"use client";

// Page /kit : chaque composant du kit dans ses états, avec le nom à importer depuis "@/components/ui".
import { useEffect, useState, type ReactNode } from "react";
import {
  Alert,
  BowlBadge,
  Button,
  Card,
  Check,
  Chip,
  Chips,
  Cue,
  DayBars,
  EmptyState,
  Field,
  Gauge,
  ICON_NAMES,
  Icon,
  Induction,
  Input,
  Lanes,
  List,
  ListRow,
  Macro,
  MacroRow,
  OvenLevel,
  Pill,
  Presence,
  PresenceDots,
  RecipeTile,
  Segmented,
  Sheet,
  SpecChip,
  Stepper,
  Tabs,
  Tag,
  Timer,
  Toast,
  ToastZone,
  VerifyPanel,
  StepProgress,
  Simmer,
  Stamp,
  StampCommande,
  StampCongele,
  StampExpress,
  StampFaitMaison,
  StampNouveau,
  StampSaison,
  StampSemainePrete,
  Tape,
  calibrated,
  useCountdown,
  useElapsed,
  type ButtonState,
  type Place,
  type LoadItem,
} from "@/components/ui";

function Panel({ title, use, children, wide }: { title: string; use: string; children: ReactNode; wide?: boolean }) {
  return (
    <Card as="section" pad="md" className={`grid content-start gap-3.5 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold">{title}</h2>
        <code className="text-[12px] text-faint">{use}</code>
      </div>
      {children}
    </Card>
  );
}
function Help({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-ink-2">{children}</p>;
}

const VITEMS = ["Sauté de porc sans os Label Rouge", "Champignons de Paris", "Échalotes", "Ricotta 250 g", "Saucisses de Toulouse", "Pulpe de tomates"];

export function KitDemo() {
  const [load, setLoad] = useState<ButtonState>("idle");
  const [filter, setFilter] = useState("Toutes");
  const [tab, setTab] = useState("etapes");
  const [mode, setMode] = useState("seul");
  const [qty, setQty] = useState(4);
  const [toast, setToast] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [sheetFree, setSheetFree] = useState(false);
  const [checked, setChecked] = useState(false);
  const [factor, setFactor] = useState(2);
  const [pres, setPres] = useState<Place[]>(["home", "office", "away"]);
  const [msg, setMsg] = useState("");
  const [vstep, setVstep] = useState(0);
  const [aiStart, setAiStart] = useState<number | null>(null);
  const aiElapsed = useElapsed(aiStart);
  const [running, setRunning] = useState<{ endsAt: number | null; left: number }>({ endsAt: null, left: 200 });
  const [short, setShort] = useState<number | null>(null);

  // Vérification en direct rejouable : une ligne toutes les 650 ms.
  useEffect(() => {
    if (vstep > VITEMS.length) return;
    const id = setTimeout(() => setVstep((s) => s + 1), 650);
    return () => clearTimeout(id);
  }, [vstep]);
  const items: LoadItem[] = VITEMS.map((label, i) => ({ label, state: i < vstep - 1 ? "done" : i === vstep - 1 ? "on" : "idle", trail: i < vstep - 1 ? <Pill tone={i === 3 ? "warn" : "ok"} dot>{i === 3 ? "à vérifier" : "en stock"}</Pill> : undefined }));

  const left = useCountdown(running.endsAt, running.left);
  const shortLeft = useCountdown(short, 0);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <div className="font-display text-[12px] font-bold uppercase tracking-[0.12em] text-faint">Kit interne · non lié</div>
        <h1 className="text-[36px] font-extrabold leading-none tracking-[-0.03em]">Les pièces, vivantes</h1>
        <p className="max-w-[70ch] text-ink-2">
          Tout vient de <code>@/components/ui</code> et des tokens de <code>src/app/cuisine-tokens.css</code>. Maquettes complètes : <code>docs/design/plan-de-travail.html</code>. Basculer le thème en haut à droite pour voir le sombre.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Boutons" use="Button, buttonClass">
          <Chips>
            <Button
              variant="primary"
              icon="refresh"
              state={load}
              loadingLabel="Vérification…"
              doneLabel="14 produits vérifiés"
              onClick={() => {
                setLoad("loading");
                setTimeout(() => setLoad("done"), 1600);
                setTimeout(() => setLoad("idle"), 3800);
              }}
            >
              Vérifier en direct
            </Button>
            <Button icon="sliders">Ajuster</Button>
            <Button variant="quiet">Plus tard</Button>
            <Button variant="danger" icon="trash">
              Marquer perdu
            </Button>
          </Chips>
          <Chips>
            <Button variant="primary" size="sm">Valider</Button>
            <Button size="sm">Changer</Button>
            <Button variant="quiet" size="sm">Annuler</Button>
            <Button variant="danger-solid" size="sm">Supprimer la session</Button>
            <Button variant="ink" size="sm" icon="check">Fait (encre)</Button>
            <span className="inline-flex rounded-[10px] bg-inverse p-1.5"><Button variant="on-inverse" size="sm" icon="check">Arrêter (sur encre)</Button></span>
            <Button variant="primary" disabled>Désactivé</Button>
            <Button variant="primary" iconOnly icon="plus" aria-label="Nouvelle recette" />
            <Button variant="quiet" size="sm" iconOnly icon="x" aria-label="Fermer" />
          </Chips>
          <Chips>
            <Button variant="primary" size="kitchen" icon="check">Fait</Button>
            <Button size="kitchen" icon="clock">3 min</Button>
          </Chips>
          <Help>variant primary · secondary · quiet · danger · danger-solid · inverse ; size sm · md · kitchen ; iconOnly ; state idle · loading · done (cliquer « Vérifier en direct »).</Help>
        </Panel>

        <Panel title="Puces, étiquettes, pastilles" use="Chip, ChipLink, Tag, Pill">
          <Chips>
            {[["Toutes", 6], ["porc", 5], ["four", 3], ["congèle", 4], ["≤ 30 min actif", 2]].map(([n, c]) => (
              <Chip key={n} pressed={filter === n} count={c as number} onClick={() => setFilter(n as string)}>
                {n}
              </Chip>
            ))}
          </Chips>
          <Chips>
            <Tag>cocotte</Tag>
            <Tag>riz</Tag>
            <Tag>batch</Tag>
            <Tag tone="warn">à relire</Tag>
          </Chips>
          <Chips>
            <Pill tone="ok">En stock · 2 h</Pill>
            <Pill tone="warn">Vu il y a 31 h</Pill>
            <Pill tone="ko">Rupture</Pill>
            <Pill tone="idle">En attente</Pill>
            <Pill tone="ok" dot>frais et en stock</Pill>
            <Pill tone="warn" dot>à vérifier</Pill>
            <Pill tone="ko" dot>rupture</Pill>
          </Chips>
          <Help>Pill : toujours couleur + icône + mot (dot : le mot passe en title). verdictTone(&quot;ok&quot;|&quot;low&quot;|&quot;high&quot;) traduit le verdict nutrition.</Help>
        </Panel>

        <Panel title="Recettes et bols" use="RecipeTile, BowlBadge">
          <div className="flex flex-wrap items-center gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
              <RecipeTile key={c} color={c} name={`Recette ${c}`}>
                {"ChPfCoMmPcSgPtRb".slice((c - 1) * 2, c * 2)}
              </RecipeTile>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <RecipeTile color={6} size="sm" name="Chasseur de porc" />
            <RecipeTile color={6} name="Chasseur de porc" />
            <RecipeTile color={6} size="lg" name="Chasseur de porc" />
            <BowlBadge color={6} letter="A" size="xs" />
            <BowlBadge color={6} letter="A" size="sm" />
            <BowlBadge color={6} letter="B" />
            <BowlBadge color={3} letter="C" size="lg" />
            <BowlBadge color={2} letter="D" size="xl" label="Bol D" />
          </div>
          <Help>color : 1 à 8, ou recipeColor(slug) de src/lib/ui.ts. Tailles tuile sm · md · lg ; bol xs · sm · md · lg · xl.</Help>
        </Panel>

        <Panel title="Cartes et listes" use="Card, cardClass, List, ListRow">
          <List>
            <ListRow lead={<RecipeTile color={6} size="sm" name="Chasseur de porc" />} title="Chasseur de porc" sub="4 repas à deux · frigo 3 j" href="/kit" />
            <ListRow lead={<RecipeTile color={5} size="sm" name="Pasta al forno" />} title="Pasta al forno saucisse-ricotta" sub="3 repas à deux · frigo 4 j" href="/kit" />
            <ListRow lead={<RecipeTile color={1} size="sm" name="Colombo de porc" />} title="Colombo de porc" sub="pas cette semaine" trail={<Pill tone="idle">en pause</Pill>} />
          </List>
          <Card lift pad="sm" className="grid gap-3">
            <div className="flex items-start gap-3">
              <RecipeTile color={6} name="Chasseur de porc" />
              <div className="min-w-0">
                <h3 className="text-[17px] font-bold leading-tight [font-stretch:100%]">Chasseur de porc</h3>
                <p className="mt-0.5 text-[13px] text-ink-2">4 repas à deux · 9 unités par repas</p>
              </div>
            </div>
            <MacroRow>
              <Macro value={760} unit="kcal" tone="ko" sub="au-dessus" />
              <Macro value={57} unit="g" tone="ok" sub="protéines" />
              <Macro value="3,12" unit="€" sub="la part" />
            </MacroRow>
            <Chips>
              <Tag>porc</Tag>
              <Tag>cocotte</Tag>
              <Tag>four</Tag>
            </Chips>
          </Card>
          <Help>Card : lift (cliquable), flat (sans ombre), pad none · sm · md · lg. Exemple de carte recette composée avec le kit.</Help>
        </Panel>

        <Panel title="Onglets et segments" use="Tabs, Segmented">
          <Tabs label="Fiche" value={tab} onChange={setTab} items={[{ value: "bols", label: "Ingrédients" }, { value: "etapes", label: "Étapes" }, { value: "nutrition", label: "Nutrition" }, { value: "notes", label: "Notes", count: 2 }]} />
          <Segmented label="Part" options={[{ value: "h", label: "Alex · 5 u" }, { value: "j", label: "Sam · 4 u" }]} />
          <Segmented label="Mode de session" value={mode} onChange={setMode} options={[{ value: "seul", label: "Seul" }, { value: "duo", label: "À deux" }, { value: "veille", label: "Prep la veille" }]} />
          <div className="rounded-[12px] bg-inverse p-3">
            <Segmented label="Vue" tone="inverse" options={[{ value: "a", label: "Maintenant" }, { value: "b", label: "Plan" }]} />
          </div>
          <Help>Contrôlés (value + onChange) ou libres (defaultValue). tone=&quot;inverse&quot; sur fond d&apos;encre, size=&quot;icon&quot; pour le thème.</Help>
        </Panel>

        <Panel title="Champs, cases, compteurs" use="Field, Input, Textarea, Check, Stepper">
          <Field label="Chercher dans le catalogue" help="Catalogue du magasin · 41 000 produits">
            {(id, d) => <Input id={id} aria-describedby={d} icon="search" defaultValue="ricotta" autoComplete="off" />}
          </Field>
          <Field label="Grammes réellement pesés" error="20 kg pour un sauté de porc : il manque sûrement une virgule. Saisis 2000 pour 2 kg.">
            {(id, d) => <Input id={id} aria-describedby={d} invalid num defaultValue="20000" inputMode="numeric" />}
          </Field>
          <div className="flex flex-wrap items-center gap-4">
            <Check checked={checked} onChange={(e) => setChecked(e.target.checked)}>
              4 × Sauté de porc 500 g
            </Check>
            <Stepper value={qty} onChange={setQty} min={0} max={12} decLabel="Un paquet de moins" incLabel="Un paquet de plus" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Check size="kitchen" defaultChecked>
              Bol A prêt
            </Check>
            <Stepper size="kitchen" defaultValue={5} unit="u" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Stepper size="sm" defaultValue={2} min={0} decLabel="Un paquet de moins" incLabel="Un paquet de plus" />
            <Stepper value={Math.round(36 * [0.5, 0.75, 1, 1.25, 1.5, 2, 3][factor])} unit="u" onStep={(d) => setFactor((f) => Math.max(0, Math.min(6, f + d)))} canDec={factor > 0} canInc={factor < 6} />
          </div>
          <Help>Stepper sm (paquets d&apos;une ligne de courses) ; avec onStep, le pas est celui de l&apos;appelant (unités d&apos;une recette ×0,5 → ×3).</Help>
        </Panel>

        <Panel title="Présence à un repas" use="Presence, PresenceDots">
          <div className="flex flex-wrap items-center gap-2">
            {pres.map((p, i) => (
              <Presence key={i} initial={i === 1 ? "S" : "A"} name={i === 1 ? "Sam" : "Alex"} place={p} onClick={() => setPres((all) => all.map((x, k) => (k === i ? ({ home: "office", office: "away", away: "home" } as const)[x] : x)))} />
            ))}
            <Presence initial="A" name="Alex" place="home" size="lg" />
            <Presence initial="S" name="Sam" place="away" size="lg" pending />
          </div>
          <PresenceDots places={[{ name: "Alex", place: "home" }, { name: "Sam", place: "away" }]} />
          <Help>Un tap : maison → bureau (repas emporté) → absent (pointillés). lg : feuille du téléphone. PresenceDots : grille compacte, plein = mange, cerclé = absent.</Help>
        </Panel>

        <Panel title="Frise des ressources" use="Lanes" wide>
          <Lanes
            total={160}
            lanes={[
              { label: "Planche", bars: [{ from: 0, to: 16, color: 6 }, { from: 16, to: 28, color: 5 }] },
              { label: "Four", bars: [{ from: 40, to: 110, color: 6 }, { from: 100, to: 140, color: 5, clash: true }] },
              { label: "Grand foyer", bars: [{ from: 28, to: 46, color: 6 }, { from: 60, to: 80, color: 5 }] },
              { label: "Foyer moyen", bars: [{ from: 36, to: 50, color: 6 }, { from: 82, to: 104, color: 5 }] },
              { label: "Petit foyer", bars: [{ from: 112, to: 136, color: 8 }] },
            ]}
          />
          <Help>Une piste par ressource, une barre par étape à la couleur de sa recette ; clash cerne la barre en rouge (four à deux températures). Composer : tirée du plan du planificateur.</Help>
        </Panel>

        <Panel title="Jauges et barres de nutrition" use="Macro, Gauge, DayBars">
          <Gauge label="Énergie · part Alex" value={760} unit="kcal" max={1000} target={[600, 720]} tone="ko" left="0" right="cible 600 à 720" />
          <Gauge label="Protéines" value={57} unit="g" max={80} target={[50]} tone="ok" left="dans la cible" right="≥ 50 g" />
          <Gauge label="Fibres" value={18} unit="g" max={40} target={[25, 35]} tone="warn" left="sous la cible" right="25 à 35 g" />
          <DayBars
            max={100}
            target={85}
            days={[
              { label: "L", value: 88, tone: "ok" },
              { label: "M", value: 92, tone: "ok" },
              { label: "M", value: 70, tone: "warn" },
              { label: "J", value: 95, tone: "ok" },
              { label: "V", value: 100, tone: "ko" },
              { label: "S", value: 62, tone: "warn" },
              { label: "D", value: null },
            ]}
          />
          <Help>La zone hachurée est la cible, la couleur de la valeur dit le verdict (passé par tone, le kit ne juge pas). Dimanche : non renseigné.</Help>
        </Panel>

        <Panel title="Repères de cuisson" use="Induction, OvenLevel, SpecChip, Cue">
          <Chips>
            <SpecChip icon="hob">Grand foyer</SpecChip>
            <SpecChip lead={<Induction level={7} />} />
            <SpecChip lead={<OvenLevel level={3} />}>
              <span className="num font-[750]">160 °C</span> · niveau 3
            </SpecChip>
            <SpecChip icon="fridge">frigo 3 j</SpecChip>
            <SpecChip icon="pan">Poêle 28 · grand foyer</SpecChip>
            <SpecChip icon="clock">3 min par face</SpecChip>
            <SpecChip lead={<BowlBadge color={6} letter="A" size="xs" />}>bol A</SpecChip>
          </Chips>
          <Cue sense="ear" quote="Ça chante fort.">
            La viande se décolle seule après 3 min : là seulement, retourne.
          </Cue>
          <Cue sense="eye" quote="Une goutte glisse comme du mercure.">
            La poêle est prête. Baisse à 6, puis un filet d&apos;huile.
          </Cue>
          <Cue sense="nose" quote="Ça sent le vin réduit.">
            Le porc doit se couper à la cuillère.
          </Cue>
          <div className="flex items-end gap-6">
            <Induction level={6} size="big" />
            <Induction level={2} />
          </div>
        </Panel>

        <Panel title="Minuteurs" use="Timer (onAdjust : appui long puis glisser, souris), useCountdown, formatClock">
          <Timer
            title="Porc · fournée 2"
            detail="Poêle · grand foyer"
            remaining={left}
            total={240}
            paused={running.endsAt == null}
            onToggle={() => setRunning((r) => (r.endsAt == null ? { endsAt: Date.now() + r.left * 1000, left: r.left } : { endsAt: null, left }))}
            onAdjust={(d) => setRunning((r) => (r.endsAt == null ? { endsAt: null, left: Math.max(5, r.left + d) } : { endsAt: r.endsAt + d * 1000, left: r.left }))}
          />
          <Timer title="Riz basmati" detail="Casserole 3 · foyer moyen" remaining={0} total={1200} onDismiss={() => {}} />
          <Timer title="Champignons · 2e fournée" detail="Poêle · foyer moyen" remaining={short == null ? 10 : shortLeft} total={10} sound onDismiss={() => setShort(null)} />
          <div>
            <Button size="sm" icon="play" onClick={() => setShort(Date.now() + 10_000)}>
              Lancer 10 s (avec son)
            </Button>
          </div>
          <Timer size="big" title="Four · pasta al forno" detail="160 °C · gradin 3" remaining={1445} total={2400} paused onToggle={() => {}} />
          <Help>Fini (remaining ≤ 0) : s&apos;inverse et pulse, sound bipe toutes les 4 s après un premier toucher. Jamais de couleur d&apos;état.</Help>
        </Panel>

        <Panel title="Bandeaux et toasts" use="Alert, Toast, ToastZone">
          <Alert tone="warn" title="À vérifier sur ton drive">
            3 produits clés vus il y a plus de 24 h : sauté de porc, ricotta, champignons.
          </Alert>
          <Alert tone="ko" title="Recette indisponible">
            La citronnelle fraîche est en rupture et elle est indispensable.
          </Alert>
          <Alert tone="info">Le panier est copié avec les 14 liens du drive.</Alert>
          <Alert tone="ok" title="Commande validée">14 produits, 62,40 €.</Alert>
          <Alert tone="leaf" title="Il restera 250 g de jambonneau" action={<Button size="sm">Une recette pour le reste</Button>}>
            Le paquet fait 600 g et la recette n&apos;en prend plus que 350 g.
          </Alert>
          <div>
            <Button size="sm" onClick={() => setToast(true)}>
              Afficher un toast
            </Button>
          </div>
          <Toast action={<Button size="sm" variant="inverse">Annuler</Button>}>Riz basmati marqué utilisé · 1,2 kg</Toast>
        </Panel>

        <Panel title="Chargement avec progression" use="VerifyPanel, Progress, LoadList">
          <VerifyPanel title="Vérification en direct" done={7 + Math.max(0, Math.min(VITEMS.length, vstep - 1))} total={14} items={items} />
          <div>
            <Button size="sm" icon="refresh" onClick={() => setVstep(0)}>
              Rejouer
            </Button>
          </div>
        </Panel>

        <Panel title="Long chargement par étapes" use="StepProgress, calibrated, useElapsed">
          {(() => {
            // Démo : un appel de 8 s d'habitude ; la vérification (3 produits) suit, une seconde chacun.
            const EXP = 8000;
            const t = aiStart == null ? 0 : aiElapsed;
            const ai = t < EXP * 1.1;
            const done = Math.min(3, Math.max(0, Math.floor((t - EXP * 1.1) / 1000)));
            const over = t >= EXP * 1.1 + 3000;
            const st = (on: boolean, d: boolean): LoadItem["state"] => (d ? "done" : on ? "on" : "idle");
            return (
              <StepProgress
                title="L'IA prépare une variante"
                running={aiStart != null && !over}
                value={aiStart == null ? 0 : over ? 1 : ai ? calibrated(t, EXP, 0.86) : 0.86 + (0.12 * done) / 3}
                aside={aiStart == null ? "≈ 8 s" : over ? "fini" : ai ? `≈ ${Math.max(1, Math.ceil((EXP - t) / 1000))} s` : "presque fini"}
                items={[
                  { label: "Lecture de la fiche", state: st(aiStart != null && t < 300, aiStart != null && t >= 300) },
                  { label: "Recherche des leviers", state: st(ai && t >= 300 && t < EXP / 3, !ai || t >= EXP / 3) },
                  { label: "Proposition de la variante", state: st(ai && t >= EXP / 3, aiStart != null && !ai) },
                  { label: "Vérification au drive", state: st(aiStart != null && !ai && !over, over), trail: aiStart != null && !ai ? <span className="num text-[13px] text-ink-2">{done}/3</span> : undefined },
                ]}
              />
            );
          })()}
          <div>
            <Button size="sm" icon="refresh" onClick={() => setAiStart(Date.now())}>
              Lancer
            </Button>
          </div>
          <Help>Barre calée sur la durée habituelle de l&apos;appel (médiane de ai_calls.duration_ms) : ≈ 78 % à la durée attendue, jamais pleine avant la fin réelle ; la vérification avance produit par produit. Un reflet glisse tant que ça travaille ; la carte retravaillée prend la classe k-scan (balayage doux). Mouvement réduit : ni reflet, ni balayage, ni rotation.</Help>
        </Panel>

        <Panel title="État vide" use="EmptyState · scene">
          <Card flat>
            <EmptyState scene="fridge" title="Le placard est vide" action={<Button variant="primary" size="sm">Voir la dernière commande</Button>}>
              Ce qui reste après une commande validée apparaîtra ici, avec son poids et sa valeur.
            </EmptyState>
          </Card>
          <div className="grid grid-cols-3 gap-2">
            <EmptyState scene="basket" title="Aucune liste" className="!py-3" />
            <EmptyState scene="pot" title="Aucune recette" className="!py-3" />
            <EmptyState icon="fridge" title="Avec une icône" className="!py-3" />
          </div>
          <Simmer label="Je remplis le panier…" className="justify-self-center" />
        </Panel>

        <StampsPanel />

        <Panel title="Étiquette sur ruban" use="Tape">
          <div className="flex flex-wrap gap-3">
            <Tape tint="var(--c-recipe-1)" sub="mardi midi">Chasseur</Tape>
            <Tape tint="var(--c-recipe-2)" sub="jeudi soir">Forno</Tape>
            <Tape tint="var(--c-accent)">sam soir · H+J</Tape>
          </div>
        </Panel>

        <Panel title="Panneau latéral et feuille du bas" use="Sheet">
          <div>
            <Button icon="sliders" onClick={() => setSheet(true)}>
              Ouvrir « Ajuster »
            </Button>{" "}
            <Button variant="quiet" onClick={() => setSheetFree(true)}>
              Sans voile (modal=false)
            </Button>
          </div>
          <Help>À droite sur ordinateur (420 px), feuille du bas avec poignée sur téléphone. Échap ou le voile ferment. `modal={"{false}"}` : pas de voile ni de page bloquée, la fiche reste lisible et défilable à côté ; `headerAction` ajoute un bouton dans l&apos;en-tête.</Help>
        </Panel>

        <Panel title="Navigation" use="TopNav, TabBar, SessionBanner (src/components/)" wide>
          <Card flat className="overflow-hidden">
            <div className="flex items-center gap-2.5 bg-inverse py-2 pl-3 pr-2.5 text-[14px] text-on-inverse">
              <span className="k-live size-2 shrink-0 rounded-full bg-on-inverse" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                <b>Session en cours</b> · Chasseur de porc + Pasta al forno · <span className="num font-bold">étape 14 sur 38</span>
              </span>
              <span className="inline-flex min-h-[30px] items-center rounded-[8px] bg-on-inverse px-2.5 font-display text-[13px] font-[650] text-inverse">Cuisson →</span>
            </div>
          </Card>
          <Help>Le bandeau de session est la seule bande d&apos;encre pleine de l&apos;appli. Santé reste grisé « bientôt » tant que le module n&apos;existe pas.</Help>
        </Panel>

        <Panel title="Icônes" use={'<Icon name="…" size="s|m|l" />'} wide>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
            {ICON_NAMES.map((n) => (
              <div key={n} className="grid justify-items-center gap-1 rounded-[10px] bg-surface-2 px-1 py-2.5 text-[11px] text-ink-2">
                <Icon name={n} className="text-ink" />
                {n}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Ajuster la recette"
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => setSheet(false)}>Annuler</Button>
            <Button variant="primary" onClick={() => setSheet(false)}>
              Appliquer
            </Button>
          </div>
        }
      >
        <Chips>
          <Chip>Moins de calories</Chip>
          <Chip>Plus de protéines</Chip>
          <Chip>Prise de masse</Chip>
          <Chip>Plus équilibré</Chip>
        </Chips>
        <div className="max-w-[88%] rounded-[14px] rounded-bl-[4px] bg-surface-2 px-3 py-2.5 text-[14px]">Que veux-tu changer ? La part d&apos;Alex est à 760 kcal, 40 au-dessus de sa cible.</div>
        <Input placeholder="Ex. garde le goût fumé" aria-label="Message" value={msg} onChange={(e) => setMsg(e.target.value)} />
      </Sheet>

      <Sheet open={sheetFree} onClose={() => setSheetFree(false)} modal={false} title="Variante proposée" headerAction={<Button size="sm" variant="quiet">Détails</Button>}>
        <Gauge label="Énergie" value={655} before={760} unit="kcal" max={1000} target={[700, 760]} tone="warn" left="avant → après" right="cible 700 à 760" />
        <Alert tone="leaf" title="Il restera 600 g de jambonneau" action={<Button size="sm">Une recette pour le reste</Button>}>
          Le paquet est déjà au placard et la recette ne le prend plus.
        </Alert>
      </Sheet>

      <ToastZone>
        {toast && (
          <Toast action={<Button size="sm" variant="inverse" onClick={() => setToast(false)}>Annuler</Button>}>
            Riz basmati marqué utilisé · 1,2 kg
          </Toast>
        )}
      </ToastZone>
    </div>
  );
}


/** Les cachets : chacun dans son encre ; « Tamponner » rejoue la pose. */
function StampsPanel() {
  const [n, setN] = useState(0);
  const f = n > 0;
  return (
    <Panel title="Cachets" use="Stamp · StampCommande · StampFaitMaison…" wide>
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4 rounded-[12px] bg-raised p-4">
        <StampFaitMaison key={`a${n}`} date={new Date()} fresh={f} />
        <StampCommande key={`b${n}`} date={new Date()} fresh={f} />
        <StampSaison key={`c${n}`} fresh={f} />
        <StampSemainePrete key={`d${n}`} fresh={f} />
        <StampCongele key={`e${n}`} fresh={f} />
        <StampExpress key={`f${n}`} minutes={20} fresh={f} />
        <Stamp key={`g${n}`} shape="heart" label="adore" center="J" color="var(--c-recipe-4)" fresh={f} />
        <StampNouveau key={`h${n}`} fresh={f} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => setN((x) => x + 1)}>
          Tamponner
        </Button>
        <span className="text-[13px] text-ink-2">Une encre par cachet, inclinaison fixe (`seed`), deux par écran au plus, « pof » seulement avec `fresh`.</span>
      </div>
    </Panel>
  );
}
