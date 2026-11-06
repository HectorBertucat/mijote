"use client";

// Les deux gestes de « Où j'en suis » : passer le repère d'un repas en automatique (ou le figer), et
// passer les protéines en g/kg. Le code vérifie et enregistre (src/app/sante/actions.ts).
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/cart/Toast";
import { setProteinPerKg, setRefMode } from "@/app/sante/actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { show, node } = useToast();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await fn();
      show(r.message, r.ok);
      if (r.ok) router.refresh();
    });
  return { pending, run, node };
}

export function RefModeSwitch({ personId, auto }: { personId: string; auto: boolean }) {
  const { pending, run, node } = useRun();
  return (
    <>
      {auto ? (
        <Button variant="quiet" size="sm" className="justify-self-start" disabled={pending} onClick={() => run(() => setRefMode(personId, false))}>
          Figer ce repère
        </Button>
      ) : (
        <Button variant="primary" size="sm" icon="check" state={pending ? "loading" : "idle"} loadingLabel="…" onClick={() => run(() => setRefMode(personId, true))}>
          Passer en automatique
        </Button>
      )}
      {node}
    </>
  );
}

export function ProteinSwitch({ personId, perKg }: { personId: string; perKg: number }) {
  const { pending, run, node } = useRun();
  return (
    <>
      <Button size="sm" state={pending ? "loading" : "idle"} loadingLabel="…" onClick={() => run(() => setProteinPerKg(personId, perKg))}>
        {`Passer à ${perKg.toFixed(1).replace(".", ",")} g/kg`}
      </Button>
      {node}
    </>
  );
}
