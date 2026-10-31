"use client";

// La cuisine du foyer, pas à pas : plaque, foyers, four, poêles, casseroles, cocotte et plats, appareils.
// Une question par écran, un choix par défaut déjà pris, « Je ne sais pas » toujours possible (la valeur
// par défaut sert et la question est notée « à vérifier »). Le planificateur n'utilise que ce qui est décrit.
// DA v3 : la question en grand, les choix en lignes à filets, l'aide concrète en marge, la progression en traits.
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Alert, Button, Check, Segmented, Stepper, Tag } from "@/components/ui";
import { saveKitchenAction, type FormState } from "@/app/reglages/actions";
import {
  DEFAULT_KITCHEN,
  HOB_SHORT,
  PAN_LABEL,
  casseroleLiters,
  hobPresets,
  kitchenSummary,
  matchHobPreset,
  typicalLevels,
  type HobType,
  type KitchenConfig,
  type KitchenQuestion,
  type PanMaterial,
} from "@/lib/kitchen/presets";
import { Block, ChoiceRow, Choices, HowTo, Line, QuestionHead, Ticks } from "./parts";

const fmt = (n: number) => String(n).replace(".", ",");
const NB = " "; // espace fine insécable, avant « ? » et entre un nombre et son unité

const STEPS: { title: string; ask: string; hint: string; questions: KitchenQuestion[] }[] = [
  { title: "La plaque", ask: `Quelle plaque as-tu${NB}?`, hint: "Le planificateur règle les feux et les temps d’après elle.", questions: ["hobType"] },
  { title: "Les foyers", ask: `Combien de foyers, de quelle taille${NB}?`, hint: "Un foyer trop petit sous une grande poêle, et la viande bout au lieu de dorer.", questions: ["hobSizes", "levels"] },
  { title: "Le four", ask: `Et le four${NB}?`, hint: "Deux plats ensemble à deux hauteurs, c’est vingt minutes de gagnées.", questions: ["oven"] },
  { title: "Les poêles", ask: `Quelles poêles${NB}?`, hint: "La grande en inox ou en fonte sert à saisir ; l’antiadhésive garde les œufs.", questions: ["pans"] },
  { title: "Casseroles et faitout", ask: `Quelles casseroles${NB}?`, hint: "Le riz, les sauces, l’eau des pâtes : chacune a sa place sur le feu.", questions: ["casseroles"] },
  { title: "Cocotte et plats à four", ask: `Une cocotte, des plats à four${NB}?`, hint: "Pour les mijotés et les gratins, qui se font pendant qu’on fait autre chose.", questions: ["pots", "plats"] },
  { title: "Les appareils", ask: `Quels appareils${NB}?`, hint: "Coche ce qui est dans tes placards, même rangé au fond.", questions: ["airFryer", "mixers", "extras"] },
  { title: "Récapitulatif", ask: "Ta cuisine, en résumé", hint: "Touche une ligne pour la corriger.", questions: [] },
];
const RECAP = STEPS.length - 1;
/** Rubrique du récapitulatif → étape du parcours. */
const SUMMARY_STEP = [0, 2, 3, 4, 5, 6];

const HOB_HINT: Record<HobType, string> = {
  induction: "Lisse et noire ; un aimant colle sous les casseroles qui y chauffent.",
  gaz: "Des brûleurs et des flammes, sous une grille.",
  vitroceramique: "Lisse et noire, les cercles rougissent en chauffant.",
  electrique: "Des plaques rondes en fonte, grises.",
};

/** Une plaque vue de haut : chaque foyer à l'échelle de son diamètre. */
export function HobLayout({ sizes, size = 72 }: { sizes: number[]; size?: number }) {
  const cols = sizes.length <= 2 ? sizes.length : sizes.length === 4 ? 2 : 3;
  const rows = Math.ceil(sizes.length / cols);
  const cell = 32;
  const w = cols * cell + 6;
  const h = rows * cell + 6;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={size} height={(size * h) / w} aria-hidden className="shrink-0 text-ink-2">
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="4" fill="var(--c-surface-2)" stroke="currentColor" strokeWidth="1.2" />
      {sizes.map((cm, i) => (
        <circle key={i} cx={3 + (i % cols) * cell + cell / 2} cy={3 + Math.floor(i / cols) * cell + cell / 2} r={(cm / 30) * (cell / 2 - 1)} fill="none" stroke="currentColor" strokeWidth="1.4" />
      ))}
    </svg>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Segmented label={label} value={value ? "oui" : "non"} onChange={(v) => onChange(v === "oui")} options={[{ value: "oui", label: "Oui" }, { value: "non", label: "Non" }]} />;
}

