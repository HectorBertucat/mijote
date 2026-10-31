"use client";

// Petit message au-dessus de la barre d’onglets : le retour visible de chaque action (Toast du kit, bulle d’encre).
// Même API qu’avant ({ show, node }) ; un échec porte l’icône d’alerte.
import { useCallback, useEffect, useState } from "react";
import { Icon, Toast } from "@/components/ui";

export function useToast() {
  const [toast, setToast] = useState<{ text: string; ok: boolean; n: number } | null>(null);
  const show = useCallback((text: string, ok = true) => setToast((t) => ({ text, ok, n: (t?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  const node = toast ? (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-40 flex justify-center sm:bottom-24">
      <Toast key={toast.n} className="pointer-events-auto max-w-md">
        <span className="inline-flex items-center gap-2">
          {!toast.ok && <Icon name="alert" className="text-ko" />}
          {toast.text}
        </span>
      </Toast>
    </div>
  ) : null;
  return { show, node };
}
