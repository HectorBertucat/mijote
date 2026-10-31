"use client";

// Synchronisation d'un écran avec la session : état déduit du journal, abonnement SSE,
// envoi des actions (affichées tout de suite, confirmées par le serveur), horloge du
// serveur pour que tous les minuteurs tombent à la même seconde.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionPlan } from "@/lib/session/planner";
import { LETTERS, type DuoNames } from "@/lib/session/people";
import { randomId, reduce, type EventKind, type SessionEvent, type SessionState } from "@/lib/session/state";

export interface Toast {
  key: string;
  text: string;
  remote: boolean;
  error?: boolean;
}

/** À deux, l'auteur de l'action en tête (son prénom, sinon sa lettre). */
const whoOf = (e: SessionEvent, names: DuoNames) => (e.payload?.person === "A" || e.payload?.person === "B" ? `${names[e.payload.person].name} · ` : "");

export function describe(e: SessionEvent, plan: SessionPlan, names: DuoNames = LETTERS): string {
  const step = (id: string | null) => plan.steps.find((s) => s.id === id);
  const undo = e.payload?.undo === true;
  const who = whoOf(e, names);
  return who + describeKind(e, plan, step, undo);
}

function describeKind(e: SessionEvent, plan: SessionPlan, step: (id: string | null) => SessionPlan["steps"][number] | undefined, undo: boolean): string {
  switch (e.kind) {
    case "bowl_ready":
      return e.payload?.ready === false ? `Bol ${e.ref} décoché` : `Bol ${e.ref} prêt`;
    case "step_start":
      return undo ? `Étape ${step(e.ref)?.no ?? ""} remise à faire` : `Étape ${step(e.ref)?.no ?? ""} lancée`;
    case "step_done":
      if (e.ref?.startsWith("prep:")) {
        const t = plan.prep.tasks.find((x) => x.id === e.ref!.slice(5));
        return undo ? `${t?.title ?? "Geste"} : à refaire` : `${t?.title ?? "Geste"} : fait`;
      }
      return undo ? `Étape ${step(e.ref)?.no ?? ""} rouverte` : `Étape ${step(e.ref)?.no ?? ""} terminée`;
    case "timer_start":
      return `Minuteur « ${e.payload?.label ?? ""} » · ${e.payload?.minutes ?? ""} min`;
    case "timer_done":
      return "Minuteur arrêté";
    case "timer_pause":
      return "Minuteur en pause";
    case "timer_resume":
      return "Minuteur repris";
    case "note":
      if (typeof e.payload?.boxed === "string") {
        const name = plan.recipes.find((r) => r.slug === e.payload!.boxed)?.name ?? "Recette";
        return undo ? `${name} : à ranger` : `${name} : en boîtes`;
      }
      if (e.payload?.status === "cooking") return plan.mode === "duo" ? "Session lancée à deux" : "Cuisson lancée";
      if (e.payload?.status === "fridge") return "Bols au frigo : à demain";
      if (e.payload?.status === "prep")
        return e.payload?.resume === true ? (e.payload?.dayMode === "duo" ? "Session reprise à deux : plan du jour J refait" : "Session reprise") : "Retour à la prep";
      if (e.payload?.replan === true) return "Plan refait";
      return e.payload?.status === "done" ? "Session terminée" : "Note";
  }
}

/** Plusieurs actions d'un coup : la personne une seule fois, sans la note de démarrage. */
function describeMany(evs: SessionEvent[], plan: SessionPlan, names: DuoNames): string {
  const shown = evs.length > 1 ? evs.filter((e) => !(e.kind === "note" && e.payload?.person)) : evs;
  // Tout mettre en pause (ou reprendre) : une phrase pour tous les minuteurs.
  if (shown.length > 1 && shown.every((e) => e.kind === shown[0].kind) && (shown[0].kind === "timer_pause" || shown[0].kind === "timer_resume"))
    return shown[0].kind === "timer_pause" ? `${shown.length} minuteurs en pause` : `${shown.length} minuteurs repris`;
  const texts = shown.map((e) => describe(e, plan, names));
  const who = shown[0] ? whoOf(shown[0], names) : "";
  if (who && texts.every((t) => t.startsWith(who))) return who + texts.map((t) => t.slice(who.length)).join(" · ");
  return texts.join(" · ");
}

