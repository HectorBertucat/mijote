"use client";

// La fenêtre d’une recette pendant la session, sans quitter l’onglet (src/lib/session/sheet.ts) : au
// survol du nom (ordinateur) elle s’ouvre à côté sans voiler l’écran ; au clic ou au toucher (partout),
// elle s’ouvre en feuille (en bas sur téléphone, à droite sur ordinateur), Échap la ferme. Tous les
// ingrédients de la recette pour cette session, aux quantités mises à l’échelle, puis toutes ses étapes
// adaptées à la cuisine, l’étape en cours repérée, les faites barrées.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SessionPlan } from "@/lib/session/planner";
import { recipeSheet, type RecipeSheet as Sheet_, type SheetStep } from "@/lib/session/sheet";
import { recipeVar } from "@/components/ui/recipe";
import { Icon, Sheet, Tape } from "@/components/ui";
import { FoodIllu } from "@/components/illus/Illu";
import { typo } from "@/lib/typo";
import type { Controls } from "./SessionApp";
import { BowlText } from "./guide";

const rc = (color: string) => ({ "--rc": recipeVar(color) }) as CSSProperties;
const pct = (x: number) => `${Math.round(x * 100)} %`;

/**
 * Le nom (ou l’étiquette) d’une recette dans la session, qui ouvre sa fenêtre : survol à la souris
 * (après un court instant, sans voile), clic, toucher ou Entrée (feuille). `children` : ce qu’on montre
 * (l’étiquette, le nom) ; sans recette, rien n’est cliquable.
 */
export function RecipeLink({ plan, c, slug, children, className = "", label }: { plan: SessionPlan; c: Controls; slug: string | null | undefined; children: ReactNode; className?: string; label?: string }) {
  const [open, setOpen] = useState<false | "hover" | "pin">(false);
  const btn = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inside = useRef(false);
  const later = (f: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(f, ms);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const recipe = slug ? plan.recipes.find((r) => r.slug === slug) : undefined;
  if (!recipe) return <>{children}</>;
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={Boolean(open)}
        aria-label={label ?? `${recipe.name} : ingrédients et étapes de la recette`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => (o === "pin" ? false : "pin"));
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && later(() => setOpen((o) => o || "hover"), 450)}
        onPointerLeave={(e) => e.pointerType === "mouse" && later(() => setOpen((o) => (o === "hover" && !inside.current ? false : o)), 500)}
        className={`cursor-pointer rounded-[4px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${className}`}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            onPointerEnter={() => {
              inside.current = true;
              if (timer.current) clearTimeout(timer.current);
            }}
            onPointerLeave={(e) => {
              inside.current = false;
              if (e.pointerType === "mouse" && open === "hover") later(() => setOpen(false), 300);
            }}
          >
            <Sheet open title={<span className="flex items-center gap-2"><span className="inline-block size-3 shrink-0 rounded-full bg-[var(--rc)]" style={rc(recipe.color)} aria-hidden />{recipe.name}</span>} onClose={() => setOpen(false)} modal={open === "pin"} scrim={open === "pin"} width={460}>
              <RecipeSheetBody plan={plan} c={c} slug={recipe.slug} />
            </Sheet>
          </div>,
          // Dans la coquille de la session (ses couleurs, sombre à côté du feu), hors d’un parent animé.
          btn.current?.closest("[data-simple]") ?? document.body
        )}
    </>
  );
}

/** Le contenu de la fenêtre : où on en est, les ingrédients de la session, les étapes adaptées. */
export function RecipeSheetBody({ plan, c, slug }: { plan: SessionPlan; c: Controls; slug: string }) {
  const sh = recipeSheet(plan, c.state, slug, c.focus?.id ?? null);
  if (!sh) return null;
  return (
    <div className="grid gap-6 pb-2" style={rc(sh.color)}>
      <p className="text-[15px] text-ink-2">
        {sh.done} étape{sh.done > 1 ? "s" : ""} faite{sh.done > 1 ? "s" : ""} sur {sh.steps.length}
        {sh.scale !== 1 ? ` · quantités ×${String(Math.round(sh.scale * 100) / 100).replace(".", ",")}` : ""} · pour cette session, dans ta cuisine.
      </p>
      <Ingredients sh={sh} plan={plan} />
      <section className="grid gap-2" aria-label="Étapes de la recette">
        <h3 className="label text-ink-2">Étapes, adaptées à ta cuisine</h3>
        <ol className="grid border-b border-line">
          {sh.steps.map((s) => (
            <StepRow key={s.id} plan={plan} c={c} s={s} />
          ))}
        </ol>
      </section>
    </div>
  );
}

