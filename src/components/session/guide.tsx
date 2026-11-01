"use client";

// Pièces de session qui disent où on en est (src/lib/session/guide.ts) : un bol cité devient une
// pastille qui montre son contenu au survol (ordinateur) ou au toucher (téléphone) ; le fil « en cours
// (mains) / en fond / ensuite » ; la barre des minuteurs (vue simple) ; ce que dit un minuteur qui
// sonne ; les rappels d’une attente (« remue ») ; le bouton de retour qui dit ce qu’il défait.
import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { restartSession } from "@/app/session/actions";
import type { Person, PlanBowl, PlanStep, SessionPlan } from "@/lib/session/planner";
import { stepStatus, type TimerState } from "@/lib/session/state";
import { ATTENTION_LABELS, containerNote, fmtMin, lanesOf, missingText, recipeStep, reminderAt, ringInfo, shareOf, takeAt, takeOf, weighLine, type LaneItem, type Undo } from "@/lib/session/guide";
import { atMoment } from "@/lib/session/flow";
import { bowlParts, clip, stepTitleOf } from "@/lib/session/text";
import { recipeVar } from "@/components/ui/recipe";
import { Alert, Button, Icon, Tape } from "@/components/ui";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import { typo } from "@/lib/typo";
import type { Controls } from "./SessionApp";
import { chime, clock, mmss, PauseAll, recipeOf, shortName } from "./parts";

const rc = (color: string) => ({ "--rc": recipeVar(color) }) as CSSProperties;

// ─── Bulle : survol à la souris, toucher au doigt, Échap ───

/**
 * Un déclencheur et sa bulle. Au survol (souris) elle s’ouvre et se referme seule ; au toucher ou au
 * clavier, elle reste jusqu’au toucher suivant, ailleurs, ou Échap. Placée sous le déclencheur, au-dessus
 * s’il n’y a pas la place, toujours dans l’écran.
 */
export function Peek({ trigger, label, children, className = "", panelClassName = "" }: { trigger: ReactNode; label: string; children: ReactNode; className?: string; panelClassName?: string }) {
  const [open, setOpen] = useState<false | "hover" | "pin">(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const later = (f: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(f, ms);
  };
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 16);
      const left = Math.min(Math.max(8, r.left + r.width / 2 - width / 2), window.innerWidth - width - 8);
      const h = panel.current?.offsetHeight ?? 240;
      const up = r.bottom + 8 + h > window.innerHeight && r.top - 8 - h > 0;
      setPos({ left, top: up ? r.top - 8 : r.bottom + 8, width, up });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (setOpen(false), btn.current?.focus());
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-expanded={Boolean(open)}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => (o === "pin" ? false : "pin"));
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && later(() => setOpen((o) => o || "hover"), 120)}
        onPointerLeave={(e) => e.pointerType === "mouse" && later(() => setOpen((o) => (o === "hover" ? false : o)), 180)}
        className={`cursor-help rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${className}`}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          onPointerEnter={(e) => e.pointerType === "mouse" && timer.current && clearTimeout(timer.current)}
          onPointerLeave={(e) => e.pointerType === "mouse" && open === "hover" && later(() => setOpen(false), 180)}
          className={`fixed z-50 rounded-[14px] border border-line bg-raised p-4 text-left text-[17px] leading-snug font-normal tracking-normal normal-case text-ink shadow-float animate-pop ${pos ? "" : "invisible"} ${panelClassName}`}
          style={pos ? { left: pos.left, top: pos.top, width: pos.width, transform: pos.up ? "translateY(-100%)" : undefined } : { left: 0, top: 0 }}
        >
          {children}
        </div>,
        // Hors du texte (un parent estompé ou animé la rendrait transparente ou décalée), dans la coquille de la session (ses couleurs, sombre à côté du feu).
        btn.current?.closest("[data-simple]") ?? document.body
      )}
    </>
  );
}

// ─── Les bols ───

type ItemLike = { item: string; food?: string | null; qty: string | null; optional: boolean };

