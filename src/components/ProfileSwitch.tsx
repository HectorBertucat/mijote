"use client";

// Sélecteur de profil (une personne du foyer) de la barre du haut : un cookie par appareil, lu par les pages
// serveur (src/lib/health/active.ts). DA v3 : les initiales en capitales serrées, comme les rubriques de l’en-tête ;
// le profil ouvert est en encre et souligné, les autres en gris ; le prénom entier au survol et pour les lecteurs d’écran.
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveProfile } from "@/app/sante/actions";

export type ProfileOption = { id: string; name: string };

/** Initiale de chacun ; deux lettres quand deux prénoms commencent pareil. */
export function profileInitials(profiles: ProfileOption[]): Map<string, string> {
  const first = (n: string) => n.trim().slice(0, 1).toLocaleUpperCase("fr-FR");
  const two = (n: string) => {
    const t = n.trim();
    return t.slice(0, 1).toLocaleUpperCase("fr-FR") + t.slice(1, 2).toLocaleLowerCase("fr-FR");
  };
  const count = new Map<string, number>();
  for (const p of profiles) count.set(first(p.name), (count.get(first(p.name)) ?? 0) + 1);
  return new Map(profiles.map((p) => [p.id, (count.get(first(p.name)) ?? 0) > 1 ? two(p.name) : first(p.name)]));
}

export function ProfileSwitch({ profiles, active, className = "" }: { profiles: ProfileOption[]; active: string; className?: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [current, setCurrent] = useOptimistic(active);
  if (profiles.length < 2) return null;
  const initials = profileInitials(profiles);
  return (
    <div role="group" aria-label="Profil" data-tour="profil" className={`flex items-stretch ${className}`}>
      {profiles.map((p) => {
        const on = p.id === current;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            aria-label={`Profil : ${p.name}`}
            title={p.name}
            onClick={() => {
              if (on) return;
              start(async () => {
                setCurrent(p.id);
                await setActiveProfile(p.id);
                router.refresh();
              });
            }}
            className={`group relative grid h-tap min-w-9 place-items-center rounded-[4px] px-2 font-display text-[15px] font-bold tracking-[0.02em] [font-stretch:75%] ${on ? "text-ink" : "text-faint hover:text-ink"}`}
          >
            {initials.get(p.id)}
            <span aria-hidden className={`absolute inset-x-2 bottom-2 h-0.5 bg-ink transition-transform duration-[var(--dur-2)] ease-[var(--ease-out)] ${on ? "scale-x-100" : "scale-x-0 group-hover:scale-x-50 group-hover:bg-faint"}`} />
          </button>
        );
      })}
    </div>
  );
}
