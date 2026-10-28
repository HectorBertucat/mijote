// L'état de la liste de courses faite depuis la semaine (brouillon, commandée), avec un lien.
import Link from "next/link";
import { Icon, Pill } from "@/components/ui";
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
  return (
    <Link href={`/courses/${list.id}`} className="flex min-h-tap items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-2.5 hover:bg-surface-2">
      <Icon name="basket" className="shrink-0 text-ink-2" />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
        <b className="text-[15px]">Liste de courses</b>
        {list.building ? (
          <Pill tone="idle">en préparation</Pill>
        ) : list.ordered ? (
          <Pill tone="ok">commandée</Pill>
        ) : (
          <Pill tone="idle" icon="sparkdraft">
            brouillon
          </Pill>
        )}
        <span className="text-[13px] text-ink-2">{list.ordered && list.orderedAt ? `validée ${when(list.orderedAt)}` : `faite ${when(list.createdAt)}`}</span>
        {list.changed && (
          <Pill tone="warn" icon="alert">
            la semaine a changé depuis
          </Pill>
        )}
      </span>
      <span className="shrink-0 text-faint">
        <PendingMark idle={<Icon name="chev" />} />
      </span>
    </Link>
  );
}
