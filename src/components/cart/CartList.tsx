"use client";

// La liste de courses interactive (DA « Plan de travail », .aisle/.cline) : rayons, lignes avec case animée
// « dans le panier » (compteur), +/− paquets (Stepper), pastille d'état, « Changer » le produit (recherche dans
// une feuille), valider la commande. Chaque tap répond tout de suite (état optimiste), puis la page se recharge.
import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import { cancelOrder, cartAll, changePacks, chooseAcceptedProduct, chooseAlternative, refuseItemProductAction, setLinePriceAction, toggleCart, validateList } from "@/app/courses/actions";
import { Button, buttonClass, Check, Icon, Input, Macro, Pill, Progress, Sheet, Stepper, type PillTone } from "@/components/ui";
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
  /** Ce que le vrai panier Chronodrive a dit de la ligne (added, already, partial, unavailable, failed, skipped). */
  drive?: { outcome: string; qty: number | null } | null;
}

const DRIVE: Record<string, { tone: PillTone; text: (q: number | null) => string }> = {
  added: { tone: "ok", text: (q) => `au panier${q ? ` · ${q}` : ""}` },
  already: { tone: "ok", text: (q) => `déjà au panier${q ? ` · ${q}` : ""}` },
  partial: { tone: "warn", text: (q) => `panier : ${q ?? 0} seulement` },
  unavailable: { tone: "ko", text: () => "pas ajouté (stock)" },
  failed: { tone: "ko", text: () => "refusé par le panier" },
  skipped: { tone: "warn", text: () => "hors drive" },
};

type Opt = { kind: "cart"; id: string; on: boolean } | { kind: "all"; on: boolean } | { kind: "packs"; id: string; packs: number } | { kind: "price"; id: string; price: number | null };