/** Un groupe de cases, sous son repère. */
function Boxes({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <p className="label text-faint">{title}</p>
      <div className="grid gap-x-6 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/**
 * `guided` : parcours de la mise en route (la question est le titre de la page, `onExit` au retour de la
 * première question, `onSaved` après l'enregistrement). Sinon : le résumé d'abord, une ligne → sa question.
 */
export function KitchenForm({ initial, guided = false, onSaved, onExit, kicker = "La cuisine" }: { initial: KitchenConfig; guided?: boolean; onSaved?: () => void; onExit?: () => void; kicker?: string }) {
  const [c, setC] = useState(initial);
  const [step, setStep] = useState(guided ? 0 : RECAP);
  const [custom, setCustom] = useState(() => !matchHobPreset(initial.hobType, initial.hobSizes));
  const [msg, setMsg] = useState<FormState>(null);
  const [pending, start] = useTransition();
  const top = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  // Nouvelle question : on la remet en haut de l'écran si elle en est sortie (téléphone), sans animation.
  useEffect(() => {
    if (!moved.current) {
      moved.current = true;
      return;
    }
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, [step]);

  const set = (patch: Partial<KitchenConfig>, answered: KitchenQuestion[] = []) => {
    setMsg(null);
    setC((cur) => ({ ...cur, ...patch, unsure: cur.unsure.filter((q) => !answered.includes(q)) }));
  };
  const go = (n: number) => setStep(Math.max(0, Math.min(RECAP, n)));
  // « Je ne sais pas » : les valeurs par défaut de l'étape, la question notée, et on avance.
  const dunno = () => {
    const qs = STEPS[step].questions;
    const d = DEFAULT_KITCHEN;
    const patch: Partial<KitchenConfig> = {};
    if (qs.includes("hobType")) Object.assign(patch, { hobType: d.hobType, levels: d.levels });
    if (qs.includes("hobSizes")) Object.assign(patch, { hobSizes: hobPresets(c.hobType)[0].sizes, levels: typicalLevels(c.hobType) });
    if (qs.includes("oven")) Object.assign(patch, { ovenLevels: d.ovenLevels, ovenFan: d.ovenFan });
    if (qs.includes("pans")) Object.assign(patch, { pans: d.pans, poeleMaxG: null });
    if (qs.includes("casseroles")) Object.assign(patch, { casseroles: d.casseroles, faitout: d.faitout });
    if (qs.includes("pots")) Object.assign(patch, { cocotte: d.cocotte, plats: d.plats });
    setMsg(null);
    setC((cur) => ({ ...cur, ...patch, unsure: [...new Set([...cur.unsure, ...qs])] }));
    if (qs.includes("hobSizes")) setCustom(false);
    go(step + 1);
  };
  const save = () =>
    start(async () => {
      const r = await saveKitchenAction(c);
      setMsg(r);
      if (r?.ok) onSaved?.();
    });

  const presets = hobPresets(c.hobType);
  const preset = matchHobPreset(c.hobType, c.hobSizes);

  const screens: { main: ReactNode; help?: ReactNode }[] = [
    // 1. La plaque
    {
      main: (
        <Choices>
          {(Object.keys(HOB_SHORT) as HobType[]).map((t) => (
            <ChoiceRow
              key={t}
              on={c.hobType === t}
              icon={t === "gaz" ? "flame" : "hob"}
              title={HOB_SHORT[t]}
              hint={HOB_HINT[t]}
              onClick={() => {
                const sizes = matchHobPreset(c.hobType, c.hobSizes) ? hobPresets(t)[0].sizes : c.hobSizes;
                set({ hobType: t, levels: typicalLevels(t), hobSizes: sizes }, ["hobType"]);
                go(1);
              }}
            />
          ))}
        </Choices>
      ),
      help: (
        <HowTo title="Comment savoir">
          <p>Pose un aimant sous une casserole : s’il colle et que la plaque est lisse, c’est très probablement de l’induction.</p>
          <p>Le mot est souvent écrit sur la plaque, ou sous la commande.</p>
        </HowTo>
      ),
    },

    // 2. Les foyers
    {
      main: (
        <div className="grid gap-6">
          <Choices>
            {presets.map((p) => (
              <ChoiceRow
                key={p.id}
                on={!custom && preset?.id === p.id}
                art={<HobLayout sizes={p.sizes} size={56} />}
                title={p.label}
                hint={p.hint}
                onClick={() => {
                  setCustom(false);
                  set({ hobSizes: p.sizes }, ["hobSizes"]);
                }}
              />
            ))}
            <ChoiceRow on={custom} icon="sliders" title="Une autre plaque" hint="Je donne le diamètre de chaque foyer." onClick={() => setCustom(true)} />
          </Choices>
          {custom && (
            <div className="grid gap-3">
              <div className="flex items-center gap-4">
                <HobLayout sizes={c.hobSizes} size={64} />
                <span className="text-small text-ink-2">Du plus grand au plus petit.</span>
              </div>
              {c.hobSizes.map((cm, i) => (
                <Line key={i}>
                  <span className="label w-18 text-ink-2">Foyer {i + 1}</span>
                  <Stepper decLabel={`Foyer ${i + 1} plus petit`} incLabel={`Foyer ${i + 1} plus grand`} value={cm} min={10} max={36} step={0.5} unit="cm" onChange={(n) => set({ hobSizes: c.hobSizes.map((x, j) => (j === i ? n : x)) }, ["hobSizes"])} />
                  {c.hobSizes.length > 1 && <Button size="sm" variant="quiet" icon="trash" iconOnly aria-label={`Retirer le foyer ${i + 1}`} onClick={() => set({ hobSizes: c.hobSizes.filter((_, j) => j !== i) }, ["hobSizes"])} />}
                </Line>
              ))}
              {c.hobSizes.length < 6 && (
                <Button size="sm" icon="plus" className="justify-self-start" onClick={() => set({ hobSizes: [...c.hobSizes, 16] }, ["hobSizes"])}>
                  Un foyer de plus
                </Button>
              )}
            </div>
          )}
          <Block title="Les chiffres du bouton">
            <Segmented
              label="Niveaux de puissance"
              value={c.levels === 0 ? "0" : c.levels === 9 ? "9" : c.levels === 12 ? "12" : "autre"}
              onChange={(v) => set({ levels: v === "autre" ? 6 : Number(v) }, ["levels"])}
              options={[
                { value: "9", label: "1 à 9" },
                { value: "12", label: "1 à 12" },
                { value: "0", label: "Pas de chiffres" },
                { value: "autre", label: "Autre" },
              ]}
            />
            {![0, 9, 12].includes(c.levels) && <Stepper decLabel="Moins" incLabel="Plus" value={c.levels} min={1} max={12} onChange={(n) => set({ levels: n }, ["levels"])} />}
            {c.levels === 0 && <p className="text-small text-ink-2">Les recettes diront « doux », « moyen », « vif ».</p>}
          </Block>
        </div>
      ),
      help: (
        <HowTo title="Comment mesurer un foyer">
          <p>Mesure le cercle dessiné sur la plaque, d’un bord à l’autre en passant par le centre. Deux cercles l’un dans l’autre : prends le grand.</p>
          <p>Au gaz : prends la plus grande casserole qui tient bien sur la grille sans que les flammes dépassent, et mesure son fond.</p>
          <p>Une zone rectangulaire, qui relie deux foyers, compte comme un grand foyer de 28{NB}cm.</p>
        </HowTo>
      ),
    },

    // 3. Le four
    {
      main: (
        <div className="grid gap-6">
          <Choices>
            <ChoiceRow on={c.oven} icon="oven" title="J’ai un four" onClick={() => set({ oven: true }, ["oven"])} />
            <ChoiceRow on={!c.oven} icon="x" title="Pas de four" hint="Les plats au four seront signalés." onClick={() => set({ oven: false }, ["oven"])} />
          </Choices>
          {c.oven && (
            <div className="grid gap-4">
              <Line>
                <Stepper decLabel="Un gradin de moins" incLabel="Un gradin de plus" value={c.ovenLevels} min={1} max={7} onChange={(n) => set({ ovenLevels: n }, ["oven"])} />
                Gradins (hauteurs de grille)
              </Line>
              <Line>
                <YesNo label="Chaleur tournante" value={c.ovenFan} onChange={(v) => set({ ovenFan: v }, ["oven"])} />
                Chaleur tournante
              </Line>
            </div>
          )}
        </div>
      ),
      help: c.oven ? (
        <HowTo title="Comment savoir">
          <p>Gradins : compte les rainures sur une paroi du four, de haut en bas.</p>
          <p>Chaleur tournante : un ventilateur au fond du four, et une hélice (souvent dans un cercle) sur le bouton. Avec, deux plats cuisent ensemble à deux hauteurs.</p>
        </HowTo>
      ) : undefined,
    },

    // 4. Les poêles
    {
      main: (
        <div className="grid">
          {c.pans.map((p, i) => (
            <Block key={i} icon="pan" title={`Poêle ${i + 1}`} aside={<Button size="sm" variant="quiet" icon="trash" iconOnly aria-label={`Retirer la poêle ${i + 1}`} onClick={() => set({ pans: c.pans.filter((_, j) => j !== i) }, ["pans"])} />}>
              <Segmented
                label={`Matière de la poêle ${i + 1}`}
                value={p.material}
                onChange={(m: PanMaterial) => set({ pans: c.pans.map((x, j) => (j === i ? { ...x, material: m } : x)) }, ["pans"])}
                options={(Object.keys(PAN_LABEL) as PanMaterial[]).map((m) => ({ value: m, label: PAN_LABEL[m][0].toUpperCase() + PAN_LABEL[m].slice(1) }))}
              />
              <Line>
                <Stepper decLabel="Plus petite" incLabel="Plus grande" value={p.cm} min={16} max={34} step={2} unit="cm" onChange={(n) => set({ pans: c.pans.map((x, j) => (j === i ? { ...x, cm: n } : x)) }, ["pans"])} />
                Diamètre
              </Line>
            </Block>
          ))}
          <div className="grid gap-4 border-t border-line pt-4">
            {c.pans.length < 3 && (
              <Button icon="plus" className="justify-self-start" onClick={() => set({ pans: [...c.pans, { material: c.pans.length ? "antiadhesive" : "inox", cm: c.pans.length ? 24 : 28 }] }, ["pans"])}>
                {c.pans.length ? "Une autre poêle" : "Une poêle"}
              </Button>
            )}
            {c.pans.length > 0 && (
              <Line>
                <Stepper decLabel="Moins" incLabel="Plus" value={c.poeleMaxG ?? 500} min={200} max={1500} step={50} unit="g" onChange={(n) => set({ poeleMaxG: n }, ["pans"])} />
                Viande par fournée dans la grande poêle
              </Line>
            )}
          </div>
        </div>
      ),
      help: (
        <HowTo title="Comment savoir">
          <p>Diamètre : mesure le haut de la poêle, d’un bord à l’autre. Il est souvent gravé dessous.</p>
          <p>Antiadhésive : un revêtement sombre et lisse à l’intérieur. Inox : métal brillant. Fonte : noire, lourde, mate.</p>
        </HowTo>
      ),
    },

    // 5. Casseroles et faitout
    {
      main: (
        <div className="grid">
          {c.casseroles.map((k, i) => (
            <Block key={i} icon="pot" title={`Casserole ${i + 1}`} aside={<Button size="sm" variant="quiet" icon="trash" iconOnly aria-label={`Retirer la casserole ${i + 1}`} onClick={() => set({ casseroles: c.casseroles.filter((_, j) => j !== i) }, ["casseroles"])} />}>
              <Line>
                <Stepper decLabel="Plus petite" incLabel="Plus grande" value={k.cm} min={10} max={28} step={2} unit="cm" onChange={(n) => set({ casseroles: c.casseroles.map((x, j) => (j === i ? { ...x, cm: n } : x)) }, ["casseroles"])} />
                Diamètre du fond
              </Line>
              <Line>
                {k.liters == null ? (
                  <>
                    <span className="num text-ink-2">
                      Environ {fmt(casseroleLiters(k.cm))}
                      {NB}L
                    </span>
                    <Button size="sm" variant="quiet" onClick={() => set({ casseroles: c.casseroles.map((x, j) => (j === i ? { ...x, liters: casseroleLiters(k.cm) } : x)) }, ["casseroles"])}>
                      Je connais la contenance
                    </Button>
                  </>
                ) : (
                  <>
                    <Stepper decLabel="Moins" incLabel="Plus" value={k.liters} min={0.5} max={8} step={0.5} unit="L" onChange={(n) => set({ casseroles: c.casseroles.map((x, j) => (j === i ? { ...x, liters: n } : x)) }, ["casseroles"])} />
                    Contenance
                    <Button size="sm" variant="quiet" onClick={() => set({ casseroles: c.casseroles.map((x, j) => (j === i ? { ...x, liters: null } : x)) })}>
                      Je ne sais pas
                    </Button>
                  </>
                )}
              </Line>
            </Block>
          ))}
          {c.casseroles.length < 3 && (
            <div className="border-t border-line py-4">
              <Button icon="plus" onClick={() => set({ casseroles: [...c.casseroles, { cm: 16 + 2 * c.casseroles.length, liters: null }] }, ["casseroles"])}>
                {c.casseroles.length ? "Une autre casserole" : "Une casserole"}
              </Button>
            </div>
          )}
          <Block icon="pot" title="Un faitout, la grande marmite à deux poignées" aside={<YesNo label="Un faitout" value={!!c.faitout} onChange={(v) => set({ faitout: v ? (c.faitout ?? DEFAULT_KITCHEN.faitout) : null }, ["casseroles"])} />}>
            {c.faitout && (
              <>
                <Line>
                  <Stepper decLabel="Moins" incLabel="Plus" value={c.faitout.liters} min={2} max={15} step={0.5} unit="L" onChange={(n) => set({ faitout: { ...c.faitout!, liters: n } }, ["casseroles"])} />
                  Contenance
                </Line>
                <Check checked={c.faitout.ovenSafe} onChange={(e) => set({ faitout: { ...c.faitout!, ovenSafe: e.target.checked } }, ["casseroles"])}>
                  Il passe au four (poignées en métal)
                </Check>
              </>
            )}
          </Block>
        </div>
      ),
      help: (
        <HowTo title="Comment mesurer">
          <p>Casserole : mesure le fond, à l’extérieur ; c’est lui qui touche le foyer.</p>
          <p>Contenance : souvent gravée dessous ou graduée à l’intérieur. Sinon, compte les verres doseurs d’eau jusqu’à 2{NB}cm du bord. Sans réponse, Mijote l’estime d’après le diamètre.</p>
        </HowTo>
      ),
    },

    // 6. Cocotte et plats à four
    {
      main: (
        <div className="grid">
          <Block icon="pot" title="Une cocotte en fonte" aside={<YesNo label="Une cocotte en fonte" value={!!c.cocotte} onChange={(v) => set({ cocotte: v ? (c.cocotte ?? DEFAULT_KITCHEN.cocotte) : null }, ["pots"])} />}>
            {c.cocotte && (
              <>
                <Line>
                  <Stepper decLabel="Moins" incLabel="Plus" value={c.cocotte.liters} min={2} max={12} step={0.5} unit="L" onChange={(n) => set({ cocotte: { ...c.cocotte!, liters: n } }, ["pots"])} />
                  Contenance
                </Line>
                <Check checked={c.cocotte.ovenSafe} onChange={(e) => set({ cocotte: { ...c.cocotte!, ovenSafe: e.target.checked } }, ["pots"])}>
                  Elle passe au four (bouton du couvercle en métal)
                </Check>
                {c.cocotte.ovenSafe && c.oven && <p className="text-small text-ink-2">Les braisages pourront finir au four pendant que la plaque sert à autre chose.</p>}
              </>
            )}
          </Block>
          <Block icon="oven" title="Plats à four">
            {c.oven ? (
              <>
                <Line>
                  <Stepper decLabel="Un plat de moins" incLabel="Un plat de plus" value={c.plats} min={0} max={3} onChange={(n) => set({ plats: n }, ["plats"])} />
                  Gratins, rôtis
                </Line>
                <p className="text-small text-ink-2">
                  Le premier compte comme un grand plat (environ 28{NB}×{NB}21{NB}cm), puis un moyen, puis un petit.
                </p>
              </>
            ) : (
              <p className="text-small text-ink-2">Sans four, pas de plat à four.</p>
            )}
          </Block>
        </div>
      ),
      help: (
        <HowTo title="Comment savoir">
          <p>Une cocotte en fonte est lourde, avec un couvercle épais ; la contenance en litres est souvent gravée dessous.</p>
          <p>Un bouton de couvercle en plastique ne va pas au four.</p>
        </HowTo>
      ),
    },

    // 7. Les appareils
    {
      main: (
        <div className="grid gap-4">
          <Block icon="basket" title="Un air fryer, la friteuse sans huile" aside={<YesNo label="Un air fryer" value={c.airFryerL > 0} onChange={(v) => set({ airFryerL: v ? 5 : 0 }, ["airFryer"])} />}>
            {c.airFryerL > 0 && (
              <>
                <Line>
                  <Stepper decLabel="Moins" incLabel="Plus" value={c.airFryerL} min={1.5} max={12} step={0.5} unit="L" onChange={(n) => set({ airFryerL: n }, ["airFryer"])} />
                  Contenance du panier
                </Line>
                <p className="text-small text-ink-2">Le planificateur peut y cuire une plaque de légumes ou de poulet pendant que le four fait autre chose.</p>
              </>
            )}
          </Block>
          <Boxes title="Pour mixer et hacher">
            <Check checked={c.mixers.plongeant} onChange={(e) => set({ mixers: { ...c.mixers, plongeant: e.target.checked } }, ["mixers"])}>
              Mixeur plongeant
            </Check>
            <Check checked={c.mixers.blender} onChange={(e) => set({ mixers: { ...c.mixers, blender: e.target.checked } }, ["mixers"])}>
              Blender
            </Check>
            <Check checked={c.mixers.hachoir} onChange={(e) => set({ mixers: { ...c.mixers, hachoir: e.target.checked } }, ["mixers"])}>
              Petit hachoir
            </Check>
            <Check checked={c.extras.robot} onChange={(e) => set({ extras: { ...c.extras, robot: e.target.checked } }, ["extras"])}>
              Robot multifonction
            </Check>
          </Boxes>
          <Boxes title="Le reste">
            <Check checked={c.extras.microOndes} onChange={(e) => set({ extras: { ...c.extras, microOndes: e.target.checked } }, ["extras"])}>
              Micro-ondes
            </Check>
            <Check checked={c.extras.congelateur} onChange={(e) => set({ extras: { ...c.extras, congelateur: e.target.checked } }, ["extras"])}>
              Congélateur
            </Check>
            <Check checked={c.extras.balance} onChange={(e) => set({ extras: { ...c.extras, balance: e.target.checked } }, ["extras"])}>
              Balance de cuisine
            </Check>
            <Check checked={c.extras.autocuiseur} onChange={(e) => set({ extras: { ...c.extras, autocuiseur: e.target.checked } }, ["extras"])}>
              Autocuiseur
            </Check>
            <Check checked={c.extras.cuiseurRiz} onChange={(e) => set({ extras: { ...c.extras, cuiseurRiz: e.target.checked } }, ["extras"])}>
              Cuiseur à riz
            </Check>
            <Check checked={c.duo} onChange={(e) => set({ duo: e.target.checked })}>
              Deux planches et deux grands couteaux, pour cuisiner à deux
            </Check>
          </Boxes>
        </div>
      ),
      help: (
        <HowTo title="Comment savoir">
          <p>La contenance d’un air fryer est écrite sur le panier ou sur la boîte, souvent entre 3,5 et 6{NB}L.</p>
        </HowTo>
      ),
    },

    // 8. Récapitulatif
    {
      main: (
        <div className="grid gap-6">
          <ul className="grid border-t border-line">
            {kitchenSummary(c).map((row, i) => (
              <li key={row.label} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => go(SUMMARY_STEP[i])}
                  className="group grid min-h-tap w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-4 text-left hover:bg-surface-2 sm:grid-cols-[176px_minmax(0,1fr)_auto]"
                >
                  <span className="flex flex-wrap items-center gap-2 text-small font-bold text-ink-2">
                    {row.label}
                    {row.unsure && <Tag tone="warn">à vérifier</Tag>}
                  </span>
                  <span className="col-start-1 text-body sm:col-start-2 sm:row-start-1">{row.text}</span>
                  <span className="col-start-2 row-span-2 row-start-1 text-small font-bold text-faint group-hover:text-ink sm:col-start-3 sm:row-span-1">Changer</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary" icon="check" state={pending ? "loading" : "idle"} loadingLabel="Enregistrement…" onClick={save}>
              {guided ? "C’est ma cuisine" : "Enregistrer la cuisine"}
            </Button>
            {guided ? (
              <Button variant="quiet" onClick={() => go(RECAP - 1)}>
                Précédent
              </Button>
            ) : (
              <Button variant="quiet" icon="refresh" onClick={() => go(0)}>
                Reprendre pas à pas
              </Button>
            )}
            {msg?.ok && (
              <span role="status" className="text-small font-bold text-ok-ink">
                {msg.message}
              </span>
            )}
          </div>
          {msg && !msg.ok && <Alert tone="ko">{msg.message}</Alert>}
        </div>
      ),
    },
  ];

  const s = screens[step];
  const ask = STEPS[step];
  const kick = step < RECAP ? `${kicker} · ${step + 1} sur ${RECAP}` : guided ? kicker : undefined;
  return (
    <div ref={top} className="grid scroll-mt-24 gap-8 lg:grid-cols-12 lg:gap-x-6">
      <div className={`grid min-w-0 content-start gap-8 ${s.help ? "lg:col-span-7" : guided ? "lg:col-span-8" : "lg:col-span-12"}`}>
        <div className="grid gap-4">
          {!guided && step < RECAP && <Ticks total={RECAP + 1} at={step} label="Avancement de la description de la cuisine" />}
          {/* La clé rejoue l'arrivée de la question à chaque écran (pas à chaque geste). */}
          <div key={step} className="reveal">
            <QuestionHead as={guided ? "h1" : "h3"} size={guided ? "page" : "section"} kicker={kick} title={ask.ask} hint={ask.hint} />
          </div>
        </div>
        {s.main}
        {step < RECAP && (
          <div className="flex flex-wrap items-center gap-2">
            {step > 0 ? (
              <Button variant="quiet" onClick={() => go(step - 1)}>
                Précédent
              </Button>
            ) : (
              guided && onExit && (
                <Button variant="quiet" onClick={onExit}>
                  Précédent
                </Button>
              )
            )}
            <Button variant="quiet" onClick={dunno}>
              Je ne sais pas
            </Button>
            {!guided && (
              <Button variant="quiet" onClick={() => go(RECAP)}>
                Revenir au résumé
              </Button>
            )}
            <Button variant="primary" className="ml-auto" onClick={() => go(step + 1)}>
              {step === RECAP - 1 ? "Voir le résumé" : "Continuer"}
            </Button>
          </div>
        )}
      </div>
      {s.help && <aside className="min-w-0 lg:col-span-4 lg:col-start-9 lg:pt-12">{s.help}</aside>}
    </div>
  );
}
