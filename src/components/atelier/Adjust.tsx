"use client";

// Panneau « Ajuster » d’une fiche (DA « Plan de travail ») : options calculées en code (puces), champ libre,
// appel IA en flux (étapes réelles, progression calée sur la durée habituelle), puis la fiche se remodèle sur place.
// La proposition est gardée en base, une par recette : on la retrouve en revenant, avec ses échanges ; « Effacer »
// ou « Garder cette version » la vident. Ordinateur : panneau à droite sans voile, la fiche se décale. Téléphone et
// iPad : feuille du bas, réduite à une barre (écart, Effacer, Garder) pendant qu’on regarde la fiche remodelée.
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { clearProposalAction, keepVariantAction } from "@/app/recettes/[slug]/adjust-actions";
import type { AdjustEvent } from "@/app/api/ajuster/[slug]/route";
import { Alert, Button, calibrated, Card, Chip, Chips, Icon, Sheet, StepProgress, Textarea, useElapsed, verdictWord, type LoadItem } from "@/components/ui";
import { CardTitle, Eyebrow } from "@/components/RecipeParts";
import type { AdjustOption, AdjustPhase, AdjustProposal, Stored } from "@/lib/atelier";
import { verdictFor, type Macros } from "@/lib/nutrition/compute";
import type { MealRef } from "@/lib/eaters/core";
import type { RecipeInput } from "@/lib/recipes/format";
import { Checks, fmtUsd, IngredientsDiff, Leftovers, NutritionCompare, StepsList } from "./RecipeDiff";
import { firstOfMonth } from "@/lib/typo";
import { ofName } from "@/lib/session/people";

interface Budget {
  spentUsd: number;
  capUsd: number;
}

type Kept = Stored<AdjustProposal>;

interface Pending {
  label: string;
  optionId?: string;
  /** Affine la proposition gardée (sinon le fil recommence depuis la fiche d’origine). */
  refine: boolean;
  startedAt: number;
  phase: AdjustPhase;
  /** Où en était la barre quand la vérification au drive a commencé (elle repart de là). */
  verifyFrom: number | null;
}

interface Ctx {
  open: boolean;
  setOpen: (v: boolean) => void;
  kept: Kept | null;
  setKept: (k: Kept | null) => void;
  pending: Pending | null;
  setPending: React.Dispatch<React.SetStateAction<Pending | null>>;
  slug: string;
  color: string;
  original: RecipeInput;
}

const AdjustCtx = createContext<Ctx | null>(null);
const useAdjust = () => useContext(AdjustCtx);

const DESK = "(min-width: 1024px)";
function useDesk() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(DESK);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(DESK).matches,
    () => true
  );
}

export function AdjustProvider({
  slug,
  color,
  original,
  options,
  lead,
  leadName,
  leadRef,
  budget: budget0,
  expectedMs,
  initial,
  children,
}: {
  slug: string;
  color: string;
  original: RecipeInput;
  options: AdjustOption[];
  /** Part de base de la personne de référence (profil actif), pour la phrase d’accueil du panneau. */
  lead?: Macros | null;
  leadName?: string | null;
  leadRef?: MealRef | null;
  budget: Budget;
  /** Durée habituelle d’un appel « ajuster » (médiane des derniers, ai_calls.duration_ms). */
  expectedMs: number;
  /** Proposition gardée en base pour cette recette. */
  initial: Kept | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kept, setKept] = useState<Kept | null>(initial);
  const [pending, setPending] = useState<Pending | null>(null);
  const [budget, setBudget] = useState(budget0);
  const desk = useDesk();
  return (
    <AdjustCtx.Provider value={{ open, setOpen, kept, setKept, pending, setPending, slug, color, original }}>
      {/* Ordinateur : la fiche se décale pour rester visible à gauche du panneau (420 px). */}
      <div className={`transition-[margin] duration-[var(--dur-base)] ease-[var(--ease-out)] ${open && desk ? "lg:mr-[max(0px,calc(58.75rem_-_50vw))]" : ""}`}>{children}</div>
      <Panel options={options} intro={intro(lead ?? null, leadName ?? null, leadRef ?? null)} budget={budget} onBudget={setBudget} desk={desk} expectedMs={expectedMs} />
    </AdjustCtx.Provider>
  );
}

