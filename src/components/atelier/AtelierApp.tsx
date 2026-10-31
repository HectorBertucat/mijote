"use client";

// Atelier de création (DA v3 « Carnet de marché ») : une envie → une base proposée par l'IA, puis on garde ou retire
// les aliments sur des tuiles (chacune vérifiée au drive) et on en ajoute depuis le catalogue ; la recette se met
// à jour sous les yeux. Si un indispensable manque, la recette passe « indisponible » et le dit.
// Sobre : sections à filets, l'aperçu au langage de la fiche, l'état d'un aliment en forme et en mot.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { proposeCreationAction, saveCreationAction, searchCatalogAction, type CatalogHit } from "@/app/atelier/actions";
import { Alert, Button, Chip, Chips, Field, Icon, Input, LoadList, Macro, MacroRow, Tag, Tape, Textarea, recipeVar, verdictTone, type IconName } from "@/components/ui";
import type { DiffRow, Proposal } from "@/lib/atelier";
import { verdictFor } from "@/lib/nutrition/compute";
import { recipeColor } from "@/lib/ui";
import { Checks, fmtQty, fmtUsd, IngredientsDiff, Leftovers, NutritionCompare, StepsList } from "./RecipeDiff";
import { CostLine, HowItGoes, Notes, PageHead, SectionHead } from "./parts";

const IDEAS = [
  "Un plat au four avec du poulet, sans brocoli",
  "Un mijoté de porc qui se réchauffe bien",
  "Des pâtes gratinées riches en protéines",
  "Un sauté minute avec des légumes croquants",
];

const key = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const NB = "\u202f";
type Check = NonNullable<DiffRow["check"]>;

