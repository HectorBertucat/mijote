"use client";

// Notes d’une fiche (DA « Carnet de marché ») : catégories qui filtrent, la liste à filets, puis l’ajout en un tap
// (catégorie, qui, texte, Entrée).
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNote } from "@/app/recettes/[slug]/actions";
import { Button, Chip, Chips, List, ListRow, Segmented, Textarea } from "@/components/ui";
import { NOTE_CATEGORIES, NOTE_LABELS } from "@/lib/recipes/format";
import { firstOfMonth } from "@/lib/typo";

type Category = (typeof NOTE_CATEGORIES)[number];
const PERSON_KEY = "mijote.personId";

export type NoteView = { id: string; category: Category; text: string; personName: string | null; createdAt: string };

function fmtDate(iso: string) {
  return firstOfMonth(new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }));
}

/** Liste filtrable par catégorie, puis le formulaire. */
export function NotesSection({ recipeId, slug, people, notes }: { recipeId: string; slug: string; people: { id: string; name: string }[]; notes: NoteView[] }) {
  const [filter, setFilter] = useState<Category | null>(null);
  const counts = new Map<Category, number>();
  for (const n of notes) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
  const used = NOTE_CATEGORIES.filter((c) => counts.has(c));
  const shown = filter ? notes.filter((n) => n.category === filter) : notes;
  return (
    <div className="grid gap-6">
      {used.length > 1 && (
        <Chips>
          <Chip pressed={filter == null} count={notes.length} onClick={() => setFilter(null)}>
            Toutes
          </Chip>
          {used.map((c) => (
            <Chip key={c} pressed={filter === c} count={counts.get(c)} onClick={() => setFilter(filter === c ? null : c)}>
              {NOTE_LABELS[c]}
            </Chip>
          ))}
        </Chips>
      )}
      {shown.length > 0 ? (
        <List className="border-line-strong">
          {shown.map((n) => (
            <ListRow
              key={n.id}
              className="items-start"
              title={<span className="font-medium">{n.text}</span>}
              sub={[NOTE_LABELS[n.category], n.personName, fmtDate(n.createdAt)].filter(Boolean).join(" · ")}
            />
          ))}
        </List>
      ) : (
        <p className="text-body text-ink-2">Pas encore de note. Un goût à corriger, un temps de cuisson, un ingrédient pénible : écris-le ici, il sera là la prochaine fois.</p>
      )}
      <NoteForm recipeId={recipeId} slug={slug} people={people} />
    </div>
  );
}

export function NoteForm({ recipeId, slug, people }: { recipeId: string; slug: string; people: { id: string; name: string }[] }) {
  const router = useRouter();
  const [category, setCategory] = useState<Category>("taste");
  const [personId, setPersonId] = useState(people[0]?.id ?? "");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PERSON_KEY);
      if (saved && people.some((p) => p.id === saved)) setPersonId(saved);
    } catch {}
  }, [people]);

  function choosePerson(id: string) {
    setPersonId(id);
    try {
      localStorage.setItem(PERSON_KEY, id);
    } catch {}
  }

  function submit() {
    if (!text.trim() || pending) return;
    setError(null);
    start(async () => {
      const r = await addNote({ recipeId, slug, personId: personId || null, category, text });
      if (r.ok) {
        setText("");
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
        router.refresh();
        input.current?.focus();
      } else setError(r.error);
    });
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Catégorie de la note">
        {NOTE_CATEGORIES.map((c) => (
          <Chip key={c} role="radio" aria-checked={category === c} pressed={category === c} onClick={() => setCategory(c)} >
            {NOTE_LABELS[c]}
          </Chip>
        ))}
      </div>
      <Textarea
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        aria-label="Nouvelle note"
        placeholder={`${NOTE_LABELS[category]} : ce que tu changerais la prochaine fois`}
        className="resize-y"
      />
      <div className="flex flex-wrap items-center gap-2">
        {people.length > 1 ? (
          <Segmented label="Qui écrit" value={personId} onChange={choosePerson} options={people.map((p) => ({ value: p.id, label: p.name }))} />
        ) : null}
        <span className="text-small text-faint max-sm:hidden">Entrée pour enregistrer</span>
        <Button type="submit" variant="primary" className="ml-auto" disabled={!text.trim() && !saved} state={pending ? "loading" : saved ? "done" : "idle"} loadingLabel="Ajout…" doneLabel="Ajoutée">
          Ajouter
        </Button>
      </div>
      {error && <p className="text-small text-ko-ink">{error}</p>}
    </form>
  );
}
