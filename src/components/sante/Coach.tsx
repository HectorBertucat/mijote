"use client";

// Conversation avec le coach Santé. Le coach propose des objectifs ; la carte montre ce qui change,
// ce que la vérification de l'appli a corrigé, et on applique d'un tap.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, Pill, Textarea } from "@/components/ui";
import { applyCoachProposal, dismissCoachProposal, restartCoach, sendToCoach } from "@/app/sante/actions";

export interface CoachView {
  id: string;
  role: "user" | "coach";
  text: string;
  status: "proposed" | "applied" | "dismissed" | null;
  changes: { label: string; before: string | null; after: string }[];
  notes: string[];
  eta: string | null;
  why: string | null;
  suggestions: string[];
}

function Proposal({ m, last }: { m: CoachView; last: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (f: (id: string) => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await f(m.id);
      if (!r.ok) setError(r.message);
      router.refresh();
    });
  return (
    <div className="grid gap-3 rounded-[14px] border border-line-strong bg-surface p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="text-[15px]">Objectifs proposés</b>
        {m.status === "applied" && <Pill tone="ok" icon="check">appliqués</Pill>}
        {m.status === "dismissed" && <Pill tone="idle" icon="x">ignorés</Pill>}
      </div>
      {m.why && <p className="text-[14px] text-ink-2">{m.why}</p>}
      <dl className="grid gap-1.5 text-[14px]">
        {m.changes.map((c) => (
          <div key={c.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2">
            <dt className="text-ink-2">{c.label}</dt>
            <dd>
              {c.before && <span className="text-faint line-through">{c.before}</span>}
              {c.before && " → "}
              <b>{c.after}</b>
            </dd>
          </div>
        ))}
        {m.eta && (
          <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-2">
            <dt className="text-ink-2">Arrivée prévue</dt>
            <dd>{m.eta}</dd>
          </div>
        )}
      </dl>
      {m.notes.length > 0 && (
        <ul className="grid gap-1 rounded-[10px] bg-warn-soft px-3 py-2 text-[13px] text-warn-ink">
          {m.notes.map((n) => (
            <li key={n}>Vérifié par l'appli : {n}</li>
          ))}
        </ul>
      )}
      {m.status === "proposed" && (
        <div className="flex flex-wrap gap-2">
          <Button variant={last ? "primary" : "secondary"} icon="check" state={pending ? "loading" : "idle"} onClick={() => act(applyCoachProposal)}>
            Appliquer
          </Button>
          <Button variant="quiet" disabled={pending} onClick={() => act(dismissCoachProposal)}>
            Ignorer
          </Button>
        </div>
      )}
      {error && <p className="text-[13px] text-ko-ink">{error}</p>}
    </div>
  );
}

export function Coach({ personId, personName, messages, starters }: { personId: string; personName: string; messages: CoachView[]; starters: string[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, sending]);

  const send = (t: string) => {
    const msg = t.trim();
    if (!msg || sending) return;
    setSending(msg);
    setText("");
    setError(null);
    start(async () => {
      const r = await sendToCoach(personId, msg);
      if (!r.ok) {
        setError(r.message);
        setText(msg);
      }
      setSending(null);
      router.refresh();
    });
  };
  const last = messages[messages.length - 1];
  const quick = sending ? [] : last?.role === "coach" ? last.suggestions : messages.length ? [] : starters;

  return (
    <div className="grid gap-3">
      <div className="grid gap-3" aria-live="polite">
        {messages.length === 0 && !sending && (
          <p className="rounded-[14px] bg-surface-2 p-3.5 text-[15px] text-ink-2">
            Dis au coach ce que tu veux, avec tes mots : perdre du ventre, prendre du muscle, tenir 3 séances, manger plus de protéines… Il connaît ta courbe, ton journal et tes séances. Il propose des objectifs, l'appli les vérifie, et tu les appliques d'un tap.
          </p>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <p key={m.id} className="max-w-[85%] justify-self-end whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-accent-soft px-3.5 py-2.5 text-[15px]">
              {m.text}
            </p>
          ) : (
            <div key={m.id} className="grid max-w-[min(100%,40rem)] gap-2.5">
              <p className="whitespace-pre-wrap text-[15px] leading-[1.6]">{m.text}</p>
              {m.changes.length > 0 && <Proposal m={m} last={m.id === last?.id} />}
            </div>
          )
        )}
        {sending && (
          <>
            <p className="max-w-[85%] justify-self-end whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-accent-soft px-3.5 py-2.5 text-[15px]">{sending}</p>
            <p className="text-[14px] text-ink-2">
              <span className="motion-safe:animate-pulse">Le coach regarde tes données…</span>
            </p>
          </>
        )}
        <div ref={end} />
      </div>

      {quick.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quick.map((s) => (
            <Chip key={s} onClick={() => send(s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}
      {error && <p className="text-[14px] text-ko-ink">{error}</p>}

      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <Textarea
          aria-label={`Message au coach de ${personName}`}
          rows={2}
          value={text}
          placeholder="Écris au coach…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="submit" variant="primary" disabled={!text.trim() || !!sending} state={sending ? "loading" : "idle"} loadingLabel="Envoi…">
            Envoyer
          </Button>
          {messages.length > 0 && (
            <Button
              size="sm"
              variant="quiet"
              disabled={!!sending}
              onClick={() =>
                start(async () => {
                  await restartCoach(personId);
                  router.refresh();
                })
              }
            >
              Nouvelle conversation
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
