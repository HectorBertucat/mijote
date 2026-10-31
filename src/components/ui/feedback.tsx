// Retours : Alert (info, warn, ko, ok, leaf pour l’anti-gaspillage), Toast (fond d’encre, action), Progress (barre), LoadList (vérification ligne par ligne), StepProgress (long chargement par étapes), EmptyState. Sans état.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import { Scene, type SceneName } from "./scenes";

export type AlertTone = "info" | "warn" | "ko" | "ok" | "leaf";
const ALERT: Record<AlertTone, { box: string; icon: IconName; ic: string }> = {
  info: { box: "bg-accent-soft text-ink border-transparent", icon: "info", ic: "text-accent" },
  warn: { box: "bg-warn-soft text-warn-ink border-transparent", icon: "alert", ic: "" },
  ko: { box: "bg-ko-soft text-ko-ink border-transparent", icon: "x", ic: "" },
  ok: { box: "bg-ok-soft text-ok-ink border-transparent", icon: "check", ic: "" },
  leaf: { box: "bg-surface-2 text-ink border-dashed border-line-strong", icon: "leaf", ic: "text-ink-2" },
};

/** Bandeau. `title` en gras, `children` en dessous ; `action` à droite (p. ex. un Button sm) ; `icon` remplace l’icône du ton. */
export function Alert({ tone = "info", title, children, action, icon, className = "", role }: { tone?: AlertTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; icon?: IconName; className?: string; role?: "status" | "alert" }) {
  const t = ALERT[tone];
  return (
    <div role={role} className={`flex items-start gap-3 rounded-[12px] border px-3.5 py-3 text-[15px] ${t.box} ${className}`}>
      <Icon name={icon ?? t.icon} className={`mt-0.5 ${t.ic}`} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        {title && <b className="font-bold">{title}</b>}
        {children && <span>{children}</span>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/** Toast : bulle d’encre qui monte avec un léger rebond, `action` (Button variant="inverse" size="sm", p. ex. « Annuler »). À poser dans une zone fixe (ToastZone). */
export function Toast({ children, action, className = "" }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role="status" className={`inline-flex animate-toast-in items-center gap-3 rounded-[12px] bg-inverse py-2.5 pl-4 pr-2.5 text-[15px] text-on-inverse shadow-e3 ${action ? "" : "pr-4"} ${className}`}>
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  );
}

/** Zone fixe des toasts : en bas au centre, au-dessus de la barre d’onglets sur téléphone. */
export function ToastZone({ children }: { children?: ReactNode }) {
  return <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-center gap-2 px-4 sm:bottom-6 [&>*]:pointer-events-auto">{children}</div>;
}

/** Barre de progression (0 à 1), accent. `active` : un reflet glisse sur la partie remplie tant que ça travaille (immobile en mouvement réduit). */
export function Progress({ value, label, active = false, className = "" }: { value: number; label?: string; active?: boolean; className?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} className={`h-1.5 overflow-hidden rounded-full bg-surface-2 ${className}`}>
      <i className={`block h-full rounded-full bg-accent transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out)] ${active ? "k-sheen" : ""}`} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export type LoadItem = { label: ReactNode; state: "idle" | "on" | "done"; trail?: ReactNode };

/** Liste qui dit ce qu’elle vérifie : en attente (gris), en cours (roue d’accent), fait (rond plein). `trail` à droite (prix, pastille). */
export function LoadList({ items, className = "" }: { items: LoadItem[]; className?: string }) {
  return (
    <div className={`grid gap-2 text-[14px] ${className}`} aria-live="polite">
      {items.map((it, i) => (
        <div key={i} className={`flex items-center gap-2.5 transition-colors duration-[var(--dur-quick)] ${it.state === "on" ? "text-ink" : it.state === "done" ? "text-ink-2" : "text-faint"}`}>
          <span className={`grid size-4 shrink-0 place-items-center rounded-full border-2 ${it.state === "on" ? "k-mk-on" : it.state === "done" ? "border-accent bg-accent text-on-accent" : "border-line-strong"}`}>
            {it.state === "done" && <Icon name="check" size={10} strokeWidth={3.5} />}
          </span>
          <span className="min-w-0 flex-1">{it.label}</span>
          {it.trail}
        </div>
      ))}
    </div>
  );
}

/** Vérification en direct : titre, compteur « 7/14 vérifiés », barre, puis la LoadList. */
export function VerifyPanel({ title, done, total, items, className = "" }: { title: ReactNode; done: number; total: number; items: LoadItem[]; className?: string }) {
  return (
    <div className={`grid gap-2 rounded-[14px] border border-line bg-surface px-3.5 py-3 ${className}`}>
      <div className="flex items-center justify-between gap-2.5 text-[14px]">
        <b>{title}</b>
        <span className="num">
          {done}/{total} vérifiés
        </span>
      </div>
      <Progress value={total ? done / total : 0} label="Avancement" />
      <LoadList items={items} />
    </div>
  );
}

/**
 * Long chargement (appel IA) : titre, temps restant à droite, barre calée sur la durée attendue (reflet tant que ça
 * travaille), puis les étapes réelles en LoadList. Sans état : la valeur et les étapes viennent de l’appelant
 * (useCalibratedProgress dans "./progress").
 */
export function StepProgress({ title, value, items, aside, running = true, className = "" }: { title: ReactNode; value: number; items: LoadItem[]; aside?: ReactNode; running?: boolean; className?: string }) {
  return (
    <div role="status" className={`grid gap-2.5 rounded-[14px] border border-line bg-surface px-3.5 py-3 ${className}`}>
      <div className="flex items-baseline justify-between gap-2.5 text-[14px]">
        <b>{title}</b>
        {aside && <span className="num shrink-0 text-[13px] text-ink-2">{aside}</span>}
      </div>
      <Progress value={value} active={running} label="Avancement" />
      <LoadList items={items} />
    </div>
  );
}

/** État vide : une scène dessinée (`scene` : frigo, panier, cocotte) ou un rond gris avec une icône, titre, phrase, action. */
export function EmptyState({ icon = "book", scene, title, children, action, className = "" }: { icon?: IconName; scene?: SceneName; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`grid justify-items-center gap-2.5 px-4 py-7 text-center ${className}`}>
      {scene ? (
        <Scene name={scene} />
      ) : (
        <span className="grid size-[72px] place-items-center rounded-full bg-surface-2 text-faint">
          <Icon name={icon} size="l" />
        </span>
      )}
      <b>{title}</b>
      {children && <p className="max-w-[34ch] text-[15px] text-ink-2">{children}</p>}
      {action}
    </div>
  );
}
