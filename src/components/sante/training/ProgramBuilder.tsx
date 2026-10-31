"use client";

// Créer un programme : partir d’un modèle, le composer sans IA (bibliothèque d’exercices animés),
// ou le faire écrire par l’IA, qui peut inventer un exercice et sa figure (vérifiée par le code).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Chip, Chips, Field, Input, Segmented, Textarea } from "@/components/ui";
import { aiProgramAction, generateProgramAction, templateProgramAction, type ProgramResult } from "@/app/sante/entrainement/actions";
import { FOCUS_LABEL, type Focus, type ProgramRequest } from "@/lib/training/generate";
import { GEAR_LABEL, GEARS, type Gear } from "@/lib/training/library";
import { LoopingFigure } from "./KbFigure";

export interface TemplateInfo {
  id: string;
  name: string;
  perWeek: number;
  weekNote: string;
  sample: string;
}

export function ProgramBuilder({ personId, personName, templates, aiReady, onDone }: { personId: string; personName: string; templates: TemplateInfo[]; aiReady: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [req, setReq] = useState<ProgramRequest>({ gear: [], perWeek: 3, minutes: 30, level: 1, focus: "equilibre", notes: "" });
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"modele" | "generateur" | "ia" | null>(null);
  const [result, setResult] = useState<ProgramResult | null>(null);
  const set = <K extends keyof ProgramRequest>(k: K, v: ProgramRequest[K]) => setReq((r) => ({ ...r, [k]: v }));
  const toggle = (g: Gear) => set("gear", req.gear.includes(g) ? req.gear.filter((x) => x !== g) : [...req.gear, g]);

  const run = (kind: "modele" | "generateur" | "ia", call: () => Promise<ProgramResult>) => {
    setBusy(kind);
    setResult(null);
    start(async () => {
      const r = await call();
      setBusy(null);
      setResult(r);
      if (r.ok) {
        router.refresh();
        if (!r.warnings.length && !r.explanation) onDone?.();
      }
    });
  };

  return (
    <div className="grid gap-12">
      <section className="grid gap-6 border-t border-line-strong pt-4" aria-labelledby="modeles">
        <h2 id="modeles" className="text-h2">
          Partir d’un modèle
        </h2>
        <ul className="grid border-t border-line">
          {templates.map((t) => (
            <li key={t.id} className="grid gap-4 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="flex items-start gap-3">
                <LoopingFigure ex={t.sample} size={72} />
                <div className="grid gap-1">
                  <b className="text-h3">{t.name}</b>
                  <p className="text-small leading-snug text-ink-2">{t.weekNote}</p>
                </div>
              </div>
              <Button icon="check" disabled={pending} state={busy === "modele" ? "loading" : "idle"} loadingLabel="…" onClick={() => run("modele", () => templateProgramAction(personId, t.id))}>
                Choisir pour {personName}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-6 border-t border-line-strong pt-4" aria-labelledby="sur-mesure">
        <h2 id="sur-mesure" className="text-h2">
          Sur mesure
        </h2>
        <div className="grid max-w-2xl gap-6">
          <div className="grid gap-2">
            <span className="label text-ink-2">Matériel à la maison</span>
            <Chips>
              {GEARS.filter((g) => g !== "aucun").map((g) => (
                <Chip key={g} pressed={req.gear.includes(g)} onClick={() => toggle(g)}>
                  {GEAR_LABEL[g]}
                </Chip>
              ))}
            </Chips>
            <span className="text-small text-ink-2">Rien de coché : poids du corps et un tapis.</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <div className="grid gap-2">
              <span className="label text-ink-2">Séances par semaine</span>
              <Segmented label="Séances par semaine" value={String(req.perWeek)} onChange={(v) => set("perWeek", Number(v))} options={["2", "3", "4"].map((v) => ({ value: v, label: v }))} />
            </div>
            <div className="grid gap-2">
              <span className="label text-ink-2">Durée</span>
              <Segmented label="Durée d’une séance" value={String(req.minutes)} onChange={(v) => set("minutes", Number(v))} options={["20", "30", "45", "60"].map((v) => ({ value: v, label: `${v} min` }))} />
            </div>
            <div className="grid gap-2">
              <span className="label text-ink-2">Niveau</span>
              <Segmented
                label="Niveau"
                value={String(req.level)}
                onChange={(v) => set("level", Number(v) as 1 | 2 | 3)}
                options={[
                  { value: "1", label: "Débutant" },
                  { value: "2", label: "Intermédiaire" },
                  { value: "3", label: "Avancé" },
                ]}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <span className="label text-ink-2">Objectif</span>
            <Chips>
              {(Object.keys(FOCUS_LABEL) as Focus[]).map((f) => (
                <Chip key={f} pressed={req.focus === f} onClick={() => set("focus", f)}>
                  {FOCUS_LABEL[f]}
                </Chip>
              ))}
            </Chips>
          </div>
          <Field label="Nom du programme (facultatif)">{(id) => <Input id={id} value={req.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="Renfo du soir" maxLength={60} />}</Field>
          <Field label="Contraintes et envies (pour l’IA)" help="Une douleur, un exercice que tu détestes, une envie (« plus de fessiers », « rien au sol »).">
            {(id, d) => <Textarea id={id} aria-describedby={d} rows={3} value={req.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={800} />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button icon="sliders" disabled={pending} state={busy === "generateur" ? "loading" : "idle"} loadingLabel="Je compose…" onClick={() => run("generateur", () => generateProgramAction(personId, req))}>
              Composer sans IA
            </Button>
            <Button variant="primary" icon="sparkdraft" disabled={pending || !aiReady} state={busy === "ia" ? "loading" : "idle"} loadingLabel="L’IA écrit le programme…" onClick={() => run("ia", () => aiProgramAction(personId, req))}>
              Créer avec l’IA
            </Button>
          </div>
          <p className="text-small text-ink-2">
            Sans IA : les exercices de la bibliothèque, chacun avec sa figure animée. Avec l’IA : tes contraintes sont prises en compte, et un exercice qui manque peut être inventé avec sa figure, vérifiée par le code avant d’être gardée
            {aiReady ? "." : " (clé ANTHROPIC_API_KEY absente sur ce serveur)."}
          </p>
        </div>
      </section>

      {result && !result.ok && <Alert tone="ko" title="Pas de programme">{result.error}</Alert>}
      {result?.ok && (result.explanation || result.warnings.length > 0) && (
        <Alert tone={result.warnings.length ? "warn" : "ok"} title={`« ${result.name} » est prêt`} action={onDone && <Button onClick={onDone}>Voir</Button>}>
          {result.explanation && <p>{result.explanation}</p>}
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Alert>
      )}
    </div>
  );
}