function Ingredients({ sh, plan }: { sh: Sheet_; plan: SessionPlan }) {
  return (
    <section className="grid gap-3" aria-label="Ingrédients pour cette session">
      <h3 className="label text-ink-2">Ingrédients pour cette session</h3>
      {sh.groups.map((g) => (
        <div key={g.letter ?? "placard"} className="grid gap-1">
          <p className="flex items-baseline justify-between gap-3 text-[15px]">
            <b>{g.letter ? `${g.holder === "boite" ? "Boîte" : g.holder === "moment" ? "Au moment" : g.holder === "assiette" ? "Assiette" : "Bol"} ${g.letter}` : "Hors bol"}{g.container && g.holder !== "moment" && g.letter ? <span className="font-normal text-ink-2"> · {g.container.toLocaleLowerCase("fr")}</span> : null}</b>
            {g.stepNo != null && <span className="num text-[13px] text-ink-2">étape {g.stepNo}</span>}
          </p>
          <ul className="grid">
            {g.items.map((i, k) => (
              <li key={k} className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 py-1 text-[15px] ${k ? "border-t border-line" : ""}`}>
                <FoodIllu food={i.food} item={i.item} size={28} label={i.name} />
                <span className="min-w-0">
                  {typo(i.item)}
                  {i.optional && !/facultatif/i.test(i.item) && <span className="text-ink-2"> (facultatif)</span>}
                </span>
                <b className="num-tight text-right">{i.qty ?? ""}</b>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {sh.shares.map((x) => (
        <p key={x.stepNo} className="rounded-[12px] border border-line px-3 py-2 text-[15px]">
          <b>Cuisson commune · étape {x.stepNo}</b> : {x.the} cuit avec {x.with.join(", ")} ({x.total} en tout). Pour cette recette : <b>{x.mine}</b>, soit {pct(x.share)}.
          <span className="sr-only"> {plan.recipes.length} recettes dans la session.</span>
        </p>
      ))}
    </section>
  );
}

function StepRow({ plan, c, s }: { plan: SessionPlan; c: Controls; s: SheetStep }) {
  const done = s.status === "done";
  const step = plan.steps.find((x) => x.id === s.id)!;
  return (
    <li className={`grid gap-1 border-t border-line py-3 ${s.current ? "-mx-3 rounded-[8px] border-l-4 border-l-[var(--rc)] bg-[color-mix(in_srgb,var(--rc)_10%,var(--c-raised))] px-3" : ""}`} aria-current={s.current ? "step" : undefined}>
      <p className="label flex flex-wrap items-center gap-x-2 text-ink-2">
        <span className="num">{s.n != null ? `Étape ${s.n}` : s.shared ? "Pour la session" : "Avant"}</span>
        <span className="num">· {s.no} de la session</span>
        {s.status === "active" && <span className="text-accent">· en cours</span>}
        {done && (
          <span>
            · <Icon name="check" size={12} className="inline align-[-1px]" /> faite
          </span>
        )}
        {s.current && s.status !== "active" && <span className="text-accent">· à l’écran</span>}
      </p>
      <p className={`text-[17px] font-bold leading-snug ${done ? "text-ink-2 line-through decoration-1" : ""}`}>
        <BowlText plan={plan} text={s.title} uses={step.uses} />
      </p>
      {s.detail && <p className={`text-[15px] leading-snug ${done ? "text-ink-3 line-through decoration-1" : "text-ink-2"}`}>{typo(s.detail)}</p>}
      {(s.where.length > 0 || s.minutes > 0) && (
        <p className="num text-[13px] text-ink-2">
          {[...s.where, s.minutes ? `${s.minutes} min` : null].filter(Boolean).join(" · ")}
        </p>
      )}
      {s.uses.length > 0 && (
        <p className="text-[13px] text-ink-2">
          Reprend : {s.uses.map((u, k) => <span key={u.stepId}>{k ? ", " : ""}{u.name} ({u.from}{u.status !== "done" ? ", pas encore fait" : ""})</span>)}
        </p>
      )}
      {s.phases.length > 1 && !done && (
        <ol className="mt-1 grid gap-0.5 text-[14px]">
          {s.phases.map((p, i) => (
            <li key={i} className={`flex gap-2 ${p.status === "done" ? "text-ink-3 line-through decoration-1" : p.status === "active" ? "font-bold text-accent" : "text-ink-2"}`}>
              <span className="num w-5 shrink-0 text-right">{i + 1}.</span>
              <span className="min-w-0">
                <BowlText plan={plan} text={p.text} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {c.focus?.id !== s.id && s.status === "todo" && <span className="sr-only">À faire.</span>}
    </li>
  );
}

/** L’étiquette de recette d’une étape, qui ouvre la fenêtre de la recette. */
export function RecipeTape({ plan, c, slug }: { plan: SessionPlan; c: Controls; slug: string }) {
  const r = plan.recipes.find((x) => x.slug === slug);
  if (!r) return null;
  return (
    <RecipeLink plan={plan} c={c} slug={slug} className="group inline-flex max-w-full items-center gap-2">
      <Tape tint={r.color} seed={r.slug} wrap>
        {r.name}
      </Tape>
      <Icon name="chev" size={14} className="shrink-0 text-ink-2 group-hover:text-ink" />
    </RecipeLink>
  );
}
