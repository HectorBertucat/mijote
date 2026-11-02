"use client";

// Le calculateur de la marmite (src/lib/reserve/core.ts, calcul pur partagé avec le serveur) : on pèse
// chaque groupe cuit (le plat, le riz, les haricots verts), il dit combien de portions pour chacun et
// les grammes de chaque groupe d’une portion. En fin de session, « Ranger » met la marmite en réserve
// (et les boîtes du congélo) ; rouvert, il réajuste. Sur la fiche, c’est seulement une calculette.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, Button, Field, Input, Stepper } from "@/components/ui";
import { BoxGlyph } from "@/components/boxes/BoxGlyph";
import { gramsLabel } from "@/lib/boxes/core";
import { defaultCounts, defaultFreezer, splitGroups, weighedGroups, type CalcModel } from "@/lib/reserve/core";
import type { SavedReserve } from "@/lib/reserve/store";
import { saveReserveAction } from "@/app/plats/actions";

const num = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
/** « Riz cuit », « Haricots verts cuits », « Plat cuit », « Sauce au skyr ». */
const cookedLabel = (label: string, kind: string) => (kind === "other" && label.startsWith("sauce") ? cap(label) : `${cap(label)} ${/s$|x$/.test(label.split(" ")[0]) ? "cuits" : /^(semoule|polenta|purée)/.test(label) ? "cuite" : "cuit"}`);

