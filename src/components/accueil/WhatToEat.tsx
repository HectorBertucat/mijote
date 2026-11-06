"use client";

// « Que manger ? » sur l’accueil : la réserve de chacun, plat par plat (le jour est libre). Pour la
// personne choisie (le profil de l’appareil d’abord, l’autre d’un geste), ce qui lui reste de chaque
// plat (« 2 sur 4 »), les grammes de sa prochaine portion (≈ tant que le plat n’est pas pesé), et
// « J’ai mangé une portion » d’un geste, annulable ; ce qu’elle a mangé aujourd’hui, annulable aussi.
// Sans rien de cuit : les portions prévues des plats de la période. Remplace « Aujourd’hui » et le frigo.
import Link from "next/link";
import { useState } from "react";
import { Button, RecipeTile, Segmented } from "@/components/ui";
import { gramsLine, limitWords, portions } from "@/components/plats/words";
import { useEat } from "@/components/plats/useEat";
import type { DishView, ServingView } from "@/lib/reserve/store";
import { recipeColor } from "@/lib/ui";

const QUIET = "inline-flex min-h-tap items-center gap-1 rounded-[8px] text-small font-semibold text-ink-2 underline decoration-line-strong decoration-1 underline-offset-[6px] hover:text-ink hover:decoration-ink";
const MEAL = { breakfast: "matin", lunch: "midi", dinner: "soir", snack: "à côté" } as const;

export interface EatBatch {
  id: string;
  title: string;
  toWeigh: number;
}

