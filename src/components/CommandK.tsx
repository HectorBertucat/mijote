"use client";

// Recherche rapide au clavier (ordinateur) : ⌘K ou Ctrl K ouvre une barre qui trouve une recette (par son nom ou
// un de ses ingrédients) ou une page, ou pose la question à l’assistant. ↑ ↓ pour choisir, Entrée pour ouvrir,
// Échap pour fermer.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, RecipeTile, type IconName } from "@/components/ui";
import { askAssistant } from "@/components/assistant/Assistant";

export type SearchRecipe = { slug: string; name: string; color: string; items: string[] };

const PAGES: { href: string; label: string; icon: IconName; words: string }[] = [
  { href: "/recettes", label: "Recettes", icon: "book", words: "bibliotheque" },
  { href: "/semaine", label: "Semaine", icon: "cal", words: "menu planning repas" },
  { href: "/composer", label: "Composer", icon: "pot", words: "session batch" },
  { href: "/courses", label: "Courses", icon: "basket", words: "liste drive chronodrive" },
  { href: "/placard", label: "Placard", icon: "home", words: "restes stock" },
  { href: "/couts", label: "Coûts", icon: "scale", words: "prix depenses" },
  { href: "/atelier", label: "Atelier", icon: "sparkdraft", words: "nouvelle recette creer ia" },
  { href: "/sante", label: "Santé", icon: "pulse", words: "poids objectifs" },
  { href: "/sante/entrainement", label: "Entraînement", icon: "kb", words: "kettlebell seance sport" },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Hit = { key: string; href: string; label: string; sub?: string; lead: React.ReactNode; ask?: string };

/** `assistant` : l’assistant est disponible (clé d’API), une ligne « Demander à l’assistant » s’ajoute. */
export function CommandK({ recipes, assistant = false }: { recipes: SearchRecipe[]; assistant?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ("");
      setAt(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const n = fold(q.trim());
    const out: Hit[] = [];
    for (const r of recipes) {
      const byName = !n || fold(r.name).includes(n);
      const item = !byName && n.length >= 2 ? r.items.find((i) => fold(i).includes(n)) : undefined;
      if (byName || item) out.push({ key: `r${r.slug}`, href: `/recettes/${r.slug}`, label: r.name, sub: item ? `avec ${item.split(/[,(]/)[0].trim().toLowerCase()}` : "recette", lead: <RecipeTile color={r.color} name={r.name} size="sm" /> });
    }
    for (const p of PAGES) if (!n || fold(`${p.label} ${p.words}`).includes(n)) out.push({ key: `p${p.href}`, href: p.href, label: p.label, sub: "page", lead: <span className="grid size-7 place-items-center rounded-[4px] bg-surface-2 text-ink-2"><Icon name={p.icon} size="s" /></span> });
    const lead = <span className="grid size-7 place-items-center rounded-[4px] bg-surface-2 text-ink-2"><Icon name="talk" size="s" /></span>;
    // Une vraie question (ou rien ne correspond) : l’assistant en tête ; sinon en dernier.
    const ask = assistant ? { key: "ask", href: "", label: q.trim() ? `Demander : ${q.trim()}` : "Demander à l’assistant", sub: "⌘I", lead, ask: q.trim() } : null;
    const top = ask && (/\?\s*$/.test(q) || q.trim().split(/\s+/).length >= 4 || (n && !out.length));
    return ask ? (top ? [ask, ...out.slice(0, 11)] : [...out.slice(0, 11), ask]) : out.slice(0, 12);
  }, [q, recipes, assistant]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    setOpen(false);
    if (h.ask != null) askAssistant(h.ask);
    else router.push(h.href);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hidden h-9 items-center gap-2 rounded-[8px] border border-line px-3 text-small font-semibold text-ink-2 hover:border-line-strong hover:text-ink lg:inline-flex" aria-label="Chercher (⌘K)">
        <Icon name="search" size="s" />
        Chercher
        <kbd className="label rounded-[4px] bg-surface-2 px-1 py-0.5 text-ink-2">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] grid animate-[fade-in_var(--dur-2)_var(--ease-out)] items-start justify-items-center bg-scrim px-4 pt-[12vh]" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal aria-label="Recherche rapide" className="grid w-full max-w-[560px] animate-pop overflow-hidden rounded-[14px] border border-line bg-raised shadow-float" onClick={(e) => e.stopPropagation()}>
            <label className="flex items-center gap-3 border-b border-line px-4">
              <Icon name="search" className="text-faint" />
              <input
                ref={input}
                id="commandk-q"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setAt(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setAt((a) => Math.min(a + 1, hits.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setAt((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    go(hits[at]);
                  }
                }}
                placeholder="Une recette, un ingrédient, une page"
                aria-label="Chercher"
                className="h-14 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint"
              />
              <kbd className="label rounded-[4px] bg-surface-2 px-1 py-0.5 text-ink-2">Échap</kbd>
            </label>
            <ul className="max-h-[52vh] overflow-y-auto p-2" role="listbox" aria-label="Résultats">
              {hits.length === 0 && <li className="px-3 py-6 text-center text-small text-ink-2">Rien ne correspond à «{"\u00a0"}{q}{"\u00a0"}».</li>}
              {hits.map((h, i) => (
                <li key={h.key} role="option" aria-selected={i === at}>
                  <button type="button" onMouseEnter={() => setAt(i)} onClick={() => go(h)} className={`flex min-h-tap w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left ${i === at ? "bg-accent-soft text-ink" : ""}`}>
                    {h.lead}
                    <span className="min-w-0 flex-1 truncate font-semibold">{h.label}</span>
                    {h.sub && <span className="shrink-0 text-small text-ink-2">{h.sub}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
