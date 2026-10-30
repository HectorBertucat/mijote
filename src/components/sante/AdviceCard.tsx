// Le conseil hors batch (déterministe, src/lib/eaters/habits.ts adviceOf) : manque-t-il des
// protéines ou des kcal une fois mangés les repas du batch et les habitudes ? Page serveur.
import Link from "next/link";
import { Alert } from "@/components/ui";
import type { Advice } from "@/lib/eaters/habits";

const FROM = { semaine: "d'après tes repas de la Semaine", bibliotheque: "d'après ta part des recettes de la bibliothèque" } as const;

export function AdviceCard({ advice, link = false }: { advice: (Advice & { from: keyof typeof FROM }) | null; link?: boolean }) {
  if (!advice) return null;
  return (
    <Alert tone={advice.kind === "gap" ? "info" : "ok"} title={advice.kind === "gap" ? "Un complément serait utile" : "Aucun complément utile"}>
      {advice.text} <span className="text-ink-2">({FROM[advice.from]})</span>
      {link && advice.kind === "gap" && (
        <>
          {" "}
          <Link href="/sante/habitudes" className="font-semibold text-accent hover:underline">
            Régler mes habitudes
          </Link>
        </>
      )}
    </Alert>
  );
}
