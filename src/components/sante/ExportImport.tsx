"use client";

// Import de l'historique d'Apple Santé : le fichier est lu ici, dans le navigateur (il peut peser des
// centaines de Mo) ; seules les pesées, les séances et les pas par jour partent vers l'appli, par paquets.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Progress } from "@/components/ui";
import { importExportBatch } from "@/app/sante/actions";
import { dailySteps, readExport, type ExportSteps, type ExportWeight, type ExportWorkout } from "@/lib/health/apple-export";

interface Counts {
  weights: number;
  workouts: number;
  days: number;
}
const ZERO: Counts = { weights: 0, workouts: 0, days: 0 };

function chunks<T>(xs: T[], n: number) {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function ExportImport({ personId, personName }: { personId: string; personName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ phase: "idle" | "read" | "done" | "error"; read: number; found: Counts; added: Counts; message?: string }>({ phase: "idle", read: 0, found: ZERO, added: ZERO });

  const run = async (file: File) => {
    setState({ phase: "read", read: 0, found: ZERO, added: ZERO });
    let buffer: ExportWeight[] = [];
    const workouts: ExportWorkout[] = [];
    const steps: ExportSteps[] = [];
    const found = { ...ZERO };
    const added = { ...ZERO };
    const send = async (batch: Parameters<typeof importExportBatch>[1]) => {
      const r = await importExportBatch(personId, batch);
      if (!r.ok) throw new Error(r.message);
      added.weights += r.weights;
      added.workouts += r.workouts;
      added.days += r.steps;
    };
    const flush = async () => {
      const batch = buffer;
      buffer = [];
      if (batch.length) await send({ weights: batch });
    };
    try {
      const sends: Promise<void>[] = [];
      await readExport(
        file,
        (f) => {
          found.weights += f.weights.length;
          found.workouts += f.workouts.length;
          buffer.push(...f.weights);
          workouts.push(...f.workouts);
          steps.push(...f.steps);
          if (buffer.length >= 500) sends.push(flush());
        },
        (r) => setState((s) => ({ ...s, read: r, found: { ...found } }))
      );
      await Promise.all(sends);
      await flush();
      const days = dailySteps(steps);
      found.days = days.length;
      for (const w of chunks(workouts, 300)) await send({ workouts: w });
      for (const d of chunks(days, 500)) await send({ steps: d });
      setState({ phase: "done", read: 1, found, added });
      router.refresh();
    } catch (e) {
      setState((s) => ({ ...s, phase: "error", message: e instanceof Error ? e.message : "Lecture impossible." }));
    }
  };

  const { found, added } = state;
  return (
    <div className="grid gap-3">
      <input
        ref={input}
        type="file"
        accept=".zip,.xml,application/zip,text/xml"
        className="sr-only"
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) run(f);
          e.currentTarget.value = "";
        }}
      />
      <div>
        <Button icon="plus" variant="primary" state={state.phase === "read" ? "loading" : "idle"} loadingLabel="Lecture…" onClick={() => input.current?.click()}>
          Choisir export.zip
        </Button>
      </div>
      {state.phase === "read" && (
        <div className="grid gap-1.5">
          <Progress value={state.read} active label="Lecture de l'export" />
          <span className="num text-[13px] text-ink-2">
            {found.weights} pesées, {found.workouts} séances trouvées · {Math.round(state.read * 100)} %
          </span>
        </div>
      )}
      {state.phase === "done" && (
        <p className="text-[14px]">
          Pour {personName} : <b>{added.weights}</b> nouvelles pesées sur {found.weights}, <b>{added.workouts}</b> nouvelles séances sur {found.workouts}, et les pas de <b>{found.days}</b> jours. Le reste était déjà là.
        </p>
      )}
      {state.phase === "error" && <p className="text-[14px] text-ko-ink">{state.message}</p>}
    </div>
  );
}
