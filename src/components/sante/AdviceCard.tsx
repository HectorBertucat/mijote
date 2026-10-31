// Le conseil hors batch (déterministe, src/lib/eaters/habits.ts adviceOf) : manque-t-il des
// protéines ou des kcal une fois mangés les repas du batch et les habitudes ? Page serveur.
import Link from "next/link";
import type { Advice } from "@/lib/eaters/habits";
import { Verdict } from "./carnet";

const FROM = { semaine: "d’après tes repas de la Semaine", bibliotheque: "d’après ta part des recettes de la bibliothèque" } as const;

export function AdviceCard({ advice, link = false }: { advice: (Advice & { from: keyof typeof FROM }) | null; link?: boolean }) {
  if (!advice) return null;
  const gap = advice.kind === "gap";
  return (
    <div className={`grid max-w-[62ch] gap-2 border-l-2 py-1 pl-4 ${gap ? "border-ink" : "border-ok"}`}>
      {gap ? <span className="label text-ink">Un complément serait utile</span> : <Verdict tone="ok">Aucun complément utile</Verdict>}
      <p className="text-body">
        {advice.text} <span className="text-small text-ink-2">({FROM[advice.from]})</span>
      </p>
      {link && gap && (
        <Link href="/sante/habitudes" className="w-fit text-small font-bold underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          Régler mes habitudes
        </Link>
      )}
    </div>
  );
}
