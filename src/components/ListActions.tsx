"use client";

// Actions d’une liste de courses (système « Carnet de marché ») : vérification en direct (suivie ligne par
// ligne), progression pendant la création (LoadList), copie avec les liens. Sections sobres : étiquette à filet,
// chiffres serrés, un mot plutôt qu’une pastille.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkLive, followLive } from "@/app/courses/actions";
import { Alert, Button, Icon, LoadList, Progress, type LoadItem } from "@/components/ui";
import { SectionHead } from "@/components/cart/Carnet";

export type LiveLine = { label: string; status: string | null };

/** Ce que la page sait de chaque ligne vérifiable → lignes de la LoadList (la première en file tourne). */
function liveItems(lines: LiveLine[]): { items: LoadItem[]; done: number; total: number; pending: number } {
  const asked = lines.filter((l) => l.status);
  let first = true;
  const items: LoadItem[] = asked.map((l) => {
    if (l.status === "pending") {
      const on = first;
      first = false;
      return { label: l.label, state: on ? "on" : "idle" };
    }
    const trail =
      l.status === "done" || l.status === "fresh" ? (
        <span className="text-small text-ink-3">{l.status === "fresh" ? "déjà frais" : "vérifié"}</span>
      ) : l.status === "failed" ? (
        <span className="inline-flex items-center gap-1 text-small font-semibold text-ko-ink">
          <Icon name="x" size="s" strokeWidth={2.4} />
          échec
        </span>
      ) : (
        <span className="text-small text-ink-3">pas vérifiable</span>
      );
    return { label: l.label, state: "done", trail };
  });
  // En cours d’abord, puis l’attente, puis le fait.
  const rank = { on: 0, idle: 1, done: 2 } as const;
  items.sort((a, b) => rank[a.state] - rank[b.state]);
  return { items, done: asked.filter((l) => l.status !== "pending").length, total: asked.length, pending: asked.filter((l) => l.status === "pending").length };
}

/**
 * « Vérifier en direct » : la demande part sans attendre (20 produits au plus, par le worker de chronocatalog),
 * puis on suit chaque ligne toutes les 2,5 s (GET /live?ids=…) ; la page se recharge et le panneau avance.
 */
export function LiveVerify({ listId, lines }: { listId: string; lines: LiveLine[] }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const alive = useRef(true);
  const { items, done, total, pending } = liveItems(lines);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);

  const following = useRef(false);
  async function follow() {
    if (following.current) return;
    following.current = true;
    setBusy(true);
    const until = Date.now() + 4 * 60_000;
    while (alive.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 2500));
      const r = await followLive(listId);
      if (!r.ok) {
        setMsg({ text: r.message, ok: false });
        break;
      }
      router.refresh();
      if (r.pending === 0) {
        setMsg({ text: `${r.total} produits vérifiés en direct.`, ok: true });
        break;
      }
    }
    following.current = false;
    setBusy(false);
  }

  // Une vérification était en cours (page rechargée) : on reprend le suivi.
  useEffect(() => {
    if (pending > 0) void follow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = open || pending > 0 ? items : items.slice(0, 0);
  return (
    <section className="grid gap-4" aria-labelledby="direct-titre">
      <SectionHead as="label" id="direct-titre" title="Vérification en direct" count={total > 0 ? `${done} sur ${total}` : undefined} />
      {total > 0 && <Progress value={done / total} label="Avancement de la vérification" />}
      {shown.length > 0 && <LoadList items={shown.slice(0, 10)} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon="refresh"
          state={busy ? "loading" : "idle"}
          loadingLabel={pending > 0 ? `${done} sur ${total} vérifiés…` : "Envoi au worker…"}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            const r = await checkLive(listId);
            if (!r.ok) {
              setMsg({ text: r.message, ok: false });
              setBusy(false);
              return;
            }
            router.refresh();
            if (r.pending === 0) {
              setMsg({ text: `${r.asked} produits déjà frais.`, ok: true });
              setBusy(false);
              return;
            }
            await follow();
          }}
        >
          Vérifier en direct
        </Button>
        {total > 0 && pending === 0 && items.length > 0 && (
          <Button variant="quiet" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Masquer le détail" : "Voir le détail"}
          </Button>
        )}
      </div>
      {(msg || total === 0) && <p className={`text-small ${msg && !msg.ok ? "text-ko-ink" : "text-ink-2"}`}>{msg?.text ?? "Prix et stock relus sur le drive, 20 produits au plus."}</p>}
    </section>
  );
}

/** Pendant la création de la liste : chaque ligne de recette passe par /resolve (6 à la fois), puis le choix des produits. Rechargé toutes les 0,8 s. */
export function BuildProgress({ done, total, lines, error }: { done: number; total: number; lines: string[]; error: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (error) return;
    const id = setInterval(() => router.refresh(), 800);
    return () => clearInterval(id);
  }, [router, error]);
  if (error)
    return (
      <Alert tone="ko" title="La liste n’a pas pu être construite">
        {error}
      </Alert>
    );
  const first = lines.length;
  const second = done >= first;
  const items: LoadItem[] = [
    ...lines.map((l, i): LoadItem => ({ label: l, state: i < done ? "done" : i < done + 6 ? "on" : "idle" })),
    { label: "Choix des produits et des paquets", state: second ? (done >= total ? "done" : "on") : "idle", trail: second && total > first ? <span className="num text-ink-3">{Math.min(done - first, total - first)} sur {total - first}</span> : undefined },
  ];
  // Ce qui tourne en premier, puis la suite ; le fait se replie en bas.
  const rank = { on: 0, idle: 1, done: 2 } as const;
  const ordered = [...items].sort((a, b) => rank[a.state] - rank[b.state]);
  return (
    <section className="grid gap-4" aria-labelledby="creation-titre">
      <SectionHead as="label" id="creation-titre" title="Je prépare la liste…" count={`${done} sur ${total}`} />
      <Progress value={total ? done / total : 0} label="Avancement" />
      <LoadList items={ordered.slice(0, 9)} />
      {ordered.length > 9 && <p className="text-small text-ink-3">{ordered.length - 9 === 1 ? "et 1 autre ligne" : `et ${ordered.length - 9} autres lignes`}</p>}
      <p className="text-small text-ink-2">Chaque ingrédient d’abord (type de produit, quantité lue), puis un produit et un nombre de paquets par besoin.</p>
    </section>
  );
}

/** `links` : la liste copiée porte les liens des produits (catalogue relié) ; sinon, le texte seul. */
export function CopyButton({ text, size = "md", links = true }: { text: string; size?: "sm" | "md"; links?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size={size}
      icon="copy"
      state={done ? "done" : "idle"}
      doneLabel="Copié"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const t = document.createElement("textarea");
          t.value = text;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {links ? "Copier avec les liens" : "Copier la liste"}
    </Button>
  );
}
