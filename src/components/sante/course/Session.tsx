// Une séance prévue, lisible d'un coup d'œil : son profil (un morceau par pas, la largeur pour la durée, la
// hauteur et la teinte pour la zone visée) et ses blocs en tableau de carnet (échauffement, répétitions, retour
// au calme), chacun avec sa cible en bpm et en zone. Rendu serveur ; le profil est muet, les blocs le disent.
import { VIZ_ZONE } from "@/components/ui/charts/core";
import { durText, paceText, type ReadableBlock, type ReadableStep } from "@/lib/running/view";
import { NB } from "../carnet";

const ROLE: Record<ReadableStep["role"], string> = { warmup: "Échauffement", work: "", recovery: "", cooldown: "Retour au calme" };

/** Le profil de la séance : des barres dont la largeur est la durée et la hauteur l'intensité (zones 1 à 5). */
export function SessionProfile({ profile, className = "" }: { profile: { seconds: number; level: number }[]; className?: string }) {
  const total = profile.reduce((s, p) => s + p.seconds, 0) || 1;
  return (
    <div aria-hidden className={`flex h-14 items-end gap-[2px] ${className}`}>
      {profile.map((p, i) => (
        <span
          key={i}
          className="block min-w-[2px] rounded-t-[2px]"
          style={{ flexGrow: p.seconds / total, flexBasis: 0, height: `${18 + (p.level - 1) * 20}%`, background: VIZ_ZONE[Math.min(5, Math.max(1, p.level)) - 1] }}
        />
      ))}
    </div>
  );
}

function Target({ st }: { st: ReadableStep }) {
  if (st.hr)
    return (
      <span className="grid justify-items-end">
        <span className="num font-bold whitespace-nowrap text-ink">{`${st.hr[0]}–${st.hr[1]}${NB}bpm`}</span>
        <span className="label text-ink-2">{st.zone}</span>
      </span>
    );
  if (st.pace) return <span className="num whitespace-nowrap text-ink-2">{`${paceText(st.pace[0])}–${paceText(st.pace[1])}/km`}</span>;
  return <span className="text-small text-ink-3">sans cible</span>;
}

const amount = (st: ReadableStep) => (st.seconds ? durText(st.seconds) : st.meters ? `${st.meters}${NB}m` : "libre");

/** Les blocs de la séance, de haut en bas, dans un tableau à filets (lu tel quel par un lecteur d'écran). */
export function SessionBlocks({ blocks, compact = false }: { blocks: ReadableBlock[]; compact?: boolean }) {
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Les blocs de la séance et leurs cibles</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Partie</th>
          <th scope="col">Durée</th>
          <th scope="col">Cible</th>
        </tr>
      </thead>
      <tbody className="border-t border-line-strong">
        {blocks.map((b, i) =>
          b.steps.map((st, k) => (
            <tr key={`${i}-${k}`} className={k === b.steps.length - 1 ? "border-b border-line" : ""}>
              <th scope="row" className={`pr-4 text-left align-bottom font-normal ${compact ? "py-2" : "py-3"}`}>
                {k === 0 && (ROLE[st.role] || b.reps > 1) && <span className="label block pb-1 text-ink-2">{ROLE[st.role] || `${b.reps} fois`}</span>}
                <span className={`block ${st.role === "work" ? "font-bold text-ink" : "text-ink"}`}>{st.label}</span>
              </th>
              <td className={`num pr-4 align-bottom whitespace-nowrap text-ink ${compact ? "py-2" : "py-3"}`}>
                {amount(st)}
              </td>
              <td className={`text-right align-bottom ${compact ? "py-2" : "py-3"}`}>
                <Target st={st} />
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
