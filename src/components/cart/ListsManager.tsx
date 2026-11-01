"use client";

// Les listes de /courses, avec un mode « Sélectionner » : archiver (annulable) ou supprimer une ou
// plusieurs listes. Supprimer demande un second tap ; une liste déjà commandée ou cuisinée est
// archivée à la place (src/lib/shopping/archive.ts). Les archivées se rangent en bas, restaurables.
// Une liste = une ligne à filet : date en chiffres serrés, titre, état en un mot (pas de pastille ni de cachet).
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveListsAction, deleteListsAction, restoreListsAction } from "@/app/courses/actions";
import { Button, Check, Icon, type PillTone } from "@/components/ui";
import { SectionHead } from "./Carnet";
import { useToast } from "./Toast";

export interface ListRowData {
  id: string;
  title: string;
  /** Jour de création, court (« 31 oct. »). */
  day?: string;
  sub: string;
  label: string;
  tone: PillTone;
  /** Commandée : le mot prend une coche. */
  ordered?: boolean;
}

export function ListsManager({ lists, archived }: { lists: ListRowData[]; archived: ListRowData[] }) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const [undo, setUndo] = useState<string[] | null>(null);
  const toast = useToast();
  const router = useRouter();

  const ids = [...picked];
  const stop = () => {
    setSelecting(false);
    setPicked(new Set());
    setConfirm(false);
  };
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      toast.show(r.message ?? (r.ok ? "Fait." : "Action impossible."), r.ok);
      if (r.ok) after?.();
      router.refresh();
    });

  const status = (l: ListRowData) => (
    <span className={`inline-flex shrink-0 items-center gap-1 text-small ${l.ordered ? "font-semibold text-ink" : "text-ink-3"}`}>
      {l.ordered && <Icon name="check" size="s" strokeWidth={2.4} />}
      {l.label.charAt(0).toUpperCase() + l.label.slice(1)}
    </span>
  );
  const row = "grid min-w-0 grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-line py-4";
  const text = (l: ListRowData) => (
    <span className="grid min-w-0">
      {/* Deux lignes plutôt qu’un titre coupé au téléphone (« Colombo de porc + … »). */}
      <span className="line-clamp-2 font-semibold">{l.title}</span>
      <span className="text-small text-ink-2">{l.sub}</span>
    </span>
  );

  return (
    <section className="grid gap-6" aria-labelledby="listes-titre">
      <SectionHead
        id="listes-titre"
        title="Listes"
        count={lists.length || undefined}
        action={
          lists.length > 0 &&
          (selecting ? (
            <Button variant="quiet" size="sm" onClick={stop}>
              Annuler
            </Button>
          ) : (
            <Button variant="quiet" size="sm" icon="check" onClick={() => setSelecting(true)}>
              Sélectionner
            </Button>
          ))
        }
      />

      {lists.length === 0 ? (
        <p className="text-small text-ink-2">Toutes les listes sont archivées.</p>
      ) : (
        <ul className="-mt-6">
          {lists.map((l) =>
            selecting ? (
              <li key={l.id} className={`${row} !items-center !py-1 transition-colors duration-[var(--dur-1)] ${picked.has(l.id) ? "bg-accent-soft" : ""}`}>
                <span className="num-tight text-h3 text-ink-2">{l.day}</span>
                <Check checked={picked.has(l.id)} onChange={(e) => toggle(l.id, e.target.checked)} strike={false} className="min-w-0" aria-label={`Sélectionner ${l.title}`}>
                  {text(l)}
                </Check>
                {status(l)}
              </li>
            ) : (
              <li key={l.id} className="border-b border-line">
                <Link href={`/courses/${l.id}`} className={`${row} group -mx-3 grid-cols-[72px_minmax(0,1fr)_auto_auto] rounded-[8px] !border-b-0 px-3 hover:bg-surface-2`}>
                  <span className="num-tight text-h3">{l.day}</span>
                  {text(l)}
                  {status(l)}
                  <Icon name="chev" size="s" className="self-center text-ink-3 transition-transform duration-[var(--dur-1)] ease-[var(--ease-out)] group-hover:translate-x-1 group-hover:text-ink" />
                </Link>
              </li>
            )
          )}
        </ul>
      )}

      {selecting && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-raised px-4 py-3 shadow-float sm:bottom-4">
          <span className="num mr-auto text-small text-ink-2">{ids.length === 0 ? "Touche les listes à ranger" : `${ids.length} sélectionnée${ids.length > 1 ? "s" : ""}`}</span>
          <Button
            size="sm"
            icon="archive"
            disabled={!ids.length || pending}
            onClick={() =>
              run(
                () => archiveListsAction(ids),
                () => {
                  setUndo(ids);
                  stop();
                }
              )
            }
          >
            Archiver
          </Button>
          <Button
            size="sm"
            variant={confirm ? "danger-solid" : "danger"}
            icon="trash"
            disabled={!ids.length || pending}
            onClick={() => {
              if (!confirm) {
                setConfirm(true);
                setTimeout(() => setConfirm(false), 4000);
                return;
              }
              run(() => deleteListsAction(ids), stop);
            }}
          >
            {confirm ? "Confirmer" : "Supprimer"}
          </Button>
        </div>
      )}

      {undo && !selecting && (
        <div className="flex items-center gap-2 text-small text-ink-2">
          <Icon name="archive" size="s" />
          {undo.length > 1 ? `${undo.length} listes archivées` : "Liste archivée"}
          <Button variant="quiet" size="sm" onClick={() => run(() => restoreListsAction(undo), () => setUndo(null))}>
            Annuler
          </Button>
        </div>
      )}

      {archived.length > 0 && (
        <details className="group">
          <summary className="label flex min-h-tap cursor-pointer list-none items-center gap-2 text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <Icon name="chev" size="s" className="transition-transform duration-[var(--dur-1)] ease-[var(--ease-out)] group-open:rotate-90" />
            Archivées · <span className="num">{archived.length}</span>
          </summary>
          <ul className="mt-2 border-t border-line">
            {archived.map((l) => (
              <li key={l.id} className={`${row} !items-center !py-2`}>
                <span className="num-tight text-h3 text-ink-3">{l.day}</span>
                <Link href={`/courses/${l.id}`} className="min-w-0 text-ink-2 hover:text-ink">
                  {text(l)}
                </Link>
                <Button variant="quiet" size="sm" icon="refresh" disabled={pending} onClick={() => run(() => restoreListsAction([l.id]))}>
                  Restaurer
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {toast.node}
    </section>
  );
}