/** Mot de la pastille : le premier avertissement s'il y en a un, sinon l'état. */
function stateWord(r: RowData, catalog: boolean): { tone: PillTone; text: string } {
  if (!r.product) return catalog ? { tone: "ko", text: "introuvable" } : { tone: "idle", text: r.totalPrice != null ? "prix saisi" : "à prendre" };
  const w = r.warnings.find((x) => x !== "facultatif");
  if (r.liveStatus === "done" || r.liveStatus === "fresh") return { tone: r.state === "ko" ? "ko" : "ok", text: r.state === "ko" ? (w ?? "rupture") : "vérifié en direct" };
  if (r.state === "ok") return { tone: "ok", text: w ?? "en stock" };
  if (r.state === "ko") return { tone: "ko", text: w ?? "rupture" };
  return { tone: "warn", text: w ?? "à vérifier" };
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
  const [picking, setPicking] = useState<RowData | null>(null);
  const { show, node } = useToast();
  const byId = new Map(rows.map((r) => [r.id, r]));

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
    <div className="grid gap-1">
      {!ordered ? (
        <div className="sticky top-[57px] z-10 -mx-4 mb-1 border-b border-line bg-[color-mix(in_srgb,var(--c-bg)_92%,transparent)] px-4 py-2 backdrop-blur-md sm:top-[59px]">
          <div className="flex items-center gap-3">
            <div className="grid min-w-0 flex-1 gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-[14px]">
                <span>
                  <b key={inCart.length} className={`inline-block animate-pop font-display text-[20px] tabular-nums ${all100 ? "text-ok" : "text-accent"}`}>
                    {inCart.length}
                  </b>
                  <span className="text-ink-2">/{buyable.length} dans le panier</span>
                </span>
                <span className="num text-ink-2">{eur(inCart.reduce((s, r) => s + (r.totalPrice ?? 0), 0))}</span>
              </div>
              <Progress value={buyable.length ? inCart.length / buyable.length : 0} label="Dans le panier" />
            </div>
            <Button size="sm" onClick={() => run({ kind: "all", on: !all100 }, () => cartAll(listId, !all100))}>
              {all100 ? "Tout décocher" : "Tout cocher"}
            </Button>
          </div>
        </div>
      ) : (
        <OrderedBanner listId={listId} title={title} orderedAt={orderedAt} lines={inCart.map((r) => ({ packs: r.packs, name: r.product?.name ?? r.item, price: r.totalPrice }))} total={inCart.reduce((s, r) => s + (r.totalPrice ?? 0), 0)} onMsg={show} />
      )}

      {groups.map(({ aisle, rows: gr }) => {
        const n = gr.filter((g) => !byId.get(g.id)!.pantry).length;
        const got = gr.filter((g) => byId.get(g.id)!.inCart).length;
        const head = (
          <>
            <span>{aisle === "Placard" ? "Placard · à vérifier chez toi" : aisle}</span>
            <span className="num inline-flex items-center gap-1">
              {aisle === "Placard" ? gr.length : `${got ? `${got}/` : ""}${n}`}
              {aisle === "Placard" && <Icon name="chev" size="s" className="transition-transform group-open:rotate-90" />}
            </span>
          </>
        );
        const H = "flex justify-between px-0.5 pb-1.5 pt-3.5 font-display text-[12px] font-bold uppercase tracking-[0.1em] text-faint [font-stretch:100%]";
        const Wrap = aisle === "Placard" ? "details" : "section";
        return (
          <Wrap key={aisle} aria-label={aisle} className="group min-w-0">
            {aisle === "Placard" ? <summary className={`${H} min-h-tap cursor-pointer list-none items-center`}>{head}</summary> : <h2 className={H}>{head}</h2>}
            <ul className="overflow-hidden rounded-[14px] border border-line bg-surface [&>li:last-child]:border-b-0">
              {gr.map((g) => {
                const r = byId.get(g.id)!;
                return r.pantry ? (
                  <li key={r.id} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 text-[14px]">
                    <Icon name="home" size="s" className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{r.item}</span>
                      <span className="text-ink-2">{[grams(r.needG), r.forRecipes].filter(Boolean).map((x) => ` · ${x}`).join("")}</span>
                    </span>
                  </li>
                ) : (
                  <Row
                    key={r.id}
                    r={r}
                    catalog={catalog}
                    ordered={ordered}
                    onPrice={(eur) => run({ kind: "price", id: r.id, price: eur }, () => setLinePriceAction(r.id, eur))}
                    onCart={(on) => run({ kind: "cart", id: r.id, on }, () => toggleCart(r.id, on))}
                    onPacks={(n) => run({ kind: "packs", id: r.id, packs: n }, () => changePacks(r.id, n))}
                    onPick={() => setPicking(r)}
                  />
                );
              })}
            </ul>
          </Wrap>
        );
      })}

      {!ordered && buyable.length > 0 && (
        <div className="sticky bottom-[calc(4.9rem+env(safe-area-inset-bottom))] z-20 mt-3 sm:bottom-4">
          <div className="flex items-center justify-between gap-3 rounded-[14px] border border-line bg-raised px-4 py-3 shadow-e2">
            <Macro className="min-w-0" value={total.toFixed(2).replace(".", ",")} unit="€" sub={`${toValidate.length} produit${toValidate.length > 1 ? "s" : ""}${inCart.length ? ` · ${inCart.length} dans le panier` : " · rien de coché"}`} />
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
      {copy && !ordered && <div className="mt-2 sm:hidden">{copy}</div>}

      <Sheet open={picking != null} onClose={() => setPicking(null)} title={picking ? `${picking.product ? "Changer" : "Chercher"} · ${picking.product ? `${picking.product.name}${picking.product.quantityLabel ? ` ${picking.product.quantityLabel}` : ""}` : picking.item}` : ""}>
        {picking && (
          <>
            <p className="text-[14px] text-ink-2">
              Pour {picking.item}
              {picking.needG != null && ` · besoin ${grams(picking.needG)}`}
              {picking.forRecipes && ` · ${picking.forRecipes}`}. Les paquets se recalculent.
            </p>
            {picking.accepted.filter((a) => !a.current).length > 0 && (
              <div className="grid gap-1.5">
                <span className="font-display text-[12px] font-bold uppercase tracking-[0.12em] text-faint">Produits acceptés</span>
                <div className="flex flex-wrap gap-2">
                  {picking.accepted
                    .filter((a) => !a.current)
                    .map((a) => (
                      <Button
                        key={a.id}
                        size="sm"
                        icon={a.preferred ? "star" : "swap"}
                        className="!h-auto !whitespace-normal py-1.5 text-left"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const r = await chooseAcceptedProduct(picking.id, a.id);
                            show(r.message ?? "Produit changé.", r.ok);
                            if (r.ok) setPicking(null);
                          })
                        }
                      >
                        {a.label}
                        {a.price != null && ` · ${eur(a.price)}`}
                        {a.preferred && " · préféré"}
                      </Button>
                    ))}
                </div>
              </div>
            )}
            {picking.canRefuse && picking.product && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-surface-2 px-3 py-2 text-[14px] text-ink-2">
                <span className="min-w-0">
                  Ce produit ({[picking.product.brandName, picking.product.quantityLabel].filter(Boolean).join(", ") || picking.product.name}) ne convient pas ? Il sera exclu de toutes les recettes.
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  icon="x"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await refuseItemProductAction(picking.id);
                      show(r.message ?? "Refusé.", r.ok);
                      if (r.ok) setPicking(null);
                    })
                  }
                >
                  Ne correspond pas
                </Button>
              </div>
            )}
            {picking.alts.filter((a) => !picking.accepted.some((x) => x.id === a.id)).length > 0 && picking.state !== "ok" && (
              <div className="grid gap-1.5">
                <span className="font-display text-[12px] font-bold uppercase tracking-[0.12em] text-faint">Proposés par le catalogue</span>
                <div className="flex flex-wrap gap-2">
                  {picking.alts.filter((a) => !picking.accepted.some((x) => x.id === a.id)).map((a) => (
                    <form key={a.id} action={chooseAlternative.bind(null, picking.id, a.id)} onSubmit={() => setTimeout(() => setPicking(null), 0)}>
                      <Button type="submit" size="sm" icon="swap" className="!h-auto !whitespace-normal py-1.5 text-left">
                        {a.label}
                        {a.price != null && ` · ${eur(a.price)}`}
                      </Button>
                    </form>
                  ))}
                </div>
              </div>
            )}
            <ProductPicker
              key={picking.id}
              itemId={picking.id}
              initial={picking.item}
              onDone={(m, ok) => {
                show(m, ok);
                if (ok) setPicking(null);
              }}
            />
          </>
        )}
      </Sheet>
      {pending && <span className="sr-only">Enregistrement…</span>}
      {node}
    </div>
  );
}

