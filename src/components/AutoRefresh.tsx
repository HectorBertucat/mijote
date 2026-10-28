"use client";

// Recharge les données serveur quand l'onglet redevient visible, et toutes les 30 s :
// une note ajoutée sur le téléphone apparaît sur l'ordinateur sans recharger la page.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ everyMs = 30_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const id = window.setInterval(refresh, everyMs);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.clearInterval(id);
    };
  }, [router, everyMs]);
  return null;
}
