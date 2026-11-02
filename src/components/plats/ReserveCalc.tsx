"use client";

// Le calculateur de la marmite (src/lib/reserve/core.ts, calcul pur partagé avec le serveur) : on pèse
// chaque groupe cuit (le plat, le riz, les haricots verts), il dit combien de portions pour chacun et
// les grammes de chaque groupe d’une portion. En fin de session, « Ranger » met la marmite en réserve
// (et les boîtes du congélo). Sans pesée, la marmite est déjà en réserve, estimée d’après le cru : le
// bilan du batch la rouvre pour la pesée tardive (après un repas : la pesée de ce qui reste). Sur la
// fiche, c’est seulement une calculette.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Pill, Stepper } from "@/components/ui";
import { BoxGlyph } from "@/components/boxes/BoxGlyph";
import { gramsLabel } from "@/lib/boxes/core";
import { defaultCounts, defaultFreezer, splitGroups, weighedGroups, type CalcModel } from "@/lib/reserve/core";
import type { SavedReserve } from "@/lib/reserve/store";
import { adjustAction, saveReserveAction } from "@/app/plats/actions";

const num = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
/** « Riz cuit », « Haricots verts cuits », « Plat cuit », « Sauce au skyr ». */
const cookedLabel = (label: string, kind: string) => (kind === "other" && label.startsWith("sauce") ? cap(label) : `${cap(label)} ${/s$|x$/.test(label.split(" ")[0]) ? "cuits" : /^(semoule|polenta|purée)/.test(label) ? "cuite" : "cuit"}`);