function Row({ r, catalog, ordered, onCart, onPacks, onPick, onPrice }: { r: RowData; catalog: boolean; ordered: boolean; onCart: (on: boolean) => void; onPacks: (n: number) => void; onPick: () => void; onPrice: (eur: number | null) => void }) {
  const p = r.product;
  const st = stateWord(r, catalog);
  const live = !ordered ? liveWord(r.liveStatus) : null;
  const unit = p && r.unitPrice != null ? `${eur(r.unitPrice)} le paquet` : null;
  const swipe = useSwipe(!ordered && (!!p || !catalog), (dir) => onCart(dir === "right"));
  return (
    <li className="relative overflow-hidden border-b border-line">
      {swipe.dx !== 0 && (
        <span aria-hidden className={`absolute inset-0 flex items-center px-5 text-[14px] font-bold ${swipe.dx > 0 ? "justify-start bg-accent-soft text-accent" : "justify-end bg-surface-2 text-ink-2"}`}>
          <span className="inline-flex items-center gap-1.5">
            <Icon name={swipe.dx > 0 ? "basket" : "x"} size="s" />
            {swipe.dx > 0 ? "dans le panier" : "retirer"}
          </span>
        </span>
      )}
    <div
      {...swipe.handlers}
      style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
      className={`relative grid touch-pan-y grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 bg-surface px-3.5 py-2.5 transition-[background-color,opacity,transform] duration-[var(--dur-base)] ${swipe.dragging ? "!transition-none" : ""} ${(r.inCart && !ordered) || (ordered && !r.inCart) ? "opacity-70" : ""} ${r.liveStatus === "pending" ? "!bg-accent-soft" : ""}`}
    >
      <span className="pt-0.5">
        {(p || !r.pantry) && !ordered ? (
          <Check checked={r.inCart} onChange={(e) => onCart(e.target.checked)} aria-label={r.inCart ? `Retirer ${p?.name ?? r.item} du panier` : `${p?.name ?? r.item} dans le panier`} className="!min-h-0" />
        ) : (
          <span className={`grid size-[26px] place-items-center rounded-[7px] ${r.inCart ? "bg-accent text-on-accent" : "border-2 border-line-strong"}`} aria-label={r.inCart ? "commandé" : "pas commandé"} role="img">
            {r.inCart && <Icon name="check" size={16} strokeWidth={3} />}
          </span>
        )}
      </span>
      <div className="min-w-0">
        <div className={`text-[15px] font-semibold leading-[1.25] transition-colors ${r.inCart && !ordered ? "text-faint line-through" : ""}`}>
          {p ? (
            <>
              <span className="num mr-1 font-display font-extrabold">{r.packs} ×</span>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {p.name}
                </a>
              ) : (
                p.name
              )}
            </>
          ) : (
            r.item
          )}
        </div>
        <div className="mt-[3px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
          {p?.quantityLabel && <span className="num">{p.quantityLabel}</span>}
          <Pill tone={st.tone}>{st.text}</Pill>
          {live && <Pill tone={live.tone} icon={live.icon}>{live.text}</Pill>}
          {r.drive && DRIVE[r.drive.outcome] && (
            <Pill tone={DRIVE[r.drive.outcome].tone} icon="basket">
              {DRIVE[r.drive.outcome].text(r.drive.qty)}
            </Pill>
          )}
          <span className="min-w-0">
            {[r.forRecipes, r.needG != null ? `besoin ${grams(r.needG)}` : null, p?.brandName].filter(Boolean).join(" · ")}
          </span>
        </div>
        {r.warnings.length > 1 && <div className={`mt-1 text-[13px] ${r.state === "ko" ? "text-ko-ink" : "text-warn-ink"}`}>{r.warnings.filter((w) => w !== st.text).join(" · ")}</div>}
        {!ordered && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {p && <Stepper size="sm" value={r.packs} min={0} onChange={onPacks} decLabel={`Un paquet de moins de ${p.name}`} incLabel={`Un paquet de plus de ${p.name}`} />}
            {catalog ? (
              <Button size="sm" variant={!p || r.state === "ko" ? "primary" : r.state === "warn" ? "secondary" : "quiet"} icon={p ? "swap" : "search"} onClick={onPick}>
                {p ? "Changer" : "Chercher"}
              </Button>
            ) : (
              !p && <PriceInput value={r.totalPrice} label={r.item} onSave={onPrice} />
            )}
          </div>
        )}
      </div>
      <div className="grid justify-items-end gap-0.5 text-right">
        <b className="num font-display text-[16px]">{eur(r.totalPrice)}</b>
        {unit && r.packs > 1 && <span className="num text-[12px] text-faint">{unit}</span>}
      </div>
    </div>
    </li>
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
    <label className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
      <Input num inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} placeholder="prix" aria-label={`Prix payé : ${label}`} className="!h-9 !min-h-0 !w-20 !px-2 text-right" />
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

