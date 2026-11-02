"use client";

// La fiche d’une portion, à lire en cuisine : pour la personne affichée, les grammes de chaque groupe à
// se servir (le plat, le riz, les haricots verts), en très grand ; la part de l’autre d’un geste ; kcal et
// protéines en petit. « J’ai mangé cette portion » (annulable), ou ce qu’elle a vraiment pris. Puis le
// grand récipient (ce qui reste, réajuster : nouvelle pesée, portions de chacun), les boîtes, « C’est fini ».
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Button, Field, Icon, Input, Segmented, Stepper } from "@/components/ui";
import { gramsLabel } from "@/lib/boxes/core";
import type { DishView } from "@/lib/reserve/store";
import { adjustAction, closeAction } from "@/app/plats/actions";
import { moveBoxAction, throwBoxAction } from "@/app/frigo/actions";
import { limitWords } from "./words";
import { useEat } from "./useEat";

const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
const num = (v: string) => {
  const n = Number(v.replace(",", ".").trim());
  return v.trim() === "" || !Number.isFinite(n) || n < 0 ? null : n;
};

export function PortionSheet({ dish, who, me, today, art }: { dish: DishView; who: string; me: string; today: string; art?: ReactNode }) {
  const router = useRouter();
  const [shown, setShown] = useState(who);
  const [other, setOther] = useState(false);
  const [took, setTook] = useState<Record<string, string>>({});
  const [adjust, setAdjust] = useState(false);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [left, setLeft] = useState<Record<string, number>>(() => Object.fromEntries(dish.people.map((p) => [p.personId, p.left])));
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const { eat, busy: eating, pending, node, say } = useEat();
  const share = dish.people.find((p) => p.personId === shown) ?? dish.people[0];
  const self = share?.personId === me;
  const name = self ? "toi" : (share?.name ?? "");
  const next = share?.next;
  const box = next?.source === "boite" ? dish.boxes.find((b) => b.id === next.boxId) : null;
  const potLeft = dish.groups.filter((g) => (g.leftG ?? 0) > 0);
  const lim = dish.limit && dish.freshness ? limitWords(dish.limit, dish.freshness, today) : null;
  const several = dish.groups.length > 1;

  const act = (fn: () => Promise<{ ok: boolean; message: string }>, done?: () => void) =>
    start(async () => {
      const r = await fn();
      say(r.message, r.ok);
      if (r.ok) done?.();
    });
  const tookGrams = () => Object.fromEntries(dish.groups.map((g) => [g.key, num(took[g.key] ?? "") ?? 0]));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 md:gap-18 lg:grid-cols-12 lg:gap-x-6">
      <header className="grid gap-6 lg:col-span-12">
        <Link href={who === me ? "/plats" : `/plats?pour=${who}`} className="inline-flex min-h-tap w-fit items-center gap-1 rounded-[8px] font-semibold text-ink-2 hover:text-ink">
          <Icon name="chev" size="s" className="rotate-180" />
          Nos plats
        </Link>
        <div className="flex items-center gap-4">
          {art}
          <h1 className="min-w-0 text-h2 sm:text-h1">{dish.name}</h1>
        </div>
        {dish.people.length > 1 && (
          <Segmented label="La part de" value={shown} onChange={(v) => { setShown(v); setOther(false); }} options={dish.people.map((p) => ({ value: p.personId, label: p.personId === me ? `${p.name} (toi)` : p.name }))} />
        )}
      </header>

      {/* La portion : les grammes à se servir, en grand. */}
      <section aria-labelledby="portion-titre" className="grid content-start gap-6 lg:col-span-7">
        <h2 id="portion-titre" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-h2">
          {share ? `La portion de ${share.name}` : "La portion"}
          {share && (
            <span className="num text-lead font-normal text-ink-2">
              {share.left} sur {share.total} restante{share.left > 1 ? "s" : ""}
            </span>
          )}
        </h2>
        {next ? (
          <>
            {box && (
              <p className="text-[17px] text-ink-2">
                {box.place === "freezer" ? "Dans sa boîte au congélo : à sortir la veille, ou à réchauffer longtemps." : "Dans sa boîte au frigo."}
              </p>
            )}
            <dl className="border-t border-line-strong" data-portion={share.personId}>
              {next.grams.map((g) => (
                <div key={g.key} className="flex items-baseline justify-between gap-4 border-b border-line py-4">
                  <dt className="text-h3">{several ? cap(g.label) : "La portion"}</dt>
                  <dd className="num-tight text-num-xl" data-grams={g.key}>
                    {g.g.toLocaleString("fr-FR")}
                    <span className="ml-1 text-[0.4em] font-semibold text-ink-2">g</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="num text-small text-ink-2">
              {next.kcal != null ? <>≈&nbsp;{next.kcal}&nbsp;kcal · {next.protein}&nbsp;g de protéines</> : "Calories inconnues"}
              {share.inBoxes > 0 && ` · dont ${share.inBoxes} en boîte${share.inBoxes > 1 ? "s" : ""}`}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="kitchen" icon="check" state={eating === "portion" ? "loading" : "idle"} loadingLabel="Je note…" disabled={pending} onClick={() => eat("portion", dish.id, share.personId, box ? { boxId: box.id } : {})} data-action="manger-portion">
                {self ? "J’ai mangé cette portion" : `${share.name} l’a mangée`}
              </Button>
              {!box && potLeft.length > 0 && (
                <Button variant="quiet" onClick={() => { setOther((x) => !x); setTook(Object.fromEntries(next.grams.map((g) => [g.key, String(g.g)]))); }} aria-expanded={other} data-action="autre-quantite">
                  {self ? "J’ai pris autre chose" : "Autre quantité"}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="border-y border-line py-4 text-[17px] text-ink-2">
            {share && share.left > 0 ? "Le récipient est vide : à se servir à l’œil, ou pèse ce qui reste." : `Plus de portion pour ${name}.`}
            {potLeft.length > 0 && share && share.left === 0 && " Il en reste dans le récipient : une portion de plus se prend sur celles des autres."}
          </p>
        )}
        {!next && potLeft.length > 0 && share && (
          <Button variant="secondary" className="w-fit" state={eating === "portion" ? "loading" : "idle"} disabled={pending} onClick={() => eat("portion", dish.id, share.personId)} data-action="manger-portion">
            {self ? "J’en prends une" : `${share.name} en prend une`}
          </Button>
        )}
        {other && share && (
          <form
            className="grid gap-4 border-t border-line pt-6"
            onSubmit={(e) => {
              e.preventDefault();
              eat("autre", dish.id, share.personId, { grams: tookGrams() }, () => setOther(false));
            }}
          >
            <div className={`grid gap-4 ${several ? "grid-cols-2 sm:grid-cols-3" : "max-w-[200px]"}`}>
              {dish.groups.map((g) => (
                <Field key={g.key} label={several ? `${cap(g.label)}, g` : "Grammes"}>
                  {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" value={took[g.key] ?? ""} placeholder="0" onChange={(e) => setTook((x) => ({ ...x, [g.key]: e.target.value }))} />}
                </Field>
              ))}
            </div>
            <p className="text-small text-ink-2">Ce qui a été pris sort du récipient ; les autres portions se recalculent.</p>
            <Button type="submit" variant="secondary" className="w-fit" state={eating === "autre" ? "loading" : "idle"} disabled={pending} data-action="noter-autre">
              Noter ce qui a été pris
            </Button>
          </form>
        )}
        {/* La part des autres, d’un coup d’œil. */}
        {dish.people.filter((p) => p.personId !== shown).map((p) => (
          <button key={p.personId} type="button" onClick={() => setShown(p.personId)} className="-mx-3 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 rounded-[8px] px-3 py-3 text-left hover:bg-surface-2">
            <span className="min-w-0">
              <b className="text-[17px]">{p.name}</b>
              <span className="num block text-small text-ink-2">{p.next ? p.next.grams.map((g) => `${several ? `${g.label} ` : ""}${gramsLabel(g.g)}`).join(" · ") : "plus de portion"}</span>
            </span>
            <span className="num text-ink-2">
              {p.left} sur {p.total}
            </span>
          </button>
        ))}
      </section>

      {/* Le grand récipient, les boîtes, réajuster. */}
      <aside className="grid content-start gap-12 lg:col-span-5 lg:border-l lg:border-line lg:pl-8">
        <section aria-labelledby="recipient-titre" className="grid gap-4">
          <h2 id="recipient-titre" className="border-b border-line-strong pb-4 text-h2">
            Le grand récipient
          </h2>
          {potLeft.length ? (
            <dl className="grid gap-2">
              {potLeft.map((g) => (
                <div key={g.key} className="flex items-baseline justify-between gap-4">
                  <dt className="text-[17px]">
                    {cap(g.label)}
                    {g.estimated && <span className="text-small text-ink-2"> (estimé)</span>}
                  </dt>
                  <dd className="num font-semibold">{gramsLabel(g.leftG ?? 0)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-ink-2">Vide{dish.boxes.length ? " : ce qui reste est en boîtes." : "."}</p>
          )}
          {lim && <p className={`text-small ${lim.tone || "text-ink-2"}`}>{lim.label} {lim.big}</p>}
          {dish.estimated && (
            <p className="text-small text-ink-2">
              Pas encore pesé : les grammes sont estimés d’après le cru.{" "}
              {dish.sessionId ? (
                <Link href={`/plats/batch/${dish.sessionId}`} className="font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink" data-link="bilan">
                  Peser depuis le bilan du batch
                </Link>
              ) : (
                "Réajuster, pour peser ce qui reste."
              )}
            </p>
          )}
          {dish.short && <p className="text-small text-warn-ink">Moins que prévu : chaque portion est plus petite que la part visée.</p>}
          {dish.rest && <p className="num text-small text-ink-2">Et un reste, pour qui veut : {dish.rest.grams.map((g) => `${gramsLabel(g.g)}${several ? ` de ${g.label}` : ""}`).join(", ")}.</p>}
          <Button variant="secondary" className="w-fit" icon="scale" onClick={() => setAdjust((x) => !x)} aria-expanded={adjust} data-action="reajuster">
            Réajuster
          </Button>
          {adjust && (
            <form
              className="grid gap-6 border-t border-line pt-6"
              onSubmit={(e) => {
                e.preventDefault();
                const w = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, num(v)]).filter(([, v]) => v != null));
                const changed = Object.fromEntries(Object.entries(left).filter(([id, n]) => dish.people.find((p) => p.personId === id)?.left !== n));
                act(() => adjustAction(dish.id, { weights: w, left: changed }), () => { setAdjust(false); setWeights({}); router.refresh(); });
              }}
            >
              <div className="grid gap-3">
                <p className="text-small text-ink-2">Pèse ce qui reste dans le récipient (sans les boîtes) : les portions se recalculent. Laisse vide ce qui n’a pas changé.</p>
                <div className="grid grid-cols-2 gap-4">
                  {dish.groups.map((g) => (
                    <Field key={g.key} label={cap(g.label)}>
                      {(id, d) => <Input id={id} aria-describedby={d} num inputMode="decimal" placeholder={`${g.leftG ?? 0} g`} value={weights[g.key] ?? ""} onChange={(e) => setWeights((x) => ({ ...x, [g.key]: e.target.value }))} data-field={`pesee-${g.key}`} />}
                    </Field>
                  ))}
                </div>
              </div>
              <ul className="grid border-b border-line">
                {dish.people.map((p) => (
                  <li key={p.personId} className="flex items-center justify-between gap-3 border-t border-line py-3">
                    <span>
                      <b>{p.name}</b>
                      <span className="block text-small text-ink-2">portions restantes</span>
                    </span>
                    <Stepper value={left[p.personId] ?? 0} min={0} max={30} onChange={(v) => setLeft((x) => ({ ...x, [p.personId]: v }))} decLabel={`Une portion de moins pour ${p.name}`} incLabel={`Une portion de plus pour ${p.name}`} />
                  </li>
                ))}
              </ul>
              <Button type="submit" variant="primary" className="w-fit" state={busy ? "loading" : "idle"} loadingLabel="Je recalcule…" data-action="reajuster-ok">
                Recalculer les portions
              </Button>
            </form>
          )}
        </section>

        {dish.boxes.length > 0 && (
          <section aria-labelledby="boites-titre" className="grid gap-4">
            <h2 id="boites-titre" className="flex items-baseline gap-3 border-b border-line-strong pb-4 text-h2">
              En boîtes <span className="num-tight text-[0.8em] text-ink-3">{dish.boxes.length}</span>
            </h2>
            <ul className="grid">
              {dish.boxes.map((b) => {
                const owner = dish.people.find((p) => p.personId === b.personId);
                const bl = limitWords(b.limit, b.freshness, today);
                const eater = owner ?? share;
                return (
                  <li key={b.id} className="grid gap-2 border-b border-line py-3" data-box={b.id}>
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="min-w-0">
                        <b>{owner ? `Pour ${owner.name}` : "Pour qui veut"}</b>
                        <span className="num block text-small text-ink-2">
                          {b.place === "freezer" ? "congélo" : b.thawed ? "frigo, décongelée" : "frigo"} · {b.grams.map((g) => `${several ? `${g.label} ` : ""}${gramsLabel(g.g)}`).join(" · ")}
                        </span>
                      </span>
                      <span className={`shrink-0 text-right text-small ${bl.tone || "text-ink-2"}`}>
                        {bl.label} {bl.big}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {eater && (
                        <Button size="sm" variant="secondary" icon="check" disabled={pending} onClick={() => eat(b.id, dish.id, eater.personId, { boxId: b.id })} data-action="manger-boite">
                          {eater.personId === me ? "Je la mange" : `${eater.name} la mange`}
                        </Button>
                      )}
                      <Button size="sm" variant="quiet" icon={b.place === "freezer" ? "fridge" : "snow"} disabled={busy} onClick={() => act(() => moveBoxAction(b.id, b.place === "freezer" ? "fridge" : "freezer"), () => router.refresh())}>
                        {b.place === "freezer" ? "Sortir au frigo" : "Au congélo"}
                      </Button>
                      {confirm === b.id ? (
                        <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => act(() => throwBoxAction(b.id), () => router.refresh())}>
                          Oui, jetée
                        </Button>
                      ) : (
                        <Button size="sm" variant="quiet" iconOnly icon="trash" onClick={() => setConfirm(b.id)} aria-label="Jetée" title="Jetée" />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="grid gap-3 border-t border-line pt-6">
          {confirm === "fin" ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-ink-2">Ce qui reste sort de la liste.</span>
              <Button variant="danger" size="sm" disabled={busy} onClick={() => act(() => closeAction(dish.id), () => router.push("/plats"))} data-action="fini-oui">
                Oui, c’est fini
              </Button>
            </div>
          ) : (
            <Button variant="quiet" className="w-fit" onClick={() => setConfirm("fin")} data-action="fini">
              C’est fini, tout est mangé ou jeté
            </Button>
          )}
        </section>
      </aside>
      {node}
    </div>
  );
}
