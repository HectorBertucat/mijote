"use client";

// Les goûts sur la fiche recette : ce qu’en pense chacun (le dernier retour), le retour en un geste, un
// ingrédient remplacé en vrai (la nutrition de la réserve ou de la session suit), et la variante ajustée
// d’après les retours, avec l’aperçu chiffré de la part de chacun. Les chiffres viennent du serveur.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { swapAction, variantAction } from "@/app/recettes/[slug]/gouts-actions";
import { Button, Icon } from "@/components/ui";
import { firstOfMonth } from "@/lib/typo";
import { TasteForm } from "./TasteForm";

export interface TastePanelData {
  recipeId: string;
  slug: string;
  people: { id: string; name: string }[];
  activeId: string;
  latest: { personId: string; line: string; note: string | null; at: string; meh: boolean }[];
  swaps: { id: string; from: string; to: string; at: string; where: "session" | "reserve" | null }[];
  swappable: { position: number; item: string; options: { food: string; label: string }[] }[];
  swapWhere: string;
  /** Une variante née après le dernier « bof ». */
  adjusted: { slug: string; name: string } | null;
  adjust: {
    tags: string[];
    tagsLine: string;
    withSwaps: boolean;
    changes: string[];
    notes: string[];
    preview: { name: string; before: { kcal: number | null; protein: number | null }; after: { kcal: number | null; protein: number | null }; proteinMin: number | null }[];
    name: string;
  } | null;
}

