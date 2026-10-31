"use client";

// La marmite pesée → les grammes par boîte de chacun (src/lib/boxes/core.ts, calcul pur partagé avec
// le serveur). En fin de session, un bouton range les boîtes au frigo et au congélo ; sur la fiche,
// c’est seulement une calculette.
import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { Alert, Button, Field, Input } from "@/components/ui";
import { BoxGlyph } from "./BoxGlyph";
import { gramsLabel, placeFor, splitPot, type PotModel, type Weights } from "@/lib/boxes/core";
import type { StoredPot } from "@/lib/boxes/store";
import { storeSessionBoxes } from "@/app/frigo/actions";

const num = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export function PotSplit({ model, color, session, stored, head = true, kitchen = false, art }: { model: PotModel; color: string; session?: string; stored?: StoredPot | null; head?: boolean; /** Fin de session : bouton de cuisine (64 px). */ kitchen?: boolean; /** La boîte du plat (DishBox) ; à défaut, BoxGlyph. */ art?: ReactNode }) {
  const [dish, setDish] = useState(stored?.dishG ? String(Math.round(stored.dishG)) : "");
  const [side, setSide] = useState(stored?.sideG ? String(Math.round(stored.sideG)) : "");
  const [saved, setSaved] = useState<{ ok: boolean; message: string } | null>(stored?.count ? { ok: true, message: `${plural(stored.count, "boîte rangée", "boîtes rangées")}${stored.open < stored.count ? `, dont ${stored.count - stored.open} déjà sortie${stored.count - stored.open > 1 ? "s" : ""}` : ""}.` } : null);
  const [pending, start] = useTransition();
  const weights: Weights = { dishG: num(dish), sideG: model.side ? num(side) : null };
  const split = splitPot(model, weights);
  const sideName = model.side?.label ?? "garniture";
  const weighed = weights.dishG != null;
  const places = split.boxes.map((b) => placeFor(model.cookedOn ?? "", b.plannedFor?.date ?? null, model.fridgeDays, model.freezerOk));
  const inFridge = places.filter((p) => p === "fridge").length;
  const inFreezer = places.length - inFridge;
  const bounded = Object.values(split.modes).includes("borne");
  const planned = split.boxes.filter((b) => b.plannedFor).length;

  const store = () =>
    start(async () => {
      const r = await storeSessionBoxes(session!, model.recipeId, weights);
      setSaved(r);
    });

  return (
    <div className="grid gap-6" data-pot={model.slug}>
      {head && (
        <div className="flex items-center gap-4">
          {art ?? <BoxGlyph color={color} size={48} />}
          <h3 className="min-w-0 flex-1 text-h3">{model.name}</h3>
        </div>
      )}
      <div className="grid gap-3">
        <div className={`grid gap-4 ${model.side ? "grid-cols-2 sm:max-w-md" : "max-w-[280px]"}`}>
          <Field label={model.side ? "Plat cuit" : "Marmite cuite"}>
            {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" placeholder="g" value={dish} onChange={(e) => setDish(e.target.value)} data-field="plat" />}
          </Field>
          {model.side && (
            <Field label={`${sideName[0].toUpperCase()}${sideName.slice(1)} cuit`}>
              {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" placeholder="g" value={side} onChange={(e) => setSide(e.target.value)} data-field="garniture" />}
            </Field>
          )}
        </div>
        <p className="text-small text-ink-2">Pèse le récipient plein, retire le poids du récipient vide.</p>
      </div>

      <ul className="grid border-b border-line" aria-live="polite">
        {split.byPerson.map((p) => (
          <li key={p.personId} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-t border-line py-3">
            <b className="text-[17px]">{p.name}</b>
            <span className="num text-right text-[17px]">
              {plural(p.count, "boîte")}
              {weighed && (
                <>
                  {" "}de <b className="num-tight text-[28px] leading-none">{gramsLabel(p.dishG ?? 0)}</b>
                  {p.sideG != null && (
                    <>
                      {" "}+ <b className="num-tight text-[28px] leading-none">{gramsLabel(p.sideG)}</b> de {sideName}
                    </>
                  )}
                </>
              )}
            </span>
            {p.kcal != null && (
              <span className="num col-span-2 text-small text-ink-2">
                ≈&nbsp;{p.kcal}&nbsp;kcal · {p.protein}&nbsp;g de protéines la boîte
              </span>
            )}
          </li>
        ))}
      </ul>
      {!weighed && <p className="text-small text-ink-2">Pèse {model.side ? `le plat et le ${sideName}` : "la marmite"} pour avoir les grammes de chaque boîte.</p>}
      {weighed && model.side && weights.sideG == null && <p className="text-small text-ink-2">Sans le poids du {sideName}, il se partage à l’œil, dans la même proportion.</p>}
      {split.fill < 0.97 && (
        <Alert tone="warn" title="Moins que prévu">
          La marmite ne couvre pas les {planned} repas prévus : chaque boîte est plus petite que la part visée.
        </Alert>
      )}
      {bounded && weighed && <p className="text-small text-ink-2">Le {sideName} reste entre la moitié et le double de la proportion de la marmite : la part vise les calories, les protéines au plus près.</p>}

      {session && (
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" size={kitchen ? "kitchen" : "md"} icon="fridge" state={pending ? "loading" : "idle"} loadingLabel="Je range…" onClick={store} data-action="ranger-boites">
            {saved?.ok ? "Ranger à nouveau" : `Ranger ${plural(split.boxes.length, "boîte")}`}
          </Button>
          <span className="num text-[17px] text-ink-2">
            {[inFridge ? `${inFridge} au frigo` : null, inFreezer ? `${inFreezer} au congélo` : null].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
      {saved && (
        <p className={`text-[17px] ${saved.ok ? "text-ink-2" : "text-ko-ink"}`} role="status">
          {saved.message}
          {saved.ok && (
            <>
              {" "}
              <Link href="/frigo" className="font-bold text-accent underline-offset-4 hover:underline">
                Voir le frigo
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