export function ReserveCalc({ model, color, session, saved, head = true, kitchen = false, art, shared }: { model: CalcModel; color: string; session?: string; saved?: SavedReserve | null; head?: boolean; /** Fin de session : bouton de cuisine (64 px). */ kitchen?: boolean; art?: ReactNode; /** Un féculent cuit pour plusieurs recettes : la part de celle-ci (grammes), tant qu’il n’est pas pesé à part. */ shared?: { key: string; grams: number | null; note: string } | null }) {
  // Rouverte après un repas : on pèse ce qui reste ; sinon la marmite entière.
  const reopened = !!saved && saved.eaten > 0;
  const [w, setW] = useState<Record<string, string>>(() => Object.fromEntries(model.groups.map((g) => [g.key, saved && !reopened ? String(Math.round(saved.groups.find((x) => x.key === g.key && !x.estimated)?.g ?? 0) || "") : ""])));
  const [counts, setCounts] = useState<Record<string, number>>(() => saved?.counts ?? defaultCounts(model));
  const [freezer, setFreezer] = useState<Record<string, number>>(() => saved?.freezer ?? defaultFreezer(model, saved?.counts ?? defaultCounts(model)));
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(saved ? { ok: true, message: reopened ? "En réserve ; des portions sont déjà mangées : pèse ce qui reste pour réajuster." : "En réserve." } : null);
  const [pending, setPending] = useState(false);

  const value = (key: string) => (w[key] ?? "").trim() === "" && shared?.key === key && shared.grams != null ? String(shared.grams) : (w[key] ?? "");
  const weights = Object.fromEntries(model.groups.map((g) => [g.key, num(value(g.key))]));
  const groups = weighedGroups(model, weights, "");
  const anyWeighed = model.groups.some((g) => weights[g.key] != null);
  const split = splitGroups(groups, Object.fromEntries(groups.map((g) => [g.key, g.g])), model.people, counts);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const frozen = model.freezerOk ? model.people.reduce((s, p) => s + Math.min(counts[p.id] ?? 0, freezer[p.id] ?? 0), 0) : 0;
  const estimated = groups.filter((g) => g.estimated);
  const several = model.groups.length > 1;

  const setCount = (id: string, n: number) => {
    setCounts((c) => ({ ...c, [id]: n }));
    setFreezer((f) => ({ ...f, [id]: Math.min(f[id] ?? 0, n) }));
  };
  const store = async () => {
    setPending(true);
    const r = await saveReserveAction(session!, model.recipeId, { weights, counts, freezer: model.freezerOk ? freezer : {} });
    setResult(r);
    setPending(false);
  };

  return (
    <div className="grid gap-6" data-calc={model.slug}>
      {head && (
        <div className="flex items-center gap-4">
          {art ?? <BoxGlyph color={color} size={48} />}
          <h3 className="min-w-0 flex-1 text-h3">{model.name}</h3>
        </div>
      )}

      {/* Les pesées : un champ par groupe servi à part. */}
      <div className="grid gap-3">
        <div className={`grid gap-4 ${several ? "grid-cols-2 sm:grid-cols-3 sm:max-w-xl" : "max-w-[280px]"}`}>
          {model.groups.map((g) => (
            <Field key={g.key} label={several ? cookedLabel(g.label, g.kind) : "Marmite cuite"}>
              {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" placeholder={`≈ ${Math.round(g.estG)} g`} value={value(g.key)} onChange={(e) => setW((x) => ({ ...x, [g.key]: e.target.value }))} data-field={g.key} />}
            </Field>
          ))}
        </div>
        {shared && <p className="text-small text-ink-2">{shared.note}{(w[shared.key] ?? "").trim() !== "" ? " · pesé à part ici" : ""}</p>}
        <p className="text-small text-ink-2">{reopened ? "Pèse ce qui reste dans le grand récipient, sans les boîtes." : "Pèse chaque récipient plein, retire le poids du récipient vide."}</p>
      </div>

      {/* Les portions de chacun : combien, et les grammes de chaque groupe d’une portion. */}
      <ul className="grid border-b border-line" aria-live="polite">
        {model.people.map((p) => {
          const portion = split.portions[p.id];
          const n = counts[p.id] ?? 0;
          return (
            <li key={p.id} className="grid gap-3 border-t border-line py-4" data-person={p.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <b className="text-[17px]">{p.name}</b>
                <Stepper value={n} min={0} max={30} onChange={(v) => setCount(p.id, v)} unit=" port." decLabel={`Une portion de moins pour ${p.name}`} incLabel={`Une portion de plus pour ${p.name}`} />
              </div>
              {portion && n > 0 && (
                <>
                  <dl className="flex flex-wrap gap-x-6 gap-y-2">
                    {model.groups
                      .filter((g) => (portion.grams[g.key] ?? 0) > 0)
                      .map((g) => (
                        <div key={g.key} className="grid">
                          <dt className="label text-ink-2">{several ? g.label : "la portion"}</dt>
                          <dd className="num-tight text-[28px] leading-none">{gramsLabel(portion.grams[g.key])}</dd>
                        </div>
                      ))}
                  </dl>
                  <p className="num text-small text-ink-2">
                    {portion.kcal != null ? <>≈&nbsp;{portion.kcal}&nbsp;kcal · {portion.protein}&nbsp;g de protéines la portion</> : "Calories inconnues : la proportion de la marmite."}
                    {p.planned > 0 && ` · ${plural(p.planned, "repas prévu")} dans la semaine`}
                  </p>
                </>
              )}
              {session && model.freezerOk && n > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-small text-ink-2">
                  <span>Dont en boîtes au congélo</span>
                  <Stepper size="sm" value={Math.min(freezer[p.id] ?? 0, n)} min={0} max={n} onChange={(v) => setFreezer((f) => ({ ...f, [p.id]: v }))} decLabel={`Une boîte de moins pour ${p.name}`} incLabel={`Une boîte de plus pour ${p.name}`} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!anyWeighed && <p className="text-small text-ink-2">Pèse {several ? "chaque groupe" : "la marmite"} pour des grammes justes ; d’ici là, une estimation d’après le cru.</p>}
      {anyWeighed && estimated.length > 0 && <p className="text-small text-ink-2">Pas pesé{estimated.length > 1 ? "s" : ""} : {estimated.map((g) => g.label).join(", ")}, estimé d’après le cru.</p>}
      {split.fill < 0.97 && (
        <Alert tone="warn" title="Moins que prévu">
          La marmite ne couvre pas {plural(total, "portion")} à la part visée : chacune est plus petite.
        </Alert>
      )}
      {split.rest && (
        <p className="num text-small text-ink-2">
          Et un reste, pour qui veut : {model.groups.filter((g) => (split.rest!.grams[g.key] ?? 0) > 0).map((g) => `${gramsLabel(split.rest!.grams[g.key])}${several ? ` de ${g.label}` : ""}`).join(", ")}
          {split.rest.kcal != null && <> (≈&nbsp;{split.rest.kcal}&nbsp;kcal)</>}. Chacun est au haut de son repère.
        </p>
      )}

      {session && (
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary" size={kitchen ? "kitchen" : "md"} icon="fridge" state={pending ? "loading" : "idle"} loadingLabel="Je range…" onClick={store} disabled={total === 0} data-action="ranger-reserve">
            {result?.ok ? "Ranger à nouveau" : `Ranger ${plural(total, "portion")}`}
          </Button>
          {frozen > 0 && <span className="num text-[17px] text-ink-2">dont {frozen} en boîte{frozen > 1 ? "s" : ""} au congélo</span>}
        </div>
      )}
      {result && (
        <p className={`text-[17px] ${result.ok ? "text-ink-2" : "text-ko-ink"}`} role="status">
          {result.message}
          {result.ok && (
            <>
              {" "}
              <Link href="/plats" className="font-bold text-accent underline-offset-4 hover:underline">
                Voir nos plats
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