export function useSession(opts: { id: string; plan: SessionPlan; initialEvents: SessionEvent[]; initialStatus: SessionState["status"]; people?: DuoNames }) {
  const { id, plan } = opts;
  const [events, setEvents] = useState<SessionEvent[]>(opts.initialEvents);
  const [offset, setOffset] = useState(0);
  const [online, setOnline] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const local = useRef(new Set<string>());
  const lastSeq = useRef(Math.max(0, ...opts.initialEvents.map((e) => e.seq ?? 0)));
  const planRef = useRef(plan);
  planRef.current = plan;
  const namesRef = useRef(opts.people ?? LETTERS);
  namesRef.current = opts.people ?? LETTERS;
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  const show = useCallback((t: Omit<Toast, "key">) => setToast({ ...t, key: randomId() }), []);

  useEffect(() => {
    const es = new EventSource(`/api/session/${id}/events?after=${lastSeq.current}`);
    es.addEventListener("hello", (m) => {
      const { now } = JSON.parse((m as MessageEvent).data) as { now: number };
      setOffset(now - Date.now());
      setOnline(true);
    });
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as SessionEvent;
      lastSeq.current = Math.max(lastSeq.current, ev.seq ?? 0);
      setEvents((prev) => {
        const i = prev.findIndex((x) => x.id === ev.id);
        if (i >= 0) {
          const copy = prev.slice();
          copy[i] = ev;
          return copy;
        }
        return [...prev, ev];
      });
      if (!local.current.has(ev.id) && !(ev.kind === "note" && ev.payload?.person)) show({ text: describe(ev, planRef.current, namesRef.current), remote: true });
      // Le plan a changé (reprise à deux, réduction des unités) : chaque écran le recharge.
      if (ev.kind === "note" && ev.payload?.replan === true) routerRef.current.refresh();
    };
    return () => es.close();
  }, [id, show]);

  const send = useCallback(
    (list: { id?: string; kind: EventKind; ref?: string | null; payload?: Record<string, unknown> | null }[]) => {
      const evs: SessionEvent[] = list.map((x) => ({
        id: x.id ?? randomId(),
        at: new Date(Date.now() + offset).toISOString(),
        kind: x.kind,
        ref: x.ref ?? null,
        payload: x.payload ?? null,
      }));
      if (!evs.length) return;
      evs.forEach((e) => local.current.add(e.id));
      setEvents((prev) => [...prev, ...evs]);
      show({ text: describeMany(evs, planRef.current, namesRef.current), remote: false });
      (async () => {
        for (const e of evs) {
          try {
            const r = await fetch(`/api/session/${id}/actions`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: e.id, kind: e.kind, ref: e.ref, payload: e.payload }),
            });
            if (!r.ok) throw new Error(String(r.status));
          } catch {
            setEvents((prev) => prev.filter((x) => x.id !== e.id));
            show({ text: "Action non enregistrée : réseau coupé ?", remote: false, error: true });
          }
        }
      })();
    },
    [id, offset, show]
  );

  const state = useMemo(() => reduce(opts.initialStatus, events), [opts.initialStatus, events]);
  /** Un événement écrit par le serveur pour cet écran (reprise à deux) : pas de toast « autre écran ». */
  const markLocal = useCallback((eventId: string) => void local.current.add(eventId), []);
  return { state, events, send, offset, online, toast, setToast, markLocal };
}

/** Heure du serveur, rafraîchie chaque seconde. */
export function useNow(offset: number, initial: number, everyMs = 1000) {
  // Premier rendu à l'heure du rendu serveur : même HTML des deux côtés (hydratation).
  const [now, setNow] = useState(initial);
  useEffect(() => {
    setNow(Date.now() + offset);
    const t = setInterval(() => setNow(Date.now() + offset), everyMs);
    return () => clearInterval(t);
  }, [offset, everyMs]);
  return now;
}
