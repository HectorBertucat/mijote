// Les bases du foyer dans Nos plats et le bilan du batch : un gros récipient de riz, de haricots verts…
// où chacun se sert, ce qui en reste, « Refaire du riz » quand il n’en reste plus que pour une portion
// ou deux ; et ce qui est à congeler (plats et bases) avant la limite au frigo. Sans état.
import Link from "next/link";
import { FoodIllu } from "@/components/illus/Illu";
import { Icon, Pill } from "@/components/ui";
import { gramsLabel } from "@/lib/boxes/core";
import type { BaseView, FreezeView } from "@/lib/reserve/bases-store";
import { BASE_FOOD, baseFamily } from "@/lib/reserve/bases";
import { beforeWords, limitWords, portions } from "./words";

const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);

/** Les gros récipients des bases : une ligne par base, ce qui reste, à refaire. */
export function BaseList({ bases, today, title = "Les bases" }: { bases: BaseView[]; today: string; title?: string }) {
  if (!bases.length) return null;
  return (
    <section aria-labelledby="bases-titre" className="grid content-start gap-4">
      <h2 id="bases-titre" className="border-b border-line-strong pb-4 text-h2">
        {title}
      </h2>
      <p className="text-small text-ink-2">Cuites à part, dans de gros récipients : chacun s’y sert à chaque repas, avec son plat.</p>
      <ul className="grid border-b border-line">
        {bases.map((b) => {
          const first = b.containers.find((c) => c.leftG > 0);
          const lim = first ? limitWords(first.limit, first.freshness, today) : null;
          const n = b.containers.filter((c) => c.leftG > 0).length;
          return (
            <li key={b.family} className="border-t border-line" data-base={b.family} data-low={b.low ? "1" : undefined}>
              <Link href={`/plats/bases/${b.family}`} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[4px] py-3 hover:bg-surface-2">
                <FoodIllu food={BASE_FOOD[b.family]} item={b.label} size={40} />
                <span className="grid min-w-0 gap-0.5">
                  <b className="text-[17px] leading-snug">{cap(b.label)}</b>
                  <span className="num text-small text-ink-2">
                    {b.leftG > 0 ? `${b.containers.some((c) => c.estimated && c.leftG > 0) ? "≈ " : ""}${gramsLabel(b.leftG)}${n > 1 ? ` dans ${n} récipients` : ""}` : "vide"}
                    {lim && <span className={lim.tone}> · {lim.label.toLocaleLowerCase("fr")} {lim.big}</span>}
                  </span>
                  {b.low && (
                    <span className="text-small font-semibold text-warn-ink">
                      {b.leftG > 0 ? "Bientôt vide" : "Vide"} : refaire {baseFamily(b.family)?.some ?? b.label}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {b.low ? <Pill tone="warn" icon="pot">à refaire</Pill> : null}
                  <Icon name="chev" className="shrink-0 text-faint" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** « À congeler : 2 portions de butter chicken d’ici jeudi » ; ce qui ne se congèle pas : à manger d’abord. */
export function FreezeList({ dishes, bases, today }: { dishes: FreezeView[]; bases: BaseView[]; today: string }) {
  const fb = bases.filter((b) => b.freeze.portions > 0 && b.freeze.by);
  const ok = dishes.filter((d) => d.ok);
  const first = dishes.filter((d) => !d.ok);
  if (!ok.length && !fb.length && !first.length) return null;
  return (
    <section aria-labelledby="congeler-titre" className="grid gap-3 border-y border-line-strong py-4 lg:max-w-[66%]" data-congeler>
      <h2 id="congeler-titre" className="flex items-center gap-2 text-h3">
        <Icon name="snow" />
        {ok.length || fb.length ? "À congeler" : "À manger d’abord"}
      </h2>
      <ul className="grid gap-2">
        {ok.map((d) => (
          <li key={d.dishId} className="num text-[17px]" data-congeler-plat={d.slug ?? d.dishId}>
            <b>{portions(d.portions)}</b> de {d.name} {beforeWords(d.by, today)}
            <span className="text-ink-2"> ({d.people.map((p) => `${p.name} ${p.n}`).join(", ")}) : plus que ce qui sera mangé d’ici là.</span>
            {d.note && <span className="block text-small text-ink-2">Attention : {d.note}.</span>}
          </li>
        ))}
        {fb.map((b) => (
          <li key={b.family} className="num text-[17px]" data-congeler-base={b.family}>
            <b>{portions(b.freeze.portions)}</b> {/^[aeéiouy]/i.test(b.label) ? "d’" : "de "}
            {b.label} de {gramsLabel(b.portionG)} {beforeWords(b.freeze.by!, today)}
            <span className="block text-small text-ink-2">{cap(b.freeze.how)}.</span>
          </li>
        ))}
        {first.map((d) => (
          <li key={d.dishId} className="num text-[17px]" data-manger-dabord={d.slug ?? d.dishId}>
            {d.name} : {portions(d.portions)} de trop {beforeWords(d.by, today)}, et {d.portions > 1 ? "elles ne se congèlent pas" : "elle ne se congèle pas"} : à manger en premier.
          </li>
        ))}
      </ul>
    </section>
  );
}
