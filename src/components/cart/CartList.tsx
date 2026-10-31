"use client";

// La liste de courses interactive (système « Carnet de marché ») : une vraie liste qu'on coche en magasin ou qu'on
// envoie au drive. Par rayon (étiquette et compteur), une ligne = case généreuse, dessin de l'aliment, quantité en
// chiffres serrés, nom, prix aligné à droite ; un seul signal, et seulement s'il demande d'agir (rupture, à vérifier,
// introuvable). Le reste (marque, besoin, paquets, autre produit) est dans le détail de la ligne (feuille).
// Chaque tap répond tout de suite (état optimiste, sans animation), puis la page se recharge.
import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { cancelOrder, cartAll, changePacks, chooseAcceptedProduct, chooseAlternative, refuseItemProductAction, setLinePriceAction, toggleCart, validateList } from "@/app/courses/actions";
import { Button, buttonClass, Icon, Sheet, Stepper } from "@/components/ui";
import { FoodIllu } from "@/components/illus/Illu";
import { ProductPicker } from "./ProductPicker";
import { Ticket } from "./Ticket";
import { useToast } from "./Toast";
import { eur, grams } from "./format";

export interface RowData {
  id: string;
  pantry: boolean;
  item: string;
  packs: number;
  unitPrice: number | null;
  totalPrice: number | null;
  state: "ok" | "warn" | "ko" | null;
  warnings: string[];
  forRecipes: string;
  needG: number | null;
  product: { name: string; url: string; quantityLabel: string | null; brandName: string | null } | null;
  alts: { id: string; label: string; price: number | null }[];
  inCart: boolean;
  liveStatus: string | null;
  /** Produits acceptés pour l'ingrédient (onglet « Produits » de la fiche), préféré d'abord. */
  accepted: { id: string; label: string; price: number | null; preferred: boolean; current: boolean }[];
  /** « Ne correspond pas » possible : le produit de la ligne et la clé de l'ingrédient sont connus. */
  canRefuse: boolean;
  /** Ce que le vrai panier du drive a dit de la ligne (added, already, partial, unavailable, failed, skipped). */
  drive?: { outcome: string; qty: number | null } | null;
}

type Opt = { kind: "cart"; id: string; on: boolean } | { kind: "all"; on: boolean } | { kind: "packs"; id: string; packs: number } | { kind: "price"; id: string; price: number | null };

/** Un vrai doute, pas l'âge d'une vérification ni « facultatif ». */
const realDoubt = (w: string) => !w.startsWith("vérifié il y a") && w !== "facultatif";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Signal = { tone: "ko" | "warn" | "wait"; text: string; act: boolean };

/** Le seul signal d'une ligne, par ordre d'urgence ; rien quand tout va bien (en stock, au panier, vérifié). */
export function signalOf(r: RowData, catalog: boolean, ordered: boolean): Signal | null {
  if (ordered || r.pantry) return null;
  if (catalog && !r.product) return { tone: "ko", text: "Introuvable", act: true };
  const d = r.drive?.outcome;
  if (d === "unavailable") return { tone: "ko", text: "Pas ajouté au panier : rupture", act: true };
  if (d === "failed") return { tone: "ko", text: "Refusé par le panier", act: true };
  if (d === "partial") return { tone: "warn", text: `Seulement ${r.drive?.qty ?? 0} au panier`, act: true };
  if (d === "skipped") return { tone: "warn", text: "Hors drive", act: false };
  const doubt = r.warnings.find(realDoubt);
  if (r.state === "ko") return { tone: "ko", text: cap(doubt ?? "rupture"), act: true };
  if (r.liveStatus === "pending") return { tone: "wait", text: "Vérification en cours", act: false };
  if (r.state === "warn" && doubt) return { tone: "warn", text: `À vérifier : ${doubt}`, act: true };
  return null;
}

