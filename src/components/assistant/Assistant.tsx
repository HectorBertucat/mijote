"use client";

// Assistant, partout : un bouton dans l’en-tête (⌘I ou Ctrl I au clavier, ou « Demander à l’assistant »
// dans ⌘K) ouvre un panneau (feuille du bas sur téléphone). La réponse arrive en flux ; chaque action
// proposée est une carte chiffrée par l’appli, qu’on applique ou annule d’un geste.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button, Icon, Sheet, Textarea } from "@/components/ui";
import { Row, Verdict } from "@/components/sante/carnet";
import type { AssistantActionView, AssistantView } from "@/lib/assistant/store";
import { applyAction, dismissAction, loadAssistant, restartAssistant } from "./actions";

/** Évènement pour ouvrir l’assistant d’ailleurs (⌘K), avec une question à envoyer. */
export const ASSISTANT_EVENT = "mijote:assistant";
export const askAssistant = (text?: string) => window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail: { text } }));

function starters(path: string): string[] {
  if (/^\/recettes\/[^/]+/.test(path)) return ["Cette recette convient-elle à nos objectifs ?", "Je l’ajoute à la semaine ?"];
  if (path.startsWith("/semaine")) return ["Quelle recette cette semaine pour plus de protéines ?", "On lance les courses ?"];
  if (path.startsWith("/frigo")) return ["Quelle boîte manger ce soir ?"];
  if (/^\/sante\/course\/[^/]+$/.test(path) && !/\/(reglages|sorties)$/.test(path)) return ["Explique-moi cette sortie.", "Qu’est-ce que je change pour la prochaine ?"];
  if (path.startsWith("/sante/course")) return ["Pourquoi cette séance ?", "Je ne peux pas courir demain : on décale ?", "Je me sens fatigué : on allège la semaine ?"];
  if (path.startsWith("/sante")) return ["Dois-je prendre un shaker ?", "L’autre personne devrait-elle prendre une collation le matin ?"];
  return ["Dois-je prendre un shaker ?", "Quelle recette cette semaine pour plus de protéines ?", "Quelle boîte manger ce soir ?"];
}

