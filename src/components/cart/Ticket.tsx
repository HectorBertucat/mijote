"use client";

// Ticket de caisse d'une commande validée : papier, lignes « 2 × produit … prix », total, et le cachet « Commandé »
// posé en biais. Chiffres de caisse en Archivo serrée (deux polices, pas une de plus), sans ombre : il est posé. Le cachet se pose avec son « pof » seulement juste après la validation (moins de 20 s).
import { useEffect, useState } from "react";
import { StampCommande } from "@/components/ui";
import { eur } from "./format";

export function Ticket({ seed, title, lines, total, orderedAt }: { seed: string; title: string; lines: { packs: number; name: string; price: number | null }[]; total: number; orderedAt: string | null }) {
  const at = orderedAt ? new Date(orderedAt) : null;
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (at && Date.now() - at.getTime() < 20_000) setFresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedAt]);
  return (
    <div className="k-ticket relative w-full max-w-[340px] border border-b-0 border-line px-4 pt-4 pb-6 text-small text-ink" style={{ fontFamily: "var(--font-num)", fontStretch: "75%", boxShadow: "none" }}>
      <p className="label text-center">Mijote · courses</p>
      <p className="truncate text-center text-ink-2">{title}</p>
      {at && <p className="text-center text-ink-2">{at.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" })}</p>}
      <hr className="my-2" />
      <ul className="grid">
        {lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">
              {l.packs} × {l.name}
            </span>
            <span className="shrink-0 tabular-nums">{l.price == null ? "—" : l.price.toFixed(2).replace(".", ",")}</span>
          </li>
        ))}
      </ul>
      <hr className="my-2" />
      <p className="flex justify-between font-bold">
        <span className="label self-center">Total · {lines.length} art.</span>
        <span className="tabular-nums">{eur(total)}</span>
      </p>
      <p className="mt-2 text-center text-ink-2">Merci, et bonne cuisine</p>
      <span className="absolute -right-2 bottom-10">
        <StampCommande key={fresh ? "f" : "s"} date={at} seed={seed} size={150} fresh={fresh} />
      </span>
    </div>
  );
}
