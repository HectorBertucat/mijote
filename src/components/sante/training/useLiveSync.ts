"use client";

// Synchronisation d'un écran avec la séance partagée : l'état confirmé par le serveur, les gestes de
// cet écran pas encore confirmés (appliqués tout de suite par-dessus), l'abonnement SSE et l'écart
// d'horloge avec le serveur. Les gestes partent un par un ; en cas de conflit (un autre écran a écrit
// avant), le geste est rejoué sur l'état du serveur, où `act` l'ignore s'il ne s'applique plus.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { act, type Live, type LiveAction } from "@/lib/training/live";
import type { Program, Workout } from "@/lib/training/program";

export interface LiveRowClient {
  id: string;
  personId: string;
  live: Live;
  version: number;
  ended: boolean;
}

export function useLiveSync(p: Program, initial: LiveRowClient, workouts: Workout[]) {
  const [confirmed, setConfirmed] = useState({ live: initial.live, version: initial.version, ended: initial.ended });
  const [queue, setQueue] = useState<{ a: LiveAction; at: number }[]>([]);
  const [offset, setOffset] = useState(0);
  const [online, setOnline] = useState(true);
  const conf = useRef(confirmed);
  conf.current = confirmed;
  const q = useRef(queue);
  q.current = queue;
  const busy = useRef(false);
  const wk = useRef(workouts);
  wk.current = workouts;
  const off = useRef(offset);
  off.current = offset;

  const adopt = useCallback((row: { live: Live; version: number; ended: boolean }) => {
    if (row.version >= conf.current.version) setConfirmed({ live: row.live, version: row.version, ended: row.ended });
  }, []);

  useEffect(() => {
    const es = new EventSource(`/api/sante/seance/${initial.id}/events`);
    es.addEventListener("hello", (m) => {
      const { now } = JSON.parse((m as MessageEvent).data) as { now: number };
      setOffset(now - Date.now());
      setOnline(true);
    });
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.onmessage = (m) => adopt(JSON.parse(m.data));
    return () => es.close();
  }, [initial.id, adopt]);

  // Envoi des gestes, un à la fois, chacun calculé sur le dernier état confirmé.
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (q.current.length) {
        const { a, at } = q.current[0];
        const base = conf.current;
        if (base.ended) {
          setQueue([]);
          break;
        }
        const next = act(p, base.live, a, at, wk.current);
        if (next === base.live) {
          q.current = q.current.slice(1); // le geste ne s'applique plus (étape déjà passée) : rien à écrire
          setQueue(q.current);
          continue;
        }
        let res: Response;
        try {
          res = await fetch(`/api/sante/seance/${initial.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expect: base.version, live: next }) });
        } catch {
          setOnline(false);
          await new Promise((r) => setTimeout(r, 2000));
          continue; // réseau coupé : on réessaie
        }
        const body = (await res.json().catch(() => null)) as (LiveRowClient & { ok: boolean }) | null;
        if (res.ok && body) {
          setOnline(true);
          conf.current = { live: body.live, version: body.version, ended: body.ended };
          setConfirmed(conf.current);
          q.current = q.current.slice(1);
          setQueue(q.current);
        } else if (res.status === 409 && body) {
          // Un autre écran a écrit avant : on rejoue le geste sur son état (act ignore ce qui ne s'applique plus).
          conf.current = { live: body.live, version: body.version, ended: body.ended };
          setConfirmed(conf.current);
        } else {
          q.current = q.current.slice(1); // refusé : on l'abandonne
          setQueue(q.current);
        }
      }
    } finally {
      busy.current = false;
    }
  }, [p, initial.id]);

  const dispatch = useCallback(
    (a: LiveAction) => {
      q.current = [...q.current, { a, at: Date.now() + off.current }];
      setQueue(q.current);
      void pump();
    },
    [pump]
  );

  const live = useMemo(() => queue.reduce((l, x) => act(p, l, x.a, x.at, workouts), confirmed.live), [p, queue, confirmed.live, workouts]);
  const now = useCallback(() => Date.now() + off.current, []);
  return { live, version: confirmed.version, ended: confirmed.ended, dispatch, offset, now, online, pending: queue.length > 0 };
}
