"use client";

// Atelier de création (DA « Plan de travail ») : une envie → une base proposée par l'IA, puis on garde ou retire
// les aliments sur des tuiles (chacune vérifiée au drive) et on en ajoute depuis le catalogue ; la recette se met
// à jour sous les yeux. Si un indispensable manque, la recette passe « indisponible » et le dit.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { proposeCreationAction, saveCreationAction, searchCatalogAction, type CatalogHit } from "@/app/atelier/actions";
import { Alert, Button, Card, Chip, Chips, EmptyState, Field, Icon, Input, LoadList, Macro, MacroRow, Pill, RecipeTile, Tag, Textarea, verdictTone, type PillTone } from "@/components/ui";
import { CardTitle } from "@/components/RecipeParts";
import type { DiffRow, Proposal } from "@/lib/atelier";
import { verdictFor } from "@/lib/nutrition/compute";
import { recipeColor } from "@/lib/ui";
import { Checks, fmtQty, fmtUsd, IngredientsDiff, Leftovers, NutritionCompare, StepsList } from "./RecipeDiff";

const IDEAS = [
  "Un plat au four avec du poulet, sans brocoli",
  "Un mijoté de porc qui se réchauffe bien",
  "Des pâtes gratinées riches en protéines",
  "Un sauté minute avec des légumes croquants",
];

