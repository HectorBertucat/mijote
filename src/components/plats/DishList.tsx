"use client";

// Les plats de la réserve pour une personne : une ligne par plat, le nombre de portions qui lui restent
// en grand (« 2 sur 4 »), les grammes de sa prochaine portion, « J’ai mangé une portion » d’un geste
// (annulable) ; la ligne ouvre la fiche de la portion. Puis les plats à cuisiner (portions prévues) et
// ce qu’elle a mangé ces trois derniers jours, chacun annulable.
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { BoxGlyph } from "@/components/boxes/BoxGlyph";
import type { DishView, ServingView } from "@/lib/reserve/store";
import { gramsLine, limitWords, portions } from "./words";
import { useEat } from "./useEat";

const MEAL = { breakfast: "matin", lunch: "midi", dinner: "soir", snack: "à côté" } as const;
const dayWord = (date: string, today: string) => {
  if (date === today) return "aujourd’hui";
  const d = new Date(`${date}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  if ((t.getTime() - d.getTime()) / 86_400_000 === 1) return "hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
};

export function DishList({ dishes, eaten, who, me, today, arts, colors }: { dishes: DishView[]; eaten: ServingView[]; who: { id: string; name: string }; me: string; today: string; arts: Record<string, ReactNode>; colors: Record<string, string> }) {
  const { eat, undo, busy, pending, node } = useEat();
  const self = who.id === me;
  const cooked = dishes.filter((d) => d.status === "cooked");
  const planned = dishes.filter((d) => d.status === "planned");
  const firstEat = cooked.findIndex((d) => (d.people.find((p) => p.personId === who.id)?.left ?? 0) > 0);
  const art = (d: DishView) => (d.slug && arts[d.slug]) || <BoxGlyph color={(d.slug && colors[d.slug]) || "var(--c-ink-3)"} size={56} />;

  return (
    <>
      {cooked.length > 0 && (
        <section aria-labelledby="reserve-titre" className="grid gap-6">
          <h2 id="reserve-titre" className="sr-only">
            En réserve
          </h2>
          <ul className="grid border-b border-line">
            {cooked.map((d, i) => {
              const mine = d.people.find((p) => p.personId === who.id);
              const others = d.people.filter((p) => p.personId !== who.id && p.total > 0);
              const left = mine?.left ?? 0;
              const fridgeBox = d.boxes.find((b) => b.place === "fridge");
              const lim = d.limit && d.freshness ? limitWords(d.limit, d.freshness, today) : fridgeBox ? limitWords(fridgeBox.limit, fridgeBox.freshness, today) : null;
              const potLeft = d.groups.some((g) => !g.base && (g.leftG ?? 0) > 0);
              const next = mine?.next;
              const href = `/plats/${d.id}${self ? "" : `?pour=${who.id}`}`;
              return (
                <li key={d.id} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 border-t border-line py-4" data-dish={d.slug ?? d.id}>
                  <Link href={href} className="rounded-[8px]" tabIndex={-1} aria-hidden>
                    {art(d)}
                  </Link>
                  <Link href={href} className="grid min-w-0 gap-1 rounded-[4px] hover:[&>b]:underline hover:[&>b]:decoration-line-strong hover:[&>b]:underline-offset-4">
                    <b className="text-[17px] leading-snug text-pretty">{d.name}</b>
                    <span className="num text-small text-ink-2">
                      {next ? (
                        <>
                          {next.source === "boite" ? (d.boxes.find((b) => b.id === next.boxId)?.place === "freezer" ? "sa boîte au congélo : " : "sa boîte au frigo : ") : d.estimated ? "≈ " : ""}
                          {gramsLine(next.grams)}
                          {next.source === "recipient" && d.estimated ? " · estimé, pas encore pesé" : ""}
                        </>
                      ) : left > 0 ? (
                        "à se servir à l’œil : le récipient est vide"
                      ) : (
                        `plus de portion pour ${self ? "toi" : who.name}`
                      )}
                    </span>
                    {others.length > 0 && <span className="num text-small text-ink-2">{others.map((o) => `${o.name} : ${o.left} sur ${o.total}`).join(" · ")}</span>}
                  </Link>
                  <p className="grid justify-items-end text-right" aria-label={`${left} portions restantes sur ${mine?.total ?? 0}`}>
                    <span className="num-tight text-[40px] leading-none">{left}</span>
                    <span className="label text-ink-2">sur {mine?.total ?? 0}</span>
                  </p>
                  <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {left > 0 || potLeft ? (
                      <Button variant={i === firstEat ? "primary" : "secondary"} icon="check" state={busy === d.id ? "loading" : "idle"} loadingLabel="Je note…" disabled={pending && busy !== d.id} onClick={() => eat(d.id, d.id, who.id)} data-action="manger">
                        {left > 0 ? (self ? "J’ai mangé une portion" : `${who.name} a mangé une portion`) : "En prendre une"}
                      </Button>
                    ) : null}
                    {lim && (
                      <span className={`text-small ${lim.tone || "text-ink-2"}`}>
                        {lim.label.toLocaleLowerCase("fr")} {lim.big}
                      </span>
                    )}
                    {mine && mine.inBoxes > 0 && <span className="text-small text-ink-2">dont {mine.inBoxes} en boîte{mine.inBoxes > 1 ? "s" : ""}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {planned.length > 0 && (
        <section aria-labelledby="prevus-titre" className="grid gap-6">
          <h2 id="prevus-titre" className="text-h2">
            À cuisiner
          </h2>
          <ul className="grid border-b border-line">
            {planned.map((d) => {
              const mine = d.people.find((p) => p.personId === who.id);
              const others = d.people.filter((p) => p.personId !== who.id);
              return (
                <li key={d.id} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-4 border-t border-line py-4" data-planned={d.slug}>
                  {art(d)}
                  <span className="grid min-w-0 gap-1">
                    <Link href={`/recettes/${d.slug}`} className="text-[17px] font-bold leading-snug text-pretty hover:underline hover:decoration-line-strong hover:underline-offset-4">
                      {d.name}
                    </Link>
                    <span className="num text-small text-ink-2">{others.length ? others.map((o) => `${o.name} : ${portions(o.total)}`).join(" · ") : "pas encore cuisiné"}</span>
                  </span>
                  <p className="grid justify-items-end text-right">
                    <span className="num-tight text-[40px] leading-none">{mine?.total ?? 0}</span>
                    <span className="label text-ink-2">prévues</span>
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {eaten.length > 0 && (
        <section aria-labelledby="mange-titre" className="grid gap-6">
          <h2 id="mange-titre" className="text-h2">
            {self ? "Ce que tu as mangé" : `Ce que ${who.name} a mangé`}
          </h2>
          <ul className="grid border-b border-line">
            {eaten.map((s) => (
              <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-line py-3" data-serving={s.id}>
                <span className="grid min-w-0 gap-1">
                  <b className="text-[17px] leading-snug text-pretty">{s.name.split(",")[0]}</b>
                  <span className="num text-small text-ink-2">
                    {dayWord(s.date, today)} {MEAL[s.meal]} · {gramsLine(s.grams) || (s.source === "boite" ? "une boîte" : "")} · {s.kcal}&nbsp;kcal
                  </span>
                </span>
                <Button variant="quiet" size="sm" disabled={pending} onClick={() => undo(s.id)} data-action="annuler-portion">
                  Annuler
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {node}
    </>
  );
}
