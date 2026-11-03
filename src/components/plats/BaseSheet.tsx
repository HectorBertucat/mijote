"use client";

// La fiche d’une base (src/lib/reserve/bases.ts) : ce qui reste dans ses gros récipients, la pesée et
// « C’est fini » de chacun ; « Refaire » en quelques gestes (le cru, l’eau, la casserole, la durée, les
// récipients à remplir), puis « C’est cuit » : un nouveau récipient, d’après le cru ou pesé cuit.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import { Alert, Button, Field, Icon, Input, Pill } from "@/components/ui";
import { gramsLabel } from "@/lib/boxes/core";
import { BASE_FOOD } from "@/lib/reserve/bases";
import type { BaseView } from "@/lib/reserve/bases-store";
import { closeBaseAction, remakeBaseAction, weighBaseAction } from "@/app/plats/actions";
import { limitWords, portions } from "./words";

const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
const num = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() === "" || !Number.isFinite(n) || n < 0 ? null : n;
};
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", timeZone: "UTC" });
const fmtL = (l: number) => `${(Math.round(l * 10) / 10).toLocaleString("fr-FR")} L`;

export function BaseSheet({ base, today, raw, some }: { base: BaseView; today: string; raw: string; some: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [rawG, setRawG] = useState(String(base.remake.rawG));
  const [cooked, setCooked] = useState("");
  const r = base.remake;
  const open = base.containers.filter((c) => c.leftG > 0 || base.containers.length === 1);
  const act = (fn: () => Promise<{ ok: boolean; message: string }>, done?: () => void) =>
    start(async () => {
      const x = await fn();
      setMsg(x);
      if (x.ok) {
        done?.();
        router.refresh();
      }
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 md:gap-18 lg:grid-cols-12 lg:gap-x-6" data-base-sheet={base.family}>
      <header className="grid gap-6 lg:col-span-12">
        <Link href="/plats" className="inline-flex min-h-tap w-fit items-center gap-1 rounded-[8px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="chev" size="s" className="rotate-180" />
          Nos plats
        </Link>
        <div className="flex items-center gap-4">
          <FoodIllu food={BASE_FOOD[base.family]} item={base.label} size="l" />
          <h1 className="min-w-0 text-h1">{cap(base.the)}</h1>
        </div>
        <p className="num max-w-[56ch] text-lead text-ink-2">
          {base.leftG > 0 ? `${gramsLabel(base.leftG)} dans ${open.length > 1 ? `${open.length} récipients` : "le récipient"}` : "Le récipient est vide"}
          {base.dishes.length ? `, avec ${base.dishes.map((d) => d.name).join(", ")}` : ""}. Chacun s’y sert à chaque repas : la portion de chacun est sur la fiche de son plat.
          {base.needG > 0 ? ` Encore prévu dans les portions : ${gramsLabel(base.needG)}.` : ""}
        </p>
        {msg && (
          <Alert tone={msg.ok ? "ok" : "ko"} role="status">
            {msg.message}
          </Alert>
        )}
      </header>

      {/* Refaire : une mini-session. */}
      <section aria-labelledby="refaire-titre" className="grid content-start gap-6 lg:col-span-7">
        <h2 id="refaire-titre" className="flex flex-wrap items-center gap-3 border-b border-line-strong pb-4 text-h2">
          Refaire {some}
          {base.low && <Pill tone="warn" icon="pot">{base.leftG > 0 ? "bientôt vide" : "vide"}</Pill>}
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {[
            [`${cap(raw)}`, gramsLabel(r.rawG)],
            ["Cuit", `≈ ${gramsLabel(r.cookedG)}`],
            ["Eau", `${fmtL(r.waterL)}${r.batches > 1 ? ` × ${r.batches}` : ""}`],
            ["En tout", `${r.minutes} min`],
          ].map(([k, v]) => (
            <div key={k} className="grid gap-1">
              <dt className="label text-ink-2">{k}</dt>
              <dd className="num-tight text-h3">{v}</dd>
            </div>
          ))}
        </dl>
        <ol className="grid border-b border-line">
          {r.steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-4 border-t border-line py-4">
              <StepIllu kind={i === 1 ? "boil" : i === 0 ? "prep" : "cool"} text={s} size="m" />
              <p className="text-[17px] leading-snug text-pretty">{s}</p>
            </li>
          ))}
        </ol>
        <p className="text-small text-ink-2">
          {r.pantryG == null ? `Rien à acheter si le placard en a ${gramsLabel(r.rawG)}.` : r.pantryG >= r.rawG ? `Le placard en a : ${gramsLabel(r.pantryG)}, rien à acheter.` : `Le placard n’en a plus que ${gramsLabel(r.pantryG)} : à ajouter aux courses.`}
          {r.boxes == null && " Note tes gros récipients dans Réglages › Cuisine : je dirai combien en remplir."}
        </p>
        <form
          className="grid gap-4 border-t border-line pt-6"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => remakeBaseAction(base.family, { rawG: num(rawG), grams: num(cooked) }), () => setCooked(""));
          }}
        >
          <div className="grid max-w-md grid-cols-2 gap-4">
            <Field label={`${cap(base.label)} ${raw}, g`}>
              {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" value={rawG} onChange={(e) => setRawG(e.target.value)} data-field="refaire-cru" />}
            </Field>
            <Field label="Ou pesé cuit, g">
              {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" placeholder={`≈ ${r.cookedG}`} value={cooked} onChange={(e) => setCooked(e.target.value)} data-field="refaire-cuit" />}
            </Field>
          </div>
          <Button type="submit" variant={base.low ? "primary" : "secondary"} size="kitchen" icon="check" className="w-fit" state={busy ? "loading" : "idle"} loadingLabel="Je range…" data-action="refaire">
            C’est cuit et rangé
          </Button>
        </form>
      </section>

      {/* Les récipients. */}
      <aside className="grid content-start gap-12 lg:col-span-5 lg:border-l lg:border-line lg:pl-8">
        <section aria-labelledby="recipients-titre" className="grid gap-4">
          <h2 id="recipients-titre" className="border-b border-line-strong pb-4 text-h2">
            {open.length > 1 ? "Les récipients" : "Le récipient"}
          </h2>
          {!open.length && <p className="text-ink-2">Aucun récipient en cours.</p>}
          <ul className="grid">
            {open.map((c, i) => {
              const lim = limitWords(c.limit, c.freshness, today);
              return (
                <li key={c.id} className="grid gap-3 border-b border-line py-4" data-container={c.id}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0">
                      <b>{i === 0 && open.length > 1 ? "Celui qui sert d’abord" : `Cuit ${day(c.cookedOn)}`}</b>
                      <span className="num block text-small text-ink-2">
                        {i === 0 && open.length > 1 ? `cuit ${day(c.cookedOn)} · ` : ""}
                        {c.estimated ? "≈ " : ""}
                        {gramsLabel(c.leftG)} sur {gramsLabel(c.cookedG)}
                        {c.boxes ? ` · ${c.boxes > 1 ? `${c.boxes} gros récipients` : "un gros récipient"}` : ""}
                      </span>
                    </span>
                    <span className={`shrink-0 text-right text-small ${lim.tone || "text-ink-2"}`}>
                      {lim.label} {lim.big}
                    </span>
                  </div>
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const g = num(weights[c.id] ?? "");
                      if (g != null) act(() => weighBaseAction(c.id, g), () => setWeights((x) => ({ ...x, [c.id]: "" })));
                    }}
                  >
                    <div className="w-36">
                      <Field label="Pesé, sans le récipient">
                        {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" placeholder={`${c.leftG} g`} value={weights[c.id] ?? ""} onChange={(e) => setWeights((x) => ({ ...x, [c.id]: e.target.value }))} data-field="base-pesee" />}
                      </Field>
                    </div>
                    <Button type="submit" variant="secondary" icon="scale" disabled={busy || num(weights[c.id] ?? "") == null} data-action="peser-base">
                      Peser
                    </Button>
                    {confirm === c.id ? (
                      <Button variant="danger" size="sm" disabled={busy} onClick={() => act(() => closeBaseAction(c.id), () => setConfirm(null))} data-action="base-fini-oui">
                        Oui, fini
                      </Button>
                    ) : (
                      <Button variant="quiet" size="sm" onClick={() => setConfirm(c.id)} data-action="base-fini">
                        C’est fini
                      </Button>
                    )}
                  </form>
                </li>
              );
            })}
          </ul>
          <p className="text-small text-ink-2">Les portions puisent d’abord dans le plus ancien récipient. {base.freeze.ok ? `Au congélo : ${base.freeze.how}.` : `Ne se congèle pas : ${base.freeze.how}.`}</p>
          {base.freeze.portions > 0 && (
            <p className="num text-[17px]">
              À congeler : <b>{portions(base.freeze.portions)}</b> de {gramsLabel(base.portionG)}, plus que ce qui sera servi avant la limite.
            </p>
          )}
        </section>
      </aside>
    </div>
  );
}