export function AtelierApp({ initialEnvie, budget: budget0, count }: { initialEnvie: string; budget: { spentUsd: number; capUsd: number }; count?: number }) {
  const router = useRouter();
  const [envie, setEnvie] = useState(initialEnvie);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [first, setFirst] = useState(true);
  const [known, setKnown] = useState<Map<string, Check>>(new Map());
  const [adds, setAdds] = useState<CatalogHit[]>([]);
  const [removes, setRemoves] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState(budget0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const [running, setRunning] = useState<"fresh" | "update">("fresh");
  const top = useRef<HTMLDivElement>(null);

  const draft = proposal?.draft ?? null;
  const color = recipeColor(draft?.slug ?? "atelier");

  // Les ingrédients inchangés gardent le verdict catalogue de la proposition précédente.
  const rows = useMemo(() => {
    if (!proposal) return [];
    return proposal.verification.rows.map((r) => {
      const check = r.check ?? (r.after ? (known.get(key(r.after.item)) ?? null) : null);
      return { ...r, check, status: first ? ("same" as const) : r.status };
    });
  }, [proposal, known, first]);
  const blocked = rows.filter((r) => r.after && !r.after.optional && !r.after.pantry && r.check?.state === "replace").map((r) => r.after!.item);

  const run = (opts: { fresh: boolean }) => {
    setError(null);
    setRunning(opts.fresh ? "fresh" : "update");
    start(async () => {
      const r = await proposeCreationAction(
        { envie, add: opts.fresh ? [] : adds.map((a) => a.name), remove: opts.fresh ? [] : [...removes], avoid: [] },
        opts.fresh ? null : draft
      );
      if (!r.ok) return setError(r.error);
      setBudget(r.budget);
      setFirst(opts.fresh);
      setKnown((prev) => {
        const m = opts.fresh ? new Map<string, Check>() : new Map(prev);
        for (const row of r.proposal.verification.rows) if (row.after && row.check) m.set(key(row.after.item), row.check);
        return m;
      });
      setProposal(r.proposal);
      setAdds([]);
      setRemoves(new Set());
      if (opts.fresh) top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const save = () => {
    if (!proposal) return;
    setError(null);
    startSave(async () => {
      const r = await saveCreationAction(proposal.draft, proposal.explanation);
      if (!r.ok) return setError(r.error);
      router.push(`/recettes/${r.slug}`);
    });
  };

  const changes = adds.length + removes.size;
  const leadPart = proposal?.verification.after.people[0];
  const h = leadPart?.macros;
  const v = h ? verdictFor(leadPart?.ref, h) : null;
  const macros = h && (
    <MacroRow>
      <Macro value={Math.round(h.kcal)} unit="kcal" tone={v ? verdictTone(v.kcal) : undefined} sub={`part de ${leadPart!.name}`} />
      <Macro value={Math.round(h.protein)} unit="g" tone={v ? verdictTone(v.protein) : undefined} sub="protéines" />
    </MacroRow>
  );
  const unavailable = blocked.length > 0 && (
    <Notes items={[{ tone: "ko", key: "blocked", text: <><b>Indisponible pour l’instant.</b> {blocked.join(", ")} : ni produit au drive, ni remplaçant. Retire-le ou ajoute un autre aliment.</> }]} />
  );
  const budgetLine = (
    <CostLine>
      IA ce mois : {fmtUsd(budget.spentUsd)} sur {fmtUsd(budget.capUsd)} · environ 0,05 à 0,10{NB}$ par proposition
    </CostLine>
  );

  return (
    <div className="grid gap-12" ref={top}>
      <PageHead
        back={{ href: "/recettes", label: "Recettes" }}
        title="Atelier"
        lead={draft ? undefined : `Une envie, une base, puis tu choisis les aliments. L’atelier connaît tes ${count ?? "…"} recettes et évite les doublons.`}
        aside={
          proposal ? (
            <Button
              variant="quiet"
              icon="x"
              disabled={pending || saving}
              onClick={() => {
                setProposal(null);
                setAdds([]);
                setRemoves(new Set());
                setFirst(true);
              }}
            >
              Abandonner le brouillon
            </Button>
          ) : (
            <Link href="/atelier/importer" className="inline-flex min-h-tap items-center gap-2 rounded-[8px] text-body font-bold text-ink-2 hover:text-ink">
              <Icon name="copy" size="s" />
              Importer un texte collé
            </Link>
          )
        }
      />

      <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-6">
        <div className={`grid min-w-0 content-start gap-12 ${proposal ? "lg:col-span-8" : "lg:col-span-7"}`}>
          <form
            className="grid gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (envie.trim()) run({ fresh: true });
            }}
          >
            <Field label="Ce que tu veux manger">
              {(id) => (
                <Textarea
                  id={id}
                  value={envie}
                  onChange={(e) => setEnvie(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (envie.trim() && !pending) run({ fresh: true });
                    }
                  }}
                  rows={proposal ? 2 : 3}
                  maxLength={600}
                  placeholder="Un porc thaï au four, qui se congèle"
                  className="resize-none text-lead"
                />
              )}
            </Field>
            {!proposal && (
              <div className="grid gap-2">
                <p className="label text-faint">Pour commencer</p>
                <Chips scroll className="sm:mx-0 sm:flex-wrap sm:px-0">
                  {IDEAS.map((i) => (
                    <Chip key={i} pressed={envie === i} onClick={() => setEnvie(i)}>
                      {i}
                    </Chip>
                  ))}
                </Chips>
              </div>
            )}
            <div className="grid gap-3">
              <Button type="submit" variant={proposal ? "secondary" : "primary"} icon="sparkdraft" className="justify-self-start" disabled={!envie.trim()} state={pending && running === "fresh" ? "loading" : "idle"} loadingLabel="L’IA compose…">
                {proposal ? "Nouvelle proposition" : "Proposer une recette"}
              </Button>
              {budgetLine}
            </div>
          </form>

          {error && (
            <Alert tone="ko" role="alert">
              {error}
            </Alert>
          )}

          {proposal && draft && (
            <>
              <header key={draft.name} className="reveal grid gap-4 border-t border-line-strong pt-6">
                <Tape tint={recipeVar(color)} seed={draft.name} className="justify-self-start">
                  Brouillon · à essayer
                </Tape>
                <h2 className="text-h1">{draft.name}</h2>
                <p className="num text-small text-ink-2">
                  {draft.servingsUnits} unités{draft.fridgeDays != null ? ` · ${draft.fridgeDays}${NB}j au frigo` : ""}
                  {draft.freezerOk ? " · se congèle" : ""}
                </p>
                {draft.description && <p className="max-w-[56ch] text-lead text-ink-2">{draft.description}</p>}
                {draft.tags.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {draft.tags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </div>
                )}
                <Notes items={[{ tone: "info", key: proposal.explanation, text: proposal.explanation }]} />
              </header>

              {/* Téléphone : l'essentiel en tête (indisponible, la part). */}
              <div className="grid gap-4 lg:hidden">
                {unavailable}
                {macros}
              </div>

              <section className={`grid gap-6 transition-opacity duration-[var(--dur-2)] ease-[var(--ease-out)] ${pending ? "opacity-60" : ""}`}>
                <SectionHead aside="vérifiés au catalogue">Aliments</SectionHead>
                <FoodTiles
                  ingredients={draft.ingredients
                    .filter((i) => !i.pantry)
                    .map((i) => ({ item: i.item, qty: fmtQty(i.grams, i.units), optional: Boolean(i.optional), check: known.get(key(i.item)) ?? null }))}
                  adds={adds}
                  removes={removes}
                  onUnadd={(id) => setAdds((a) => a.filter((x) => x.id !== id))}
                  onToggleRemove={(item) =>
                    setRemoves((s) => {
                      const n = new Set(s);
                      if (n.has(item)) n.delete(item);
                      else n.add(item);
                      return n;
                    })
                  }
                />
                <CatalogSearch onAdd={(hit) => setAdds((a) => (a.some((x) => x.id === hit.id) ? a : [...a, hit]))} />
                <Button variant={changes ? "accent" : "secondary"} icon="refresh" block disabled={!changes} state={pending && running === "update" ? "loading" : "idle"} loadingLabel="Mise à jour de la recette…" onClick={() => run({ fresh: false })}>
                  {changes ? `Mettre à jour la recette (${changes} changement${changes > 1 ? "s" : ""})` : "Touche un aliment pour le retirer, ou ajoutes-en un"}
                </Button>
              </section>

              <div className={`grid gap-12 transition-opacity duration-[var(--dur-2)] ease-[var(--ease-out)] ${pending ? "opacity-60" : ""}`}>
                <Checks v={{ ...proposal.verification, rows, blocked }} duplicate={proposal.duplicate} />
                <IngredientsDiff rows={rows} color={color} />
                <section className="grid gap-2">
                  <SectionHead>Étapes</SectionHead>
                  <StepsList steps={draft.steps} before={null} color={color} />
                </section>
                {draft.tips && (
                  <section className="grid gap-4">
                    <SectionHead as="h3">Conseils</SectionHead>
                    <p className="max-w-[60ch] text-body text-ink-2">{draft.tips}</p>
                  </section>
                )}
              </div>
            </>
          )}
        </div>

        {!proposal && (
          <aside className="min-w-0 lg:col-span-4 lg:col-start-9" aria-live="polite">
            {pending ? (
              <div className="grid gap-4 border-t border-line-strong pt-4">
                <p className="label text-faint">En cours</p>
                <LoadList
                  className="!text-body"
                  items={[
                    { label: "L’IA compose une base à partir de ton envie", state: "on" },
                    { label: "Chaque ingrédient cherché au catalogue", state: "idle" },
                    { label: "Les doublons cherchés dans ta bibliothèque", state: "idle" },
                    { label: "La nutrition calculée en code", state: "idle" },
                  ]}
                />
              </div>
            ) : (
              <HowItGoes
                title="Ce qui se passe"
                steps={[
                  "L’IA propose une base : des aliments, des quantités, des étapes à ton matériel.",
                  "Tu gardes ou retires chaque aliment ; chacun est cherché au catalogue du drive.",
                  "Rien n’est enregistré sans toi. La recette arrive « à essayer ».",
                ]}
              />
            )}
          </aside>
        )}

        {proposal && draft && (
          <aside className={`grid min-w-0 content-start gap-8 transition-opacity duration-[var(--dur-2)] ease-[var(--ease-out)] lg:sticky lg:top-24 lg:col-span-4 ${pending ? "opacity-60" : ""}`}>
            <div className="grid gap-4 border-t border-line-strong pt-4">
              <div className="hidden gap-4 lg:grid">
                {unavailable}
                {macros}
              </div>
              <Button variant="primary" icon="check" block onClick={save} disabled={pending || Boolean(proposal.duplicate)} state={saving ? "loading" : "idle"} loadingLabel="Enregistrement…">
                Ajouter à mes recettes
              </Button>
              <p className="text-small text-faint">
                Elle arrive «{NB}à essayer{NB}»{blocked.length ? `, marquée «${NB}indisponible${NB}» tant qu’un indispensable n’a pas de produit` : ""} ; rien d’autre ne change dans la bibliothèque.
              </p>
            </div>
            <NutritionCompare before={first ? null : proposal.verification.before} after={proposal.verification.after} coverage={proposal.verification.after.coverage} />
            <Leftovers items={proposal.verification.leftovers} />
          </aside>
        )}
      </div>
    </div>
  );
}

const STATE: Record<Check["state"], { icon: IconName; cls: string; word: string }> = {
  ok: { icon: "check", cls: "text-ok-ink", word: "au drive" },
  warn: { icon: "clock", cls: "text-warn-ink", word: "à vérifier" },
  replace: { icon: "x", cls: "text-ko-ink", word: "à remplacer" },
};

/** État d'un aliment : la forme et le mot, en couleur de verdict (jamais la couleur seule). */
function StateWord({ icon, cls, children }: { icon: IconName; cls: string; children: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-small font-bold ${cls}`}>
      <Icon name={icon} size={14} strokeWidth={2.4} />
      {children}
    </span>
  );
}

/** Tuiles d'aliments : gardé (case d'encre cochée), retiré (pointillés, barré), ajouté depuis le catalogue. */
function FoodTiles({
  ingredients,
  adds,
  removes,
  onUnadd,
  onToggleRemove,
}: {
  ingredients: { item: string; qty: string; optional: boolean; check: Check | null }[];
  adds: CatalogHit[];
  removes: Set<string>;
  onUnadd: (id: string) => void;
  onToggleRemove: (item: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {ingredients.map((i) => {
        const off = removes.has(i.item);
        const p = i.check?.product;
        const st = i.check ? STATE[i.check.state] : null;
        return (
          <button
            key={i.item}
            type="button"
            onClick={() => onToggleRemove(i.item)}
            aria-pressed={!off}
            title={off ? "Remettre" : "Retirer de la recette"}
            className={`k-btn relative grid min-w-0 content-start gap-2 rounded-[8px] border p-3 text-left ${off ? "border-dashed border-line-strong bg-transparent" : "border-line-strong bg-surface hover:border-ink"}`}
          >
            <span className="flex items-start justify-between gap-2">
              <b className={`min-w-0 text-body leading-tight ${off ? "strike-out text-faint" : ""}`}>{i.item.split(",")[0]}</b>
              <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-[4px] border-2 ${off ? "border-line-strong text-faint" : "border-ink bg-ink text-bg"}`}>
                <Icon name={off ? "refresh" : "check"} size={14} strokeWidth={2.6} />
              </span>
            </span>
            <span className="num truncate text-small text-ink-2">
              {i.qty}
              {p && (p.quantityLabel || p.price != null) ? ` · ${[p.quantityLabel, p.price != null ? eur(p.price) : null].filter(Boolean).join(" · ")}` : ""}
            </span>
            {off ? (
              <StateWord icon="minus" cls="text-faint">
                retiré
              </StateWord>
            ) : st ? (
              <StateWord icon={st.icon} cls={st.cls}>
                {st.word}
              </StateWord>
            ) : (
              <StateWord icon="dash" cls="text-faint">
                pas vérifié
              </StateWord>
            )}
            {i.optional && <span className="label text-faint">facultatif</span>}
          </button>
        );
      })}
      {adds.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onUnadd(a.id)}
          title="Ne pas ajouter"
          className="k-btn grid min-w-0 animate-pop content-start gap-2 rounded-[8px] border-2 border-dashed border-ink bg-surface p-3 text-left"
        >
          <span className="flex items-start justify-between gap-2">
            <b className="min-w-0 text-body leading-tight">+ {a.name}</b>
            <Icon name="x" size="s" className="text-faint" />
          </span>
          <span className="num truncate text-small text-ink-2">{[a.quantityLabel, a.price != null ? eur(a.price) : null].filter(Boolean).join(" · ") || "catalogue"}</span>
          <StateWord icon="plus" cls="text-ink">
            à ajouter
          </StateWord>
        </button>
      ))}
    </div>
  );
}