export function WhatToEat({ reserve, planned, people, me, today, eaten, batch }: { reserve: DishView[]; planned: DishView[]; people: { id: string; name: string }[]; me: string; today: string; eaten: ServingView[]; batch: EatBatch | null }) {
  const [shown, setShown] = useState(me);
  const { eat, undo, busy, pending, node } = useEat();
  const who = people.find((p) => p.id === shown) ?? people[0];
  if (!who) return null;
  const self = who.id === me;
  const share = (d: DishView) => d.people.find((p) => p.personId === who.id);
  // Ses plats : ceux où il lui reste une portion d’abord, puis ceux où le récipient en a encore pour qui veut.
  const dishes = reserve.filter((d) => (share(d)?.total ?? 0) > 0 || d.groups.some((g) => (g.leftG ?? 0) > 0)).sort((a, b) => Number((share(b)?.left ?? 0) > 0) - Number((share(a)?.left ?? 0) > 0));
  const left = dishes.reduce((s, d) => s + (share(d)?.left ?? 0), 0);
  const todo = planned.filter((d) => (share(d)?.total ?? 0) > 0);
  const mine = eaten.filter((s) => s.personId === who.id && s.date === today);
  const href = (path: string) => (self ? path : `${path}?pour=${who.id}`);
  if (!reserve.length && !todo.length) return null;

  return (
    <section aria-labelledby="manger-titre" data-block="que-manger">
      <div className="flex items-end justify-between gap-4 border-b border-line-strong pb-4">
        <h2 id="manger-titre" className="text-h2">
          <Link href={href("/plats")} className="rounded-[4px] hover:underline hover:decoration-2 hover:underline-offset-[6px]">
            Que manger&nbsp;?
          </Link>
        </h2>
        {dishes.length > 0 && (
          <p className="flex items-baseline gap-2" aria-label={`${portions(left)} pour ${self ? "toi" : who.name}`}>
            <span className="num-tight text-num-xl">{left}</span>
            <span className="label text-faint">portion{left > 1 ? "s" : ""}</span>
          </p>
        )}
      </div>
      {people.length > 1 && <Segmented className="mt-4" label="La réserve de" value={who.id} onChange={setShown} options={people.map((p) => ({ value: p.id, label: p.name }))} />}

      {dishes.length > 0 ? (
        <ul className="mt-2">
          {dishes.map((d) => {
            const s = share(d);
            const n = s?.left ?? 0;
            const next = s?.next;
            const box = next?.source === "boite" ? d.boxes.find((b) => b.id === next.boxId) : null;
            const fridgeBox = d.boxes.find((b) => b.place === "fridge");
            const lim = d.limit && d.freshness ? limitWords(d.limit, d.freshness, today) : fridgeBox ? limitWords(fridgeBox.limit, fridgeBox.freshness, today) : null;
            return (
              <li key={d.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 border-b border-line py-4" data-dish={d.slug ?? d.id}>
                <RecipeTile color={d.slug ? recipeColor(d.slug) : "var(--c-ink-3)"} name={d.name} size="sm" />
                <Link href={href(`/plats/${d.id}`)} className="min-w-0 rounded-[4px] hover:[&_b]:underline hover:[&_b]:decoration-line-strong hover:[&_b]:underline-offset-4">
                  <span className="grid min-w-0 gap-1">
                    <b className="font-semibold leading-snug text-pretty">{d.name}</b>
                    <span className="num text-small text-ink-2">
                      {next ? (
                        <>
                          {box ? (box.place === "freezer" ? "sa boîte au congélo : " : "sa boîte au frigo : ") : ""}
                          {d.estimated && !box ? "≈ " : ""}
                          {gramsLine(next.grams)}
                          {d.estimated && !box ? " · estimé" : ""}
                        </>
                      ) : n > 0 ? (
                        "à se servir à l’œil"
                      ) : s?.borrow ? (
                        `celle de ${s.borrow.name} : ${gramsLine(s.borrow.grams)}`
                      ) : (
                        `plus de portion pour ${self ? "toi" : who.name}`
                      )}
                    </span>
                    {lim && <span className={`text-small ${lim.tone || "text-ink-2"}`}>{lim.label.toLocaleLowerCase("fr")} {lim.big}</span>}
                  </span>
                </Link>
                <p className="grid justify-items-end text-right" aria-label={`${n} sur ${s?.total ?? 0}`}>
                  <span className="num-tight text-h2 leading-none">{n}</span>
                  <span className="label text-ink-2">sur {s?.total ?? 0}</span>
                </p>
                <div className="col-span-2 col-start-2">
                  <Button size="sm" icon="check" state={busy === d.id ? "loading" : "idle"} loadingLabel="Je note…" disabled={pending && busy !== d.id} onClick={() => eat(d.id, d.id, who.id)} data-action="manger">
                    {n > 0 ? (self ? "J’ai mangé une portion" : `${who.name} a mangé une portion`) : s?.borrow ? `Prendre celle de ${s.borrow.name}` : "En prendre une"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <p className="mt-4 text-ink-2">Pas encore cuisiné. {self ? "Tes portions prévues" : `Les portions prévues de ${who.name}`}&nbsp;:</p>
          <ul className="mt-2">
            {todo.map((d) => (
              <li key={d.id} className="flex min-w-0 items-center gap-3 border-b border-line py-3" data-planned={d.slug}>
                <RecipeTile color={d.slug ? recipeColor(d.slug) : "var(--c-ink-3)"} name={d.name} size="sm" />
                <span className="min-w-0 flex-1 font-semibold text-pretty">{d.name}</span>
                <span className="num shrink-0 text-ink-2">{portions(share(d)?.total ?? 0)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {mine.length > 0 && (
        <div className="mt-6">
          <h3 className="label text-ink-2">{self ? "Mangé aujourd’hui" : `${who.name}, aujourd’hui`}</h3>
          <ul className="mt-2">
            {mine.map((x) => (
              <li key={x.id} className="flex min-w-0 items-center gap-3 border-b border-line py-2" data-serving={x.id}>
                <span className="min-w-0 flex-1 text-small">
                  <b className="font-semibold">{x.name.split(",")[0]}</b> <span className="num text-ink-2">· {MEAL[x.meal]} · {x.kcal}&nbsp;kcal</span>
                </span>
                <Button variant="quiet" size="sm" disabled={pending} onClick={() => undo(x.id)} data-action="annuler-portion">
                  Annuler
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-6">
        {batch && (
          <Link href={`/plats/batch/${batch.id}`} className={QUIET} data-link="bilan">
            {batch.title}
            {batch.toWeigh > 0 && <span className="font-normal">&nbsp;· {batch.toWeigh}&nbsp;à peser</span>}
          </Link>
        )}
        <Link href={href("/plats")} className={QUIET}>
          Tous les plats
        </Link>
      </div>
      {node}
    </section>
  );
}
