"use client";

// Recherche dans le catalogue (GET /search, produits disponibles) pour changer le produit d'une ligne.
import { useEffect, useRef, useState, useTransition } from "react";
import { pickProduct, searchProducts } from "@/app/courses/actions";
import type { CatalogChoice } from "@/lib/shopping/cart";
import { Button, Input, Pill } from "@/components/ui";
import { eur } from "./format";

export function ProductPicker({ itemId, initial, onDone, onClose }: { itemId: string; initial: string; onDone: (msg: string, ok: boolean) => void; onClose?: () => void }) {
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<CatalogChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const n = ++seq.current;
    const id = setTimeout(async () => {
      setSearching(true);
      const r = await searchProducts(query);
      if (n !== seq.current) return;
      setSearching(false);
      if (r.ok) {
        setResults(r.results);
        setError(null);
      } else setError(r.message);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="grid gap-2.5">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Input icon="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher dans le catalogue…" aria-label="Chercher dans le catalogue" />
        </div>
        {onClose && (
          <Button variant="quiet" onClick={onClose}>
            Fermer
          </Button>
        )}
      </div>
      {searching && !results && (
        <div className="grid gap-2">
          <div className="skeleton h-14 rounded-[12px]" />
          <div className="skeleton h-14 rounded-[12px] opacity-70" />
        </div>
      )}
      {error && <p className="text-[14px] text-ko-ink">{error}</p>}
      {results && results.length === 0 && <p className="px-1 text-[14px] text-ink-2">Rien de disponible sous ce nom. Essaie un mot plus court.</p>}
      {results && results.length > 0 && (
        <ul className={`grid overflow-hidden rounded-[14px] border border-line bg-surface transition-opacity [&>li:last-child>button]:border-b-0 ${searching ? "opacity-60" : ""}`}>
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={choosing != null}
                onClick={() => {
                  setChoosing(c.id);
                  start(async () => {
                    const r = await pickProduct(itemId, c.id, q);
                    setChoosing(null);
                    onDone(r.ok ? (r.message ?? "Produit changé.") : r.message, r.ok);
                  });
                }}
                className="flex w-full min-w-0 items-center gap-3 border-b border-line px-3 py-2.5 text-left transition-colors hover:bg-surface-2 active:scale-100 disabled:opacity-60"
              >
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="size-11 shrink-0 rounded-[8px] border border-line bg-surface object-contain" loading="lazy" />
                ) : (
                  <span className="size-11 shrink-0 rounded-[8px] bg-surface-2" />
                )}
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[15px] font-semibold">{c.name}</span>
                  <span className="num truncate text-[13px] text-ink-2">{[c.quantityLabel, c.brandName, c.pricePerKg != null ? `${eur(c.pricePerKg)}/kg` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="grid shrink-0 justify-items-end gap-1 text-right">
                  {choosing === c.id ? <span className="k-spin text-accent" aria-label="Choix en cours" /> : <b className="num font-display text-[15px]">{eur(c.price)}</b>}
                  {c.promo ? <Pill tone="ok" icon="check">promo</Pill> : <Pill tone="ok">en stock</Pill>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
