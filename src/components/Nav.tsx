"use client";

// Coque de l'appli (DA « Plan de travail ») : en-tête léger (logo, navigation sur ordinateur, sélecteur de profil,
// sélecteur de thème), barre d'onglets en bas sur téléphone (pastille sur l'onglet actif).
import type { CSSProperties } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { ProfileSwitch, type ProfileOption } from "./ProfileSwitch";
import { ThemeToggle } from "./ThemeToggle";
import { Icon, type IconName } from "./ui/icon";


// Chaque rubrique a sa couleur (tokens sec-*) : pastille dans le menu, fond teinté quand elle est ouverte.
const TABS: { href: string; label: string; icon: IconName; sec: string }[] = [
  { href: "/recettes", label: "Recettes", icon: "book", sec: "var(--c-sec-recettes)" },
  { href: "/semaine", label: "Semaine", icon: "cal", sec: "var(--c-sec-semaine)" },
  { href: "/composer", label: "Composer", icon: "pot", sec: "var(--c-sec-composer)" },
  { href: "/courses", label: "Courses", icon: "basket", sec: "var(--c-sec-courses)" },
  { href: "/frigo", label: "Frigo", icon: "fridge", sec: "var(--c-sec-frigo)" },
  { href: "/sante", label: "Santé", icon: "pulse", sec: "var(--c-sec-sante)" },
];
const secStyle = (sec: string) => ({ "--sec": sec }) as CSSProperties;

// Fin trait d'accent qui pulse pendant le chargement de la page visée.
function Pending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`pointer-events-none absolute h-0.5 rounded-full bg-accent transition-opacity ${pending ? "animate-pulse opacity-100" : "opacity-0"} ${className}`} />;
}

/** `motif` : le dessin de saison à côté du logo, rendu par le layout (serveur) pour garder les dessins hors du paquet client. */
export function TopNav({ profiles, active, motif, search, home }: { profiles: ProfileOption[]; active: string; motif?: React.ReactNode; search?: React.ReactNode; home?: string | null }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_srgb,var(--c-bg)_92%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center gap-[22px] px-4 py-3 sm:px-7">
        <Link href="/recettes" title={home ?? undefined} className="group inline-flex items-center gap-1 font-display text-[19px] font-extrabold tracking-[-0.03em] text-ink [font-stretch:125%] active:scale-100">
          mijote
          {motif && <span className="-my-1 inline-grid transition-transform duration-[var(--dur-base)] group-hover:-rotate-12">{motif}</span>}
        </Link>
        <nav className="hidden flex-1 gap-0.5 sm:flex" aria-label="Navigation">
          {TABS.map((t) => {
            const on = path.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? "page" : undefined}
                style={secStyle(t.sec)}
                className={`relative inline-flex items-center gap-1.5 rounded-[8px] px-3 py-[7px] text-[14px] font-semibold ${on ? "bg-[color-mix(in_srgb,var(--sec)_15%,var(--c-surface))] text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
              >
                <span key={on ? "on" : "off"} aria-hidden className={`size-2 rounded-[3px] bg-[var(--sec)] ${on ? "k-gesture" : ""}`} data-g="dot" />
                {t.label}
                <Pending className="inset-x-3 -bottom-px" />
              </Link>
            );
          })}
        </nav>
        {search}
        <ProfileSwitch profiles={profiles} active={active} className="ml-auto sm:ml-0" />
        <Link href="/reglages" aria-label="Réglages" title="Réglages" className="grid size-tap place-items-center rounded-[10px] text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Icon name="sliders" />
        </Link>
        <ThemeToggle />
      </div>
    </header>
  );
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-[color-mix(in_srgb,var(--c-surface)_94%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden" aria-label="Navigation">
      <div className="mx-auto grid max-w-md grid-cols-6">
        {TABS.map((t) => {
          const on = path.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} style={secStyle(t.sec)} className={`relative grid justify-items-center gap-0.5 pb-1 pt-2 text-[11px] font-semibold active:scale-100 ${on ? "text-ink" : "text-ink-2"}`}>
              <span className={`grid h-[30px] w-12 place-items-center rounded-full transition-colors duration-[var(--dur-quick)] ${on ? "bg-[color-mix(in_srgb,var(--sec)_18%,var(--c-surface))] text-[var(--sec)]" : ""}`}>
                {/* Ouvrir une rubrique : son icône fait son geste une fois (panier qui se balance, page qui tourne…). */}
                <span key={on ? path : "off"} data-g={t.icon} className={`grid place-items-center ${on ? "k-gesture" : ""}`}>
                  <Icon name={t.icon} />
                </span>
              </span>
              {t.label}
              <Pending className="inset-x-5 top-0" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
