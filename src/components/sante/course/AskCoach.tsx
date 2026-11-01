"use client";

// « Demander au coach » : ouvre l'assistant (le même, partout) avec une question sur la course. Il lit déjà
// l'instantané Course de la personne (src/lib/running/actions.ts) et sait sur quelle page on est : pas de
// conversation à part. Ses propositions reviennent en cartes vérifiées par l'appli.
import { askAssistant } from "@/components/assistant/Assistant";
import { Button, Icon } from "@/components/ui";

export function AskCoach({ questions }: { questions: string[] }) {
  return (
    <div className="grid content-start gap-3">
      <span className="label text-ink-2">Le coach</span>
      <p className="text-small text-ink-2">Il connaît ton plan, tes sorties, tes repas et ta santé ; il propose, l’appli vérifie, tu appliques d’un geste.</p>
      <div>
        <Button size="sm" variant="secondary" icon="talk" onClick={() => askAssistant()}>
          Demander au coach
        </Button>
      </div>
      <ul className="grid border-t border-line">
        {questions.map((q) => (
          <li key={q} className="border-b border-line">
            <button type="button" onClick={() => askAssistant(q)} className="flex min-h-tap w-full items-center justify-between gap-3 rounded-[8px] py-2 text-left text-small font-bold text-ink-2 hover:text-ink">
              {q}
              <Icon name="chev" size="s" className="shrink-0 text-ink-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