function ActionCard({ messageId, a, onDone }: { messageId: string; a: AssistantActionView; onDone: (messages: AssistantView[], note?: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const apply = () =>
    start(async () => {
      const r = await applyAction(messageId, a.index);
      setError(r.ok ? null : r.message);
      onDone(r.messages);
      if (r.ok) router.refresh();
    });
  const dismiss = () => start(async () => onDone(await dismissAction(messageId, a.index)));
  const run = a.kind.startsWith("course_");

  if (a.status === "refused")
    return (
      <div className="grid gap-1 border-l-2 border-line-strong pl-4 text-small text-ink-2">
        <span className="label text-ink-3">{a.title} · écartée par l’appli</span>
        <span>{a.reason}</span>
      </div>
    );
  return (
    <div className="grid gap-3 border-t-2 border-ink pt-3">
      {run && (
        <span className="label inline-flex items-center gap-1.5 text-ink-2">
          <Icon name="pulse" size="s" />
          Course
        </span>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold">{a.title}</span>
        {a.status === "applied" && <Verdict tone="ok">appliquée</Verdict>}
        {a.status === "dismissed" && <Verdict tone="idle">annulée</Verdict>}
      </div>
      {a.why && <p className="text-small text-ink-2">{a.why}</p>}
      {!!a.lines?.length && (
        <dl className="grid border-t border-line text-small">
          {a.lines.map((l) => (
            <Row key={l.label} k={l.label} className="!grid-cols-[minmax(0,7rem)_minmax(0,1fr)] !py-2">
              {l.value}
            </Row>
          ))}
        </dl>
      )}
      {!!a.notes?.length && (
        <ul className="grid gap-1 border-l-2 border-warn pl-4 text-small">
          {a.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {a.status === "proposed" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" icon="check" state={pending ? "loading" : "idle"} onClick={apply}>
            Appliquer
          </Button>
          <Button size="sm" variant="quiet" disabled={pending} onClick={dismiss}>
            Annuler
          </Button>
        </div>
      )}
      {a.status === "applied" && a.result && (
        <p className="text-small text-ink-2">
          {a.result}
          {run && " La montre suit à la prochaine ouverture de l’app Mijote Santé."}
          {a.href && (
            <>
              {" "}
              <Link href={a.href} className="font-bold text-accent underline underline-offset-2">
                {run ? "Voir le plan" : "Voir"}
              </Link>
            </>
          )}
        </p>
      )}
      {error && <p className="text-small text-ko-ink">{error}</p>}
    </div>
  );
}

export function Assistant() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantView[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(
    async (t: string) => {
      const msg = t.trim();
      if (!msg || sending) return;
      setSending(msg);
      setPartial("");
      setText("");
      setError(null);
      try {
        const week = new URLSearchParams(window.location.search).get("w");
        const res = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: msg, path, week }) });
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? "L’assistant n’a pas pu répondre.");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let done = false;
        while (!done) {
          const r = await reader.read();
          done = r.done;
          buf += dec.decode(r.value ?? new Uint8Array(), { stream: !done });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const ev = JSON.parse(line) as { t: "delta"; text: string } | { t: "done"; message: AssistantView } | { t: "error"; message: string };
            if (ev.t === "delta") setPartial((p) => p + ev.text);
            else if (ev.t === "done") setMessages((m) => [...(m ?? []), { id: `q-${ev.message.id}`, role: "user", text: msg, actions: [] }, ev.message]);
            else throw new Error(ev.message);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "L’assistant n’a pas pu répondre.");
        setText(msg);
      }
      setSending(null);
      setPartial("");
    },
    [path, sending]
  );

  // Ouvrir : ⌘I / Ctrl I, ou l’évènement de ⌘K (avec une question à envoyer).
  const pendingAsk = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onAsk = (e: Event) => {
      const t = (e as CustomEvent<{ text?: string }>).detail?.text?.trim();
      if (t) pendingAsk.current = t;
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(ASSISTANT_EVENT, onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(ASSISTANT_EVENT, onAsk);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadAssistant().then((m) => {
      if (!alive) return;
      setMessages(m);
      const q = pendingAsk.current;
      pendingAsk.current = null;
      if (q) send(q);
      else setTimeout(() => field.current?.focus(), 0);
    });
    return () => {
      alive = false;
    };
    // send change à chaque frappe : on ne recharge qu’à l’ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages?.length, sending, partial]);

  const list = messages ?? [];
  const quick = sending || list.length ? [] : starters(path);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Assistant (⌘I)" title="Assistant (⌘I)" className="grid size-tap place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink">
        <Icon name="talk" />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        width={460}
        title="Assistant"
        headerAction={
          list.length > 0 && (
            <Button
              size="sm"
              variant="quiet"
              disabled={!!sending}
              onClick={async () => {
                await restartAssistant();
                setMessages([]);
                setError(null);
              }}
            >
              Repartir de zéro
            </Button>
          )
        }
        footer={
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <Textarea
              ref={field}
              aria-label="Question à l’assistant"
              rows={2}
              value={text}
              placeholder="Une question sur vos repas, vos objectifs…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-small text-ink-3">L’appli vérifie chaque proposition.</span>
              <Button type="submit" size="sm" variant="primary" disabled={!text.trim() || !!sending} state={sending ? "loading" : "idle"} loadingLabel="…">
                Envoyer
              </Button>
            </div>
          </form>
        }
      >
        <ol className="grid gap-6 pb-2" aria-live="polite">
          {messages && list.length === 0 && !sending && (
            <li className="grid gap-2">
              <p className="text-body">Pose ta question avec tes mots. Je lis vos objectifs, la semaine, le frigo et les recettes ; je propose, l’appli vérifie, tu appliques d’un geste.</p>
            </li>
          )}
          {list.map((m) =>
            m.role === "user" ? (
              <UserLine key={m.id} text={m.text} />
            ) : (
              <li key={m.id} className="grid gap-4">
                <p className="whitespace-pre-wrap text-body">{m.text}</p>
                {m.actions.map((a) => (
                  <ActionCard key={a.index} messageId={m.id} a={a} onDone={setMessages} />
                ))}
              </li>
            )
          )}
          {sending && (
            <>
              <UserLine text={sending} />
              <li className="grid gap-2">
                <p className="whitespace-pre-wrap text-body">{partial || <span className="text-ink-2 motion-safe:animate-pulse">Je regarde vos données…</span>}</p>
              </li>
            </>
          )}
          <li ref={end} aria-hidden className="h-0" />
        </ol>
        {quick.length > 0 && (
          <ul className="grid border-t border-line" aria-label="Questions">
            {quick.map((s) => (
              <li key={s} className="border-b border-line">
                <button type="button" onClick={() => send(s)} className="flex min-h-tap w-full items-center justify-between gap-4 rounded-[8px] py-3 text-left font-bold text-ink-2 hover:text-ink">
                  {s}
                  <Icon name="chev" size="s" className="text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-small text-ko-ink">{error}</p>}
      </Sheet>
    </>
  );
}

function UserLine({ text }: { text: string }) {
  return (
    <li className="grid max-w-[85%] justify-self-end">
      <p className="whitespace-pre-wrap rounded-[8px] bg-surface-2 px-4 py-3 text-body">{text}</p>
    </li>
  );
}
