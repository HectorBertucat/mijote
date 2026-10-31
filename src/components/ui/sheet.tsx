"use client";

// Sheet : panneau à droite sur ordinateur (420 px), feuille du bas avec poignée sur téléphone. Fond voilé, Échap ferme,
// défilement de la page bloqué pendant l’ouverture. Composant client.
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { Button } from "./button";

/** Panneau. `open` + `onClose` ; `title` en tête avec un bouton fermer, `headerAction` juste avant ; `footer` collé en bas (actions) ; `scrim={false}` laisse voir la page sans voile (fiche qui se remodèle à gauche).
 * `modal={false}` : ni voile, ni page bloquée, ni aria-modal — la page reste lisible et défilable à côté (panneau « Ajuster » sur ordinateur). */
export function Sheet({ open, onClose, title, children, footer, headerAction, scrim = true, modal = true, width = 420, className = "" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; headerAction?: ReactNode; scrim?: boolean; modal?: boolean; width?: number; className?: string }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  // onClose en ref : un onClose en ligne (nouvelle identité à chaque rendu) ne doit pas relancer l’effet ni voler le focus.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    if (modal) document.body.style.overflow = "hidden";
    panel.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      if (modal) document.body.style.overflow = overflow;
      if (modal) prev?.focus?.();
    };
  }, [open, modal]);
  if (!open) return null;
  const veil = modal && scrim;
  return (
    <div className={`fixed inset-0 z-50 ${!modal ? "pointer-events-none" : scrim ? "" : "sm:pointer-events-none"}`}>
      {modal && <div className={`absolute inset-0 ${veil ? "animate-[k-fade_var(--dur-base)_var(--ease-out)] bg-scrim" : "sm:pointer-events-none"}`} onClick={onClose} aria-hidden />}
      <div
        ref={panel}
        role="dialog"
        aria-modal={modal}
        aria-labelledby={id}
        tabIndex={-1}
        style={{ "--sheet-w": `${width}px` } as CSSProperties}
        className={`pointer-events-auto absolute inset-x-0 bottom-0 flex max-h-[88dvh] animate-sheet-up flex-col gap-3.5 rounded-t-[14px] border border-line bg-raised px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-3 shadow-float outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[var(--sheet-w)] sm:max-w-full sm:animate-sheet-right sm:rounded-l-[14px] sm:rounded-tr-none sm:pt-6 ${className}`}
      >
        <span aria-hidden className="mx-auto -mt-0.5 h-[5px] w-10 shrink-0 rounded-[3px] bg-line-strong sm:hidden" />
        <div className="flex items-center justify-between gap-3">
          <h2 id={id} className="min-w-0 flex-1 text-h2">
            {title}
          </h2>
          {headerAction}
          <Button variant="quiet" size="sm" iconOnly icon="x" aria-label="Fermer" onClick={onClose} />
        </div>
        <div className="-mx-5 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5">{children}</div>
        {footer && <div className="shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
