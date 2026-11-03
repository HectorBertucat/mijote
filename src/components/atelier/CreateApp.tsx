"use client";

// Créer une recette d’après des recettes publiées (DA v3 « Carnet de marché ») : une envie → les sources trouvées
// (titres, sites, ce qu’on en retient, liens) → deux propositions, une troisième à la demande. Chaque proposition dit
// pourquoi elle est bonne, ce qui change par rapport à la source, les chiffres par portion de chacun (calculés par
// l’appli) et ses défauts ; on la retouche (« plus de sauce »), on corrige ses défauts, puis on l’ajoute « à essayer ».
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { closeCreationAction, composeAction, refineAction, saveCreationAction, startCreationAction } from "@/app/atelier/creer/actions";
import { Alert, Button, buttonClass, Chip, Chips, Field, Icon, Input, LoadList, Macro, MacroRow, Tag, Tape, Textarea, recipeVar, type LoadItem, type Tone } from "@/components/ui";
import type { Creation, CreationProposal, Figure, Source } from "@/lib/creation";
import { recipeColor } from "@/lib/ui";
import { fmtUsd, IngredientsDiff, StepsList } from "./RecipeDiff";
import { CostLine, HowItGoes, Notes, PageHead, SectionHead } from "./parts";

const IDEAS = [
  "Un plat gourmand, protéiné, one pot, avec des pois chiches",
  "Quelque chose comme un butter chicken, mais moins dense",
  "Un mijoté de porc à l’asiatique qui se congèle",
  "Des boulettes en sauce tomate, sans bœuf haché sec",
];
const TOUCHES = ["Plus de sauce", "Sans crème", "Plus protéiné", "Plus léger", "Plus relevé", "Plus de légumes"];

const NB = " ";
const LEVEL: Record<NonNullable<Figure["level"]>, { tone: Tone; word: string }> = {
  bien: { tone: "ok", word: "tombe bien" },
  juste: { tone: "warn", word: "juste" },
  loin: { tone: "ko", word: "loin du repère" },
};

type Budget = { spentUsd: number; capUsd: number };
type Phase = "search" | "compose" | null;