/** Le contenu d’un bol : chaque ingrédient avec sa quantité (mise à l’échelle), en tableau. */
export function BowlItems({ bowl, items, size = "md", className = "" }: { bowl?: { items: ItemLike[] }; items?: ItemLike[]; size?: "md" | "lg"; className?: string }) {
  const list = items ?? bowl?.items ?? [];
  return (
    <ul className={`grid ${className}`}>
      {list.map((i, k) => (
        <li key={k} className={`grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 py-1 ${k ? "border-t border-line" : ""} ${size === "lg" ? "text-[19px]" : "text-[17px]"}`}>
          <FoodIllu food={i.food ?? null} item={i.item} size={32} label={i.item.split(/[,(]/)[0].trim()} />
          <span className="min-w-0">
            {typo(i.item)}
            {i.optional && !/facultatif/i.test(i.item) && <span className="text-ink-2"> (facultatif)</span>}
          </span>
          <b className="num-tight text-right">{i.qty ?? ""}</b>
        </li>
      ))}
    </ul>
  );
}

/** « Bol A · grand bol », « Boîte E », « Assiette », « G · au moment » : où attend le groupe. */
export function bowlTitle(b: Pick<PlanBowl, "letter" | "holder" | "containerLabel">): string {
  if (b.holder === "moment") return `${b.letter} · au moment, sans bol`;
  if (b.holder === "assiette") return `${b.letter} · sur une assiette`;
  const kind = b.holder === "boite" ? "Boîte" : "Bol";
  const c = b.containerLabel && !new RegExp(`^${kind}$`, "i").test(b.containerLabel) ? ` · ${b.containerLabel.toLocaleLowerCase("fr")}` : "";
  return `${kind} ${b.letter}${c}`;
}

/** Ce que montre la bulle d’un bol : sa lettre, sa recette, son contenant, son contenu, l’étape qu’il sert. */
export function BowlCard({ plan, bowl, ready }: { plan: SessionPlan; bowl: PlanBowl; ready?: boolean }) {
  const recipe = recipeOf(plan, bowl.recipeSlug);
  const used = bowl.usedBy ? plan.steps.find((s) => s.id === bowl.usedBy!.stepId) : null;
  const moment = atMoment(bowl);
  return (
    <div className="grid gap-3" style={rc(bowl.color)}>
      <div className="flex items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full border-[2.5px] border-[var(--rc)] font-display text-[18px] font-extrabold text-[var(--rc)] ${moment ? "border-dashed bg-surface" : "bg-[color-mix(in_srgb,var(--rc)_16%,var(--c-surface))]"}`}>{bowl.letter}</span>
        <span className="grid min-w-0">
          <b className="text-[17px]">{bowlTitle(bowl)}{ready ? " · prêt" : ""}</b>
          {recipe && <span className="text-[14px] text-ink-2">{recipe.name}</span>}
        </span>
      </div>
      {moment && <span className="text-[14px] text-ink-2">Rien à préparer : pèse et verse au moment de l’étape.</span>}
      <BowlItems bowl={bowl} />
      {used && <span className="text-[14px] text-ink-2">Pour l’étape {used.no} · {stepTitleOf(used, 48)}</span>}
    </div>
  );
}

/** Une pastille de bol cliquable dans un texte ou une ligne : sa lettre à la couleur de la recette (en pointillé : au moment, sans bol) ; la bulle dit ce qu’il contient. */
export function BowlChip({ plan, letter, ready, size = "text" }: { plan: SessionPlan; letter: string; ready?: boolean; size?: "text" | "sm" | "md" | "lg" }) {
  const bowl = plan.bowls.find((b) => b.letter === letter);
  if (!bowl) return <>{letter}</>;
  const moment = atMoment(bowl);
  const dims = { text: "size-[1.2em] border-2 text-[0.72em] align-[0.05em] mx-[0.05em]", sm: "size-7 border-2 text-[13px]", md: "size-10 border-[2.5px] text-[18px]", lg: "size-16 border-[3px] text-[30px]" }[size];
  return (
    <Peek
      label={`${moment ? `${letter}, au moment, sans bol` : bowlTitle(bowl)} : ${bowl.items.map((i) => `${i.item.split(/[,(]/)[0].trim()}${i.qty ? ` ${i.qty}` : ""}`).join(", ")}`}
      className={size === "text" ? "inline-grid align-middle" : "inline-grid shrink-0"}
      trigger={
        <span className={`relative inline-grid place-items-center rounded-full border-[var(--rc)] font-display font-extrabold leading-none text-[var(--rc)] underline-offset-2 ${moment ? "border-dashed bg-surface" : "bg-[color-mix(in_srgb,var(--rc)_16%,var(--c-surface))]"} ${dims}`} style={rc(bowl.color)}>
          {letter}
          {ready && <span className="absolute -right-1 -bottom-1 size-[0.5em] min-h-2 min-w-2 rounded-full bg-accent ring-2 ring-bg" aria-hidden />}
        </span>
      }
    >
      <BowlCard plan={plan} bowl={bowl} ready={ready} />
    </Peek>
  );
}

/** Un texte de consigne où chaque bol cité (« bol G ») devient une pastille qui montre son contenu. */
export function BowlText({ plan, text, ready }: { plan: SessionPlan; text: string; ready?: Set<string> }) {
  const parts = bowlParts(text, plan.bowls.map((b) => b.letter));
  if (parts.length === 1 && parts[0].t === "text") return <>{typo(text)}</>;
  return (
    <>
      {parts.map((p, i) => (p.t === "text" ? <span key={i}>{typo(p.v)}</span> : <BowlChip key={i} plan={plan} letter={p.v} ready={ready?.has(p.v)} />))}
    </>
  );
}

/**
 * Ce que demande l’étape, quantités mises à l’échelle : les bols à prendre (ou à remplir, pour un geste
 * glissé) avec leur contenant, ce qui se pèse et se verse au moment, et le placard. Pendant une
 * sous-étape (`phase`), ce qui y entre est mis en avant.
 */
export function TakeBowls({ plan, step, ready, title, phase = null }: { plan: SessionPlan; step: PlanStep; ready: Set<string>; title?: string; phase?: number | null }) {
  const take = takeOf(plan, step);
  const now = takeAt(take, phase);
  if (!take.bowls.length && !take.moment.length && !take.loose.length) return null;
  const at = (p: number | null) => (p != null && step.phases && step.phases.length > 1 && phase == null ? <span className="text-[14px] font-normal text-ink-2"> · sous-étape {p + 1}</span> : null);
  const hot = (on: boolean) => (on ? "rounded-[8px] bg-accent-soft px-3 -mx-3" : "");
  return (
    <div className="grid gap-6">
      {take.bowls.length > 0 && (
        <section className="grid gap-3" aria-label={step.tasks ? "Bols à remplir" : "Bols à prendre"}>
          <h2 className="label text-ink-2">{title ?? (step.tasks ? "Remplis" : "Prends")}</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {take.bowls.map((b) => (
              <li key={b.letter} className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 py-1 ${hot(now.bowls.includes(b.letter))}`} style={rc(plan.bowls.find((x) => x.letter === b.letter)?.color ?? "var(--c-ink-3)")}>
                <BowlChip plan={plan} letter={b.letter} ready={ready.has(b.letter)} size="md" />
                <div className="grid min-w-0 gap-1">
                  <b className="text-[17px]">
                    {bowlTitle({ letter: b.letter, holder: b.holder, containerLabel: b.container })}
                    {ready.has(b.letter) ? " · prêt" : ""}
                    {at(b.phase)}
                  </b>
                  <BowlItems items={b.items} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {take.moment.length > 0 && (
        <section className="grid gap-3" aria-label="À peser au moment">
          <h2 className="label text-ink-2">Pèse et verse, au moment</h2>
          <ul className="grid">
            {take.moment.map((i, k) => (
              <li key={k} className={`grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 py-2 text-[17px] ${k ? "border-t border-line" : ""} ${hot(now.moment.includes(i))}`}>
                <FoodIllu food={i.food} item={i.item} size={32} label={i.name} />
                <span className="grid min-w-0">
                  <span>
                    {typo(i.item)}
                    {i.optional && !/facultatif/i.test(i.item) && <span className="text-ink-2"> (facultatif)</span>}
                    {at(i.phase)}
                  </span>
                  {i.parts && (
                    <span className="text-[14px] text-ink-2">
                      {i.parts.map((p, j) => (
                        <span key={j}>
                          {j ? " · " : ""}
                          {p.qty} pour {shortName(recipeOf(plan, p.recipeSlug)?.name) ?? p.recipeSlug}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <b className="num-tight text-right">{i.qty ?? ""}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      {take.loose.length > 0 && (
        <p className="text-[17px] text-ink-2">
          <span className="label">Du placard · </span>
          {typo(weighLine(take.loose))}
        </p>
      )}
    </div>
  );
}

/** Une cuisson commune : la part cuite de chaque recette, à sa couleur, et le bol (ou le plat) qui la reçoit. */
export function SharedSplit({ plan, step, now = false }: { plan: SessionPlan; step: PlanStep; now?: boolean }) {
  const sh = shareOf(plan, step);
  if (!sh) return null;
  return (
    <section className={`grid gap-3 ${now ? "rounded-[14px] border-2 border-accent p-4" : ""}`} aria-label={`Partage : ${sh.the}`}>
      <h2 className={`label ${now ? "text-accent" : "text-ink-2"}`}>
        Une cuisson pour {sh.lines.length} recettes · {sh.total}
      </h2>
      <p className="text-[17px]">{now ? "Pèse chaque part :" : `Puis partage ${sh.the}, chaque part pesée :`}</p>
      <ul className="grid border-b border-line">
        {sh.lines.map((l) => (
          <li key={l.recipeSlug} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-2" style={rc(l.color || "var(--c-ink-3)")}>
            <span className="flex min-w-0 items-center gap-2 text-[17px]">
              <span className="inline-block size-3 shrink-0 rounded-full bg-[var(--rc)]" aria-hidden />
              <span className="min-w-0">{l.name}</span>
              {l.bowl && <BowlChip plan={plan} letter={l.bowl} size="sm" />}
            </span>
            <b className="num-tight text-right text-[24px] leading-none">{l.qty}</b>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Avant de commencer : les bols qui manquent, l’ordre de remplissage, et ce qui se pèse au moment (sans bol). */
export function ContainersNote({ plan }: { plan: SessionPlan }) {
  const note = containerNote(plan);
  if (!note) return null;
  const m = note.missing ? missingText(note.missing) : null;
  return (
    <div className="grid gap-3">
      {m && (
        <Alert tone="warn" title={m.title}>
          {m.body}
        </Alert>
      )}
      {note.order.length > 0 && (
        <p className="flex items-start gap-3 border-t border-line pt-3 text-[17px]">
          <Icon name="info" size="s" className="mt-1 shrink-0 text-ink-2" />
          <span>
            Prépare dans cet ordre :{" "}
            {note.order.map((o, k) => (
              <span key={o.letter}>
                {k ? ", " : ""}
                <BowlChip plan={plan} letter={o.letter} /> quand <BowlChip plan={plan} letter={o.after} /> est vidé
              </span>
            ))}
            .
          </span>
        </p>
      )}
      {note.moment.length > 0 && (
        <p className="flex items-start gap-3 border-t border-line pt-3 text-[17px] text-ink-2">
          <Icon name="scale" size="s" className="mt-1 shrink-0" />
          <span>
            Sans bol, au moment :{" "}
            {note.moment.map((x, k) => (
              <span key={x.letters[0]}>
                {k ? " ; " : ""}
                {x.names.join(", ")}{" "}
                {x.letters.map((l) => (
                  <BowlChip key={l} plan={plan} letter={l} />
                ))}
              </span>
            ))}
            . L’étape dira quoi peser.
          </span>
        </p>
      )}
    </div>
  );
}

// ─── L’étape : quelle recette, où on en est ───

/** Le repère de recette d’une étape : son étiquette, « étape 2 sur 5 » de la recette et de la session. */
export function RecipeContext({ plan, step, status, extra }: { plan: SessionPlan; step: PlanStep; status: "todo" | "active" | "done"; extra?: string | null }) {
  const recipe = recipeOf(plan, step.recipeSlug);
  const rs = recipeStep(plan, step);
  const where = [step.kind !== "preheat" ? step.equipmentName : "Four"].filter(Boolean).join(" · ");
  return (
    <div className="grid min-w-0 justify-items-start gap-2">
      {recipe ? (
        <Tape tint={recipe.color} seed={recipe.slug} wrap>
          {recipe.name}
        </Tape>
      ) : (
        <span className="label text-ink-2">Pour toute la session</span>
      )}
      <p className={`label num ${status === "todo" ? "text-ink-2" : "text-accent"}`}>
        {status === "todo" ? "À commencer" : status === "active" ? "En cours" : "Fait"}
        {rs ? ` · étape ${rs.n} sur ${rs.of} de la recette` : ""}
      </p>
      <p className="num text-[14px] leading-snug text-ink-2">{[`Étape ${step.no} sur ${plan.steps.length} de la session`, where, extra].filter(Boolean).join(" · ")}</p>
    </div>
  );
}

// ─── Le fil : en cours, en fond, ensuite ───

const ATT_ICON = { mains: "pan", surveille: "eye", libre: "clock" } as const;

/** Une étiquette d’attention : « mains prises », « à surveiller », « libre ». */
export function AttentionTag({ a, className = "" }: { a: LaneItem["attention"]; className?: string }) {
  return (
    <span className={`label inline-flex shrink-0 items-center gap-1 ${a === "mains" ? "text-accent" : "text-ink-2"} ${className}`}>
      <Icon name={ATT_ICON[a]} size={14} />
      {ATTENTION_LABELS[a]}
    </span>
  );
}

/** Le rappel en cours d’une attente (« Remue » dans la minute) ou le prochain : un seul bip par rappel. */
function useReminder(item: LaneItem, now: number) {
  const r = item.since != null && item.timer && item.timer.pausedAt == null ? reminderAt(item.reminders, item.since, now, item.timer.endsAt) : { due: null, next: null };
  const key = r.due ? `${item.step.id}@${r.due.at}` : null;
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (key && key !== last.current) {
      last.current = key;
      chime();
      navigator.vibrate?.(150);
    }
  }, [key]);
  return r;
}

function LaneRow({ plan, c, item, onFinish }: { plan: SessionPlan; c: Controls; item: LaneItem; onFinish?: () => void }) {
  const { step, timer } = item;
  const recipe = recipeOf(plan, step.recipeSlug);
  const rem = useReminder(item, c.now);
  const left = timer ? timer.endsAt - c.now : null;
  return (
    <li className={`grid gap-2 border-t border-line py-3 ${rem.due ? "rounded-[8px] bg-accent-soft px-3" : ""}`} style={rc(recipe?.color ?? "var(--c-ink-3)")}>
      <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
        <StepIllu kind={step.kind} text={item.doing} size={40} live />
        <span className="grid min-w-0 gap-1">
          <span className="text-[14px] leading-snug text-ink-2">
            <span className="mr-2 inline-block size-2.5 rounded-full bg-[var(--rc)]" aria-hidden />
            {recipe?.name ?? "Four"} · étape {step.no}
            <AttentionTag a={item.attention} className="ml-2 align-[-1px]" />
          </span>
          <b className="text-[17px] leading-snug"><BowlText plan={plan} text={item.doing} ready={c.state.bowlsReady} /></b>
          {rem.due ? (
            <span className="flex items-center gap-2 text-[17px] font-bold text-accent">
              <Icon name="bell" size="s" /> Maintenant : {rem.due.text.toLowerCase()}
            </span>
          ) : rem.next ? (
            <span className="text-[14px] text-ink-2">{rem.next.text}, dans {Math.max(1, Math.ceil((rem.next.at - c.now) / 60000))} min</span>
          ) : null}
        </span>
        {timer ? (
          <span className={`num-tight text-right text-[2rem] leading-none ${timer.pausedAt != null ? "text-ink-2" : ""}`} aria-label={`${timer.pausedAt != null ? "en pause, reste" : "reste"} ${mmss(Math.max(0, left!))}`}>
            {timer.pausedAt != null && <Icon name="pause" size="s" className="mr-1 inline align-middle" />}
            {mmss(Math.max(0, left!))}
          </span>
        ) : (
          onFinish && (
            <Button size="sm" variant="secondary" onClick={onFinish} title={`Marquer l’étape ${step.no} finie`}>
              Finie
            </Button>
          )
        )}
      </div>
    </li>
  );
}

/**
 * Le fil de l’écran : ce qui t’occupe, ce qui tourne en fond (à surveiller, ou libre), ce qui vient,
 * et si tu peux commencer la suite en parallèle.
 */
export function Lanes({ plan, c, focus, person, showNow = false }: { plan: SessionPlan; c: Controls; focus: PlanStep | null; person?: Person | null; showNow?: boolean }) {
  const l = lanesOf(plan, c.state, c.now, focus, person);
  const first = l.next[0];
  if (!l.background.length && !l.next.length && !(showNow && l.now)) return null;
  return (
    <section className="grid gap-6" aria-label="Où j’en suis">
      {showNow && l.now && (
        <div className="grid gap-2">
          <h2 className="label text-accent">En cours · tes mains</h2>
          <ul className="grid border-b border-line">
            <LaneRow plan={plan} c={c} item={l.now} />
          </ul>
        </div>
      )}
      {l.background.length > 0 && (
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="label text-ink-2">En fond · {l.background.length}</h2>
          </div>
          <ul className="grid border-b border-line">
            {l.background.map((it) => (
              <LaneRow key={it.step.id} plan={plan} c={c} item={it} onFinish={() => c.toggleStep(it.step)} />
            ))}
          </ul>
        </div>
      )}
      {first && (
        <div className="grid gap-2">
          <h2 className="label text-ink-2">Ensuite{first.startMin != null ? <> · prévue <span className="num">{clock(c.cookingStart + first.startMin * 60000)}</span></> : null}</h2>
          <ul className="grid border-y border-line">
            {l.next.map((s, k) => (
              <li key={s.id} className={`grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 py-3 ${k ? "border-t border-line text-ink-2" : ""}`} style={rc(recipeOf(plan, s.recipeSlug)?.color ?? "var(--c-ink-3)")}>
                <StepIllu kind={s.kind} text={s.text} size={40} />
                <span className="grid min-w-0">
                  <span className="text-[14px] leading-snug text-ink-2">
                    <span className="mr-2 inline-block size-2.5 rounded-full bg-[var(--rc)]" aria-hidden />
                    {recipeOf(plan, s.recipeSlug)?.name ?? "Four"} · étape {s.no}
                  </span>
                  <span className="text-[17px] leading-snug"><BowlText plan={plan} text={stepTitleOf(s, 90)} ready={c.state.bowlsReady} /></span>
                </span>
              </li>
            ))}
          </ul>
          {focus && stepStatus(c.state, focus.id) === "active" && l.freeHands && stepStatus(c.state, first.id) === "todo" && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[17px]">Tes mains sont libres : tu peux commencer l’étape {first.no} en parallèle.</span>
              <Button size="sm" variant="secondary" icon="play" onClick={() => c.act(first, person ?? null)}>
                Commencer l’étape {first.no}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── La barre des minuteurs (vue simple) ───

/** Un minuteur en puce : couleur de la recette, quoi, combien ; la bulle donne le détail et les gestes. */
function TimerChip({ plan, c, t }: { plan: SessionPlan; c: Controls; t: TimerState }) {
  const info = ringInfo(plan, c.state, t);
  const left = t.endsAt - c.now;
  const paused = t.pausedAt != null;
  const color = info.recipe?.color ?? "var(--c-ink-3)";
  return (
    <Peek
      label={`${info.recipe?.name ?? "Minuteur"} : ${info.finished}, ${paused ? "en pause" : `reste ${mmss(Math.max(0, left))}`}`}
      className="rounded-[8px]"
      trigger={
        <span className={`flex h-11 items-center gap-2 rounded-[8px] border border-[color-mix(in_srgb,currentColor_25%,transparent)] px-3 ${left <= 60000 && !paused ? "border-current" : ""}`} style={rc(color)}>
          <span className="size-2.5 shrink-0 rounded-full bg-[var(--rc)]" aria-hidden />
          <span className="max-w-[10rem] text-[14px] leading-tight">{clip(info.step ? (info.step.phases?.[t.phase ?? -1]?.text ?? stepTitleOf(info.step, 40)) : t.label, 22)}</span>
          <span className={`num-tight text-[20px] leading-none ${paused ? "opacity-60" : ""}`}>
            {paused && <Icon name="pause" size={12} className="mr-1 inline" />}
            {mmss(Math.max(0, left))}
          </span>
        </span>
      }
    >
      <TimerCard plan={plan} c={c} t={t} />
    </Peek>
  );
}

/** Le détail d’un minuteur : la recette, ce qui tourne, ce qu’il touche, ce qu’on fera à la fin, et ses gestes. */
export function TimerCard({ plan, c, t }: { plan: SessionPlan; c: Controls; t: TimerState }) {
  const info = ringInfo(plan, c.state, t);
  const paused = t.pausedAt != null;
  return (
    <div className="grid gap-3">
      {info.recipe && <span className="text-[14px] text-ink-2">{info.recipe.name}{info.step ? ` · étape ${info.step.no}` : ""}</span>}
      <b className="text-[19px] leading-snug"><BowlText plan={plan} text={info.finished} /></b>
      {info.where.length > 0 && <span className="text-[14px] text-ink-2">{info.where.join(" · ")}</span>}
      <span className="num text-[14px]">{paused ? "En pause : la fin repart à la reprise." : `Sonne à ${clock(t.endsAt)} · reste ${mmss(Math.max(0, t.endsAt - c.now))}`}</span>
      <span className="text-[17px]"><span className="label text-ink-2">À la fin · </span><BowlText plan={plan} text={info.action} /></span>
      <span className="flex flex-wrap gap-2">
        <Button size="sm" variant={paused ? "primary" : "secondary"} icon={paused ? "play" : "pause"} onClick={() => c.pauseTimer(t)} aria-pressed={paused}>
          {paused ? "Reprendre" : "Pause"}
        </Button>
        <Button size="sm" variant="secondary" icon="plus" onClick={() => c.addMinutes(t, 1)}>
          1 min
        </Button>
        <Button size="sm" variant="quiet" icon="x" onClick={() => c.send([{ kind: "timer_done", ref: t.id }])} title="Arrête le minuteur sans rien marquer fait">
          Arrêter
        </Button>
      </span>
    </div>
  );
}

/** Les minuteurs en ligne, en haut de la vue simple (à droite sur ordinateur) ; le détail au survol ou au toucher. */
export function TimerBar({ plan, c, person }: { plan: SessionPlan; c: Controls; person?: Person | null }) {
  const mine = (t: TimerState) => {
    if (!person) return true;
    const s = t.stepId ? plan.steps.find((x) => x.id === t.stepId) : undefined;
    return !s || (s.person ?? "A") === person;
  };
  const list = c.timers.filter((t) => t.endsAt > c.now && mine(t));
  if (!list.length) return null;
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:justify-end md:overflow-visible" role="list" aria-label="Minuteurs en cours">
      {list.map((t) => (
        <span key={t.id} role="listitem" className="shrink-0">
          <TimerChip plan={plan} c={c} t={t} />
        </span>
      ))}
      <span role="listitem" className="shrink-0">
        <PauseAll timers={c.timers} now={c.now} allPaused={c.allPaused} onClick={c.pauseAll} />
      </span>
    </div>
  );
}

// ─── Ça sonne ───

/** Ce que dit un minuteur qui sonne : de quoi il s’agit, ce qu’il touche, quoi faire maintenant, puis ce qui suit. */
export function RingDetails({ plan, c, t }: { plan: SessionPlan; c: Controls; t: TimerState }) {
  const info = ringInfo(plan, c.state, t);
  return (
    <div className="grid content-start gap-6">
      <div className="grid gap-2">
        {info.recipe && (
          <p className="text-[17px] font-bold">
            <span className="mr-2 inline-block size-3 rounded-full border-2 border-current bg-[var(--rc)] align-[-1px]" style={rc(info.recipe.color)} aria-hidden />
            {info.recipe.name}
            {info.step ? <span className="font-normal opacity-80"> · étape {info.step.no}</span> : null}
          </p>
        )}
        <p className="text-lead opacity-90">
          Fini : <BowlText plan={plan} text={info.finished} />
        </p>
        {info.where.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[17px] opacity-90">
            <Icon name={info.step?.oven || info.step?.kind === "preheat" ? "oven" : "hob"} size="s" />
            {info.where.join(" · ")}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <p className="label opacity-80">Maintenant</p>
        <h1 className="sx-consigne">
          <BowlText plan={plan} text={info.action} />
        </h1>
        {info.cue && <p className="text-lead opacity-90">Repère : « {typo(info.cue)} »</p>}
      </div>
      {info.bowls.length > 0 && (
        <div className="grid gap-3 rounded-[14px] bg-surface p-4 text-ink">
          {info.bowls.map((l) => {
            const b = plan.bowls.find((x) => x.letter === l);
            return b ? <BowlCard key={l} plan={plan} bowl={b} ready={c.state.bowlsReady.has(l)} /> : null;
          })}
        </div>
      )}
      {info.after && (
        <p className="text-[17px] opacity-85">
          <span className="label">Puis · </span>
          <BowlText plan={plan} text={info.after} />
        </p>
      )}
    </div>
  );
}

// ─── Le retour ───

/** Le bouton de retour : il dit ce qu’il défait ; rien à défaire, il est grisé. */
export function BackButton({ undo, onBack, compact = false, className = "", onInk = false }: { undo: Undo | null; onBack: () => void; compact?: boolean; className?: string; onInk?: boolean }) {
  return (
    <Button
      size="kitchen"
      variant={onInk ? "inverse" : "secondary"}
      onClick={onBack}
      disabled={!undo}
      title={undo ? `${undo.detail} (flèche gauche)` : "Rien à défaire"}
      aria-label={undo ? `${undo.label}. ${undo.detail}` : "Retour : rien à défaire"}
      className={`min-h-[72px] ${compact ? "w-[72px] !px-0" : "justify-start text-left"} ${className}`}
    >
      <Icon name="chev" size={compact ? "l" : "m"} className="shrink-0 rotate-180" />
      {!compact && <span className="min-w-0 text-[15px] leading-tight">{undo ? undo.label : "Rien à défaire"}</span>}
    </Button>
  );
}

// ─── Recommencer ───

/** Relancer la session (plan refait, mêmes plats), pour de vrai ou en test ; l’ancienne s’arrête sur tous les écrans. */
export function useRestart(id: string) {
  const [pending, start] = useTransition();
  const run = (test: boolean) => {
    const ask = test ? "Recommencer en session test ? Celle-ci s’arrête ; rien n’est compté (durées, frigo)." : "Recommencer la session de zéro ? Celle-ci s’arrête sur tous les écrans.";
    if (window.confirm(ask)) start(() => restartSession(id, test));
  };
  return { run, pending };
}

/** Recommencer, en deux boutons discrets (vue détaillée, fin de session). */
export function RestartButtons({ id }: { id: string }) {
  const r = useRestart(id);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="quiet" icon="refresh" disabled={r.pending} onClick={() => r.run(false)}>
        {r.pending ? "Je refais le plan…" : "Recommencer de zéro"}
      </Button>
      <Button size="sm" variant="quiet" disabled={r.pending} onClick={() => r.run(true)} title="Rien n’est compté : ni les durées, ni le frigo">
        en test
      </Button>
    </div>
  );
}

/** Minutes d’une sous-étape, lisibles. */
export { fmtMin };
