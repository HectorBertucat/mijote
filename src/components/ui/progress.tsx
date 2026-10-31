"use client";

// Progression d’un long travail dont on connaît la durée habituelle (appel IA) : `calibrated` donne la part
// attendue (monte vite, ralentit, ≈ 78 % à la durée attendue, jamais 100 % avant la fin réelle) et
// `useElapsed` fait tourner l’horloge. À poser dans StepProgress. Composant client.
import { useEffect, useState } from "react";

/** Part attendue (0 à `cap`) après `elapsedMs` d’un travail qui prend d’habitude `expectedMs`. */
export function calibrated(elapsedMs: number, expectedMs: number, cap = 0.95): number {
  const t = Math.max(0, elapsedMs) / Math.max(1, expectedMs);
  return cap * (1 - Math.exp(-1.7 * t));
}

/** Millisecondes écoulées depuis `startedAt` (epoch ms), rafraîchies 5 fois par seconde ; 0 si `null`. */
export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt == null ? 0 : Math.max(0, now - startedAt);
}
