// Les zones cardiaques en cours : une ligne par zone (nom, bpm, ressenti sans cardio), d'où viennent les repères
// (âge, courses, saisie, test) et ce qui manque pour qu'elles soient plus justes. Rendu serveur.
import Link from "next/link";
import { VIZ_ZONE } from "@/components/ui/charts/core";
import { DEFAULT_AGE } from "@/lib/running/store";
import { METHOD_LABEL, ZONE_FEEL, ZONE_NAMES, zoneRange, type Zones } from "@/lib/running/zones";
import { HowCalc, NB, Section } from "../carnet";

const REST_LABEL = { saisie: "saisie", mesuree: "médiane des 30 derniers jours", defaut: "par défaut, faute de mesure" } as const;
const THRESHOLD_LABEL = { saisie: "saisie", test: "d’après ton test", estimee: "estimée" } as const;

export function ZonesSection({ z, ageKnown, pending, hasHr }: { z: Zones; ageKnown: boolean; pending: number | null; hasHr: boolean }) {
  return (
    <Section title="Tes zones" id="zones" aside={<span className="text-small text-ink-2">{z.method === "friel" ? "d’après ta FC au seuil" : "d’après la réserve cardiaque"}</span>}>
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <table className="w-full border-collapse text-left lg:col-span-7">
          <caption className="sr-only">Zones cardiaques, en battements par minute</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Zone</th>
              <th scope="col">Battements</th>
              <th scope="col">Sans cardio</th>
            </tr>
          </thead>
          <tbody className="border-t border-line-strong">
            {([5, 4, 3, 2, 1] as const).map((k) => (
              <tr key={k} className="border-b border-line">
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  <span className="flex items-center gap-3">
                    <i aria-hidden className="inline-block size-3 shrink-0 rounded-[2px]" style={{ background: VIZ_ZONE[k - 1] }} />
                    <span>
                      <b className="font-bold">{`Z${k}`}</b> <span className="text-ink-2">{ZONE_NAMES[k]}</span>
                    </span>
                  </span>
                </th>
                <td className="num py-3 pr-4 text-right font-bold whitespace-nowrap">{`${zoneRange(z, k).join("–")}${NB}bpm`}</td>
                <td className="hidden py-3 text-small text-ink-2 sm:table-cell">{ZONE_FEEL[k]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid content-start gap-4 text-small lg:col-span-5">
        <dl className="grid content-start gap-4">
          <div className="grid gap-1">
            <dt className="label text-ink-2">FC max</dt>
            <dd>
              <b className="num text-body">{`${z.max}${NB}bpm`}</b> <span className="text-ink-2">{METHOD_LABEL[z.maxSource]}{!ageKnown && z.maxSource === "age" ? `, sur ${DEFAULT_AGE} ans faute de date de naissance` : ""}</span>
              {pending ? <span className="block text-ink-2">{`Un pic à ${pending}${NB}bpm attend d’être confirmé par une autre sortie.`}</span> : null}
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="label text-ink-2">Au repos</dt>
            <dd>
              <b className="num text-body">{`${z.rest}${NB}bpm`}</b> <span className="text-ink-2">{REST_LABEL[z.restSource]}</span>
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="label text-ink-2">Au seuil</dt>
            <dd>
              <b className="num text-body">{`${z.threshold}${NB}bpm`}</b> <span className="text-ink-2">{THRESHOLD_LABEL[z.thresholdSource]}</span>
            </dd>
          </div>
        </dl>
          <p className="text-ink-2">
            {hasHr ? "Les repères se mettent à jour le 1er du mois." : "Pas encore de fréquence cardiaque reçue : la charge se calcule avec la durée et l’effort que tu notes."}{" "}
            <Link href="/sante/course/reglages#fc" className="font-bold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              Saisir une FC mesurée
            </Link>
          </p>
        </div>
      </div>
      <HowCalc>
        <p>FC max : la valeur saisie, sinon la plus haute de tes courses confirmée par une autre, sinon l’estimation 208 − 0,7 × l’âge. Elle ne baisse que si tu la saisis.</p>
        <p>Zones : un pourcentage de l’écart entre FC au repos et FC max (50, 60, 70, 80, 90 %), la méthode des montres Apple. Avec une FC au seuil mesurée, les zones de Friel la remplacent.</p>
      </HowCalc>
    </Section>
  );
}
