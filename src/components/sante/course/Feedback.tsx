// Le ressenti juste après une course, en quelques gestes : effort 1 à 10, douleur 0 à 10 et où, plaisir, malade.
// Un formulaire serveur (marche sans JavaScript) : des boutons radio dessinés en rangées de cases, au doigt et
// au clavier (flèches dans un groupe). L'effort et la douleur alimentent l'adaptation du plan (plan.ts § 4.8) ;
// le plaisir est seulement gardé et affiché.
import { Button, Textarea } from "@/components/ui";
import { PAIN_PLACES } from "@/lib/running/store";
import { feedbackAction } from "@/app/sante/course/actions";

const EFFORT_WORD = ["", "très facile", "très facile", "facile", "facile", "modéré", "modéré", "dur", "dur", "très dur", "à fond"];
export const ENJOY_WORD = ["", "pénible", "bof", "correct", "bien", "super"];

const CELL =
  "grid min-h-tap min-w-0 cursor-pointer place-items-center rounded-[8px] border border-line-strong bg-surface text-[15px] font-bold text-ink transition-colors duration-[var(--dur-1)] ease-[var(--ease-out)] hover:border-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-bg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent";

function Scale({ name, legend, from, to, value, words, hint }: { name: string; legend: string; from: number; to: number; value: number | null; words?: string[]; hint?: string }) {
  const xs = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <fieldset className="grid gap-2">
      <legend className="label pb-2 text-ink-2">{legend}</legend>
      <div className={`grid gap-1 ${xs.length > 6 ? "grid-cols-6 sm:grid-cols-11" : "grid-cols-5"}`}>
        {xs.map((x) => (
          <label key={x} className={`${CELL} ${words && xs.length <= 5 ? "px-1 text-small" : "num"}`} title={words?.[x]}>
            <input type="radio" name={name} value={x} defaultChecked={value === x} className="sr-only" aria-label={words?.[x] ? `${x}, ${words[x]}` : String(x)} />
            {words && xs.length <= 5 ? words[x] : x}
          </label>
        ))}
      </div>
      {hint && <span className="text-small text-ink-2">{hint}</span>}
    </fieldset>
  );
}

export function FeedbackForm({ date, back, initial, title = "Comment ça s’est passé ?" }: { date: string; back: string; initial?: { effort: number | null; pain: number | null; painWhere: string | null; enjoy: number | null; sick: boolean; note: string | null } | null; title?: string }) {
  return (
    <form action={feedbackAction} className="grid gap-6">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="back" value={back} />
      <b className="text-h3">{title}</b>
      <Scale name="effort" legend="Effort, de 1 à 10" from={1} to={10} value={initial?.effort ?? null} words={EFFORT_WORD} hint="3 ou 4 : on parle en phrases. 7 ou 8 : quelques mots." />
      <Scale name="pain" legend="Une douleur ? De 0 (aucune) à 10" from={0} to={10} value={initial?.pain ?? 0} />
      <fieldset className="grid gap-2">
        <legend className="label pb-2 text-ink-2">Où, si douleur</legend>
        <div className="flex flex-wrap gap-1">
          {PAIN_PLACES.map((p) => (
            <label key={p} className={`${CELL} px-3 text-small`}>
              <input type="radio" name="painWhere" value={p} defaultChecked={initial?.painWhere === p} className="sr-only" />
              {p}
            </label>
          ))}
        </div>
      </fieldset>
      <Scale name="enjoy" legend="Plaisir" from={1} to={5} value={initial?.enjoy ?? null} words={ENJOY_WORD} />
      <label className="flex min-h-tap items-center gap-3 text-body">
        <input type="checkbox" name="sick" defaultChecked={initial?.sick} className="size-5 accent-[var(--c-ink)]" /> Malade (fièvre, symptômes sous le cou)
      </label>
      <label className="grid gap-2">
        <span className="label text-ink-2">Un mot (facultatif)</span>
        <Textarea name="note" rows={2} maxLength={300} defaultValue={initial?.note ?? ""} />
      </label>
      <div>
        <Button type="submit" variant="primary" icon="check">
          Noter
        </Button>
      </div>
    </form>
  );
}
