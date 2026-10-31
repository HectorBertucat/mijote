"use client";

// Coque de l’appli (DA v3 « Carnet de marché ») : en-tête sur papier, mot-symbole à la cocotte, rubriques en texte
// (soulignées d’encre quand elles sont ouvertes : la couleur reste aux plats), recherche, profil, réglages, thème.
// Sur téléphone, barre d’onglets en bas.
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ProfileSwitch, type ProfileOption } from "./ProfileSwitch";
import { ThemeToggle } from "./ThemeToggle";
import { Icon, type IconName } from "./ui/icon";
import { Wordmark } from "./ui/wordmark";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/recettes", label: "Recettes", icon: "book" },
  { href: "/semaine", label: "Semaine", icon: "cal" },
  { href: "/courses", label: "Courses", icon: "basket" },
  { href: "/frigo", label: "Frigo", icon: "fridge" },
  { href: "/sante", label: "Santé", icon: "pulse" },
];

// Trait sous l’onglet visé pendant le chargement de la page (retour immédiat au clic).
function Pending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`pointer-events-none absolute h-0.5 bg-ink-3 transition-opacity duration-[var(--dur-1)] ${pending ? "opacity-100" : "opacity-0"} ${className}`} />;
}

/** `motif` : gardé pour compatibilité (le dessin de saison n’est plus affiché : le mot-symbole suffit). */
export function TopNav({ profiles, active, search, home }: { profiles: ProfileOption[]; active: string; motif?: React.ReactNode; search?: React.ReactNode; home?: string | null }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-8 px-5 sm:px-10">
        <Link href="/" title={home ?? undefined} className="group -mx-1 rounded-[4px] px-1">
          <Wordmark />
        </Link>
        <nav className="hidden h-full flex-1 items-stretch gap-7 sm:flex" aria-label="Rubriques">
          {TABS.map((t) => {
            const on = path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                data-tour={t.href.slice(1)}
                aria-current={on ? "page" : undefined}
                className={`relative inline-flex items-center text-[15px] font-bold tracking-[-0.005em] ${on ? "text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {t.label}
                <span aria-hidden className={`absolute inset-x-0 -bottom-px h-0.5 bg-ink transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] ${on ? "scale-x-100" : "scale-x-0"}`} />
                <Pending className="inset-x-0 -bottom-px" />
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          {search}
          <ProfileSwitch profiles={profiles} active={active} />
          <Link href="/reglages" aria-label="Réglages" title="Réglages" className="grid size-tap place-items-center rounded-[8px] text-ink-2 hover:bg-surface-2 hover:text-ink">
            <Icon name="sliders" />
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] sm:hidden" aria-label="Rubriques">
      <div className="mx-auto grid max-w-md grid-cols-5">
        {TABS.map((t) => {
          const on = path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} data-tour={t.href.slice(1)} aria-current={on ? "page" : undefined} className={`relative grid justify-items-center gap-1 pb-2 pt-3 ${on ? "text-ink" : "text-ink-3"}`}>
              <span aria-hidden className={`absolute inset-x-5 top-0 h-0.5 bg-ink transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] ${on ? "scale-x-100" : "scale-x-0"}`} />
              {/* Ouvrir une rubrique : son icône fait son geste une fois (panier qui se balance, page qui tourne…). */}
              <span key={on ? path : "off"} data-g={t.icon} className={`grid place-items-center ${on ? "k-gesture" : ""}`}>
                <Icon name={t.icon} />
              </span>
              <span className="label !tracking-[0.04em]">{t.label}</span>
              <Pending className="inset-x-5 top-0" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
