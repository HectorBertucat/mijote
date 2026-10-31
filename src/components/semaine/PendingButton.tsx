"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant, type IconName } from "@/components/ui";

/** Bouton d’envoi de formulaire serveur (Button du kit) : roue de chargement pendant l’envoi (Semaine, paquets entamés). */
export function PendingButton({ children, variant = "secondary", size = "sm", icon, iconOnly, label, title, loadingLabel, className = "" }: { children?: React.ReactNode; variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; iconOnly?: boolean; label?: string; title?: string; loadingLabel?: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} icon={icon} iconOnly={iconOnly} state={pending ? "loading" : "idle"} loadingLabel={loadingLabel} aria-label={label} title={title} className={className}>
      {children}
    </Button>
  );
}
