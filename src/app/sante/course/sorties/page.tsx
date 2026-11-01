// Toutes les sorties de course, de la plus récente à la plus ancienne, regroupées par mois ; chacune mène à son détail.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Section } from "@/components/sante/carnet";
import { RunList } from "@/components/sante/course/RunList";
import { Icon } from "@/components/ui";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { courseView } from "@/lib/running/page";

export const dynamic = "force-dynamic";

const monthOf = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function Sorties() {
  const person = await activePerson();
  const v = courseView(db, person.id);
  if (!v) notFound();
  const months = [...new Set(v.runs.map((r) => r.date.slice(0, 7)))];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12">
      <header className="grid gap-3">
        <Link href="/sante/course" className="inline-flex min-h-tap items-center gap-1 justify-self-start text-small font-bold text-ink-2 hover:text-ink">
          <Icon name="chev" size="s" className="rotate-180" />
          Course
        </Link>
        <h2 className="text-h1">Sorties</h2>
        <p className="text-lead text-ink-2">{`${v.runs.length} course${v.runs.length > 1 ? "s" : ""} reçue${v.runs.length > 1 ? "s" : ""}.`}</p>
      </header>
      {months.map((m) => {
        const runs = v.runs.filter((r) => r.date.startsWith(m));
        const label = monthOf(`${m}-01`);
        return (
          <Section key={m} title={`${label[0].toUpperCase()}${label.slice(1)}`} id={`m-${m}`} level={3} aside={<span className="text-small text-ink-2">{`${runs.length} sortie${runs.length > 1 ? "s" : ""}`}</span>}>
            <RunList runs={runs} />
          </Section>
        );
      })}
    </div>
  );
}
