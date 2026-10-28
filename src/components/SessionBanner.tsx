"use client";

// Bandeau « Session en cours » sur les autres pages (DA : fond inverse, point qui pulse, bouton) : un tap pour
// rejoindre la session (ordinateur, iPad ou téléphone). Lu par fetch : la mise en page reste statique.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Active = { id: string; title: string; status: string; mode?: string; test?: boolean } | null;

export function SessionBanner() {
  const path = usePathname();
  const [active, setActive] = useState<Active>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/session/active", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { session: Active }) => !stop && setActive(d.session))
        .catch(() => {});
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [path]);
  if (!active || path.startsWith("/session")) return null;
  // Seule bande d'encre pleine de l'appli : sous l'en-tête sur ordinateur, juste au-dessus de la barre d'onglets
  // sur téléphone (à portée de pouce ; kit.css agrandit alors la marge basse de <main>).
  return (
    <div data-session-banner className="fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 sm:static">
      <Link href={`/session/${active.id}`} className="flex items-center gap-2.5 bg-inverse py-2 pl-3 pr-2.5 text-[14px] text-on-inverse active:scale-100 sm:px-[max(1.75rem,calc((100vw-64rem)/2+1.75rem))]">
        <span className="k-live size-2 shrink-0 rounded-full bg-on-inverse" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <b>{active.status === "fridge" ? "Prep faite la veille" : active.test ? "Session test" : "Session en cours"}</b> · {active.title}
          {active.mode === "duo" ? " · à deux" : ""}
        </span>
        <span className="inline-flex min-h-[30px] shrink-0 items-center rounded-[8px] bg-on-inverse px-2.5 font-display text-[13px] font-[650] text-inverse">
          {active.status === "fridge" ? "Reprendre la session" : active.mode === "duo" ? "À deux" : active.status === "prep" ? "Prep" : "Cuisson"} →
        </span>
      </Link>
    </div>
  );
}
