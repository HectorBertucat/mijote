import type { Metadata } from "next";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import { ACTIONS, FOODS, type ActionId, type FoodArtId } from "@/lib/illus/art";

// Banque d'illustrations (src/lib/illus/art.ts) : chaque geste et chaque aliment, vivants. Non liée.
export const metadata: Metadata = { title: "Dessins · cuisine", robots: { index: false, follow: false } };

function Cell({ children, label, id }: { children: React.ReactNode; label: string; id: string }) {
  return (
    <figure className="grid justify-items-center gap-1 rounded-[14px] border border-line bg-surface px-2 pt-3 pb-2 text-center text-[13px]">
      {children}
      <figcaption>
        {label}
        <span className="block text-[11px] text-faint">{id}</span>
      </figcaption>
    </figure>
  );
}

export default function DessinsPage() {
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5";
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[30px] font-extrabold">Dessins</h1>
        <p className="mt-1 max-w-[66ch] text-ink-2">
          {Object.keys(ACTIONS).length} gestes et {Object.keys(FOODS).length} aliments (les « _ » sont les génériques de famille). Un ingrédient inconnu prend le dessin de sa famille ; <code>pnpm illus:coverage</code> liste ceux qui méritent le leur.
        </p>
      </div>
      <section className="grid gap-3">
        <h2 className="text-[20px] font-bold">Gestes</h2>
        <div className={grid}>
          {(Object.keys(ACTIONS) as ActionId[]).map((id) => (
            <Cell key={id} id={id} label={ACTIONS[id].label}>
              <StepIllu id={id} size="l" live />
            </Cell>
          ))}
        </div>
      </section>
      <section className="grid gap-3">
        <h2 className="text-[20px] font-bold">Aliments</h2>
        <div className={grid}>
          {(Object.keys(FOODS) as FoodArtId[]).map((id) => (
            <Cell key={id} id={`${id} · ${FOODS[id].category}`} label={FOODS[id].label}>
              <FoodIllu id={id} size="l" live />
            </Cell>
          ))}
        </div>
      </section>
    </div>
  );
}
