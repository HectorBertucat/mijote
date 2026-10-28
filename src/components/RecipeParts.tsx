// Morceaux d'une fiche, communs à la fiche, au panneau « Ajuster » et à l'atelier (DA « Plan de travail ») :
// étape (récipient, foyer, niveau, four, durée, bols, repère sensoriel) et groupe d'ingrédients par bol. Sans état.
import type { ReactNode } from "react";
import { BowlBadge, Cue, Icon, Induction, SpecChip, type IconName, type RecipeColor } from "@/components/ui";
import { STEP_LABELS, type STEP_KINDS, type StepPhase } from "@/lib/recipes/format";
import { StepIllu } from "@/components/illus/Illu";

export function fmtQty(grams: number | null | undefined, units: number | null | undefined) {
  if (units != null && (grams == null || units < 10)) {
    const u = Number.isInteger(units) ? units : units.toLocaleString("fr-FR");
    return grams != null ? `${u} (≈ ${Math.round(grams)} g)` : `${u}`;
  }
  if (grams != null) return grams >= 1000 ? `${(grams / 1000).toLocaleString("fr-FR")} kg` : `${Math.round(grams)} g`;
  return "";
}

export function fmtMin(m: number | null | undefined) {
  if (m == null) return null;
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)} min`;
}

/** Icône d'un récipient d'après son type (base) ou son id d'équipement (sortie de l'IA). */
export function equipmentIcon(kind: string | null | undefined, id?: string | null): IconName {
  if (kind === "oven" || id === "oven") return "oven";
  if (kind === "pan" || /poele|poêle|sauteuse|wok/i.test(id ?? "")) return "pan";
  if (kind === "pot" || /cocotte|faitout|casserole|marmite/i.test(id ?? "")) return "pot";
  if (kind === "hob") return "hob";
  if (kind === "appliance") return "flame";
  return "pot";
}

/** « poele-28 » → « Poêle 28 » : libellé lisible d'un id d'équipement quand on n'a pas son nom. */
export const equipmentLabel = (id: string) => (id === "oven" ? "Four" : id).replace(/-/g, " ").replace(/^\p{L}/u, (c) => c.toUpperCase());

/** Sens du repère : on l'entend (chante, grésille), on le sent, sinon on le voit. */
function cueSense(text: string): "ear" | "nose" | "eye" {
  if (/chant|grésill|gresill|crépit|siffl|crach|bruit|entend/i.test(text)) return "ear";
  if (/sent |sentir|odeur|parfum|arôme|arome/i.test(text)) return "nose";
  return "eye";
}

/** Repère : la première phrase en citation, la suite en explication. */
export function StepCue({ text }: { text: string }) {
  const m = text.match(/^(.+?[.!?…])\s+(.+)$/s);
  return (
    <Cue sense={cueSense(text)} quote={m ? m[1] : text} className="mt-2">
      {m ? m[2] : null}
    </Cue>
  );
}

export type StepView = {
  kind: (typeof STEP_KINDS)[number];
  text: string;
  durationMin?: number | null;
  hobLevel?: number | null;
  ovenTemp?: number | null;
  equipment?: { label: string; icon: IconName } | null;
  bowls?: string[];
  cue?: string | null;
  phases?: StepPhase[] | null;
};

/** « 2,5 » → « 2 min 30 », « 0,5 » → « 30 s » : la durée d'une sous-étape. */
export function fmtPhaseMin(m: number) {
  const sec = Math.round(m * 60);
  if (sec < 60) return `${sec} s`;
  const r = sec % 60;
  return r ? `${Math.floor(sec / 60)} min ${String(r).padStart(2, "0")}` : `${sec / 60} min`;
}

/** Les sous-étapes chronométrées d'une étape, comme la session les enchaîne. */
function PhaseList({ phases }: { phases: StepPhase[] }) {
  const batches = Math.max(0, ...phases.map((p) => p.batch ?? 0));
  return (
    <ol className="mt-2 grid gap-1 border-l-2 border-line pl-3 text-[14px] leading-snug text-ink-2">
      {phases.map((p, k) => (
        <li key={k} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="num w-[62px] shrink-0 font-bold text-ink">{fmtPhaseMin(p.min)}</span>
          {p.hobLevel != null && <span className="num shrink-0 text-[12px] font-bold text-faint">niv. {p.hobLevel}</span>}
          {batches > 1 && p.batch != null && <span className="shrink-0 text-[12px] font-bold text-faint">fournée {p.batch}</span>}
          {p.wait && <span className="shrink-0 text-[12px] font-bold text-faint">attente</span>}
          <span className={`min-w-0 flex-1 ${p.wait ? "italic" : ""}`}>{p.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Une étape de la fiche : numéro, type, texte, puces de spécification, repère. `fresh` : réécrite par la variante (surlignée). */
export function StepItem({ n, step: s, color, fresh = false, badge }: { n: number; step: StepView; color: RecipeColor; fresh?: boolean; badge?: ReactNode }) {
  const specs = s.equipment || s.hobLevel != null || s.ovenTemp != null || s.durationMin != null || (s.bowls?.length ?? 0) > 0;
  return (
    <li className={`grid grid-cols-[34px_minmax(0,1fr)_auto] gap-3 border-b border-line py-3.5 last:border-b-0 ${fresh ? "-mx-2 animate-flash rounded-[10px] px-2" : ""}`}>
      <span className="font-display text-[20px] font-extrabold tabular-nums text-faint">{n}</span>
      <div className="min-w-0">
        <div className="mb-0.5 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-faint">
          {STEP_LABELS[s.kind]}
          {badge}
        </div>
        <p className="text-[16px] leading-[1.45]">{s.text}</p>
        {specs && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {s.equipment && <SpecChip icon={s.equipment.icon}>{s.equipment.label}</SpecChip>}
            {s.hobLevel != null && <SpecChip lead={<Induction level={s.hobLevel} />} />}
            {s.ovenTemp != null && (
              <SpecChip icon="oven">
                <span className="num font-[750]">{s.ovenTemp} °C</span>
              </SpecChip>
            )}
            {s.durationMin != null && <SpecChip icon="clock">{fmtMin(s.durationMin)}</SpecChip>}
            {(s.bowls ?? []).map((b) => (
              <SpecChip key={b} lead={<BowlBadge color={color} letter={b} size="xs" />}>
                bol {b}
              </SpecChip>
            ))}
          </div>
        )}
        {s.phases && s.phases.length > 0 && <PhaseList phases={s.phases} />}
        {s.cue && <StepCue text={s.cue} />}
      </div>
      <StepIllu kind={s.kind} text={s.text} size="l" className="max-sm:size-11" />
    </li>
  );
}

/** Ligne d'ingrédient : quantité à gauche (chiffres), nom ; `children` sous le nom (vérification catalogue). */
export function IngLine({ qty, name, sub, art, className = "", children }: { qty: ReactNode; name: ReactNode; sub?: ReactNode; /** Dessin de l'aliment (FoodIllu). */ art?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <div className={`flex min-w-0 items-center gap-2.5 border-b border-dashed border-line py-2 text-[15px] last:border-b-0 ${className}`}>
      <span className="num w-[92px] shrink-0 text-right font-bold max-sm:w-[76px]">{qty}</span>
      {art}
      <span className="min-w-0 flex-1">
        {name}
        {sub && <span className="text-ink-2"> {sub}</span>}
        {children}
      </span>
    </div>
  );
}

/** Groupe d'un bol : pastille ronde à la couleur de la recette, puis ses ingrédients. Sans lettre : « hors bol ». */
export function BowlGroup({ letter, color, children }: { letter: string | null; color: RecipeColor; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-3 border-b border-line py-3 last:border-b-0">
      {letter ? (
        <BowlBadge color={color} letter={letter} label={`Bol ${letter}`} />
      ) : (
        <span className="grid size-10 place-items-center rounded-full border-[2.5px] border-dashed border-line-strong text-faint" title="Hors bol">
          <Icon name="dash" size="s" />
        </span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Titre de carte d'une fiche (18 px, Archivo). */
export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
      <h2 className="text-[18px] font-bold">{children}</h2>
      {aside}
    </div>
  );
}

/** Petit titre en capitales (« Ce qui pèse le plus »). */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`font-display text-[12px] font-bold uppercase tracking-[0.12em] text-faint [font-stretch:100%] ${className}`}>{children}</div>;
}
