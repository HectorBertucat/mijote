"use client";

// Les listes de /courses, avec un mode « Sélectionner » : archiver (annulable) ou supprimer une ou
// plusieurs listes. Supprimer demande un second tap ; une liste déjà commandée ou cuisinée est
// archivée à la place (src/lib/shopping/archive.ts). Les archivées se rangent en bas, restaurables.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveListsAction, deleteListsAction, restoreListsAction } from "@/app/courses/actions";
import { Button, Check, Icon, List, ListRow, Pill, StampCommande, type PillTone } from "@/components/ui";
import { useToast } from "./Toast";

export interface ListRowData {
  id: string;
  title: string;
  sub: string;
  label: string;
  tone: PillTone;
  /** Commandée : le cachet « Commandé » remplace la pastille. */
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

  return (
    <section className="grid gap-2.5" aria-labelledby="listes-titre">
      <div className="flex min-h-[36px] items-center justify-between gap-2">
        <h2 id="listes-titre" className="text-[18px] font-bold">
          Listes
        </h2>
        {lists.length > 0 &&
          (selecting ? (
            <Button variant="quiet" size="sm" onClick={stop}>
              Annuler
            </Button>
          ) : (
            <Button variant="quiet" size="sm" icon="check" onClick={() => setSelecting(true)}>
              Sélectionner
            </Button>
          ))}
      </div>

      {lists.length === 0 ? (
        <p className="text-[14px] text-ink-2">Toutes les listes sont archivées.</p>
      ) : (
        <List>
          {lists.map((l) =>
            selecting ? (
              <div key={l.id} className={`flex min-w-0 items-center gap-3 border-b border-line px-3.5 py-1.5 ${picked.has(l.id) ? "bg-accent-soft" : ""}`}>
                <Check checked={picked.has(l.id)} onChange={(e) => toggle(l.id, e.target.checked)} strike={false} className="min-w-0 flex-1" aria-label={`Sélectionner ${l.title}`}>
                  <span className="grid min-w-0">
                    <span className="truncate font-semibold">{l.title}</span>
                    <span className="truncate text-[14px] text-ink-2">{l.sub}</span>
                  </span>
                </Check>
                <Pill tone={l.tone} icon={l.tone === "idle" ? "sparkdraft" : undefined}>{l.label}</Pill>
              </div>
            ) : (
              <ListRow
                key={l.id}
                href={`/courses/${l.id}`}
                lead={<Icon name="basket" className="shrink-0 text-ink-2" />}
                title={l.title}
                sub={l.sub}
                trail={
                  l.ordered ? (
                    <StampCommande seed={l.id} size={84} title={l.label} />
                  ) : (
                    <Pill tone={l.tone} icon={l.tone === "idle" ? "sparkdraft" : undefined}>
                      {l.label}
                    </Pill>
                  )
                }
              />
            )
          )}
        </List>
      )}

      {selecting && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-2 rounded-[14px] border border-line bg-surface px-3.5 py-2.5 shadow-e3 sm:bottom-4">
          <span className="num mr-auto text-[14px] text-ink-2">{ids.length === 0 ? "Touche les listes à ranger" : `${ids.length} sélectionnée${ids.length > 1 ? "s" : ""}`}</span>
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
        <div className="flex items-center gap-2 text-[14px] text-ink-2">
          <Icon name="archive" size="s" />
          {undo.length > 1 ? `${undo.length} listes archivées` : "Liste archivée"}
          <Button variant="quiet" size="sm" onClick={() => run(() => restoreListsAction(undo), () => setUndo(null))}>
            Annuler
          </Button>
        </div>
      )}

      {archived.length > 0 && (
        <details className="group mt-1">
          <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-ink-2 [&::-webkit-details-marker]:hidden">
            <Icon name="chev" size="s" className="transition-transform group-open:rotate-90" />
            Archivées · {archived.length}
          </summary>
          <List className="mt-1.5">
            {archived.map((l) => (
              <div key={l.id} className="flex min-w-0 items-center gap-3 border-b border-line px-3.5 py-2.5">
                <Link href={`/courses/${l.id}`} className="grid min-w-0 flex-1 opacity-75 hover:opacity-100">
                  <span className="truncate font-semibold">{l.title}</span>
                  <span className="truncate text-[14px] text-ink-2">{l.sub}</span>
                </Link>
                <Button variant="quiet" size="sm" icon="refresh" disabled={pending} onClick={() => run(() => restoreListsAction([l.id]))}>
                  Restaurer
                </Button>
              </div>
            ))}
          </List>
        </details>
      )}
      {toast.node}
    </section>
  );
}