const key = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
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
      <Macro value={Math.round(h.kcal)} unit="kcal" tone={v ? verdictTone(v.kcal) : undefined} sub={`part ${leadPart!.name}`} />
      <Macro value={Math.round(h.protein)} unit="g" tone={v ? verdictTone(v.protein) : undefined} sub="protéines" />
    </MacroRow>
  );
  const unavailable = blocked.length > 0 && (
    <Alert tone="ko" title="Indisponible pour l'instant">
      {blocked.join(", ")} : ni produit au drive, ni remplaçant. Retire-le ou ajoute un autre aliment.
    </Alert>
  );
  const budgetLine = (
    <p className="text-[12px] text-faint">
      IA ce mois : {fmtUsd(budget.spentUsd)} sur {fmtUsd(budget.capUsd)} · environ 0,05 à 0,10 $ par proposition
    </p>
  );

  return (
    <div className="grid gap-5" ref={top}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Atelier</h1>
          <p className="mt-1.5 text-ink-2">{draft ? `Nouvelle recette · connaît tes ${count ?? "…"} recettes` : `Une envie, une base, puis tu choisis les aliments · connaît tes ${count ?? "…"} recettes`}</p>
        </div>
        {proposal && (
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
        )}
      </div>

      <div className={`grid items-start gap-5 ${proposal ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
        <div className="grid min-w-0 gap-5">
          <Card as="section" pad="md" className="grid gap-3">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (envie.trim()) run({ fresh: true });
              }}
            >
              <Field label="Ce que tu veux">
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
                    rows={2}
                    maxLength={600}
                    placeholder="Un porc thaï au four, qui se congèle"
                    className="resize-none"
                  />
                )}
              </Field>
              {!proposal && (
                <Chips scroll className="sm:mx-0 sm:flex-wrap sm:px-0">
                  {IDEAS.map((i) => (
                    <Chip key={i} pressed={envie === i} onClick={() => setEnvie(i)}>
                      {i}
                    </Chip>
                  ))}
                </Chips>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant={proposal ? "secondary" : "primary"} icon="sparkdraft" disabled={!envie.trim()} state={pending && running === "fresh" ? "loading" : "idle"} loadingLabel="L'IA compose…">
                  {proposal ? "Nouvelle proposition" : "Proposer une recette"}
                </Button>
                {budgetLine}
              </div>
            </form>
            {proposal && (
              <Alert tone="info" key={proposal.explanation} className="animate-swap-in">
                {proposal.explanation}
              </Alert>
            )}
          </Card>

          {error && (
            <Alert tone="ko" role="alert">
              {error}
            </Alert>
          )}

          {pending && !proposal && (
            <Card pad="md" className="grid gap-3" aria-live="polite">
              <LoadList
                items={[
                  { label: "L'IA compose une base à partir de ton envie", state: "on" },
                  { label: "Chaque ingrédient vérifié au catalogue", state: "idle" },
                  { label: "Doublons cherchés dans ta bibliothèque", state: "idle" },
                  { label: "Nutrition calculée en code", state: "idle" },
                ]}
              />
              <div className="skeleton h-28" />
            </Card>
          )}

          {!proposal && !pending && (
            <EmptyState icon="sparkdraft" title="La recette apparaîtra ici">
              Tu choisiras ensuite les aliments sur des tuiles, chacune vérifiée au catalogue du drive. Rien n&apos;est enregistré sans toi.
            </EmptyState>
          )}

          {proposal && draft && (
            <>
              {/* Téléphone : l'essentiel en tête (indisponible, la part). */}
              <div className="grid gap-3 lg:hidden">
                {unavailable}
                {macros}
              </div>

              <section className={`grid gap-3 transition-opacity ${pending ? "opacity-60" : ""}`}>
                <CardTitle aside={<span className="text-[13px] text-ink-2">vérifiés au catalogue</span>}>Aliments</CardTitle>
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
                <Button variant="primary" icon="refresh" block disabled={!changes} state={pending && running === "update" ? "loading" : "idle"} loadingLabel="Mise à jour de la recette…" onClick={() => run({ fresh: false })}>
                  {changes ? `Mettre à jour la recette (${changes} changement${changes > 1 ? "s" : ""})` : "Touche un aliment pour le retirer, ou ajoutes-en un"}
                </Button>
              </section>

              <div className={`grid gap-5 transition-opacity ${pending ? "opacity-60" : ""}`}>
                <Checks v={{ ...proposal.verification, rows, blocked }} duplicate={proposal.duplicate} />
                <IngredientsDiff rows={rows} color={color} />
                <Card as="section" pad="md">
                  <CardTitle>Étapes</CardTitle>
                  <StepsList steps={draft.steps} before={null} color={color} />
                </Card>
                {draft.tips && (
                  <Alert tone="info" title="Conseils">
                    {draft.tips}
                  </Alert>
                )}
              </div>
            </>
          )}
        </div>

        {proposal && draft && (
          <aside className={`grid min-w-0 gap-4 transition-opacity lg:sticky lg:top-[72px] ${pending ? "opacity-60" : ""}`}>
            <Card pad="md" className="grid gap-3">
              <div className="flex items-center gap-3">
                <RecipeTile color={color} name={draft.name} />
                <div className="min-w-0">
                  <b key={draft.name} className="block animate-pop font-display text-[17px] leading-tight">
                    {draft.name}
                  </b>
                  <div className="text-[13px] text-ink-2">
                    brouillon · {draft.servingsUnits} unités{draft.fridgeDays != null ? ` · frigo ${draft.fridgeDays} j` : ""}
                    {draft.freezerOk ? " · congèle" : ""}
                  </div>
                </div>
              </div>
              {draft.description && <p className="text-[14px] text-ink-2">{draft.description}</p>}
              {draft.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {draft.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              )}
              <div className="hidden gap-3 lg:grid">
                {unavailable}
                {macros}
              </div>
              <Button variant="primary" icon="check" block onClick={save} disabled={pending || Boolean(proposal.duplicate)} state={saving ? "loading" : "idle"} loadingLabel="Enregistrement…">
                Enregistrer · à essayer
              </Button>
              <p className="text-[12px] text-faint">
                Nouvelle recette au statut « à essayer »{blocked.length ? ", marquée « indisponible » tant qu'un indispensable n'a pas de produit" : ""} : la bibliothèque ne change pas autrement.
              </p>
            </Card>
            <NutritionCompare before={first ? null : proposal.verification.before} after={proposal.verification.after} coverage={proposal.verification.after.coverage} />
            <Leftovers items={proposal.verification.leftovers} />
          </aside>
        )}
      </div>
    </div>
  );
}

const TONE: Record<Check["state"], PillTone> = { ok: "ok", warn: "warn", replace: "ko" };
const WORD: Record<Check["state"], string> = { ok: "Au drive", warn: "À vérifier", replace: "À remplacer" };

/** Tuiles d'aliments : gardé (bord d'accent + coche), retiré (pointillés, barré), ajouté depuis le catalogue. */
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
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {ingredients.map((i) => {
        const off = removes.has(i.item);
        const p = i.check?.product;
        return (
          <button
            key={i.item}
            type="button"
            onClick={() => onToggleRemove(i.item)}
            aria-pressed={!off}
            title={off ? "Remettre" : "Retirer de la recette"}
            className={`relative grid min-w-0 content-start gap-1.5 rounded-[14px] bg-surface p-3 text-left active:scale-[0.97] ${off ? "border border-dashed border-line-strong opacity-70" : "border-2 border-accent"}`}
          >
            <span className="flex items-start justify-between gap-1.5">
              <b className={`min-w-0 text-[14px] leading-tight ${off ? "strike-out text-faint" : ""}`}>{i.item.split(",")[0]}</b>
              {off ? (
                <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-surface-2 text-ink-2">
                  <Icon name="refresh" size={13} />
                </span>
              ) : (
                <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-accent text-on-accent">
                  <Icon name="check" size="s" strokeWidth={2.6} />
                </span>
              )}
            </span>
            <span className="num truncate text-[13px] text-ink-2">
              {i.qty}
              {p && (p.quantityLabel || p.price != null) ? ` · ${[p.quantityLabel, p.price != null ? eur(p.price) : null].filter(Boolean).join(" · ")}` : ""}
            </span>
            {off ? (
              <Pill tone="idle" icon="minus" className="justify-self-start">
                retiré
              </Pill>
            ) : i.check ? (
              <Pill tone={TONE[i.check.state]} className="justify-self-start">
                {WORD[i.check.state]}
              </Pill>
            ) : (
              <Pill tone="idle" className="justify-self-start">
                pas vérifié
              </Pill>
            )}
            {i.optional && <span className="font-display text-[10px] font-bold uppercase tracking-[0.12em] text-faint">facultatif</span>}
          </button>
        );
      })}
      {adds.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onUnadd(a.id)}
          title="Ne pas ajouter"
          className="grid min-w-0 animate-pop content-start gap-1.5 rounded-[14px] border-2 border-dashed border-ok bg-ok-soft p-3 text-left text-ok-ink active:scale-[0.97]"
        >
          <span className="flex items-start justify-between gap-1.5">
            <b className="min-w-0 text-[14px] leading-tight">+ {a.name}</b>
            <Icon name="x" size="s" />
          </span>
          <span className="num truncate text-[13px]">{[a.quantityLabel, a.price != null ? eur(a.price) : null].filter(Boolean).join(" · ") || "catalogue"}</span>
          <Pill tone="ok" icon="plus" className="justify-self-start">
            à ajouter
          </Pill>
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
    <div className="grid gap-2">
      <div className="relative">
        <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ajouter un aliment : champignons, lardons…" aria-label="Chercher un aliment dans le catalogue" />
        {searching && <span className="k-spin absolute right-3.5 top-1/2 -mt-2 text-accent" aria-hidden />}
      </div>
      {hits.length > 0 && (
        <div className="grid max-h-72 overflow-y-auto rounded-[14px] border border-line bg-surface">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              disabled={!h.available}
              onClick={() => {
                onAdd(h);
                setQ("");
              }}
              className="flex w-full min-w-0 items-center gap-3 border-b border-line px-3 py-2 text-left text-[14px] last:border-b-0 hover:bg-surface-2 active:scale-100 disabled:opacity-45"
            >
              {h.imageUrl ? <img src={h.imageUrl} alt="" className="size-9 shrink-0 rounded-[8px] bg-surface object-contain" /> : <span className="size-9 shrink-0 rounded-[8px] bg-surface-2" />}
              <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
              {h.available ? (
                <span className="num shrink-0 text-[13px] text-ink-2">{[h.quantityLabel, h.price != null ? eur(h.price) : null].filter(Boolean).join(" · ")}</span>
              ) : (
                <Pill tone="ko">rupture</Pill>
              )}
              {h.available && <Icon name="plus" size="s" className="text-accent" />}
            </button>
          ))}
        </div>
      )}
      <p className="text-[12px] text-faint">Touche une tuile pour retirer l&apos;aliment. Les ajouts viennent du catalogue du drive (sans recherche en direct).</p>
    </div>
  );
}