export function CartList({ listId, title = "Courses", ordered, orderedAt, groups, copy, catalog = true }: { listId: string; title?: string; ordered: boolean; orderedAt: string | null; groups: { aisle: string; rows: RowData[] }[]; copy?: ReactNode; /** Catalogue relié : sinon les lignes n'ont pas de produit, et se cochent et se paient à la main. */ catalog?: boolean }) {
  const all = groups.flatMap((g) => g.rows);
  const [rows, apply] = useOptimistic(all, (cur: RowData[], o: Opt) =>
    cur.map((r) => {
      if (o.kind === "all") return r.pantry || (catalog && !r.product) ? r : { ...r, inCart: o.on };
      if (r.id !== o.id) return r;
      if (o.kind === "cart") return { ...r, inCart: o.on };
      if (o.kind === "price") return { ...r, totalPrice: o.price, unitPrice: o.price };
      return { ...r, packs: o.packs, totalPrice: r.unitPrice != null ? Math.round(r.unitPrice * o.packs * 100) / 100 : r.totalPrice };
    })
  );
  const [pending, start] = useTransition();
  const [validating, setValidating] = useState(false);
  const [pickId, setPickId] = useState<string | null>(null);
  const { show, node } = useToast();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const picking = pickId ? (byId.get(pickId) ?? null) : null;

  const buyable = rows.filter((r) => !r.pantry && (catalog ? r.product && r.packs > 0 : true));
  const inCart = buyable.filter((r) => r.inCart);
  const toValidate = inCart.length ? inCart : buyable;
  const total = toValidate.reduce((s, r) => s + (r.totalPrice ?? 0), 0);
  const all100 = buyable.length > 0 && inCart.length === buyable.length;

  const run = (o: Opt, fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      apply(o);
      const r = await fn();
      if (!r.ok) show(r.message ?? "Action impossible.", false);
    });

  return (
    <div className="grid gap-8">
      {!ordered ? (
        <div className="grid gap-3">
          <div className="flex items-end justify-between gap-4">
            <p className="flex items-baseline gap-2" aria-live="polite">
              <span className={`num-tight text-h1 ${all100 ? "text-accent" : ""}`}>{inCart.length}</span>
              <span className="text-lead text-ink-2">sur {buyable.length} au panier</span>
            </p>
            {buyable.length > 0 && (
              <Button variant="quiet" size="sm" icon={all100 ? "x" : "check"} onClick={() => run({ kind: "all", on: !all100 }, () => cartAll(listId, !all100))}>
                {all100 ? "Tout décocher" : "Tout cocher"}
              </Button>
            )}
          </div>
          <Bar value={buyable.length ? inCart.length / buyable.length : 0} />
        </div>
      ) : (
        <OrderedBanner listId={listId} title={title} orderedAt={orderedAt} lines={inCart.map((r) => ({ packs: r.packs, name: r.product?.name ?? r.item, price: r.totalPrice }))} total={inCart.reduce((s, r) => s + (r.totalPrice ?? 0), 0)} onMsg={show} />
      )}

      {groups.map(({ aisle, rows: gr }) => {
        const head = `rayon-${aisle.toLowerCase().replace(/[^a-zà-ÿ]+/g, "-")}`;
        if (aisle === "Placard")
          return (
            <details key={aisle} className="group min-w-0">
              <summary className="flex min-h-tap cursor-pointer list-none items-end justify-between gap-4 border-b border-line-strong pb-3 hover:text-ink [&::-webkit-details-marker]:hidden">
                <span className="label text-ink">Placard · à vérifier chez toi</span>
                <span className="num-tight inline-flex items-center gap-1 text-small text-ink-2">
                  {gr.length}
                  <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-1)] ease-[var(--ease-out)] group-open:rotate-90" />
                </span>
              </summary>
              <ul>
                {gr.map((g) => (
                  <li key={g.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-line py-3">
                    <FoodIllu item={g.item} size="s" />
                    <span className="min-w-0">
                      <span className="block truncate">{g.item}</span>
                      {g.forRecipes && <span className="block truncate text-small text-ink-3">{g.forRecipes}</span>}
                    </span>
                    <span className="num text-small text-ink-2">{grams(g.needG)}</span>
                  </li>
                ))}
              </ul>
            </details>
          );
        const n = gr.length;
        const got = gr.filter((g) => byId.get(g.id)!.inCart).length;
        return (
          <section key={aisle} aria-labelledby={head} className="min-w-0">
            <div className="flex items-end justify-between gap-4 border-b border-line-strong pb-3">
              <h2 id={head} className="label text-ink">
                {aisle}
              </h2>
              <span className={`num-tight inline-flex items-center gap-1 text-small ${got === n && !ordered ? "text-accent" : "text-ink-2"}`}>
                {got === n && !ordered && <Icon name="check" size="s" strokeWidth={2.4} />}
                {got ? `${got} sur ${n}` : n}
              </span>
            </div>
            <ul>
              {gr.map((g) => {
                const r = byId.get(g.id)!;
                return (
                  <Row
                    key={r.id}
                    r={r}
                    catalog={catalog}
                    ordered={ordered}
                    onPrice={(v) => run({ kind: "price", id: r.id, price: v }, () => setLinePriceAction(r.id, v))}
                    onCart={(on) => run({ kind: "cart", id: r.id, on }, () => toggleCart(r.id, on))}
                    onPick={() => setPickId(r.id)}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}

      {!ordered && buyable.length > 0 && (
        <div className="sticky bottom-[calc(4.9rem+env(safe-area-inset-bottom))] z-20 sm:bottom-4">
          <div className="flex items-center justify-between gap-4 rounded-[14px] border border-line bg-raised px-4 py-3 shadow-float">
            <div className="grid min-w-0">
              <span className="num-tight text-h2">
                {total.toFixed(2).replace(".", ",")}
                <span className="ml-1 text-small font-semibold">€</span>
              </span>
              <span className="truncate text-small text-ink-2">{inCart.length ? `${inCart.length} sur ${buyable.length} au panier` : `${buyable.length} article${buyable.length > 1 ? "s" : ""}, rien de coché`}</span>
            </div>
            <div className="flex shrink-0 gap-2">
              {copy && <span className="max-sm:hidden">{copy}</span>}
              <Button
                variant="primary"
                icon="check"
                state={validating ? "loading" : "idle"}
                loadingLabel="Validation…"
                onClick={() => {
                  setValidating(true);
                  start(async () => {
                    const r = await validateList(listId);
                    setValidating(false);
                    show(r.message ?? "", r.ok);
                  });
                }}
              >
                {inCart.length ? "Valider la commande" : "Tout valider"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {copy && !ordered && <div className="sm:hidden">{copy}</div>}

      <Sheet open={picking != null} onClose={() => setPickId(null)} title={picking ? (picking.product?.name ?? picking.item) : ""}>
        {picking && <Detail r={picking} catalog={catalog} ordered={ordered} pending={pending} start={start} show={show} onPacks={(n) => run({ kind: "packs", id: picking.id, packs: n }, () => changePacks(picking.id, n))} close={() => setPickId(null)} />}
      </Sheet>
      {pending && <span className="sr-only">Enregistrement…</span>}
      {node}
    </div>
  );
}

/** Avancement : un filet de 2 px, cocotte sur ce qui est fait. */
function Bar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="progressbar" aria-label="Au panier" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className="h-0.5 bg-line">
      <i className="block h-full bg-accent transition-[width] duration-[var(--dur-3)] ease-[var(--ease-out)]" style={{ width: `${v * 100}%` }} />
    </div>
  );
}

/** Case de la liste : 28 px dans une cible de 48, remplie tout de suite (pas de coche qui se trace). */
function Tick({ checked, onChange, label }: { checked: boolean; onChange?: (on: boolean) => void; label: string }) {
  const box = `grid size-7 place-items-center rounded-[4px] border-2 transition-[background-color,border-color] duration-[var(--dur-1)] ease-[var(--ease-out)] ${checked ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-surface"}`;
  const mark = <Icon name="check" size={18} strokeWidth={3} className={checked ? "" : "invisible"} />;
  if (!onChange)
    return (
      <span className="grid size-12 shrink-0 place-items-center" role="img" aria-label={label}>
        <span className={box}>{mark}</span>
      </span>
    );
  return (
    <label className="group/tick relative -my-1 grid size-12 shrink-0 cursor-pointer place-items-center">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="peer absolute inset-0 cursor-pointer opacity-0" />
      <span className={`${box} group-hover/tick:border-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus ${checked ? "group-hover/tick:border-accent-hover group-hover/tick:bg-accent-hover" : ""}`}>{mark}</span>
    </label>
  );
}

function SignalLine({ s, action }: { s: Signal; action?: ReactNode }) {
  const look = s.tone === "ko" ? "text-ko-ink" : s.tone === "warn" ? "text-warn-ink" : "text-ink-3";
  return (
    <span className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small font-semibold ${look}`}>
      <span className="inline-flex items-center gap-1">
        {s.tone === "wait" ? <span className="k-spin !size-3" aria-hidden /> : <Icon name={s.tone === "ko" ? "x" : "alert"} size="s" strokeWidth={2.4} />}
        {s.text}
      </span>
      {action}
    </span>
  );
}

function Row({ r, catalog, ordered, onCart, onPick, onPrice }: { r: RowData; catalog: boolean; ordered: boolean; onCart: (on: boolean) => void; onPick: () => void; onPrice: (eur: number | null) => void }) {
  const p = r.product;
  const sig = signalOf(r, catalog, ordered);
  const done = r.inCart && !ordered;
  const name = p?.name ?? r.item;
  const qty = p ? `${r.packs} ×` : grams(r.needG);
  const meta = [p?.quantityLabel, r.forRecipes, r.warnings.includes("facultatif") ? "facultatif" : null].filter(Boolean).join(" · ");
  const canTick = !ordered && (!!p || !catalog);
  const swipe = useSwipe(canTick, (dir) => onCart(dir === "right"));
  return (
    <li id={`ligne-${r.id}`} className="relative scroll-mt-28 overflow-hidden border-b border-line">
      {swipe.dx !== 0 && (
        <span aria-hidden className={`absolute inset-0 flex items-center px-4 text-small font-bold ${swipe.dx > 0 ? "justify-start bg-accent-soft text-accent" : "justify-end bg-surface-2 text-ink-2"}`}>
          <span className="inline-flex items-center gap-1">
            <Icon name={swipe.dx > 0 ? "check" : "x"} size="s" />
            {swipe.dx > 0 ? "Au panier" : "Retirer"}
          </span>
        </span>
      )}
      <div
        {...swipe.handlers}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        className={`relative grid touch-pan-y grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-3 bg-bg py-3 ${swipe.dragging ? "" : "transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)]"} ${ordered && !r.inCart ? "opacity-50" : ""}`}
      >
        <span className="-ml-3">
          {canTick ? <Tick checked={r.inCart} onChange={onCart} label={r.inCart ? `Retirer ${name} du panier` : `${name} : au panier`} /> : <Tick checked={r.inCart} label={r.inCart ? "commandé" : "pas commandé"} />}
        </span>
        <FoodIllu item={r.item} size="s" className={`mt-2 transition-opacity duration-[var(--dur-1)] ${done ? "opacity-40" : ""}`} />
        <div className="min-w-0 pt-2">
          {ordered ? (
            <RowName qty={qty} name={name} done={false} />
          ) : (
            <button type="button" onClick={onPick} className="group/name block max-w-full rounded-[4px] text-left" aria-label={`${name} : détail${p ? ", paquets, autre produit" : ""}`}>
              <RowName qty={qty} name={name} done={done} hover />
            </button>
          )}
          {meta && <span className={`mt-1 block truncate text-small ${done ? "text-ink-3" : "text-ink-2"}`}>{meta}</span>}
          {sig && !done && (
            <SignalLine
              s={sig}
              action={
                sig.act && catalog ? (
                  <button type="button" onClick={onPick} className="inline-flex min-h-tap items-center gap-1 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    {p ? "Changer de produit" : "Chercher"}
                  </button>
                ) : null
              }
            />
          )}
        </div>
        <div className="grid justify-items-end pt-2 text-right">
          {!p && !catalog && !ordered ? (
            <PriceInput value={r.totalPrice} label={r.item} onSave={onPrice} />
          ) : (
            <>
              <span className={`num text-body font-semibold ${done ? "text-ink-3" : ""}`}>{eur(r.totalPrice)}</span>
              {p && r.unitPrice != null && r.packs > 1 && <span className="num text-small text-ink-3 max-sm:hidden">{eur(r.unitPrice)} le paquet</span>}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function RowName({ qty, name, done, hover = false }: { qty: string | null; name: string; done: boolean; hover?: boolean }) {
  return (
    <span className={`block text-body leading-snug transition-colors duration-[var(--dur-1)] ${done ? "text-ink-3 line-through decoration-ink-3" : ""}`}>
      {qty && <span className="num-tight mr-2 text-ink">{qty}</span>}
      <span className={`font-semibold ${hover ? "underline decoration-transparent underline-offset-4 group-hover/name:decoration-line-strong" : ""}`}>{name}</span>
    </span>
  );
}

/** Détail d'une ligne (feuille) : le produit, pour quoi, combien, puis changer de produit. */
function Detail({ r, catalog, ordered, pending, start, show, onPacks, close }: { r: RowData; catalog: boolean; ordered: boolean; pending: boolean; start: (fn: () => Promise<void>) => void; show: (m: string, ok: boolean) => void; onPacks: (n: number) => void; close: () => void }) {
  const p = r.product;
  const sig = signalOf(r, catalog, ordered);
  const accepted = r.accepted.filter((a) => !a.current);
  const alts = r.state !== "ok" ? r.alts.filter((a) => !r.accepted.some((x) => x.id === a.id)) : [];
  const facts: [string, ReactNode][] = [
    ["Pour", r.item],
    ...(r.forRecipes ? ([["Recettes", r.forRecipes]] as [string, ReactNode][]) : []),
    ...(r.needG != null ? ([["Besoin", <span key="b" className="num">{grams(r.needG)}</span>]] as [string, ReactNode][]) : []),
    ...(p ? ([["Produit", [p.brandName, p.quantityLabel].filter(Boolean).join(", ") || p.name]] as [string, ReactNode][]) : []),
    ...(p && r.unitPrice != null ? ([["Prix", <span key="p" className="num">{eur(r.unitPrice)} le paquet</span>]] as [string, ReactNode][]) : []),
  ];
  return (
    <>
      {sig && <SignalLine s={sig} />}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] border-t border-line">
        {facts.map(([k, v]) => (
          <div key={k} className="col-span-2 grid grid-cols-subgrid border-b border-line py-3">
            <dt className="label pt-1 pr-4 text-ink-3">{k}</dt>
            <dd className="min-w-0">{v}</dd>
          </div>
        ))}
      </dl>
      {p?.url && (
        <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex min-h-tap items-center gap-1 justify-self-start text-small font-semibold text-accent underline-offset-4 hover:underline">
          <Icon name="link" size="s" />
          Voir le produit sur le drive
        </a>
      )}
      {p && !ordered && (
        <div className="flex items-center justify-between gap-4">
          <span className="label text-ink-2">Paquets</span>
          <Stepper size="sm" value={r.packs} min={0} onChange={onPacks} decLabel={`Un paquet de moins de ${p.name}`} incLabel={`Un paquet de plus de ${p.name}`} />
        </div>
      )}
      {catalog && !ordered && (accepted.length > 0 || alts.length > 0) && (
        <div className="grid gap-2">
          <span className="label text-ink-2">{accepted.length ? "Produits acceptés" : "Proposés par le catalogue"}</span>
          <ul className="border-t border-line">
            {accepted.map((a) => (
              <li key={a.id}>
                <Choice
                  label={a.label}
                  price={a.price}
                  note={a.preferred ? "préféré" : null}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await chooseAcceptedProduct(r.id, a.id);
                      show(res.message ?? "Produit changé.", res.ok);
                      if (res.ok) close();
                    })
                  }
                />
              </li>
            ))}
            {alts.map((a) => (
              <li key={a.id}>
                <form action={chooseAlternative.bind(null, r.id, a.id)} onSubmit={() => setTimeout(close, 0)}>
                  <Choice label={a.label} price={a.price} submit />
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
      {catalog && !ordered && (
        <div className="grid gap-2">
          <span className="label text-ink-2">Chercher un autre produit</span>
          <ProductPicker
            key={r.id}
            itemId={r.id}
            initial={r.item}
            onDone={(m, ok) => {
              show(m, ok);
              if (ok) close();
            }}
          />
        </div>
      )}
      {catalog && !ordered && r.canRefuse && p && (
        <div className="grid gap-2 border-t border-line pt-4">
          <p className="text-small text-ink-2">Ce produit ne convient pas ? Il sera exclu de toutes les recettes.</p>
          <Button
            size="sm"
            variant="danger"
            icon="x"
            className="justify-self-start"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await refuseItemProductAction(r.id);
                show(res.message ?? "Refusé.", res.ok);
                if (res.ok) close();
              })
            }
          >
            Ne correspond pas
          </Button>
        </div>
      )}
    </>
  );
}

function Choice({ label, price, note, disabled, onClick, submit = false }: { label: string; price: number | null; note?: string | null; disabled?: boolean; onClick?: () => void; submit?: boolean }) {
  return (
    <button type={submit ? "submit" : "button"} disabled={disabled} onClick={onClick} className="-mx-3 flex w-[calc(100%+24px)] items-center justify-between gap-4 rounded-[8px] border-b border-line px-3 py-3 text-left hover:bg-surface-2 disabled:opacity-40">
      <span className="min-w-0">
        {label}
        {note && <span className="ml-2 text-small text-ink-3">{note}</span>}
      </span>
      <span className="num shrink-0 font-semibold">{eur(price)}</span>
    </button>
  );
}

/** Prix payé d'une ligne sans catalogue, saisi en magasin (euros, virgule acceptée) : enregistré en quittant le champ. */
function PriceInput({ value, label, onSave }: { value: number | null; label: string; onSave: (eur: number | null) => void }) {
  const [text, setText] = useState(value != null ? value.toFixed(2).replace(".", ",") : "");
  const save = () => {
    const t = text.trim().replace(",", ".");
    const v = t === "" ? null : Number(t);
    if (v != null && !Number.isFinite(v)) return;
    if (v !== value) onSave(v);
  };
  return (
    <label className="-mt-2 inline-flex items-center gap-1 text-ink-2">
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="prix"
        aria-label={`Prix payé : ${label}`}
        className="num h-10 w-18 rounded-[8px] border border-transparent bg-transparent px-2 text-right text-body font-semibold text-ink outline-none transition-colors duration-[var(--dur-1)] placeholder:font-normal placeholder:text-ink-3 hover:border-line-strong focus:border-ink focus:bg-surface"
      />
      €
    </label>
  );
}

/** Glisser une ligne au doigt : vers la droite la met dans le panier, vers la gauche l'en retire (seuil 72 px). La souris et le défilement vertical ne sont pas touchés. */
function useSwipe(enabled: boolean, onSwipe: (dir: "left" | "right") => void) {
  const start = useRef<{ x: number; y: number; id: number; locked: boolean | null } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const end = () => {
    start.current = null;
    setDragging(false);
    setDx(0);
  };
  if (!enabled) return { dx: 0, dragging: false, handlers: {} };
  return {
    dx,
    dragging,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, locked: null };
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const x = e.clientX - s.x;
        const y = e.clientY - s.y;
        if (s.locked == null && (Math.abs(x) > 10 || Math.abs(y) > 10)) s.locked = Math.abs(x) > Math.abs(y) * 1.4;
        if (!s.locked) return;
        setDragging(true);
        setDx(Math.max(-120, Math.min(120, x)));
      },
      onPointerUp: () => {
        if (Math.abs(dx) >= 72) onSwipe(dx > 0 ? "right" : "left");
        end();
      },
      onPointerCancel: end,
    },
  };
}

function OrderedBanner({ listId, title, orderedAt, lines, total, onMsg }: { listId: string; title: string; orderedAt: string | null; lines: { packs: number; name: string; price: number | null }[]; total: number; onMsg: (m: string, ok: boolean) => void }) {
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="commande-titre" className="grid gap-6 sm:grid-cols-12 sm:items-start sm:gap-x-6">
      <div className="sm:col-span-5">
        <Ticket seed={listId} title={title} lines={lines} total={total} orderedAt={orderedAt} />
      </div>
      <div className="grid gap-4 sm:col-span-7">
        <h2 id="commande-titre" className="text-h2">
          Commande validée
        </h2>
        <p className="text-ink-2">
          Prix figés{orderedAt ? ` le ${new Date(orderedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}` : ""}. Ce qui reste des paquets est au placard.
        </p>
        <span className="flex flex-wrap gap-2">
          <Link href="/placard" className={buttonClass({ variant: "primary", size: "sm" })}>
            Voir le placard
          </Link>
          <Link href="/couts" className={buttonClass({ size: "sm" })}>
            Coûts
          </Link>
          <Button
            size="sm"
            variant="quiet"
            state={pending ? "loading" : "idle"}
            loadingLabel="Annulation…"
            onClick={() =>
              start(async () => {
                const r = await cancelOrder(listId);
                onMsg(r.message ?? "", r.ok);
              })
            }
          >
            Annuler la validation
          </Button>
        </span>
      </div>
    </section>
  );
}