export function ReserveCalc({ model, color, session, saved, head = true, kitchen = false, art, shared }: { model: CalcModel; color: string; session?: string; saved?: SavedReserve | null; head?: boolean; /** Fin de session : bouton de cuisine (64 px). */ kitchen?: boolean; art?: ReactNode; /** Un féculent cuit pour plusieurs recettes : la part de celle-ci (grammes), tant qu’il n’est pas pesé à part. */ shared?: { key: string; grams: number | null; note: string } | null }) {
  const router = useRouter();
  // Rouverte après un repas, ou des boîtes d’avant : on pèse ce qui reste, sans refaire la marmite entière.
  const reopened = !!saved && (saved.eaten > 0 || saved.legacy || !saved.open);
  const estimatedSaved = !!saved && saved.weigh !== "weighed";
  const [w, setW] = useState<Record<string, string>>(() => Object.fromEntries(model.groups.map((g) => [g.key, saved ? String(Math.round(saved.groups.find((x) => x.key === g.key && !x.estimated)?.g ?? 0) || "") : ""])));
  const [counts, setCounts] = useState<Record<string, number>>(() => saved?.counts ?? defaultCounts(model));
  const [freezer, setFreezer] = useState<Record<string, number>>(() => saved?.freezer ?? defaultFreezer(model, saved?.counts ?? defaultCounts(model)));
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(saved && !estimatedSaved ? { ok: true, message: "En réserve, pesé." } : null);
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
    if (r.ok) router.refresh();
  };

  const state = saved ? (saved.weigh === "weighed" ? <Pill tone="ok">pesé</Pill> : <Pill tone="warn" icon="scale">{saved.weigh === "partial" ? "en partie pesé" : "estimé"}</Pill>) : null;
  const title = head && (
    <div className="flex items-center gap-4">
      {art ?? <BoxGlyph color={color} size={48} />}
      <h3 className="min-w-0 flex-1 text-h3">{model.name}</h3>
      {state}
    </div>
  );
  // Des portions sont déjà mangées : on ne repèse plus la marmite entière, on pèse ce qui reste.
  if (reopened) return <Reopened model={model} saved={saved!} title={title} kitchen={kitchen} />;

  return (
    <div className="grid gap-6" data-calc={model.slug}>
      {title}

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
        <p className="text-small text-ink-2">Pèse chaque récipient plein, retire le poids du récipient vide.</p>
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

      {!anyWeighed && (
        <p className="text-small text-ink-2">
          {estimatedSaved
            ? `Déjà en réserve, estimé d’après le cru : chacun peut manger ses portions. Pèse ${several ? "chaque groupe" : "la marmite"} quand tu peux, les grammes se corrigent.`
            : `Pèse ${several ? "chaque groupe" : "la marmite"} pour des grammes justes ; d’ici là, une estimation d’après le cru.`}
        </p>
      )}
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
          <Button variant="primary" size={kitchen ? "kitchen" : "md"} icon={estimatedSaved ? "scale" : "fridge"} state={pending ? "loading" : "idle"} loadingLabel="Je range…" onClick={store} disabled={total === 0} data-action="ranger-reserve">
            {estimatedSaved && !result ? (anyWeighed ? "Enregistrer la pesée" : "Enregistrer les portions") : result?.ok ? "Ranger à nouveau" : `Ranger ${plural(total, "portion")}`}
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

/**
 * Une réserve déjà entamée (ou faite de boîtes d’avant) : ce qui reste à chacun, et la pesée de ce qui reste
 * dans le grand récipient (les kcal restantes ne changent pas, seulement les grammes). Les portions de
 * chacun se réajustent sur la fiche du plat.
 */
function Reopened({ model, saved, title, kitchen }: { model: CalcModel; saved: SavedReserve; title: ReactNode; kitchen: boolean }) {
  const router = useRouter();
  const [w, setW] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const groups = saved.groups.filter((g) => (saved.leftG[g.key] ?? 0) > 0);
  const weights = Object.fromEntries(groups.map((g) => [g.key, num(w[g.key] ?? "")]).filter(([, v]) => v != null));
  const several = saved.groups.length > 1;
  const weigh = async () => {
    setPending(true);
    const r = await adjustAction(saved.id, { weights });
    setResult(r.ok ? { ok: true, message: "Pesée enregistrée : les portions se recalculent sur ce qui reste." } : r);
    setPending(false);
    if (r.ok) {
      setW({});
      router.refresh();
    }
  };
  return (
    <div className="grid gap-4" data-calc={model.slug}>
      {title}
      <p className="num text-[17px] text-ink-2">
        {!saved.open
          ? "Tout est mangé."
          : saved.people
              .filter((p) => p.total > 0)
              .map((p) => `${p.name} : ${p.left} sur ${p.total}`)
              .join(" · ")}
        {saved.eaten > 0 && saved.open ? ` · ${plural(saved.eaten, "portion mangée", "portions mangées")}` : ""}
      </p>
      {saved.open && groups.length > 0 && !saved.legacy && (
        <div className="grid gap-3">
          <div className={`grid gap-4 ${several ? "grid-cols-2 sm:grid-cols-3 sm:max-w-xl" : "max-w-[280px]"}`}>
            {groups.map((g) => (
              <Field key={g.key} label={several ? `${cookedLabel(g.label, g.kind)}, ce qui reste` : "Ce qui reste"}>
                {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" placeholder={`${g.estimated ? "≈ " : ""}${saved.leftG[g.key]} g`} value={w[g.key] ?? ""} onChange={(e) => setW((x) => ({ ...x, [g.key]: e.target.value }))} data-field={`reste-${g.key}`} />}
              </Field>
            ))}
          </div>
          <p className="text-small text-ink-2">{saved.weigh === "weighed" ? "Une nouvelle pesée corrige les grammes des portions restantes." : "Pas encore pesé : pèse ce qui reste dans le grand récipient, les portions restantes se recalculent."}</p>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant={saved.weigh === "weighed" ? "secondary" : "primary"} size={kitchen ? "kitchen" : "md"} icon="scale" state={pending ? "loading" : "idle"} loadingLabel="J’enregistre…" onClick={weigh} disabled={!Object.keys(weights).length} data-action="peser-reste">
              Enregistrer la pesée
            </Button>
            <Link href={`/plats/${saved.id}`} className="font-bold text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              Réajuster les portions
            </Link>
          </div>
        </div>
      )}
      {saved.open && (saved.legacy || !groups.length) && (
        <Link href={`/plats/${saved.id}`} className="w-fit font-bold text-accent underline-offset-4 hover:underline">
          Voir le plat
        </Link>
      )}
      {result && (
        <p className={`text-[17px] ${result.ok ? "text-ink-2" : "text-ko-ink"}`} role="status">
          {result.message}
        </p>
      )}
    </div>
  );
}