const SELECT = "min-h-12 w-full rounded-[8px] border border-line-strong bg-surface px-3 text-[16px] text-ink";
const day = (iso: string) => firstOfMonth(new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" }));

export function TastePanel({ data }: { data: TastePanelData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pos, setPos] = useState<number>(data.swappable[0]?.position ?? -1);
  const options = data.swappable.find((s) => s.position === pos)?.options ?? [];
  const [to, setTo] = useState<string>(options[0]?.food ?? "");
  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  const swap = () =>
    start(async () => {
      const r = await swapAction({ recipeId: data.recipeId, slug: data.slug, position: pos, toFood: to });
      say(r.ok, r.message);
      if (r.ok) router.refresh();
    });
  const keep = () =>
    start(async () => {
      if (!data.adjust) return;
      const r = await variantAction({ slug: data.slug, tags: data.adjust.tags, withSwaps: data.adjust.withSwaps });
      say(r.ok, r.message);
      if (r.ok && "slug" in r) router.push(`/recettes/${r.slug}`);
    });

  return (
    <div className="grid gap-10" data-gouts="panel">
      <div className="grid gap-3">
        {data.latest.length ? (
          <ul className="grid border-y border-line">
            {data.latest.map((f) => (
              <li key={f.personId} className="grid gap-1 border-t border-line py-3 first:border-t-0" data-gout-person={f.personId}>
                <span className={`inline-flex items-start gap-2 font-semibold ${f.meh ? "text-warn-ink" : ""}`}>
                  <Icon name={f.meh ? "alert" : "star"} size="s" className={`mt-[4px] shrink-0 ${f.meh ? "text-warn" : "text-ok"}`} />
                  {f.line}
                </span>
                <span className="text-small text-ink-2">
                  {f.note ? `« ${f.note} » · ` : ""}
                  {day(f.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-ink-2">Personne n’a encore noté ce plat. Après l’avoir mangé, un geste suffit : je m’en souviens pour la Semaine et pour l’ajuster.</p>
        )}
        <TasteForm recipeId={data.recipeId} slug={data.slug} people={data.people} personId={data.activeId} title="Ton avis" className="mt-3" />
      </div>

      {data.swappable.length > 0 && (
        <div className="grid gap-4" data-gouts="swap">
          <div className="grid gap-1">
            <b className="text-[17px]">J’ai remplacé un ingrédient</b>
            <p className="text-small text-ink-2">Poids pour poids, la nutrition suit la table : noté pour {data.swapWhere}.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1 text-small text-ink-2">
              Ingrédient
              <select
                className={SELECT}
                value={pos}
                onChange={(e) => {
                  const p = Number(e.target.value);
                  setPos(p);
                  setTo(data.swappable.find((s) => s.position === p)?.options[0]?.food ?? "");
                }}
              >
                {data.swappable.map((s) => (
                  <option key={s.position} value={s.position}>
                    {s.item.split(/[,(]/)[0].trim()}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-small text-ink-2">
              Remplacé par
              <select className={SELECT} value={to} onChange={(e) => setTo(e.target.value)} data-field="remplace-par">
                {options.map((o) => (
                  <option key={o.food} value={o.food}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={swap} disabled={pending || pos < 0 || !to} icon="swap" data-action="remplacer">
              Noter
            </Button>
          </div>
          {data.swaps.length > 0 && (
            <ul className="grid gap-1 text-small text-ink-2">
              {data.swaps.map((s) => (
                <li key={s.id}>
                  {s.from} → {s.to}, le {day(s.at)}
                  {s.where === "reserve" ? " (plat en réserve recalculé)" : s.where === "session" ? " (session)" : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data.adjusted && (
        <p className="flex items-start gap-2 text-body" data-gouts="ajustee">
          <Icon name="swap" size="s" className="mt-[5px] shrink-0 text-ink-3" />
          <span>
            Ajustée depuis le dernier « bof » :{" "}
            <Link href={`/recettes/${data.adjusted.slug}`} className="font-semibold text-accent underline-offset-4 hover:underline">
              {data.adjusted.name}
            </Link>
            .
          </span>
        </p>
      )}
      {data.adjust && (
        <div className="grid gap-4 border-l-2 border-line-strong pl-4" data-gouts="ajuster">
          <div className="grid gap-1">
            <b className="text-[17px]">Ajuster d’après les retours</b>
            <p className="text-small text-ink-2">
              {data.adjust.tagsLine ? `Retours : ${data.adjust.tagsLine}. ` : ""}Une variante, l’originale ne bouge pas : {data.adjust.name}.
            </p>
          </div>
          <ul className="grid gap-1 text-body">
            {data.adjust.changes.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <Icon name="chev" size="s" className="mt-[5px] shrink-0 text-ink-3" />
                {c}
              </li>
            ))}
            {data.adjust.notes.map((n) => (
              <li key={n} className="flex items-start gap-2 text-ink-2">
                <Icon name="info" size="s" className="mt-[5px] shrink-0 text-ink-3" />
                {n}
              </li>
            ))}
          </ul>
          {data.adjust.preview.some((p) => p.after.kcal != null) && (
            <table className="num w-full max-w-md text-small">
              <caption className="sr-only">La part de chacun, avant et après</caption>
              <thead>
                <tr className="text-left text-ink-2">
                  <th className="py-1 font-semibold">La part de</th>
                  <th className="py-1 font-semibold">Avant</th>
                  <th className="py-1 font-semibold">Après</th>
                </tr>
              </thead>
              <tbody>
                {data.adjust.preview.map((p) => (
                  <tr key={p.name} className="border-t border-line">
                    <td className="py-2 font-semibold">{p.name}</td>
                    <td className="py-2">{p.before.kcal != null ? `${p.before.kcal} kcal · ${p.before.protein} g prot.` : "—"}</td>
                    <td className={`py-2 ${p.proteinMin != null && (p.after.protein ?? 0) < p.proteinMin ? "text-warn-ink" : ""}`}>
                      {p.after.kcal != null ? `${p.after.kcal} kcal · ${p.after.protein} g prot.` : "—"}
                      {p.proteinMin != null ? <span className="text-ink-3"> (≥ {p.proteinMin} g)</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div>
            <Button variant="primary" onClick={keep} disabled={pending} icon="plus" data-action="variante">
              Enregistrer la variante
            </Button>
          </div>
        </div>
      )}
      {msg && (
        <p role="status" className={`inline-flex items-center gap-1 text-small ${msg.ok ? "text-ink-2" : "text-ko"}`}>
          <Icon name={msg.ok ? "check" : "alert"} size="s" />
          {msg.text}
        </p>
      )}
    </div>
  );
}