function liveWord(status: string | null): { tone: PillTone; text: string; icon?: "refresh" | "check" | "x" | "dash" } | null {
  if (!status) return null;
  if (status === "pending") return { tone: "idle", text: "en file chez le worker", icon: "refresh" };
  if (status === "done" || status === "fresh") return null; // déjà dit par la pastille d'état
  if (status === "failed") return { tone: "ko", text: "vérification échouée" };
  return { tone: "idle", text: "pas vérifiable en direct", icon: "dash" };
}

function OrderedBanner({ listId, title, orderedAt, lines, total, onMsg }: { listId: string; title: string; orderedAt: string | null; lines: { packs: number; name: string; price: number | null }[]; total: number; onMsg: (m: string, ok: boolean) => void }) {
  const [pending, start] = useTransition();
  return (
    <div className="mb-2 grid animate-pop gap-3 sm:grid-cols-[minmax(0,340px)_minmax(0,1fr)] sm:items-start sm:gap-5">
      <Ticket seed={listId} title={title} lines={lines} total={total} orderedAt={orderedAt} />
      <div className="grid gap-2.5 text-[15px]">
        <p className="text-ink-2">
          Prix figés {orderedAt ? `le ${new Date(orderedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}` : ""}. Les restes sont au placard.
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
    </div>
  );
}
