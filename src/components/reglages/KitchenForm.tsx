"use client";

// La cuisine du foyer, pas à pas : plaque, foyers, four, poêles, casseroles, cocotte et plats, appareils.
// Une question par écran, un choix par défaut déjà pris, « Je ne sais pas » toujours possible (la valeur
// par défaut sert et la question est notée « à vérifier »). Le planificateur n'utilise que ce qui est décrit.
import { useState, useTransition, type ReactNode } from "react";
import { Alert, Button, Card, Check, Icon, Progress, Segmented, Stepper, Tag, type IconName } from "@/components/ui";
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

const fmt = (n: number) => String(n).replace(".", ",");

const STEPS: { title: string; questions: KitchenQuestion[] }[] = [
  { title: "La plaque", questions: ["hobType"] },
  { title: "Les foyers", questions: ["hobSizes", "levels"] },
  { title: "Le four", questions: ["oven"] },
  { title: "Les poêles", questions: ["pans"] },
  { title: "Casseroles et faitout", questions: ["casseroles"] },
  { title: "Cocotte et plats à four", questions: ["pots", "plats"] },
  { title: "Les appareils", questions: ["airFryer", "mixers", "extras"] },
  { title: "Récapitulatif", questions: [] },
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

/** Grand bouton de choix (doigt d'abord) : un titre, une aide, un dessin facultatif. */
function Option({ on, onClick, title, hint, icon, art }: { on: boolean; onClick: () => void; title: ReactNode; hint?: ReactNode; icon?: IconName; art?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-tap w-full items-center gap-3 rounded-[14px] border px-3.5 py-3 text-left transition-[background-color,border-color,transform] duration-[var(--dur-quick)] active:scale-[0.98] ${on ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong"}`}
    >
      {art ?? (icon && <Icon name={icon} size="l" className={on ? "text-accent" : "text-ink-2"} />)}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <b className="text-[15px]">{title}</b>
        {hint && <span className="text-[13px] text-ink-2">{hint}</span>}
      </span>
      {on && <Icon name="check" size="m" className="text-accent" />}
    </button>
  );
}

/** Une plaque vue de haut : chaque foyer à l'échelle de son diamètre. */
export function HobLayout({ sizes, size = 72 }: { sizes: number[]; size?: number }) {
  const cols = sizes.length <= 2 ? sizes.length : sizes.length === 4 ? 2 : 3;
  const rows = Math.ceil(sizes.length / cols);
  const cell = 32;
  const w = cols * cell + 6;
  const h = rows * cell + 6;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={size} height={(size * h) / w} aria-hidden className="shrink-0 text-ink-2">
      <rect x="1" y="1" width={w - 2} height={h - 2} rx="5" fill="var(--c-surface-2)" stroke="currentColor" strokeWidth="1.2" />
      {sizes.map((cm, i) => (
        <circle key={i} cx={3 + (i % cols) * cell + cell / 2} cy={3 + Math.floor(i / cols) * cell + cell / 2} r={(cm / 30) * (cell / 2 - 1)} fill="none" stroke="currentColor" strokeWidth="1.4" />
      ))}
    </svg>
  );
}

function Help({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-[12px] bg-surface-2 px-3.5 py-2.5 text-[14px]">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold">
        <Icon name="info" size="s" className="text-accent" />
        {title}
      </summary>
      <div className="mt-2 grid gap-1.5 text-ink-2">{children}</div>
    </details>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px]">{children}</div>;
}

function YesNo({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Segmented label={label} value={value ? "oui" : "non"} onChange={(v) => onChange(v === "oui")} options={[{ value: "oui", label: "Oui" }, { value: "non", label: "Non" }]} />;
}

export function KitchenForm({ initial, guided = false, onSaved }: { initial: KitchenConfig; guided?: boolean; onSaved?: () => void }) {
  const [c, setC] = useState(initial);
  const [step, setStep] = useState(guided ? 0 : RECAP);
  const [custom, setCustom] = useState(() => !matchHobPreset(initial.hobType, initial.hobSizes));
  const [msg, setMsg] = useState<FormState>(null);
  const [pending, start] = useTransition();

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

  const body: ReactNode[] = [
    // 1. La plaque
    <div key="type" className="grid gap-2">
      {(Object.keys(HOB_SHORT) as HobType[]).map((t) => (
        <Option
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
      <Help title="Comment savoir ?">
        <p>Pose un aimant sous une casserole : s&apos;il colle et que la plaque est lisse, c&apos;est très probablement de l&apos;induction. Le mot est souvent écrit sur la plaque ou sous la commande.</p>
      </Help>
    </div>,

    // 2. Les foyers
    <div key="hobs" className="grid gap-3">
      <div className="grid gap-2">
        {presets.map((p) => (
          <Option
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
        <Option on={custom} icon="sliders" title="Autre plaque" hint="Je donne le diamètre de chaque foyer." onClick={() => setCustom(true)} />
      </div>
      {custom && (
        <Card flat pad="sm" className="grid gap-2">
          <div className="flex items-center gap-3">
            <HobLayout sizes={c.hobSizes} size={64} />
            <span className="text-[14px] text-ink-2">Du plus grand au plus petit.</span>
          </div>
          {c.hobSizes.map((cm, i) => (
            <Row key={i}>
              <span className="w-16 font-semibold">Foyer {i + 1}</span>
              <Stepper decLabel={`Foyer ${i + 1} plus petit`} incLabel={`Foyer ${i + 1} plus grand`} value={cm} min={10} max={36} step={0.5} unit="cm" onChange={(n) => set({ hobSizes: c.hobSizes.map((x, j) => (j === i ? n : x)) }, ["hobSizes"])} />
              {c.hobSizes.length > 1 && <Button size="sm" variant="quiet" icon="trash" iconOnly aria-label={`Retirer le foyer ${i + 1}`} onClick={() => set({ hobSizes: c.hobSizes.filter((_, j) => j !== i) }, ["hobSizes"])} />}
            </Row>
          ))}
          {c.hobSizes.length < 6 && (
            <Button size="sm" icon="plus" className="justify-self-start" onClick={() => set({ hobSizes: [...c.hobSizes, 16] }, ["hobSizes"])}>
              Un foyer de plus
            </Button>
          )}
        </Card>
      )}
      <Help title="Comment mesurer un foyer">
        <p>Mesure le cercle dessiné sur la plaque, d&apos;un bord à l&apos;autre en passant par le centre. Deux cercles l&apos;un dans l&apos;autre : prends le grand.</p>
        <p>Au gaz : prends la plus grande casserole qui tient bien sur la grille sans que les flammes dépassent, et mesure son fond.</p>
        <p>Une zone « bridge » ou rectangulaire compte comme un grand foyer de 28 cm.</p>
      </Help>
      <div className="grid gap-1.5">
        <span className="text-[14px] font-semibold">Niveaux de puissance</span>
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
        {c.levels === 0 && <p className="text-[13px] text-ink-2">Les recettes diront « doux, moyen, vif ».</p>}
      </div>
    </div>,

    // 3. Le four
    <div key="oven" className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Option on={c.oven} icon="oven" title="J'ai un four" onClick={() => set({ oven: true }, ["oven"])} />
        <Option on={!c.oven} icon="x" title="Pas de four" hint="Les plats au four seront signalés." onClick={() => set({ oven: false }, ["oven"])} />
      </div>
      {c.oven && (
        <>
          <Row>
            <Stepper decLabel="Un gradin de moins" incLabel="Un gradin de plus" value={c.ovenLevels} min={1} max={7} onChange={(n) => set({ ovenLevels: n }, ["oven"])} />
            Gradins (hauteurs de grille)
          </Row>
          <Row>
            <YesNo label="Chaleur tournante" value={c.ovenFan} onChange={(v) => set({ ovenFan: v }, ["oven"])} />
            Chaleur tournante
          </Row>
          <Help title="Comment savoir ?">
            <p>Gradins : compte les rainures sur une paroi du four, de haut en bas.</p>
            <p>Chaleur tournante : un ventilateur au fond du four, et un symbole d&apos;hélice (souvent dans un cercle) sur le bouton. Avec, deux plats cuisent ensemble à deux hauteurs.</p>
          </Help>
        </>
      )}
    </div>,

    // 4. Les poêles
    <div key="pans" className="grid gap-3">
      {c.pans.map((p, i) => (
        <Card key={i} flat pad="sm" className="grid gap-2">
          <Row>
            <Icon name="pan" size="m" className="text-ink-2" />
            <b>Poêle {i + 1}</b>
            <Button size="sm" variant="quiet" icon="trash" iconOnly aria-label={`Retirer la poêle ${i + 1}`} className="ml-auto" onClick={() => set({ pans: c.pans.filter((_, j) => j !== i) }, ["pans"])} />
          </Row>
          <Segmented
            label={`Matière de la poêle ${i + 1}`}
            value={p.material}
            onChange={(m: PanMaterial) => set({ pans: c.pans.map((x, j) => (j === i ? { ...x, material: m } : x)) }, ["pans"])}
            options={(Object.keys(PAN_LABEL) as PanMaterial[]).map((m) => ({ value: m, label: PAN_LABEL[m][0].toUpperCase() + PAN_LABEL[m].slice(1) }))}
          />
          <Row>
            <Stepper decLabel="Plus petite" incLabel="Plus grande" value={p.cm} min={16} max={34} step={2} unit="cm" onChange={(n) => set({ pans: c.pans.map((x, j) => (j === i ? { ...x, cm: n } : x)) }, ["pans"])} />
            Diamètre
          </Row>
        </Card>
      ))}
      {c.pans.length < 3 && (
        <Button icon="plus" className="justify-self-start" onClick={() => set({ pans: [...c.pans, { material: c.pans.length ? "antiadhesive" : "inox", cm: c.pans.length ? 24 : 28 }] }, ["pans"])}>
          {c.pans.length ? "Une autre poêle" : "Une poêle"}
        </Button>
      )}
      {c.pans.length > 0 && (
        <Row>
          <Stepper decLabel="Moins" incLabel="Plus" value={c.poeleMaxG ?? 500} min={200} max={1500} step={50} unit="g" onChange={(n) => set({ poeleMaxG: n }, ["pans"])} />
          Viande par fournée dans la grande poêle
        </Row>
      )}
      <Help title="Comment savoir ?">
        <p>Diamètre : mesure le haut de la poêle, d&apos;un bord à l&apos;autre. Il est souvent gravé sous la poêle.</p>
        <p>Antiadhésive : un revêtement sombre et lisse à l&apos;intérieur. Inox : métal brillant. Fonte : noire, lourde, mate.</p>
        <p>La plus grande poêle en inox ou en fonte sert à saisir la viande ; l&apos;antiadhésive est gardée pour les œufs et le poisson.</p>
      </Help>
    </div>,

    // 5. Casseroles et faitout
    <div key="casseroles" className="grid gap-3">
      {c.casseroles.map((k, i) => (
        <Card key={i} flat pad="sm" className="grid gap-2">
          <Row>
            <Icon name="pot" size="m" className="text-ink-2" />
            <b>Casserole {i + 1}</b>
            <Button size="sm" variant="quiet" icon="trash" iconOnly aria-label={`Retirer la casserole ${i + 1}`} className="ml-auto" onClick={() => set({ casseroles: c.casseroles.filter((_, j) => j !== i) }, ["casseroles"])} />
          </Row>
          <Row>
            <Stepper decLabel="Plus petite" incLabel="Plus grande" value={k.cm} min={10} max={28} step={2} unit="cm" onChange={(n) => set({ casseroles: c.casseroles.map((x, j) => (j === i ? { ...x, cm: n } : x)) }, ["casseroles"])} />
            Diamètre du fond
          </Row>
          <Row>
            {k.liters == null ? (
              <>
                <span className="text-ink-2">Environ {fmt(casseroleLiters(k.cm))} L</span>
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
          </Row>
        </Card>
      ))}
      {c.casseroles.length < 3 && (
        <Button icon="plus" className="justify-self-start" onClick={() => set({ casseroles: [...c.casseroles, { cm: 16 + 2 * c.casseroles.length, liters: null }] }, ["casseroles"])}>
          {c.casseroles.length ? "Une autre casserole" : "Une casserole"}
        </Button>
      )}
      <Card flat pad="sm" className="grid gap-2">
        <Row>
          <Icon name="pot" size="m" className="text-ink-2" />
          <b>Un faitout</b>
          <span className="text-ink-2">(grande marmite à deux poignées)</span>
          <YesNo label="Un faitout" value={!!c.faitout} onChange={(v) => set({ faitout: v ? (c.faitout ?? DEFAULT_KITCHEN.faitout) : null }, ["casseroles"])} />
        </Row>
        {c.faitout && (
          <>
            <Row>
              <Stepper decLabel="Moins" incLabel="Plus" value={c.faitout.liters} min={2} max={15} step={0.5} unit="L" onChange={(n) => set({ faitout: { ...c.faitout!, liters: n } }, ["casseroles"])} />
              Contenance
            </Row>
            <Check checked={c.faitout.ovenSafe} onChange={(e) => set({ faitout: { ...c.faitout!, ovenSafe: e.target.checked } }, ["casseroles"])}>
              Il passe au four (poignées en métal)
            </Check>
          </>
        )}
      </Card>
      <Help title="Comment mesurer">
        <p>Casserole : mesure le fond, à l&apos;extérieur (c&apos;est lui qui touche le foyer).</p>
        <p>Contenance : souvent gravée sous le récipient ou graduée à l&apos;intérieur. Sinon, compte les verres doseurs d&apos;eau jusqu&apos;à 2 cm du bord. Sans réponse, Mijote l&apos;estime d&apos;après le diamètre.</p>
      </Help>
    </div>,

    // 6. Cocotte et plats à four
    <div key="pots" className="grid gap-3">
      <Card flat pad="sm" className="grid gap-2">
        <Row>
          <Icon name="pot" size="m" className="text-ink-2" />
          <b>Une cocotte en fonte</b>
          <YesNo label="Une cocotte en fonte" value={!!c.cocotte} onChange={(v) => set({ cocotte: v ? (c.cocotte ?? DEFAULT_KITCHEN.cocotte) : null }, ["pots"])} />
        </Row>
        {c.cocotte && (
          <>
            <Row>
              <Stepper decLabel="Moins" incLabel="Plus" value={c.cocotte.liters} min={2} max={12} step={0.5} unit="L" onChange={(n) => set({ cocotte: { ...c.cocotte!, liters: n } }, ["pots"])} />
              Contenance
            </Row>
            <Check checked={c.cocotte.ovenSafe} onChange={(e) => set({ cocotte: { ...c.cocotte!, ovenSafe: e.target.checked } }, ["pots"])}>
              Elle passe au four (bouton du couvercle en métal)
            </Check>
            {c.cocotte.ovenSafe && c.oven && <p className="text-[13px] text-ink-2">Les braisages pourront finir au four pendant que la plaque sert à autre chose.</p>}
          </>
        )}
      </Card>
      {c.oven ? (
        <Card flat pad="sm" className="grid gap-2">
          <Row>
            <Stepper decLabel="Un plat de moins" incLabel="Un plat de plus" value={c.plats} min={0} max={3} onChange={(n) => set({ plats: n }, ["plats"])} />
            Plats à four (gratins, rôtis)
          </Row>
          <p className="text-[13px] text-ink-2">Le premier compte comme un grand plat (environ 28 × 21 cm), puis un moyen, puis un petit.</p>
        </Card>
      ) : (
        <p className="text-[14px] text-ink-2">Sans four, pas de plat à four.</p>
      )}
      <Help title="Comment savoir ?">
        <p>Une cocotte en fonte est lourde, avec un couvercle épais ; la contenance (en litres) est souvent gravée dessous. Un bouton de couvercle en plastique ne va pas au four.</p>
      </Help>
    </div>,

    // 7. Les appareils
    <div key="apps" className="grid gap-3">
      <Card flat pad="sm" className="grid gap-2">
        <Row>
          <Icon name="basket" size="m" className="text-ink-2" />
          <b>Un air fryer</b>
          <span className="text-ink-2">(friteuse sans huile)</span>
          <YesNo label="Un air fryer" value={c.airFryerL > 0} onChange={(v) => set({ airFryerL: v ? 5 : 0 }, ["airFryer"])} />
        </Row>
        {c.airFryerL > 0 && (
          <>
            <Row>
              <Stepper decLabel="Moins" incLabel="Plus" value={c.airFryerL} min={1.5} max={12} step={0.5} unit="L" onChange={(n) => set({ airFryerL: n }, ["airFryer"])} />
              Contenance du panier
            </Row>
            <p className="text-[13px] text-ink-2">Écrite sur le panier ou la boîte, souvent entre 3,5 et 6 L. Le planificateur peut y cuire une plaque de légumes ou de poulet pendant que le four fait autre chose.</p>
          </>
        )}
      </Card>
      <div className="grid gap-1.5">
        <span className="text-[14px] font-semibold">Pour mixer et hacher</span>
        <div className="grid gap-x-6 sm:grid-cols-2">
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
        </div>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[14px] font-semibold">Autres</span>
        <div className="grid gap-x-6 sm:grid-cols-2">
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
            Deux planches et deux grands couteaux (pour cuisiner à deux)
          </Check>
        </div>
      </div>
    </div>,

    // 8. Récapitulatif
    <div key="recap" className="grid gap-3">
      <ul className="grid gap-2">
        {kitchenSummary(c).map((row, i) => (
          <li key={row.label}>
            <button type="button" onClick={() => go(SUMMARY_STEP[i])} className="flex min-h-tap w-full items-center gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-2.5 text-left hover:border-line-strong">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-2">
                  {row.label}
                  {row.unsure && <Tag tone="warn">à vérifier</Tag>}
                </span>
                <span className="text-[15px]">{row.text}</span>
              </span>
              <Icon name="chev" size="s" className="text-ink-2" />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="check" state={pending ? "loading" : "idle"} loadingLabel="Enregistrement…" onClick={save}>
          Enregistrer la cuisine
        </Button>
        {!guided && (
          <Button variant="quiet" icon="refresh" onClick={() => go(0)}>
            Reprendre pas à pas
          </Button>
        )}
        {msg?.ok && <span className="text-[14px] text-ok">{msg.message}</span>}
      </div>
      {msg && !msg.ok && <Alert tone="ko">{msg.message}</Alert>}
    </div>,
  ];

  return (
    <Card pad="md" className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[17px] font-extrabold">{STEPS[step].title}</h3>
          <span className="num shrink-0 text-[13px] text-ink-2">
            {step < RECAP ? `${step + 1} sur ${RECAP}` : "prêt"}
          </span>
        </div>
        <Progress value={step / RECAP} label="Avancement de la description de la cuisine" />
      </div>
      {body[step]}
      {step < RECAP && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {step > 0 && (
            <Button variant="quiet" onClick={() => go(step - 1)}>
              Précédent
            </Button>
          )}
          <Button variant="quiet" icon="info" onClick={dunno}>
            Je ne sais pas
          </Button>
          <Button variant="primary" className="ml-auto" onClick={() => go(step + 1)}>
            {step === RECAP - 1 ? "Voir le récapitulatif" : "Suivant"}
          </Button>
        </div>
      )}
    </Card>
  );
}
