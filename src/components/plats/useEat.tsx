"use client";

// Manger une portion d’un geste, et pouvoir l’annuler : le toast du kit avec « Annuler » (6 s), un échec
// avec l’icône d’alerte. La page se recharge d’elle-même (actions serveur, revalidatePath).
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button, Icon, Toast, ToastZone } from "@/components/ui";
import { eatAction, undoAction } from "@/app/plats/actions";
import type { Grams } from "@/lib/reserve/core";

export function useEat() {
  const [toast, setToast] = useState<{ text: string; ok: boolean; undo?: string; n: number } | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const say = useCallback((text: string, ok = true, undo?: string) => setToast((t) => ({ text, ok, undo, n: (t?.n ?? 0) + 1 })), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.undo ? 6000 : 3200);
    return () => clearTimeout(id);
  }, [toast]);

  /** `key` : ce qui tourne pendant l’envoi (le bouton du plat). */
  const eat = (key: string, reserveId: string, personId: string, opts: { boxId?: string; grams?: Grams; from?: string } = {}, done?: () => void) => {
    setBusy(key);
    start(async () => {
      const r = await eatAction(reserveId, personId, opts);
      setBusy(null);
      say(r.message, r.ok, r.servingId);
      if (r.ok) done?.();
    });
  };
  const undo = (servingId: string) =>
    start(async () => {
      const r = await undoAction(servingId);
      say(r.message, r.ok);
    });

  const node = toast ? (
    <ToastZone>
      <Toast
        key={toast.n}
        className="max-w-md"
        action={
          toast.undo ? (
            <Button variant="inverse" size="sm" onClick={() => undo(toast.undo!)} data-action="annuler">
              Annuler
            </Button>
          ) : undefined
        }
      >
        <span className="inline-flex items-center gap-2">
          {!toast.ok && <Icon name="alert" className="text-ko" />}
          {toast.text}
        </span>
      </Toast>
    </ToastZone>
  ) : null;
  return { eat, undo, busy: pending ? busy : null, pending, node, say };
}