export function CreateApp({
  initial,
  initialEnvie,
  budget: budget0,
  estimates,
  limits,
}: {
  initial: Creation | null;
  initialEnvie: string;
  budget: Budget;
  estimates: { creation: number; cached: number; more: number; refine: number };
  limits: { searches: number; fetches: number; first: number; max: number };
}) {
  const [creation, setCreation] = useState<Creation | null>(initial);
  const [envie, setEnvie] = useState(initialEnvie || initial?.envie || "");
  const [budget, setBudget] = useState(budget0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [busy, setBusy] = useState<string | null>(null); // id de la proposition en cours de retouche ou d’enregistrement
  const [pending, start] = useTransition();
  const top = useRef<HTMLDivElement>(null);

  const take = (r: Awaited<ReturnType<typeof startCreationAction>>) => {
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    setCreation(r.creation);
    setBudget(r.budget);
    return r.creation;
  };

  const create = () => {
    if (envie.trim().length < 4 || pending) return;
    setError(null);
    start(async () => {
      setPhase("search");
      const c = take(await startCreationAction(envie));
      if (c) {
        setPhase("compose");
        take(await composeAction(c.id));
      }
      setPhase(null);
    });
  };

  const more = () => {
    if (!creation) return;
    setError(null);
    start(async () => {
      setPhase("compose");
      take(await composeAction(creation.id));
      setPhase(null);
    });
  };

  const restart = () => {
    if (creation) void closeCreationAction(creation.id);
    setCreation(null);
    setError(null);
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sources = creation?.research?.sources ?? [];
  const proposals = creation?.proposals ?? [];
  const cachedHint = creation?.cached && creation.envie === envie.trim();
  const estimate = cachedHint ? estimates.cached : estimates.creation;

  return (
    <div className="grid gap-12" ref={top}>
      <PageHead
        back={{ href: "/atelier", label: "Atelier" }}
        title="Créer une recette"
        lead={creation ? undefined : "Décris une envie : l’assistant cherche de vraies recettes publiées, s’en inspire et en propose deux pour ton foyer. Chaque chiffre est recalculé par l’appli, chaque étape vérifiée sur ta cuisine."}
        aside={
          creation ? (
            <Button variant="quiet" icon="refresh" disabled={pending} onClick={restart}>
              Nouvelle envie
            </Button>
          ) : null
        }
      />

      <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-6">
        <div className="grid min-w-0 content-start gap-12 lg:col-span-8">
          {!creation && (
            <form
              className="grid gap-6"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <Field label="Ton envie">
                {(id) => (
                  <Textarea
                    id={id}
                    value={envie}
                    onChange={(e) => setEnvie(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        create();
                      }
                    }}
                    rows={3}
                    maxLength={400}
                    placeholder="Un plat gourmand, protéiné, one pot, avec des pois chiches"
                    className="resize-none text-lead"
                  />
                )}
              </Field>
              <div className="grid gap-2">
                <p className="label text-faint">Par exemple</p>
                <Chips scroll className="sm:mx-0 sm:flex-wrap sm:px-0">
                  {IDEAS.map((i) => (
                    <Chip key={i} pressed={envie === i} onClick={() => setEnvie(i)}>
                      {i}
                    </Chip>
                  ))}
                </Chips>
              </div>
              <div className="grid gap-3">
                <Button type="submit" variant="primary" icon="search" className="justify-self-start" disabled={envie.trim().length < 4} state={pending ? "loading" : "idle"} loadingLabel={phase === "compose" ? "Composition…" : "Recherche…"}>
                  Chercher et proposer
                </Button>
                <CostLine>
                  Environ {fmtUsd(estimate)} : {limits.searches} recherches et {limits.fetches} pages lues au plus, {limits.first} recettes composées · IA ce mois : {fmtUsd(budget.spentUsd)} sur {fmtUsd(budget.capUsd)}
                </CostLine>
              </div>
            </form>
          )}

          {creation && (
            <header className="grid gap-2">
              <p className="label text-faint">Envie</p>
              <p className="max-w-[56ch] text-lead">« {creation.envie} »</p>
              <CostLine>
                Cette création : {fmtUsd(creation.costUsd)}
                {creation.cached ? " · recherche reprise du cache, sans nouveau coût" : creation.research ? ` · ${creation.research.searches} recherche${creation.research.searches > 1 ? "s" : ""}` : ""} · IA ce mois : {fmtUsd(budget.spentUsd)} sur {fmtUsd(budget.capUsd)}
              </CostLine>
            </header>
          )}

          {error && (
            <Alert tone="ko" role="alert">
              {error}
            </Alert>
          )}

          {creation?.research && <Sources research={creation.research} />}

          {proposals.length > 0 && (
            <section className="grid gap-12">
              <SectionHead aside="chiffres et vérifications calculés par l’appli">Propositions</SectionHead>
              {proposals.map((p, k) => (
                <ProposalView
                  key={p.id}
                  n={k + 1}
                  p={p}
                  sources={sources}
                  creationId={creation!.id}
                  refineUsd={estimates.refine}
                  disabled={pending || (busy != null && busy !== p.id)}
                  onBusy={setBusy}
                  onCreation={(c, b) => {
                    setCreation(c);
                    if (b) setBudget(b);
                  }}
                  onError={setError}
                />
              ))}
              {proposals.length < limits.max && (
                <div className="grid gap-2 border-t border-line-strong pt-4">
                  <Button icon="sparkdraft" className="justify-self-start" onClick={more} disabled={pending || busy != null} state={pending && phase === "compose" ? "loading" : "idle"} loadingLabel="Composition…">
                    Une autre idée
                  </Button>
                  <CostLine>Environ {fmtUsd(estimates.more)}, d’après les mêmes sources</CostLine>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:col-span-4 lg:self-start" aria-live="polite">
          {phase ? (
            <div className="grid gap-4 border-t border-line-strong pt-4">
              <p className="label text-faint">En cours</p>
              <LoadList className="!text-body" items={loadItems(phase, Boolean(creation?.research), proposals.length ? 1 : limits.first)} />
              <p className="text-small text-faint">{phase === "search" ? "Une vingtaine de secondes pour chercher et lire." : "Une minute environ pour composer et tout vérifier."}</p>
            </div>
          ) : (
            <HowItGoes
              title="Ce qui se passe"
              steps={[
                `L’assistant cherche des recettes publiées (${limits.searches} recherches au plus) et les résume : les sources sont citées, rien n’est recopié.`,
                "Il en tire des recettes pour ton foyer : vos parts et vos repères, ton équipement, vos goûts, le batch (frigo, congélation, garniture à part).",
                "L’appli recalcule les chiffres et vérifie tout. Rien n’entre dans ta bibliothèque sans toi, et la recette arrive « à essayer ».",
              ]}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function loadItems(phase: Phase, researched: boolean, n: number): LoadItem[] {
  const s = (on: boolean, done: boolean): LoadItem["state"] => (done ? "done" : on ? "on" : "idle");
  const composing = phase === "compose";
  return [
    { label: "Recherche de recettes publiées", state: s(phase === "search", researched || composing) },
    { label: "Lecture et résumé des sources", state: s(phase === "search", researched || composing) },
    { label: `Composition de ${n} recette${n > 1 ? "s" : ""} pour le foyer`, state: s(composing, false) },
    { label: "Vérification : nutrition, équipement, quantités", state: s(composing, false) },
  ];
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Les recettes publiées trouvées : ce qu’on en retient, dans nos mots, et le lien vers la page. */
function Sources({ research }: { research: NonNullable<Creation["research"]> }) {
  const { sources, dropped } = research;
  return (
    <section className="grid gap-4">
      <SectionHead aside={sources.length ? `${sources.length} recette${sources.length > 1 ? "s" : ""} publiée${sources.length > 1 ? "s" : ""}` : undefined}>Sources</SectionHead>
      {sources.length === 0 ? (
        <Notes items={[{ tone: "warn", text: "Aucune recette publiée retenue : les propositions viennent du métier de l’assistant, sans source." }]} />
      ) : (
        <ol className="grid border-t border-line">
          {sources.map((s) => (
            <li key={s.id} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b border-line py-4">
              <span className="num label pt-1 text-faint">{s.id.toUpperCase()}</span>
              <div className="grid min-w-0 gap-1">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-baseline gap-2 text-body font-bold hover:text-accent">
                  <span className="min-w-0">{s.title}</span>
                  <Icon name="link" size="s" className="shrink-0 text-faint" label="ouvre la page" />
                </a>
                <span className="text-small text-ink-2">
                  {s.site !== host(s.url) ? `${s.site} · ` : ""}
                  {host(s.url)}
                  {s.servings ? ` · ${s.servings} parts` : ""}
                </span>
                <p className="max-w-[60ch] text-body text-ink-2">{s.whyGood} {s.technique}</p>
                {s.keyIngredients.length > 0 && <p className="text-small text-faint">{s.keyIngredients.join(" · ")}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {research.notes && <p className="max-w-[60ch] text-small text-ink-2">{research.notes}</p>}
      {dropped.length > 0 && (
        <p className="text-small text-faint">
          {dropped.length} écartée{dropped.length > 1 ? "s" : ""} par l’appli : {dropped.map((d) => `${host(d.url)} (${d.why})`).join(" ; ")}.
        </p>
      )}
    </section>
  );
}

function ProposalView({
  n,
  p,
  sources,
  creationId,
  refineUsd,
  disabled,
  onBusy,
  onCreation,
  onError,
}: {
  n: number;
  p: CreationProposal;
  sources: Source[];
  creationId: string;
  refineUsd: number;
  disabled: boolean;
  onBusy: (id: string | null) => void;
  onCreation: (c: Creation, b?: Budget) => void;
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(n === 1);
  const [ask, setAsk] = useState("");
  const [doing, setDoing] = useState<"refine" | "fix" | "save" | null>(null);
  const [, start] = useTransition();
  const d = p.draft;
  const color = recipeColor(d.slug);
  const ko = p.defects.filter((x) => x.level === "ko");
  const warn = p.defects.filter((x) => x.level === "warn");
  const used = sources.filter((s) => p.inspiredBy.includes(s.id));
  const minutes = Math.round(d.steps.reduce((t, s) => t + (s.durationMin ?? 0), 0));

  const act = (kind: "refine" | "fix" | "save", text = "") => {
    onError(null);
    setDoing(kind);
    onBusy(p.id);
    start(async () => {
      if (kind === "save") {
        const r = await saveCreationAction(creationId, p.id);
        if (!r.ok) onError(r.error);
        else {
          onCreation(r.creation);
          router.push(`/recettes/${r.slug}`);
        }
      } else {
        const r = await refineAction(creationId, p.id, text, kind === "fix");
        if (!r.ok) onError(r.error);
        else {
          onCreation(r.creation, r.budget);
          setAsk("");
        }
      }
      setDoing(null);
      onBusy(null);
    });
  };
  const working = doing != null;

  return (
    <article className={`grid gap-6 border-t border-line-strong pt-6 transition-opacity duration-[var(--dur-2)] ease-[var(--ease-out)] ${working && doing !== "save" ? "opacity-60" : ""}`} aria-busy={working}>
      <header key={d.name} className="reveal grid gap-4">
        <Tape tint={recipeVar(color)} seed={d.name} className="justify-self-start">
          {p.savedSlug ? "Dans tes recettes · à essayer" : `Proposition ${n}`}
        </Tape>
        <h3 className="text-h1">{d.name}</h3>
        <p className="num text-small text-ink-2">
          {d.servingsUnits} unités{minutes ? ` · ${minutes}${NB}min d’étapes` : ""}
          {d.fridgeDays != null ? ` · ${d.fridgeDays}${NB}j au frigo` : ""}
          {d.freezerOk ? " · se congèle" : ""}
          {d.ingredients.some((i) => i.side) ? " · garniture à part" : ""}
        </p>
        <p className="max-w-[56ch] text-lead text-ink-2">{p.pitch}</p>
        {d.tags.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {d.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-2">
        <p className="label text-faint">Une part, calculée par l’appli</p>
        <MacroRow className="gap-x-8">
          {p.figures.map((f) => (
            <div key={f.id} className="grid gap-1">
              <span className="text-small font-bold">
                {f.name} <span className="num font-normal text-ink-2">· {f.units}{NB}unités</span>
              </span>
              <MacroRow>
                <Macro value={f.kcal} unit="kcal" tone={f.level ? LEVEL[f.level].tone : undefined} />
                <Macro value={f.protein} unit="g" sub="protéines" tone={f.level ? LEVEL[f.level].tone : undefined} />
              </MacroRow>
              {f.level && <span className={`text-small font-bold ${LEVEL[f.level].tone === "ok" ? "text-ok-ink" : LEVEL[f.level].tone === "warn" ? "text-warn-ink" : "text-ko-ink"}`}>{LEVEL[f.level].word}</span>}
            </div>
          ))}
        </MacroRow>
        {p.verification.after.coverage < 0.95 && <p className="num text-small text-faint">{Math.round(p.verification.after.coverage * 100)}{NB}% des grammes connus de la table nutritionnelle</p>}
      </div>

      {(used.length > 0 || p.changes.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {used.length > 0 && (
            <div className="grid content-start gap-2">
              <p className="label text-faint">Inspirée de</p>
              <ul className="grid gap-1">
                {used.map((s) => (
                  <li key={s.id} className="text-body">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-bold underline decoration-1 underline-offset-4 hover:decoration-2">
                      {s.title}
                    </a>
                    <span className="text-small text-ink-2"> · {host(s.url)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.changes.length > 0 && (
            <div className="grid content-start gap-2">
              <p className="label text-faint">Ce qui change{used.length ? " par rapport à la source" : ""}</p>
              <ul className="grid gap-1 text-body text-ink-2">
                {p.changes.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span aria-hidden className="text-faint">–</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Notes
        title="Vérifications"
        items={
          p.defects.length
            ? [...ko, ...warn].map((x, k) => ({ tone: x.level, key: `${k}-${x.text}`, text: x.text }))
            : [{ tone: "ok", text: "Aliments connus, étapes sur ton équipement, durées et quantités cohérentes." }]
        }
      />

      {p.asks.length > 0 && (
        <div className="grid gap-1">
          <p className="label text-faint">Retouches</p>
          {p.asks.map((a) => (
            <p key={a.at} className="text-small text-ink-2">
              <b className="text-ink">{a.ask}</b> : {a.answer}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {p.savedSlug ? (
          <Link href={`/recettes/${p.savedSlug}`} className={buttonClass({ variant: "primary" })}>
            <Icon name="book" />
            Ouvrir la fiche
          </Link>
        ) : (
          <>
            <Button variant="primary" icon="check" onClick={() => act("save")} disabled={disabled || working || ko.length > 0} state={doing === "save" ? "loading" : "idle"} loadingLabel="Vérification et enregistrement…">
              Ajouter à mes recettes
            </Button>
            {ko.length > 0 && (
              <Button variant="accent" icon="refresh" onClick={() => act("fix")} disabled={disabled || working} state={doing === "fix" ? "loading" : "idle"} loadingLabel="Correction…">
                Corriger {ko.length > 1 ? `les ${ko.length} défauts` : "le défaut"}
              </Button>
            )}
          </>
        )}
        <Button variant="quiet" icon={open ? "minus" : "plus"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Replier la recette" : "Voir la recette"}
        </Button>
      </div>

      {!p.savedSlug && (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ask.trim()) act("refine", ask);
          }}
        >
          <Chips scroll className="sm:mx-0 sm:flex-wrap sm:px-0">
            {TOUCHES.map((t) => (
              <Chip key={t} pressed={ask === t} onClick={() => setAsk(t)} disabled={disabled || working}>
                {t}
              </Chip>
            ))}
          </Chips>
          <div className="flex gap-2">
            <Input value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={300} placeholder="Retoucher : plus de sauce, sans crème…" aria-label={`Retoucher ${d.name}`} className="min-w-0 flex-1" />
            <Button type="submit" disabled={disabled || working || !ask.trim()} state={doing === "refine" ? "loading" : "idle"} loadingLabel="Retouche…">
              Retoucher
            </Button>
          </div>
          <CostLine>Environ {fmtUsd(refineUsd)} par retouche ; tout est revérifié</CostLine>
        </form>
      )}

      {open && (
        <div className="grid gap-12">
          <IngredientsDiff rows={p.verification.rows.map((r) => ({ ...r, status: "same" as const }))} color={color} />
          <section className="grid gap-2">
            <SectionHead as="h3">Étapes</SectionHead>
            <StepsList steps={d.steps} before={null} color={color} />
          </section>
          {d.tips && (
            <section className="grid gap-4">
              <SectionHead as="h3">Conseils</SectionHead>
              <p className="max-w-[60ch] text-body text-ink-2">{d.tips}</p>
            </section>
          )}
        </div>
      )}
    </article>
  );
}
