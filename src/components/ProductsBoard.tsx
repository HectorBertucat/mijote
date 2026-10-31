"use client";

// Onglet « Produits du drive » d'une fiche : pour chaque ingrédient, les produits Chronodrive acceptés
// (préféré ★, prix, format, pastille de dispo), la proposition automatique classée pour le besoin,
// « Ajouter un produit » (recherche), « Ne correspond pas » (refus commun), et un réglage propre au plat.
// Une association vaut pour toutes les recettes qui contiennent l'ingrédient (type chronocatalog).
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Alert, Button, buttonClass, Chip, Chips, Icon, Input, Pill, Tag } from "@/components/ui";
import { useSectionCount } from "@/components/FicheSections";
import { fmtQty } from "@/components/RecipeParts";
import { BlockTitle, HowCalculated } from "@/components/fiche/Block";
import type { IngredientProducts, ProductView } from "@/lib/products/fiche";
import type { CatalogChoice } from "@/lib/shopping/cart";
import { acceptAction, acceptBestAction, forgetAction, overrideAction, preferAction, refuseAction, searchProductsAction } from "@/app/recettes/[slug]/produits-actions";

const eur = (v: number | null) => (v == null ? "—" : v.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));
const perKg = (v: number | null) => (v == null ? null : `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/kg`);
const needLabel = (i: IngredientProducts) => fmtQty(i.needG, i.pieces);
const isDone = (i: IngredientProducts) => i.nothingToBuy || i.accepted.length > 0;

type Mode = "all" | "recipe";