/** Bouton d’ouverture, dans l’en-tête de la fiche. Un point d’accent signale une proposition gardée. */
export function AdjustButton({ block = false }: { block?: boolean }) {
  const c = useAdjust();
  if (!c) return null;
  return (
    <Button icon="sliders" block={block} onClick={() => c.setOpen(!c.open)} aria-expanded={c.open} className={`relative ${c.open ? "!border-accent !bg-accent-soft !text-accent" : ""}`}>
      Ajuster
      {(c.kept || c.pending) && !c.open && <span aria-label="proposition en cours" className={`absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ${c.pending ? "k-live" : ""}`} />}
    </Button>
  );
}

function deltasOf(p: AdjustProposal) {
  const v = p.verification;
  return {
    dk: v.before ? Math.round(v.after.lead.kcal - v.before.lead.kcal) : 0,
    dp: v.before ? Math.round(v.after.lead.protein - v.before.lead.protein) : 0,
  };
}

function Deltas({ p, small = false }: { p: AdjustProposal; small?: boolean }) {
  const { dk, dp } = deltasOf(p);
  return (
    <span className={`num whitespace-nowrap ${small ? "text-[14px]" : "text-[15px]"}`}>
      <b className={`font-display font-bold ${dk <= 0 ? "text-ok" : "text-warn"}`}>
        {dk > 0 ? "+" : dk < 0 ? "−" : "±"}
        {Math.abs(dk)} kcal
      </b>
      <span className="text-faint"> · </span>
      <b className={`font-display font-bold ${dp >= 0 ? "text-ok" : "text-warn"}`}>
        {dp >= 0 ? "+" : "−"}
        {Math.abs(dp)} g
      </b>
      <span className="text-[12px] text-ink-2"> par part</span>
    </span>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return new Date().toDateString() === d.toDateString() ? `aujourd’hui à ${hm}` : `le ${firstOfMonth(d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }))} à ${hm}`;
}

/** Sous l’en-tête de la fiche, panneau fermé : la proposition gardée, à reprendre ou à effacer. */
export function AdjustNotice() {
  const c = useAdjust();
  const [clearing, startClear] = useTransition();
  if (!c || c.open || (!c.kept && !c.pending)) return null;
  const last = c.kept?.exchanges.at(-1);
  return (
    <Card flat className="flex animate-swap-in flex-wrap items-center gap-x-3 gap-y-2 border-dashed border-line-strong bg-surface-2 px-3.5 py-2.5">
      <Icon name="sparkdraft" className="text-accent" />
      <div className="grid min-w-0 flex-1">
        <span className="text-[14px] font-semibold">{c.pending ? `L’IA prépare une variante · ${c.pending.label}` : `Proposition en cours${last ? ` · ${last.ask}` : ""}`}</span>
        {c.kept && !c.pending && (
          <span className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink-2">
            <Deltas p={c.kept.proposal} small />
            <span suppressHydrationWarning>· {when(c.kept.updatedAt)}</span>
          </span>
        )}
      </div>
      <div className="grid w-full grid-flow-col gap-2 sm:w-auto">
        {c.kept && !c.pending && (
          <Button
            size="sm"
            variant="quiet"
            state={clearing ? "loading" : "idle"}
            loadingLabel="Effacement…"
            onClick={() =>
              startClear(async () => {
                const r = await clearProposalAction(c.slug);
                if (r.ok) c.setKept(null);
              })
            }
          >
            Effacer
          </Button>
        )}
        <Button size="sm" icon="sliders" onClick={() => c.setOpen(true)}>
          {c.pending ? "Suivre" : "Reprendre"}
        </Button>
      </div>
    </Card>
  );
}

/** Zone de la fiche remplacée par la variante quand le panneau la montre ; balayée doucement pendant le travail de l’IA. */
export function AdjustSlot({ part, children }: { part: "nutrition" | "ingredients" | "steps"; children: React.ReactNode }) {
  const c = useAdjust();
  if (!c) return <>{children}</>;
  const p = c.open ? c.kept?.proposal : null;
  const body = !p ? (
    children
  ) : part === "nutrition" ? (
    <NutritionCompare before={p.verification.before} after={p.verification.after} coverage={p.verification.after.coverage} />
  ) : part === "ingredients" ? (
    <IngredientsDiff rows={p.verification.rows} title="Ingrédients · variante" color={c.color} />
  ) : (
    <Card as="section" pad="md">
      <CardTitle>Étapes · variante</CardTitle>
      <StepsList steps={p.draft.steps} before={c.original.steps} color={c.color} />
    </Card>
  );
  if (!c.pending || !c.open) return <>{body}</>;
  return (
    <div className="k-scan rounded-[14px]" aria-busy="true">
      {body}
    </div>
  );
}

function Bubble({ me = false, children }: { me?: boolean; children: React.ReactNode }) {
  return (
    <div className={`max-w-[88%] animate-swap-in rounded-[14px] px-3 py-2.5 text-[14px] leading-snug ${me ? "justify-self-end rounded-br-[4px] bg-accent text-on-accent" : "justify-self-start rounded-bl-[4px] bg-surface-2"}`}>{children}</div>
  );
}

function intro(h: Macros | null, name: string | null, t: MealRef | null) {
  if (!h) return "Que veux-tu changer ?";
  const k = Math.round(h.kcal);
  const who = name ? `La part ${ofName(name)}` : "Une part";
  const v = verdictFor(t, h);
  if (!t || !v) return `Que veux-tu changer ? ${who} est à ${k} kcal et ${Math.round(h.protein)} g de protéines.`;
  const gap = v.kcal === "high" ? `, ${k - t.kcalMax} au-dessus de sa cible` : v.kcal === "low" ? `, ${t.kcalMin - k} sous sa cible` : ", dans sa cible";
  return `Que veux-tu changer ? ${who} est à ${k} kcal${gap}, et ${Math.round(h.protein)} g de protéines (${verdictWord(v.protein)}).`;
}

// Étapes du chargement : la lecture et la vérification au drive sont des signaux réels du serveur ; pendant l’appel IA
// (une seule requête), « recherche des leviers » puis « proposition » se relaient au tiers de la durée habituelle.
const AI_SHARE = 0.86; // part de la barre consacrée à l’IA (le reste : la vérification)
const LEVERS_UNTIL = 0.33;

function useLoad(pending: Pending | null, expectedMs: number) {
  const elapsed = useElapsed(pending?.startedAt ?? null);
  if (!pending) return null;
  const ph = pending.phase;
  const aiFrac = elapsed / Math.max(1, expectedMs);
  const inAi = ph.phase === "ai";
  const verify = ph.phase === "verify" ? ph : null;
  const from = pending.verifyFrom ?? AI_SHARE;
  const value = ph.phase === "read" ? 0.03 : verify ? from + (0.98 - from) * (verify.total ? verify.done / verify.total : 1) : Math.max(0.05, calibrated(elapsed, expectedMs, AI_SHARE));
  const st = (on: boolean, done: boolean): LoadItem["state"] => (done ? "done" : on ? "on" : "idle");
  const items: LoadItem[] = [
    { label: "Lecture de la fiche", state: st(ph.phase === "read", ph.phase !== "read") },
    { label: "Recherche des leviers", state: st(inAi && aiFrac < LEVERS_UNTIL, Boolean(verify) || (inAi && aiFrac >= LEVERS_UNTIL)) },
    { label: "Proposition de la variante", state: st(inAi && aiFrac >= LEVERS_UNTIL, Boolean(verify)) },
    {
      label: "Vérification au drive",
      state: st(Boolean(verify), false),
      trail: verify && verify.total > 0 ? <span className="num text-[13px] text-ink-2">{verify.done}/{verify.total}</span> : undefined,
    },
  ];
  const left = Math.ceil((expectedMs - elapsed) / 1000);
  const aside = verify ? "presque fini" : ph.phase === "read" ? null : left > 1 ? `≈ ${left} s` : "encore un instant";
  return { value, items, aside };
}

async function streamAdjust(slug: string, body: object, onEvent: (e: AdjustEvent) => void) {
  const res = await fetch(`/api/ajuster/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(res.status === 400 ? "Demande invalide." : `Serveur injoignable (${res.status}).`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as AdjustEvent);
    }
    if (done) break;
  }
}

function Panel({ options, intro, budget, onBudget, desk, expectedMs }: { options: AdjustOption[]; intro: string; budget: Budget; onBudget: (b: Budget) => void; desk: boolean; expectedMs: number }) {
  const c = useAdjust()!;
  const router = useRouter();
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [clearing, startClear] = useTransition();
  const [mini, setMini] = useState(false); // téléphone : feuille réduite pour voir la fiche
  const lastValue = useRef(0);
  const openRef = useRef(c.open); // la réponse peut arriver panneau fermé : ne pas faire sauter la fiche
  openRef.current = c.open;
  const load = useLoad(c.pending, expectedMs);
  // Ref stable : la feuille ne défile qu’une fois, à l’apparition du chargement.
  const scrollIn = useCallback((el: HTMLDivElement | null) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" }), []);
  if (load) lastValue.current = load.value;

  const proposal = c.kept?.proposal ?? null;
  const pending = c.pending;

  const ask = (input: { optionId?: string; text?: string; refine?: boolean }, label: string) => {
    if (pending) return;
    setError(null);
    c.setPending({ label, optionId: input.optionId, refine: Boolean(input.refine), startedAt: Date.now(), phase: { phase: "read" }, verifyFrom: null });
    let finished = false;
    streamAdjust(c.slug, { ...input, label }, (e) => {
      if (e.type === "phase") {
        const { type: _t, ...phase } = e;
        c.setPending((p) => (p ? { ...p, phase, verifyFrom: phase.phase === "verify" && p.verifyFrom == null ? Math.max(lastValue.current, 0.5) : p.verifyFrom } : p));
      } else if (e.type === "error") {
        finished = true;
        setError(e.error);
      } else {
        finished = true;
        onBudget(e.budget);
        c.setKept(e.stored);
        if (input.text) setText("");
        if (openRef.current && !window.matchMedia(DESK).matches) {
          setMini(true);
          // La fiche passe sur l’onglet des bols, où se voit la variante.
          history.replaceState(null, "", "#ingredients");
          window.dispatchEvent(new HashChangeEvent("hashchange"));
          document.getElementById("ingredients")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        if (!finished) setError((m) => m ?? "La connexion a été coupée. Si l’IA a fini, la proposition t’attend en rouvrant la fiche.");
        c.setPending(null);
      });
  };
  const clear = () => {
    setError(null);
    startClear(async () => {
      const r = await clearProposalAction(c.slug);
      if (!r.ok) return setError(r.error);
      c.setKept(null);
      setMini(false);
    });
  };
  // Fermer garde la proposition ; un appel en cours continue côté serveur et s’enregistre.
  const close = () => {
    setMini(false);
    c.setOpen(false);
  };
  const keep = () => {
    if (!proposal) return;
    setError(null);
    startSave(async () => {
      const r = await keepVariantAction(c.slug, proposal.draft, proposal.explanation);
      if (!r.ok) return setError(r.error);
      c.setKept(null);
      router.push(`/recettes/${r.slug}?variante=1`);
      window.scrollTo({ top: 0 });
    });
  };

  if (!c.open) return null;
  const v = proposal?.verification;
  const blocked = (v?.blocked.length ?? 0) > 0;
  const shown = Boolean(proposal && !pending);
  const lastOption = pending ? pending.optionId : c.kept?.exchanges.at(-1)?.optionId;
  const recommended = options.find((o) => o.recommended);

  const keepButtons = (
    <div className="grid grid-cols-[1fr_1.6fr] gap-2">
      <Button onClick={clear} disabled={saving || Boolean(pending)} state={clearing ? "loading" : "idle"} loadingLabel="Effacement…" title="Vider la proposition gardée pour cette recette">
        Effacer
      </Button>
      <Button variant="primary" icon="check" onClick={keep} disabled={blocked || Boolean(pending)} state={saving ? "loading" : "idle"} loadingLabel="Enregistrement…" title={blocked ? "Un ingrédient indispensable est à remplacer" : undefined}>
        Garder cette version
      </Button>
    </div>
  );
  const budgetLine = (
    <p className="text-[12px] text-faint">
      IA ce mois : {fmtUsd(budget.spentUsd)} sur {fmtUsd(budget.capUsd)} · environ 0,05 à 0,10 $ par proposition
    </p>
  );

  // Téléphone et iPad, variante proposée : barre réduite au-dessus de la fiche remodelée.
  if (!desk && shown && mini && proposal)
    return (
      <div role="region" aria-label="Variante proposée" className="fixed inset-x-0 bottom-0 z-50 grid animate-sheet-up gap-2.5 rounded-t-[20px] border border-line bg-raised px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-2 shadow-e3">
        <button type="button" onClick={() => setMini(false)} aria-label="Afficher les détails" className="mx-auto h-[5px] w-10 rounded-[3px] bg-line-strong active:scale-100" />
        <div className="flex items-center justify-between gap-2">
          <div className="grid min-w-0">
            <b className="text-[15px]">Variante proposée</b>
            <Deltas p={proposal} />
          </div>
          <Button size="sm" variant="quiet" onClick={() => setMini(false)}>
            Détails
          </Button>
        </div>
        {blocked && <p className="text-[13px] font-semibold text-ko-ink">À remplacer avant de garder : {v!.blocked.join(", ")}</p>}
        {error && <Alert tone="ko">{error}</Alert>}
        {keepButtons}
      </div>
    );

  return (
    <Sheet
      open
      onClose={close}
      modal={!desk}
      title={proposal ? "Variante proposée" : "Ajuster la recette"}
      headerAction={
        shown && !desk ? (
          <Button size="sm" variant="quiet" onClick={() => setMini(true)}>
            Voir la fiche
          </Button>
        ) : null
      }
      footer={
        <div className="grid gap-2">
          {proposal && keepButtons}
          {budgetLine}
        </div>
      }
    >
      <Chips>
        {options.map((o) => (
          <Chip
            key={o.id}
            pressed={lastOption === o.id}
            disabled={Boolean(pending)}
            title={o.hint}
            onMouseEnter={() => setHint(o.hint)}
            onFocus={() => setHint(o.hint)}
            onMouseLeave={() => setHint(null)}
            onClick={() => ask({ optionId: o.id }, o.label)}
            className={o.recommended && lastOption !== o.id ? "!border-accent text-accent" : ""}
          >
            {o.label}
          </Chip>
        ))}
      </Chips>
      {!pending && (
        <p className="-mt-1 min-h-[2.6em] text-[13px] leading-snug text-ink-2">
          {hint ??
            (proposal
              ? "Une option repart de la fiche d’origine ; tes mots, en bas, affinent cette proposition."
              : recommended
                ? `Conseillé : ${recommended.label.toLowerCase()} — ${recommended.hint}`
                : "Touche une option, ou écris ta demande.")}
        </p>
      )}

      <div className="grid gap-2" aria-live="polite">
        <Bubble>{intro}</Bubble>
        {(!pending || pending.refine) && c.kept?.exchanges.map((e, i) => (
          <div key={`${e.at}-${i}`} className="contents">
            <Bubble me>
              {e.refine && <span className="mr-1 text-[12px] opacity-80">affiner ·</span>}
              {e.ask}
            </Bubble>
            <Bubble>{e.answer}</Bubble>
          </div>
        ))}
        {pending && <Bubble me>{pending.label}</Bubble>}
        {pending && load && (
          // Téléphone : la feuille défile jusqu’au chargement, sous la demande qui vient d’être faite.
          <div ref={scrollIn}>
            <StepProgress title="L’IA prépare une variante" value={load.value} items={load.items} aside={load.aside} className="animate-swap-in" />
          </div>
        )}
      </div>

      {shown && proposal && v && (
        <>
          <div className="flex items-center justify-between gap-2 rounded-[12px] border border-line bg-surface px-3.5 py-2.5">
            <span className="text-[14px] text-ink-2">Écart</span>
            <Deltas p={proposal} />
          </div>
          {proposal.changes.length > 0 && (
            <div>
              <Eyebrow className="mb-1.5">Changements</Eyebrow>
              <div className="grid overflow-hidden rounded-[14px] border border-line bg-surface">
                {proposal.changes.map((ch, i) => (
                  <div key={`${i}-${ch}`} className="animate-swap-in border-b border-line px-3.5 py-2.5 text-[14px] font-medium last:border-b-0" style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}>
                    {ch}
                  </div>
                ))}
              </div>
            </div>
          )}
          <Checks v={v} />
          <Leftovers items={v.leftovers} />
        </>
      )}

      {error && (
        <Alert tone="ko" role="alert">
          {error}
        </Alert>
      )}

      {!pending && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) ask({ text, refine: Boolean(proposal) }, text.trim());
          }}
        >
          <Textarea
            id="adjust-free"
            aria-label={proposal ? "Affiner la proposition" : "Ta demande"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim()) ask({ text, refine: Boolean(proposal) }, text.trim());
              }
            }}
            rows={2}
            maxLength={600}
            placeholder={proposal ? "Affine : garde la crème, plus de champignons, moins de riz…" : "Ou dis-le avec tes mots : remplacer la crème par du skyr, garder le goût fumé…"}
            className="resize-none"
          />
          <Button type="submit" variant={proposal ? "secondary" : "primary"} icon="sparkdraft" disabled={!text.trim()} block>
            {proposal ? "Affiner cette proposition" : "Proposer une variante"}
          </Button>
        </form>
      )}
    </Sheet>
  );
}
