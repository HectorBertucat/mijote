"use client";

// Importer une recette : on colle le texte (légende d’un post, page de blog) et son lien, l’IA la met au
// format standard, le code la vérifie, et on voit l’aperçu avant d’enregistrer. Téléphone d’abord.
// DA v3 : une grande zone de collage, l’aperçu au langage de la fiche (étiquette du plat, ingrédients par bol,
// étapes numérotées), les avertissements en lignes nettes, l’enregistrement en marge.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { proposeImportAction, saveImportAction, type ImportLimits } from "@/app/atelier/actions";
import { Alert, Button, Field, Input, LoadList, Macro, MacroRow, Tag, Tape, Textarea, recipeVar, verdictTone } from "@/components/ui";
import type { ImportProposal } from "@/lib/atelier/import";
import { verdictFor } from "@/lib/nutrition/compute";
import { recipeColor } from "@/lib/ui";
import { Checks, fmtUsd, IngredientsDiff, NutritionCompare, StepsList } from "./RecipeDiff";
import { CostLine, HowItGoes, Notes, PageHead, SectionHead } from "./parts";

const NB = "\u202f";

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
  // « Coller » n’apparaît que si le navigateur sait lire le presse-papiers.
  const [canPaste, setCanPaste] = useState(false);
  useEffect(() => setCanPaste(typeof navigator !== "undefined" && !!navigator.clipboard?.readText), []);
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t);
    } catch {
      setCanPaste(false);
    }
  };

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

  const cost = (
    <CostLine>
      environ {usd(estimateUsd)} par import · {out ? "plus d’import aujourd’hui" : `${limits.left} sur ${limits.limit} restant${limits.left > 1 ? "s" : ""} aujourd’hui`} · IA ce mois : {fmtUsd(limits.spentUsd)} sur {fmtUsd(limits.capUsd)}
    </CostLine>
  );

  const form = (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() && !pending) read();
      }}
    >
      <Field label="Le texte de la recette" help={`Les ingrédients avec leurs quantités, puis les étapes. Rien n’est téléchargé ; au-delà de ${maxChars.toLocaleString("fr-FR")} caractères, le texte est coupé.`}>
        {(id, describedBy) => (
          <div className="relative">
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={proposal ? 6 : 14}
              className="min-h-48 resize-y text-body"
              placeholder={"Poulet basquaise\nPour 4 : 800 g de hauts de cuisse, 3 poivrons, 2 oignons, 400 g de tomates…\nSaisir le poulet, ajouter les légumes…"}
            />
            {canPaste && !text && (
              <span className="absolute bottom-4 right-4">
                <Button size="sm" icon="copy" onClick={paste}>
                  Coller
                </Button>
              </span>
            )}
          </div>
        )}
      </Field>
      <Field label="Le lien" help="Facultatif. Gardé comme source sur la fiche.">
        {(id, describedBy) => <Input id={id} aria-describedby={describedBy} icon="link" type="url" inputMode="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />}
      </Field>
      <div className="grid gap-3">
        <Button type="submit" variant={proposal ? "secondary" : "primary"} icon="sparkdraft" className="justify-self-start" disabled={!text.trim() || out} state={pending ? "loading" : "idle"} loadingLabel="Mise au format…">
          {proposal ? "Relire le texte" : "Lire la recette"}
        </Button>
        {cost}
      </div>
    </form>
  );

  return (
    <div className="grid gap-12" ref={top}>
      <PageHead
        back={{ href: "/recettes", label: "Recettes" }}
        title="Importer une recette"
        lead={proposal ? undefined : "Colle la légende d’un post ou la page d’un blog : Mijote la met au format de tes fiches, puis tu relis avant d’enregistrer."}
        aside={
          proposal && (
            <Button variant="quiet" icon="x" disabled={pending || saving} onClick={() => setProposal(null)}>
              Abandonner l’aperçu
            </Button>
          )
        }
      />

      {error && (
        <Alert tone="ko" role="alert">
          {error}
        </Alert>
      )}

      {!proposal && (
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-6">
          <div className="min-w-0 lg:col-span-7">{form}</div>
          <aside className="min-w-0 lg:col-span-4 lg:col-start-9" aria-live="polite">
            {pending ? (
              <div className="grid gap-4 border-t border-line-strong pt-4">
                <p className="label text-faint">En cours</p>
                <LoadList
                  className="!text-body"
                  items={[
                    { label: "L’IA met la recette au format : bols, sous-étapes, ton matériel", state: "on" },
                    { label: "Chaque ingrédient cherché au catalogue", state: "idle" },
                    { label: "Quantités et nutrition vérifiées en code", state: "idle" },
                  ]}
                />
              </div>
            ) : (
              <HowItGoes
                title="Ce qui se passe"
                steps={[
                  "L’IA range la recette au format de tes fiches : ingrédients par bol, étapes, ton matériel.",
                  "Le code vérifie les quantités et calcule la nutrition de chaque part.",
                  <>Tu relis l’aperçu. La fiche arrive «{NB}à essayer{NB}» dans tes recettes, avec son lien.</>,
                ]}
              />
            )}
          </aside>
        </div>
      )}

      {proposal && draft && (
        <div className={`grid gap-12 transition-opacity duration-[var(--dur-2)] ease-[var(--ease-out)] lg:grid-cols-12 lg:gap-x-6 ${pending ? "opacity-60" : ""}`}>
          <div className="grid min-w-0 content-start gap-12 lg:col-span-8">
            <header key={draft.name} className="reveal grid gap-4">
              <Tape tint={recipeVar(color)} seed={draft.name} className="justify-self-start">
                Aperçu · à essayer
              </Tape>
              <h2 className="text-h1">{draft.name}</h2>
              <p className="num text-small text-ink-2">
                {draft.servingsUnits} unités{draft.fridgeDays != null ? ` · ${draft.fridgeDays}${NB}j au frigo` : ""}
                {draft.freezerOk ? " · se congèle" : ""}
                {proposal.source && (
                  <>
                    {" · "}
                    <a href={proposal.source} target="_blank" rel="noopener noreferrer" className="font-bold text-accent underline decoration-1 underline-offset-4 hover:decoration-2">
                      {host(proposal.source)}
                    </a>
                  </>
                )}
              </p>
              {draft.description && <p className="max-w-[56ch] text-lead text-ink-2">{draft.description}</p>}
              {(draft.tags.length > 0 || proposal.review.length > 0) && (
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {proposal.review.length > 0 && <Tag tone="warn">à relire</Tag>}
                  {draft.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              )}
            </header>

            <div className="grid gap-6">
              <Notes items={[{ tone: "info", key: proposal.explanation, text: proposal.explanation }]} />
              <Notes title="Quantités douteuses, à relire" items={proposal.review.map((w) => ({ tone: "warn" as const, key: w, text: w }))} />
              <Checks v={proposal.verification} />
            </div>

            <IngredientsDiff rows={rows} color={color} title="Ingrédients" />
            <section className="grid gap-2">
              <SectionHead>Étapes</SectionHead>
              <StepsList steps={draft.steps} before={null} color={color} />
            </section>
            {draft.tips && (
              <section className="grid gap-4">
                <SectionHead as="h3">Conseils</SectionHead>
                <p className="max-w-[60ch] text-body text-ink-2">{draft.tips}</p>
              </section>
            )}
            <details className="group border-y border-line">
              <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 text-body font-bold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                Le texte collé
                <span className="font-normal text-faint">pour corriger et relire</span>
              </summary>
              <div className="pb-6 pt-2">{form}</div>
            </details>
          </div>

          <aside className="grid min-w-0 content-start gap-8 max-lg:order-first lg:sticky lg:top-24 lg:col-span-4">
            <div className="grid gap-4 border-t border-line-strong pt-4">
              {h && (
                <MacroRow>
                  <Macro value={Math.round(h.kcal)} unit="kcal" tone={v ? verdictTone(v.kcal) : undefined} sub={`part de ${leadPart!.name}`} />
                  <Macro value={Math.round(h.protein)} unit="g" tone={v ? verdictTone(v.protein) : undefined} sub="protéines" />
                </MacroRow>
              )}
              <Button variant="primary" icon="check" block onClick={save} disabled={pending} state={saving ? "loading" : "idle"} loadingLabel="Enregistrement…">
                Ajouter à mes recettes
              </Button>
              <p className="text-small text-faint">
                Elle arrive «{NB}à essayer{NB}»{proposal.review.length ? ", marquée «\u202fà relire\u202f»" : ""}
                {proposal.verification.blocked.length ? ", et «\u202findisponible\u202f» tant qu’un indispensable n’a pas de produit" : ""}.
              </p>
            </div>
            <div className="max-lg:hidden">
              <NutritionCompare before={null} after={proposal.verification.after} coverage={proposal.verification.after.coverage} />
            </div>
          </aside>
          <div className="lg:hidden">
            <NutritionCompare before={null} after={proposal.verification.after} coverage={proposal.verification.after.coverage} />
          </div>
        </div>
      )}
    </div>
  );
}