export function ProductsBoard({ slug, initial }: { slug: string; initial: IngredientProducts[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todo" | "all">("all");
  const [bulk, startBulk] = useTransition();
  // Les données du serveur (rechargées toutes les 30 s par AutoRefresh) font foi.
  useEffect(() => setItems(initial), [initial]);

  const buy = items.filter((i) => !i.nothingToBuy);
  const todo = buy.filter((i) => !isDone(i));
  useSectionCount("produits", todo.length);
  const shown = filter === "todo" ? todo : items;
  const replace = (s: IngredientProducts) => setItems((xs) => xs.map((x) => (x.ingredientId === s.ingredientId ? s : x)));
  const proposable = todo.filter((i) => i.candidates.some((c) => c.tone !== "ko" && !c.otherType)).length;

  return (
    <section className="grid gap-6" aria-label="Produits du drive">
      <BlockTitle
        aside={
          buy.length > 0 && (
            <span className={`num inline-flex items-center gap-2 font-semibold ${todo.length ? "text-warn-ink" : "text-ok-ink"}`}>
              <Icon name={todo.length ? "alert" : "check"} size="s" />
              {buy.length - todo.length} sur {buy.length} associés
            </span>
          )
        }
      >
        Produits du drive
      </BlockTitle>
      <HowCalculated title="Comment la liste choisit">
        <p className="max-w-[72ch]">
          Un produit accepté vaut pour toutes les recettes qui contiennent l’ingrédient. La liste de courses prend le préféré <Icon name="star" size={14} className="inline -translate-y-px" />, sinon le meilleur des acceptés pour le besoin, jamais un produit refusé.
        </p>
      </HowCalculated>

      {todo.length > 0 ? (
        <Alert
          tone="warn"
          title={`${todo.length} ingrédient${todo.length > 1 ? "s" : ""} à associer`}
        >
          {todo.map((i) => i.item).join(" · ")}
          {proposable > 0 && (
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Button
                size="sm"
                variant="primary"
                icon="check"
                state={bulk ? "loading" : "idle"}
                loadingLabel="Association…"
                onClick={() =>
                  startBulk(async () => {
                    const r = await acceptBestAction(slug);
                    if (r.ok) setItems(r.states);
                    else setError(r.message);
                  })
                }
              >
                Accepter la proposition
              </Button>
              <span className="text-[13px]">le premier produit proposé pour chacun{proposable < todo.length ? ` (${proposable} sur ${todo.length})` : ""}</span>
            </span>
          )}
        </Alert>
      ) : (
        buy.length > 0 && (
          <Alert tone="ok" title="Tous les ingrédients ont leur produit">
            La liste de courses de cette recette ne prendra que des produits acceptés.
          </Alert>
        )
      )}
      {error && (
        <Alert tone="ko" role="alert">
          {error}
        </Alert>
      )}

      {todo.length > 0 && todo.length < buy.length && (
        <Chips>
          <Chip pressed={filter === "all"} count={items.length} onClick={() => setFilter("all")}>
            Tous
          </Chip>
          <Chip pressed={filter === "todo"} count={todo.length} onClick={() => setFilter("todo")}>
            À associer
          </Chip>
        </Chips>
      )}

      <ul className="grid items-start gap-3 lg:grid-cols-2">
        {shown.map((i) => (
          <IngredientBlock key={i.ingredientId} slug={slug} ing={i} onState={replace} onError={setError} />
        ))}
      </ul>
    </section>
  );
}

function IngredientBlock({ slug, ing, onState, onError }: { slug: string; ing: IngredientProducts; onState: (s: IngredientProducts) => void; onError: (m: string | null) => void }) {
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [localMode, setLocalMode] = useState<Mode | null>(null);
  const [more, setMore] = useState(false);
  const [showRefused, setShowRefused] = useState(false);
  const [searching, setSearching] = useState(false);
  const mode: Mode = localMode ?? (ing.hasOverride ? "recipe" : "all");
  const done = isDone(ing);

  const run = (id: string | null, fn: () => Promise<{ ok: true; state: IngredientProducts } | { ok: false; message: string }>) => {
    setBusyId(id);
    start(async () => {
      const r = await fn();
      setBusyId(null);
      if (r.ok) {
        onError(null);
        onState(r.state);
      } else onError(r.message);
    });
  };

  if (ing.nothingToBuy)
    return (
      <li className="flex min-w-0 items-center justify-between gap-3 rounded-[12px] border border-dashed border-line-strong px-3.5 py-2.5 text-[14px] text-ink-2">
        <span className="min-w-0 truncate">
          <b className="font-semibold text-ink">{ing.item}</b> · rien à acheter
        </span>
        <Pill tone="idle" icon="home">
          placard
        </Pill>
      </li>
    );

  const firstCandidates = done ? 0 : 3;
  const visibleCandidates = more ? ing.candidates : ing.candidates.slice(0, firstCandidates);
  const hidden = ing.candidates.length - visibleCandidates.length;

  return (
    <li className={`grid min-w-0 content-start gap-2.5 rounded-[12px] border px-3 py-3 sm:px-3.5 ${done ? "border-line" : "border-[color-mix(in_srgb,var(--c-warn)_45%,transparent)]"}`} aria-busy={pending || undefined}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold leading-tight">
            {ing.item}
            {needLabel(ing) && <span className="num ml-1.5 font-semibold text-ink-2">{needLabel(ing)}</span>}
            {ing.optional && <span className="ml-1.5 text-[13px] font-medium text-faint">facultatif</span>}
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-ink-2">
            {ing.notFound ? "pas de type au catalogue" : ing.label} · {mode === "recipe" ? "réglage pour ce plat" : "commun à toutes les recettes"}
          </p>
        </div>
        {done ? (
          <Pill tone="ok">{ing.accepted.length > 1 ? `${ing.accepted.length} produits` : "associé"}</Pill>
        ) : (
          <Pill tone="warn" icon="alert">
            à associer
          </Pill>
        )}
      </div>

      {ing.accepted.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Produits acceptés">
          {ing.accepted.map((p) => (
            <ProductRow
              key={p.id}
              p={p}
              kind="accepted"
              preferred={p.id === ing.preferredId}
              chosen={p.id === ing.chosenId}
              busy={busyId === p.id && pending}
              onPrefer={() => run(p.id, () => preferAction(slug, ing.ingredientId, p.id, p.id !== ing.preferredId, mode))}
              onRemove={() => run(p.id, () => forgetAction(slug, ing.ingredientId, p.id, "accepted", mode))}
              onRefuse={() => run(p.id, () => refuseAction(slug, ing.ingredientId, p.id, mode))}
            />
          ))}
        </ul>
      )}

      {ing.candidates.length > 0 && (visibleCandidates.length > 0 || hidden > 0) && (
        <div className="grid gap-1.5">
          {visibleCandidates.length > 0 && <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-faint">{done ? "Autres produits" : "Proposition"}</p>}
          {visibleCandidates.length > 0 && (
            <ul className="grid gap-1.5" aria-label="Produits proposés">
              {visibleCandidates.map((p, k) => (
                <ProductRow
                  key={p.id}
                  p={p}
                  kind="candidate"
                  best={k === 0 && !done ? needLabel(ing) || "le besoin" : null}
                  busy={busyId === p.id && pending}
                  onAccept={() => run(p.id, () => acceptAction(slug, ing.ingredientId, p.id, { scope: mode }))}
                  onRefuse={() => run(p.id, () => refuseAction(slug, ing.ingredientId, p.id, mode))}
                />
              ))}
            </ul>
          )}
          {hidden > 0 || more ? (
            <button type="button" onClick={() => setMore((m) => !m)} className="w-fit text-[14px] font-semibold text-accent underline-offset-2 hover:underline">
              {more ? "Moins de produits" : `${done ? "Voir les" : "Voir les"} ${hidden} autre${hidden > 1 ? "s" : ""} produit${hidden > 1 ? "s" : ""}`}
            </button>
          ) : null}
        </div>
      )}
      {ing.candidates.length === 0 && ing.accepted.length === 0 && <p className="text-[14px] text-ink-2">Rien de proposé au catalogue sous ce nom : cherche le produit.</p>}

      {searching ? (
        <SearchBox
          onClose={() => setSearching(false)}
          exclude={new Set([...ing.accepted.map((a) => a.id)])}
          initial={ing.label}
          busyId={pending ? busyId : null}
          onPick={(c, q) => run(c.id, () => acceptAction(slug, ing.ingredientId, c.id, { scope: mode, query: q }))}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {!searching && (
          <Button size="sm" variant="quiet" icon="search" onClick={() => setSearching(true)}>
            Ajouter un produit
          </Button>
        )}
        {mode === "all" ? (
          <Button size="sm" variant="quiet" icon="sliders" onClick={() => (ing.accepted.length ? run(null, () => overrideAction(slug, ing.ingredientId, true)) : setLocalMode("recipe"))} title="Des produits propres à cette recette, qui priment sur le réglage commun">
            Pour ce plat seulement
          </Button>
        ) : (
          <Button
            size="sm"
            variant="quiet"
            icon="refresh"
            onClick={() => {
              setLocalMode("all");
              if (ing.hasOverride) run(null, () => overrideAction(slug, ing.ingredientId, false));
            }}
          >
            Revenir au réglage commun
          </Button>
        )}
        {ing.refused.length > 0 && (
          <Button size="sm" variant="quiet" onClick={() => setShowRefused((v) => !v)} aria-expanded={showRefused}>
            {ing.refused.length} refusé{ing.refused.length > 1 ? "s" : ""}
          </Button>
        )}
      </div>

      {showRefused && ing.refused.length > 0 && (
        <ul className="grid gap-1.5" aria-label="Produits refusés">
          {ing.refused.map((p) => (
            <ProductRow key={p.id} p={p} kind="refused" busy={busyId === p.id && pending} onRemove={() => run(p.id, () => forgetAction(slug, ing.ingredientId, p.id, "refused", mode))} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ProductRow({
  p,
  kind,
  preferred = false,
  chosen = false,
  best = null,
  busy = false,
  onAccept,
  onPrefer,
  onRemove,
  onRefuse,
}: {
  p: ProductView;
  kind: "accepted" | "candidate" | "refused";
  preferred?: boolean;
  chosen?: boolean;
  best?: string | null;
  busy?: boolean;
  onAccept?: () => void;
  onPrefer?: () => void;
  onRemove?: () => void;
  onRefuse?: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const sub = [p.brand, p.quantityLabel].filter(Boolean).join(" · ");
  const name = p.url ? (
    <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
      {p.name}
    </a>
  ) : (
    p.name
  );
  return (
    <li
      className={`flex min-w-0 items-center gap-2.5 rounded-[10px] border py-2 pl-2 pr-1.5 transition-colors duration-[var(--dur-quick)] ${
        kind === "accepted" ? (preferred ? "border-accent bg-accent-soft" : "border-line-strong bg-surface") : kind === "refused" ? "border-dashed border-line bg-surface-2 opacity-80" : "border-line bg-surface-2"
      } ${busy ? "opacity-60" : ""}`}
    >
      <span className="relative size-9 shrink-0 overflow-hidden rounded-[8px] bg-surface sm:size-11">
        <Icon name="basket" className="absolute inset-0 m-auto text-faint" />
        {p.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = "none")} className="relative size-full bg-surface object-contain" />
        )}
      </span>
      <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-0.5">
        <span className={`line-clamp-2 text-[14px] font-semibold leading-snug ${kind === "refused" ? "line-through decoration-faint" : ""}`}>{name}</span>
        <span className="num flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-ink-2">
          <b className="text-[14.5px] font-bold text-ink">{eur(p.price)}</b>
          {p.promo && <span className="text-[11px] font-bold uppercase text-ok">promo</span>}
          {perKg(p.perKg) && <span>· {perKg(p.perKg)}</span>}
          {p.packs > 1 && p.needCost != null && <span>· {`${p.packs} × = ${eur(p.needCost)}`}</span>}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-ink-2">
          {sub && <span className="min-w-0 truncate">{sub}</span>}
          <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
            <Pill tone={p.tone} dot className="!size-[18px]">
              {p.dispo}
            </Pill>
            <span className={p.tone === "ok" ? "" : p.tone === "ko" ? "text-ko" : "text-warn-ink"}>{p.dispo}</span>
          </span>
        </span>
        {(best || chosen || p.otherType || p.savedAt) && (
          <span className="flex flex-wrap gap-1">
            {best && <Tag className="!h-[22px] !text-[12px]">meilleur pour {best}</Tag>}
            {chosen && <Tag className="!h-[22px] !text-[12px]">pris pour la liste</Tag>}
            {p.otherType && <Tag className="!h-[22px] !text-[12px]">{p.otherType}</Tag>}
            {p.savedAt && <Tag tone="warn" className="!h-[22px] !text-[12px]">prix du {new Date(p.savedAt).toLocaleDateString("fr-FR")}</Tag>}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center">
        {kind === "accepted" && (
          <>
            <button
              type="button"
              aria-label={preferred ? "Ne plus préférer" : "Préféré"}
              title={preferred ? "Préféré : pris en premier par la liste" : "Préféré"}
              aria-pressed={preferred}
              onClick={onPrefer}
              disabled={busy}
              className={buttonClass({ variant: "quiet", size: "sm", iconOnly: true, className: preferred ? "!text-accent" : "" })}
            >
              <Icon name="star" size="s" fill={preferred ? "currentColor" : "none"} />
            </button>
            {confirm ? (
              <span className="grid gap-0.5">
                <Button size="sm" variant="danger" onClick={onRefuse} disabled={busy} className="!min-h-[30px] !px-2 !text-[12px]">
                  Ne correspond pas
                </Button>
                <Button size="sm" variant="quiet" onClick={onRemove} disabled={busy} className="!min-h-[30px] !px-2 !text-[12px]">
                  Retirer
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="quiet" iconOnly icon="x" aria-label="Retirer ou refuser" title="Retirer, ou « ne correspond pas »" onClick={() => setConfirm(true)} disabled={busy} />
            )}
          </>
        )}
        {kind === "candidate" && (
          <>
            <Button size="sm" variant="quiet" iconOnly icon="x" aria-label="Ne correspond pas" title="Ne correspond pas : exclu de toutes les recettes" onClick={onRefuse} disabled={busy} />
            <Button size="sm" variant="secondary" iconOnly icon="plus" aria-label="Accepter" title="Accepter ce produit" onClick={onAccept} state={busy ? "loading" : "idle"} />
          </>
        )}
        {kind === "refused" && (
          <Button size="sm" variant="quiet" onClick={onRemove} disabled={busy} className="!text-[13px]">
            Annuler
          </Button>
        )}
      </span>
    </li>
  );
}

function SearchBox({ initial, exclude, busyId, onPick, onClose }: { initial: string; exclude: Set<string>; busyId: string | null; onPick: (c: CatalogChoice, q: string) => void; onClose: () => void }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<CatalogChoice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const seq = useRef(0);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return setResults(null);
    const n = ++seq.current;
    const t = setTimeout(
      () =>
        start(async () => {
          const r = await searchProductsAction(query);
          if (n !== seq.current) return;
          if (r.ok) {
            setErr(null);
            setResults(r.results);
          } else setErr(r.message);
        }),
      250
    );
    return () => clearTimeout(t);
  }, [q]);
  const list = useMemo(() => (results ?? []).filter((c) => !exclude.has(c.id)), [results, exclude]);
  return (
    <div className="grid gap-2 rounded-[10px] bg-surface-2 p-2">
      <div className="flex items-center gap-1.5">
        <Input autoFocus onFocus={(e) => e.currentTarget.select()} icon="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} placeholder="Chercher au catalogue (marque, nom…)" aria-label="Chercher un produit" className="!min-h-11" />
        <Button size="md" variant="quiet" iconOnly icon="x" aria-label="Fermer la recherche" onClick={onClose} />
      </div>
      {err && <p className="text-[13px] text-ko">{err}</p>}
      {loading && !results && <p className="text-[13px] text-ink-2">Recherche…</p>}
      {results && list.length === 0 && !loading && <p className="text-[13px] text-ink-2">Aucun produit disponible sous ce nom.</p>}
      {list.length > 0 && (
        <ul className="grid max-h-[340px] gap-1 overflow-y-auto" aria-label="Résultats">
          {list.map((c) => (
            <li key={c.id} className="flex min-w-0 items-center gap-2.5 rounded-[8px] bg-surface py-1.5 pl-1.5 pr-1">
              <span className="relative size-9 shrink-0 overflow-hidden rounded-[6px] bg-surface-2">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" loading="lazy" className="size-full object-contain" />
                ) : (
                  <Icon name="basket" size="s" className="absolute inset-0 m-auto text-faint" />
                )}
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-[14px] font-semibold">{c.name}</span>
                <span className="truncate text-[12.5px] text-ink-2">{[c.brandName, c.quantityLabel, perKg(c.pricePerKg)].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="num shrink-0 text-[14px] font-bold">{eur(c.price)}</span>
              <Button size="sm" variant="secondary" icon="plus" onClick={() => onPick(c, q.trim())} state={busyId === c.id ? "loading" : "idle"}>
                Ajouter
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
