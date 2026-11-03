"use client";

// Le retour de goût en un geste : j’adore, ok ou bof, quelques étiquettes (sec, trop dense…), un mot libre.
// Sur /plats juste après « J’ai mangé », et sur la fiche recette (pour qui, au choix).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tasteAction } from "@/app/recettes/[slug]/gouts-actions";
import { Button, Chip, Chips, Icon, Segmented, Textarea } from "@/components/ui";
import { NOTE_MAX, RATING_LABEL, RATINGS, TAG_LABEL, TASTE_TAGS, type Rating, type TasteTag } from "@/lib/feedback/core";

export function TasteForm({
  recipeId,
  slug,
  people,
  personId: initial,
  servingId,
  title = "C’était comment ?",
  onDone,
  className = "",
}: {
  recipeId: string | null;
  slug?: string | null;
  /** Plusieurs personnes : on choisit pour qui (fiche). Une seule : la personne affichée (/plats). */
  people: { id: string; name: string }[];
  personId?: string;
  servingId?: string | null;
  title?: string;
  onDone?: (message: string) => void;
  className?: string;
}) {
  const router = useRouter();
  const [personId, setPersonId] = useState(initial ?? people[0]?.id ?? "");
  const [rating, setRating] = useState<Rating | null>(null);
  const [tags, setTags] = useState<TasteTag[]>([]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const toggle = (t: TasteTag) => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]));

  const send = () => {
    if (!rating) return;
    start(async () => {
      const r = await tasteAction({ recipeId, slug, personId, servingId, rating, tags, note: note.trim() || null });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setRating(null);
        setTags([]);
        setNote("");
        onDone?.(r.message);
        router.refresh();
      }
    });
  };

  return (
    <form
      className={`grid gap-4 ${className}`}
      data-gouts="form"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <b className="text-[17px]">{title}</b>
        {people.length > 1 && <Segmented label="Pour qui" value={personId} onChange={setPersonId} options={people.map((p) => ({ value: p.id, label: p.name }))} />}
      </div>
      <Segmented label="Note" value={rating ?? undefined} onChange={setRating} options={RATINGS.map((r) => ({ value: r, label: RATING_LABEL[r].charAt(0).toUpperCase() + RATING_LABEL[r].slice(1) }))} />
      <Chips>
        {TASTE_TAGS.map((t) => (
          <Chip key={t} pressed={tags.includes(t)} onClick={() => toggle(t)} data-tag={t}>
            {TAG_LABEL[t]}
          </Chip>
        ))}
      </Chips>
      <Textarea rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Un mot (facultatif) : « la sauce oubliée dans le frigo »" aria-label="Note libre" />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={!rating || !personId} state={pending ? "loading" : "idle"} loadingLabel="Je note…" data-action="gout">
          Noter
        </Button>
        {msg && (
          <span role="status" className={`inline-flex items-center gap-1 text-small ${msg.ok ? "text-ink-2" : "text-ko"}`}>
            <Icon name={msg.ok ? "check" : "alert"} size="s" />
            {msg.text}
          </span>
        )}
      </div>
    </form>
  );
}
