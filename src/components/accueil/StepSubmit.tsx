"use client";

// Bouton d’envoi de l’action du moment (accueil) : cocotte, grand, en chargement tant que l’action tourne.
import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant } from "@/components/ui";

export function StepSubmit({ children, pendingText, variant = "accent", size = "kitchen" }: { children: React.ReactNode; pendingText: string; variant?: ButtonVariant; size?: "md" | "kitchen" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} state={pending ? "loading" : "idle"} loadingLabel={pendingText}>
      {children}
    </Button>
  );
}