/** Recherche dans le catalogue du drive (sans recherche en direct) pour ajouter un aliment. */
function CatalogSearch({ onAdd }: { onAdd: (h: CatalogHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchCatalogAction(q).catch(() => []);
      if (alive) {
        setHits(r);
        setSearching(false);
      }
    }, 280);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ajouter un aliment : champignons, lardons…" aria-label="Chercher un aliment dans le catalogue" />
        {searching && <span className="k-spin absolute right-4 top-1/2 -mt-2 text-faint" aria-hidden />}
      </div>
      {hits.length > 0 && (
        <div className="grid max-h-72 overflow-y-auto rounded-[8px] border border-line-strong bg-surface">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              disabled={!h.available}
              onClick={() => {
                onAdd(h);
                setQ("");
              }}
              className="flex w-full min-w-0 items-center gap-3 border-b border-line px-3 py-2 text-left text-body last:border-b-0 hover:bg-surface-2 disabled:opacity-40"
            >
              {h.imageUrl ? <img src={h.imageUrl} alt="" className="size-9 shrink-0 rounded-[8px] bg-surface object-contain" /> : <span className="size-9 shrink-0 rounded-[8px] bg-surface-2" />}
              <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
              {h.available ? (
                <span className="num shrink-0 text-small text-ink-2">{[h.quantityLabel, h.price != null ? eur(h.price) : null].filter(Boolean).join(" · ")}</span>
              ) : (
                <StateWord icon="x" cls="text-ko-ink">
                  rupture
                </StateWord>
              )}
              {h.available && <Icon name="plus" size="s" className="text-ink-2" />}
            </button>
          ))}
        </div>
      )}
      <p className="text-small text-faint">Touche une tuile pour retirer l’aliment. Les ajouts viennent du catalogue du drive, sans recherche en direct.</p>
    </div>
  );
}
