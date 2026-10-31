"use client";

// Bouton d’envoi de formulaire serveur : Button du kit en chargement tant que l’action tourne (useFormStatus).
// solid = primary ; soft = secondaire bleu pâle (action d’appoint à côté d’une principale).
import { useFormStatus } from "react-dom";
import { Button, type ButtonSize } from "./ui/button";
import type { IconName } from "./ui/icon";

export function SubmitButton({ children, pendingText, variant = "solid", size, icon }: { children: React.ReactNode; pendingText: string; variant?: "solid" | "soft"; size?: ButtonSize; icon?: IconName }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant === "soft" ? "secondary" : "primary"}
      size={size}
      icon={icon}
      state={pending ? "loading" : "idle"}
      loadingLabel={pendingText}
      className={variant === "soft" ? "!border-[color-mix(in_srgb,var(--c-accent)_30%,transparent)] !bg-accent-soft !text-accent" : ""}
    >
      {children}
    </Button>
  );
}
