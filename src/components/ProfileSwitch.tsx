"use client";

// Sélecteur de profil (une personne du foyer) de la barre du haut : un cookie par appareil, lu par les pages
// serveur (src/lib/health/active.ts). Sur téléphone, les initiales seulement.
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveProfile } from "@/app/sante/actions";
import { Segmented } from "./ui/segmented";

export type ProfileOption = { id: string; name: string };

export function ProfileSwitch({ profiles, active, className = "" }: { profiles: ProfileOption[]; active: string; className?: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [current, setCurrent] = useOptimistic(active);
  if (profiles.length < 2) return null;
  return (
    <Segmented<string>
      label="Profil"
      className={className}
      value={current}
      onChange={(id) =>
        start(async () => {
          setCurrent(id);
          await setActiveProfile(id);
          router.refresh();
        })
      }
      options={profiles.map((p) => ({
        value: p.id,
        ariaLabel: `Profil : ${p.name}`,
        label: (
          <>
            <span className="sm:hidden">{p.name.slice(0, 1)}</span>
            <span className="hidden sm:inline">{p.name}</span>
          </>
        ),
      }))}
    />
  );
}
