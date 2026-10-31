"use client";

// Visite guidée (src/lib/tour/core.ts) : une bulle par étape, posée à côté du vrai élément de l’interface qu’elle
// montre (attribut data-tour : onglets, recherche, profil, premiers pas), le reste de la page voilé ; une étape sans
// élément affiché s’ouvre au centre (feuille du bas sur téléphone), avec ses dessins. Toujours passable : « Passer »,
// Échap ; flèches gauche et droite ; focus gardé dans la bulle, rendu à la fermeture.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { DishBox } from "@/components/ui/dish";
import { FoodIllu, StepIllu } from "@/components/illus/Illu";
import { Ticks } from "@/components/reglages/parts";
import { stepAfter, tourSteps, type TourArt, type TourContext, type TourStep } from "@/lib/tour/core";
import { typo } from "@/lib/typo";
import { tourSeenAction } from "@/app/reglages/actions";
import "./tour.css";

const PAD = 6;
const GAP = 12;
const CARD_W = 360;

/** Le premier élément affiché qui porte data-tour=<name> (l’onglet du haut au bureau, celui du bas au téléphone). */
function anchorOf(name?: string): HTMLElement | null {
  if (!name) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function Art({ art, big }: { art: TourArt; big: boolean }) {
  if (art.kind === "dish") return <DishBox recipe={art.recipe} size={big ? "md" : "sm"} steam={big} live={big} />;
  if (art.kind === "food") return <FoodIllu id={art.id} size={big ? "l" : "m"} live={big} />;
  return <StepIllu id={art.id} size={big ? "l" : "m"} live={big} label="" />;
}

/** `start` : la visite s’ouvre d’elle-même (première fois, ou ?visite=1 depuis Réglages). */
export function Tour({ start, catalog, profiles }: { start: boolean } & Omit<TourContext, "desktop">) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [at, setAt] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [cardH, setCardH] = useState(0);
  const titleId = useId();
  const bodyId = useId();
  const card = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const before = useRef<HTMLElement | null>(null);

  // Ouverture après l’hydratation (l’écran décide de la recherche ⌘K), et après l’écran de lancement s’il passe.
  useEffect(() => {
    if (!start) return;
    const wait = document.documentElement.hasAttribute("data-launch") ? 620 : 0;
    const t = setTimeout(() => {
      before.current = document.activeElement as HTMLElement | null;
      setAt(0);
      setSteps(tourSteps({ catalog, profiles, desktop: matchMedia("(min-width: 1024px)").matches }));
    }, wait);
    return () => clearTimeout(t);
  }, [start, catalog, profiles]);

  const step = steps?.[at];
  const close = useCallback(() => {
    setSteps(null);
    void tourSeenAction();
    before.current?.focus?.();
    if (params.has("visite")) router.replace(path, { scroll: false });
  }, [params, path, router]);
  const go = useCallback(
    (dir: 1 | -1) => {
      if (!steps) return;
      const next = stepAfter(at, steps.length, dir);
      if (next == null) close();
      else setAt(next);
    },
    [at, steps, close]
  );

  // L’élément montré : ramené à l’écran s’il le faut, mesuré, suivi au défilement et au redimensionnement.
  useLayoutEffect(() => {
    if (!step) return;
    const el = anchorOf(step.anchor);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 64 || r.bottom > innerHeight - 80) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setView({ w: innerWidth, h: innerHeight });
        setRect(anchorOf(step.anchor)?.getBoundingClientRect() ?? null);
      });
    };
    measure();
    addEventListener("resize", measure);
    addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", measure);
      removeEventListener("scroll", measure);
    };
  }, [step]);

  // Hauteur de la bulle, pour la poser du côté où elle tient (mesurée avant d’être peinte).
  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [step, rect?.width, view.w]);

  // Chaque étape est lue dès qu’elle s’ouvre : le focus va sur son titre.
  useEffect(() => {
    if (step) title.current?.focus({ preventScroll: true });
  }, [step]);

  useEffect(() => {
    if (!steps) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "Tab" && card.current) {
        const all = [...card.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")];
        if (!all.length) return;
        const first = all[0];
        const last = all[all.length - 1];
        const inside = card.current.contains(document.activeElement);
        if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === title.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [steps, go, close]);

  if (!steps || !step) return null;
  const anchored = rect != null;
  const phone = view.w < 640;
  const last = at === steps.length - 1;

  // Le cadre reste dans l’écran (l’onglet du bas touche le bord).
  const spotTop = rect ? Math.max(2, rect.top - PAD) : view.h / 2;
  const spot: CSSProperties = rect
    ? { top: spotTop, left: Math.max(2, rect.left - PAD), width: Math.min(view.w - 4, rect.width + PAD * 2), height: Math.min(view.h - 2, rect.bottom + PAD) - spotTop }
    : { top: view.h / 2, left: view.w / 2, width: 0, height: 0 };
  let place: CSSProperties = {};
  if (rect) {
    // Sous l’élément s’il y a la place (ou plus de place qu’au-dessus), sinon au-dessus ; jamais hors de l’écran.
    const above = rect.top - PAD - GAP - 16;
    const below = view.h - rect.bottom - PAD - GAP - 16;
    const raw = below >= cardH || below >= above ? rect.bottom + PAD + GAP : rect.top - PAD - GAP - cardH;
    const top = Math.max(16, Math.min(raw, view.h - cardH - 16));
    place = phone ? { top, left: 16, right: 16 } : { top, width: CARD_W, left: Math.min(Math.max(16, rect.left + rect.width / 2 - CARD_W / 2), view.w - CARD_W - 16) };
  }

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden className="k-tour-spot" data-on={anchored ? "" : undefined} style={spot} />
      <div
        key={step.id}
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={place}
        className={`k-tour-card fixed grid max-h-[calc(100dvh-32px)] gap-4 overflow-y-auto border border-line bg-raised p-6 shadow-float ${
          anchored ? "rounded-[14px]" : "inset-x-0 bottom-0 rounded-t-[14px] pb-[calc(24px+env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[14px] sm:p-8"
        }`}
      >
        {step.art.length > 0 && (
          <div aria-hidden className={`flex items-end gap-3 ${anchored ? "" : "justify-center py-2"}`}>
            {step.art.map((a, i) => (
              <Art key={i} art={a} big={!anchored && step.art.length < 3} />
            ))}
          </div>
        )}
        <div className="grid gap-2">
          <p className="label num text-faint">
            Visite · {at + 1} sur {steps.length}
          </p>
          <h2 id={titleId} ref={title} tabIndex={-1} className={`${anchored ? "text-h3" : "text-h2"} outline-none text-balance`}>
            {typo(step.title)}
          </h2>
          <p id={bodyId} className="text-body text-ink-2 text-pretty">
            {typo(step.body)}
          </p>
        </div>
        <Ticks total={steps.length} at={at} label="Avancement de la visite" />
        <div className="flex flex-wrap items-center gap-2">
          {!last && (
            <Button variant="quiet" size="md" onClick={close} className="-ml-3">
              Passer
            </Button>
          )}
          <span className="ml-auto flex gap-2">
            {at > 0 && (
              <Button variant="secondary" size="md" onClick={() => go(-1)}>
                Retour
              </Button>
            )}
            <Button variant="primary" size="md" onClick={() => go(1)}>
              {last ? "Commencer" : "Suivant"}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
