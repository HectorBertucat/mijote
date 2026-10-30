"use client";

// Importer une recette : on colle le texte (légende d'un post, page de blog) et son lien, l'IA la met au
// format standard, le code la vérifie, et on voit l'aperçu avant d'enregistrer. Téléphone d'abord.
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { proposeImportAction, saveImportAction, type ImportLimits } from "@/app/atelier/actions";
import { Alert, Button, Card, EmptyState, Field, Input, LoadList, Macro, MacroRow, RecipeTile, Tag, Textarea, verdictTone } from "@/components/ui";
import { CardTitle } from "@/components/RecipeParts";
import type { ImportProposal } from "@/lib/atelier/import";
import { verdictFor } from "@/lib/nutrition/compute";
import { recipeColor } from "@/lib/ui";
import { Checks, fmtUsd, IngredientsDiff, NutritionCompare, StepsList } from "./RecipeDiff";

const usd = (n: number) => (n < 0.01 ? `${n.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} $` : fmtUsd(n));
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function ImportApp({ limits: limits0, estimateUsd, maxChars }: { limits: ImportLimits; estimateUsd: number; maxChars: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [proposal, setProposal] = useState<ImportProposal | null>(null);
  const [limits, setLimits] = useState(limits0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const top = useRef<HTMLDivElement>(null);

  const draft = proposal?.draft ?? null;
  const color = recipeColor(draft?.slug ?? "import");
  const rows = useMemo(() => (proposal ? proposal.verification.rows.map((r) => ({ ...r, status: "same" as const })) : []), [proposal]);
  const out = limits.left <= 0;

  const read = () => {
    setError(null);
    start(async () => {
      const r = await proposeImportAction(text, url);
      if (!r.ok) return setError(r.error);
      setLimits(r.limits);
      setProposal(r.proposal);
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const save = () => {
    if (!proposal) return;
    setError(null);
    startSave(async () => {
      const r = await saveImportAction(proposal.draft, proposal.source);
      if (!r.ok) return setError(r.error);
      router.push(`/recettes/${r.slug}`);
    });
  };

  const leadPart = proposal?.verification.after.people[0];
  const h = leadPart?.macros;
  const v = h ? verdictFor(leadPart?.ref, h) : null;

  return (
    <div className="grid gap-5" ref={top}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Importer une recette</h1>
          <p className="mt-1.5 text-ink-2">Colle la légende d&apos;un post ou la page d&apos;un blog : Mijote la met au format de tes fiches.</p>
        </div>
        {proposal && (
          <Button variant="quiet" icon="x" disabled={pending || saving} onClick={() => setProposal(null)}>
            Abandonner l&apos;aperçu
          </Button>
        )}
      </div>

      <div className={`grid items-start gap-5 ${proposal ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
        <div className="grid min-w-0 gap-5">
          <Card as="section" pad="md">
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim() && !pending) read();
              }}
            >
              <Field label="Texte de la recette" help={`Ingrédients avec leurs quantités, et les étapes. Rien n'est téléchargé ; au-delà de ${maxChars.toLocaleString("fr-FR")} caractères, le texte est tronqué.`}>
                {(id, describedBy) => (
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={proposal ? 4 : 9}
                    placeholder={"Poulet basquaise\nPour 4 : 800 g de hauts de cuisse, 3 poivrons, 2 oignons, 400 g de tomates…\nSaisir le poulet, ajouter les légumes…"}
                  />
                )}
              </Field>
              <Field label="Lien (facultatif)" help="Gardé comme source sur la fiche.">
                {(id, describedBy) => (
                  <Input id={id} aria-describedby={describedBy} icon="link" type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
                )}
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant={proposal ? "secondary" : "primary"} icon="sparkdraft" disabled={!text.trim() || out} state={pending ? "loading" : "idle"} loadingLabel="Mise au format…">
                  {proposal ? "Relire le texte" : "Lire la recette"}
                </Button>
                <p className="text-[12px] text-faint">
                  environ {usd(estimateUsd)} par import · {out ? "plus d'import aujourd'hui" : `${limits.left} sur ${limits.limit} restant${limits.left > 1 ? "s" : ""} aujourd'hui`} · IA ce mois : {fmtUsd(limits.spentUsd)} sur {fmtUsd(limits.capUsd)}
                </p>
              </div>
            </form>
          </Card>

          {error && (
            <Alert tone="ko" role="alert">
              {error}
            </Alert>
          )}

          {pending && !proposal && (
            <Card pad="md" className="grid gap-3" aria-live="polite">
              <LoadList
                items={[
                  { label: "L'IA met la recette au format (bols, sous-étapes, ton matériel)", state: "on" },
                  { label: "Chaque ingrédient vérifié au catalogue", state: "idle" },
                  { label: "Quantités et nutrition vérifiées en code", state: "idle" },
                ]}
              />
              <div className="skeleton h-28" />
            </Card>
          )}

          {!proposal && !pending && (
            <EmptyState icon="book" title="L'aperçu apparaîtra ici">
              Tu relis la fiche avant de l&apos;enregistrer. Elle arrive « à essayer » dans tes recettes, avec son lien.
            </EmptyState>
          )}

          {proposal && draft && (
            <div className={`grid gap-5 transition-opacity ${pending ? "opacity-60" : ""}`}>
              <Alert tone="info" key={proposal.explanation} className="animate-swap-in">
                {proposal.explanation}
              </Alert>
              {proposal.review.length > 0 && (
                <Alert tone="warn" title="Quantités douteuses, à relire">
                  <ul className="grid list-disc gap-0.5 pl-4">
                    {proposal.review.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Alert>
              )}
              <Checks v={proposal.verification} />
              <IngredientsDiff rows={rows} color={color} />
              <Card as="section" pad="md">
                <CardTitle>Étapes</CardTitle>
                <StepsList steps={draft.steps} before={null} color={color} />
              </Card>
              {draft.tips && (
                <Alert tone="info" title="Conseils">
                  {draft.tips}
                </Alert>
              )}
            </div>
          )}
        </div>

        {proposal && draft && (
          <aside className={`grid min-w-0 gap-4 transition-opacity max-lg:order-first lg:sticky lg:top-[72px] ${pending ? "opacity-60" : ""}`}>
            <Card pad="md" className="grid gap-3">
              <div className="flex items-center gap-3">
                <RecipeTile color={color} name={draft.name} />
                <div className="min-w-0">
                  <b className="block font-display text-[17px] leading-tight">{draft.name}</b>
                  <div className="text-[13px] text-ink-2">
                    aperçu · {draft.servingsUnits} unités{draft.fridgeDays != null ? ` · frigo ${draft.fridgeDays} j` : ""}
                    {draft.freezerOk ? " · congèle" : ""}
                  </div>
                </div>
              </div>
              {draft.description && <p className="text-[14px] text-ink-2">{draft.description}</p>}
              <div className="flex flex-wrap gap-1.5">
                {proposal.review.length > 0 && <Tag tone="warn">à relire</Tag>}
                {draft.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
              {proposal.source && (
                <a href={proposal.source} target="_blank" rel="noopener noreferrer" className="truncate text-[14px] font-semibold text-accent underline-offset-2 hover:underline">
                  Source : {host(proposal.source)}
                </a>
              )}
              {h && (
                <MacroRow>
                  <Macro value={Math.round(h.kcal)} unit="kcal" tone={v ? verdictTone(v.kcal) : undefined} sub={`part ${leadPart!.name}`} />
                  <Macro value={Math.round(h.protein)} unit="g" tone={v ? verdictTone(v.protein) : undefined} sub="protéines" />
                </MacroRow>
              )}
              <Button variant="primary" icon="check" block onClick={save} disabled={pending} state={saving ? "loading" : "idle"} loadingLabel="Enregistrement…">
                Enregistrer · à essayer
              </Button>
              <p className="text-[12px] text-faint">
                Nouvelle recette au statut « à essayer »{proposal.review.length ? ", marquée « à relire »" : ""}
                {proposal.verification.blocked.length ? " et « indisponible » tant qu'un indispensable n'a pas de produit" : ""}.
              </p>
            </Card>
            <NutritionCompare before={null} after={proposal.verification.after} coverage={proposal.verification.after.coverage} />
          </aside>
        )}
      </div>
    </div>
  );
}
