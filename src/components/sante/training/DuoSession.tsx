"use client";

// Séance à deux sur un seul écran (le MacBook) : chacun sa séance, côte à côte, avec son programme,
// son horloge et ses repos ; chacun la pilote depuis son téléphone (QR en haut de sa moitié). Les deux
// ne finissent pas en même temps : celle qui est finie se replie en colonne étroite, l'autre prend la
// place, et on sort quand les deux sont terminées.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/ui";
import type { Program, Workout } from "@/lib/training/program";
import { LiveSession } from "./LiveSession";
import type { LiveRowClient } from "./useLiveSync";

export interface DuoPane {
  row: LiveRowClient;
  program: Program;
  workouts: Workout[];
  name: string;
}

export function DuoSession({ panes, onEnd }: { panes: DuoPane[]; onEnd: () => void }) {
  const [done, setDone] = useState<string[]>([]);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    if (panes.every((x) => done.includes(x.row.id))) endRef.current();
  }, [done, panes]);
  const cols = panes.map((x) => (done.includes(x.row.id) ? "220px" : "minmax(0,1fr)")).join(" ");
  return (
    <div style={{ "--duo": cols } as CSSProperties} className="kitchen-dark fixed inset-0 z-30 grid auto-rows-[100%] grid-cols-[minmax(0,1fr)] overflow-y-auto bg-bg text-ink md:grid-cols-[var(--duo)] md:overflow-hidden">
      {panes.map((x, k) => (
        <div key={x.row.id} className={`min-h-0 min-w-0 ${k > 0 ? "border-t border-line md:border-t-0 md:border-l" : ""}`}>
          {done.includes(x.row.id) ? (
            <div className="grid h-full content-center justify-items-center gap-2 p-6 text-center">
              <Icon name="check" size={28} className="text-ok" />
              <b className="text-[17px]">{x.name} a fini</b>
              <span className="text-[14px] text-ink-2">Séance enregistrée ou arrêtée.</span>
            </div>
          ) : (
            <LiveSession program={x.program} initial={x.row} workouts={x.workouts} view="ecran" pane={{ name: x.name }} onEnd={() => setDone((d) => (d.includes(x.row.id) ? d : [...d, x.row.id]))} />
          )}
        </div>
      ))}
    </div>
  );
}
