"use client";

// Coque de l’appli (DA v3 « Carnet de marché ») : en-tête sur papier, mot-symbole à la cocotte, rubriques en texte
// (soulignées d’encre quand elles sont ouvertes : la couleur reste aux plats), recherche, profil, réglages, thème.
// Sur téléphone, barre d’onglets en bas.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

/**
 * Rubrique ouverte, mise à jour dès le tap (sans attendre la page) : l’onglet visé s’allume tout de suite, puis le
 * chemin prend le relais quand la page arrive. Un clic avec modificateur (nouvel onglet) ne change rien.
 */
function useActiveTab() {
  const path = usePathname();
  const [target, setTarget] = useState<{ href: string; from: string } | null>(null);
  const current = target && target.from === path ? target.href : (TABS.find((t) => path.startsWith(t.href))?.href ?? null);
  const pick = (href: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    setTarget({ href, from: path });
  };
  return { current, pick, moved: target != null };
}

/** `motif` : gardé pour compatibilité (le dessin de saison n’est plus affiché : le mot-symbole suffit). */
export function TopNav({ profiles, active, search, home }: { profiles: ProfileOption[]; active: string; motif?: React.ReactNode; search?: React.ReactNode; home?: string | null }) {
  const { current, pick } = useActiveTab();
  // Trait d’encre qui glisse d’une rubrique à l’autre : mesuré après l’hydratation (les rubriques n’ont pas la même
  // largeur) ; avant, chaque rubrique ouverte porte son propre trait, au même endroit.
  const nav = useRef<HTMLElement>(null);
  const [ink, setInk] = useState<{ x: number; w: number; ready: boolean } | null>(null);
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const a = current ? el.querySelector<HTMLElement>(`a[href="${current}"]`) : null;
      setInk((prev) => (a ? { x: a.offsetLeft, w: a.offsetWidth, ready: prev != null } : prev && { ...prev, w: 0 }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll("a").forEach((a) => ro.observe(a)); // la police arrive après : les largeurs changent
    return () => ro.disconnect();
  }, [current]);
  return (
    <header className="vt-site-header sticky top-0 z-20 border-b border-line bg-bg pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-8 px-5 sm:px-10">
        <Link href="/" title={home ?? undefined} className="group -mx-1 rounded-[4px] px-1">
          <Wordmark />
        </Link>
        <nav ref={nav} className="relative hidden h-full flex-1 items-stretch gap-7 sm:flex" aria-label="Rubriques">
          {TABS.map((t) => {
            const on = current === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                onClick={pick(t.href)}
                aria-current={on ? "page" : undefined}
                className={`relative inline-flex items-center text-[15px] font-bold tracking-[-0.005em] ${on ? "text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {t.label}
                {on && !ink && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
              </Link>
            );
          })}
          {ink && (
            <span
              aria-hidden
              className={`pointer-events-none absolute -bottom-px left-0 h-0.5 w-px origin-left bg-ink ${ink.ready ? "transition-transform duration-[var(--dur-3)] ease-[var(--ease-out)]" : ""}`}
              style={{ transform: `translateX(${ink.x}px) scaleX(${ink.w})` }}
            />
          )}
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
  const { current, pick, moved } = useActiveTab();
  const i = TABS.findIndex((t) => t.href === current);
  // Le trait reste à la dernière rubrique ouverte quand aucune ne l’est (accueil, réglages) : il réapparaît sans traverser la barre.
  const [last, setLast] = useState(i);
  useEffect(() => {
    if (i >= 0) setLast(i);
  }, [i]);
  const at = i >= 0 ? i : last;
  return (
    <nav className="vt-site-tabs fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)] sm:hidden" aria-label="Rubriques">
      <div className="relative mx-auto grid max-w-md grid-cols-5">
        {/* Trait d’encre : glisse d’un onglet à l’autre (un cinquième de barre par onglet). */}
        <span
          aria-hidden
          className={`pointer-events-none absolute top-0 left-0 w-1/5 px-5 transition-[transform,opacity] duration-[var(--dur-3)] ease-[var(--ease-out)] ${i >= 0 ? "opacity-100" : "opacity-0"}`}
          style={{ transform: `translateX(${Math.max(at, 0) * 100}%)` }}
        >
          <span className="block h-0.5 bg-ink" />
        </span>
        {TABS.map((t) => {
          const on = current === t.href;
          return (
            <Link key={t.href} href={t.href} onClick={pick(t.href)} aria-current={on ? "page" : undefined} className={`relative grid justify-items-center gap-1 pb-2 pt-3 ${on ? "text-ink" : "text-ink-3"}`}>
              {/* Ouvrir une rubrique d’un tap : son icône fait son geste une fois (panier qui se balance, page qui tourne…). */}
              <span key={on ? "on" : "off"} data-g={t.icon} className={`grid place-items-center ${on && moved ? "k-gesture" : ""}`}>
                <Icon name={t.icon} />
              </span>
              <span className="label !tracking-[0.04em]">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
