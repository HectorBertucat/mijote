// L'état de la liste de courses faite depuis la semaine (en préparation, brouillon, commandée), en une ligne-lien.
// Un mot plutôt qu'une pastille : seul le changement depuis la liste prend la couleur d'alerte.
import Link from "next/link";
import { Icon } from "@/components/ui";
import { PendingMark } from "@/components/PendingMark";

export interface WeekListInfo {
  id: string;
  status: string;
  ordered: boolean;
  createdAt: string;
  orderedAt: string | null;
  changed: boolean;
  building: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

export function WeekListStatus({ list }: { list: WeekListInfo }) {
  const state = list.building ? "en préparation" : list.ordered ? "commandée" : "brouillon";
  return (
    <Link href={`/courses/${list.id}`} className="group -mx-3 flex min-h-tap items-center gap-3 rounded-[8px] px-3 py-3 hover:bg-surface-2">
      <Icon name="basket" className="shrink-0 text-ink-2" />
      <span className="grid min-w-0 flex-1">
        <span className="font-bold">
          Liste de courses <span className="font-normal text-ink-2">· {state}</span>
        </span>
        <span className={`text-small ${list.changed ? "text-warn-ink" : "text-ink-2"}`}>
          {list.changed ? "La semaine a changé depuis : refais la liste." : list.ordered && list.orderedAt ? `Validée ${when(list.orderedAt)}` : `Faite ${when(list.createdAt)}`}
        </span>
      </span>
      <span className="shrink-0 text-ink-3 transition-colors duration-[var(--dur-1)] group-hover:text-ink">
        <PendingMark idle={<Icon name="chev" />} />
      </span>
    </Link>
  );
}
