"use client";

// Conversation avec le coach Santé. Le coach propose des objectifs ; la carte montre ce qui change,
// ce que la vérification de l’appli a corrigé, et on applique d’un tap.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, Textarea } from "@/components/ui";
import { de, Row, Verdict } from "./carnet";
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
    <div className="grid gap-4 border-t-2 border-ink pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="label text-ink">Objectifs proposés</span>
        {m.status === "applied" && <Verdict tone="ok">appliqués</Verdict>}
        {m.status === "dismissed" && <Verdict tone="idle">ignorés</Verdict>}
      </div>
      {m.why && <p className="text-small text-ink-2">{m.why}</p>}
      <dl className="grid border-t border-line">
        {m.changes.map((c) => (
          <Row key={c.label} k={c.label}>
            {c.before && <span className="text-ink-3 line-through">{c.before}</span>}
            {c.before && <span className="text-ink-3">{" → "}</span>}
            <b>{c.after}</b>
          </Row>
        ))}
        {m.eta && <Row k="Arrivée prévue">{m.eta}</Row>}
      </dl>
      {m.notes.length > 0 && (
        <ul className="grid gap-1 border-l-2 border-warn pl-4 text-small">
          <li className="label text-warn-ink">Corrigé par l’appli</li>
          {m.notes.map((n) => (
            <li key={n}>{n}</li>
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
      {error && <p role="alert" className="text-small text-ko-ink">{error}</p>}
    </div>
  );
}

export function Coach({ personId, personName, messages, starters }: { personId: string; personName: string; messages: CoachView[]; starters: string[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const end = useRef<HTMLLIElement>(null);

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
    <div className="grid gap-8">
      <ol className="grid gap-8" aria-live="polite">
        {messages.length === 0 && !sending && (
          <li className="grid max-w-[56ch] gap-3">
            <span className="label text-ink-2">Coach</span>
            <p className="text-lead">Dis-moi ce que tu veux, avec tes mots : perdre du ventre, prendre du muscle, tenir trois séances, manger plus de protéines.</p>
            <p className="text-small text-ink-2">Je lis ta courbe, ton journal et tes séances. Je propose des objectifs, l’appli les vérifie, et tu les appliques d’un geste.</p>
          </li>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <UserLine key={m.id} text={m.text} />
          ) : (
            <li key={m.id} className="grid max-w-[min(100%,40rem)] gap-3">
              <span className="label text-ink-2">Coach</span>
              <p className="whitespace-pre-wrap text-body">{m.text}</p>
              {m.changes.length > 0 && <Proposal m={m} last={m.id === last?.id} />}
            </li>
          )
        )}
        {sending && (
          <>
            <UserLine text={sending} />
            <li className="grid gap-3">
              <span className="label text-ink-2">Coach</span>
              <p className="text-body text-ink-2">
                <span className="motion-safe:animate-pulse">Je regarde tes données…</span>
              </p>
            </li>
          </>
        )}
        <li ref={end} aria-hidden className="h-0" />
      </ol>

      {quick.length > 0 && (
        <ul className="grid max-w-[40rem] border-t border-line" aria-label="Réponses rapides">
          {quick.map((s) => (
            <li key={s} className="border-b border-line">
              <button type="button" onClick={() => send(s)} className="-mx-3 flex min-h-tap w-[calc(100%+24px)] items-center justify-between gap-4 rounded-[8px] px-3 py-3 text-left font-bold text-ink-2 hover:bg-surface-2 hover:text-ink">
                {s}
                <Icon name="chev" size="s" className="text-ink-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-small text-ko-ink">{error}</p>}

      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <Textarea
          aria-label={`Message au coach ${de(personName)}`}
          rows={3}
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

/** Ce que la personne a écrit : aligné à droite, sur le creux du papier. */
function UserLine({ text }: { text: string }) {
  return (
    <li className="grid max-w-[85%] justify-self-end gap-2 justify-items-end">
      <span className="label text-ink-3">Toi</span>
      <p className="whitespace-pre-wrap rounded-[8px] bg-surface-2 px-4 py-3 text-body">{text}</p>
    </li>
  );
}
