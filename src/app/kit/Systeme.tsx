// Vitrine du système v3 « Carnet de marché » (docs/design/systeme.md) en tête de /kit : couleurs, typographie,
// espacements, rayons, ombre, mouvement et ton, chacun montré avec les vrais jetons. Sans état.
import type { CSSProperties, ReactNode } from "react";
import { Tape, Wordmark } from "@/components/ui";

const NB = " ";

/** Section de la vitrine : filet fort, titre sur 4 colonnes, démonstration sur 8. */
function Part({ id, title, lead, children }: { id: string; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-6 border-t border-line-strong pt-6 lg:grid-cols-12 lg:gap-x-6">
      <div className="grid content-start gap-3 lg:col-span-4">
        <h2 id={id} className="text-h2">
          {title}
        </h2>
        <p className="max-w-[40ch] text-small text-ink-2">{lead}</p>
      </div>
      <div className="min-w-0 lg:col-span-8">{children}</div>
    </section>
  );
}

const SURFACES: { v: string; name: string; role: string }[] = [
  { v: "--c-bg", name: "paper", role: "Le fond de tout" },
  { v: "--c-surface", name: "sheet", role: "Ce qui se saisit ou flotte" },
  { v: "--c-surface-2", name: "hollow", role: "Creux, survol de ligne" },
  { v: "--c-line", name: "rule", role: "Filets entre lignes" },
  { v: "--c-line-strong", name: "rule-strong", role: "Contours de champ" },
];
const INKS: { v: string; name: string; role: string }[] = [
  { v: "--c-ink", name: "ink", role: "Texte, bouton principal" },
  { v: "--c-ink-2", name: "ink-2", role: "Texte secondaire" },
  { v: "--c-ink-3", name: "ink-3", role: "Repères, légendes" },
];
const SIGNALS: { v: string; name: string; role: string }[] = [
  { v: "--c-accent", name: "cocotte", role: "Ce qu’on fait maintenant" },
  { v: "--c-hot", name: "tomate", role: "Une seule chose presse" },
  { v: "--c-ok", name: "ok", role: "Verdict, avec un mot" },
  { v: "--c-warn", name: "warn", role: "Verdict, avec un mot" },
  { v: "--c-ko", name: "ko", role: "Verdict, avec un mot" },
];
const RECIPES = ["moutarde", "betterave", "sarcelle", "prune", "paprika", "cacao", "pistache", "ardoise"];

function Swatch({ v, name, role, big = false }: { v: string; name: string; role: string; big?: boolean }) {
  return (
    <div className="grid content-start gap-2">
      <span className={`block rounded-[4px] border border-line ${big ? "h-18" : "h-12"}`} style={{ background: `var(${v})` }} />
      <span className="grid gap-1">
        <span className="label text-ink">{name}</span>
        <span className="text-small text-ink-2">{role}</span>
        <code className="num text-small text-faint">{v}</code>
      </span>
    </div>
  );
}

const TYPE: { name: string; size: string; cls: string; sample: string }[] = [
  { name: "display", size: "88 / 52", cls: "text-display font-display", sample: "Dimanche" },
  { name: "h1", size: "56 / 38", cls: "text-h1 font-display", sample: "Cuisiner dimanche" },
  { name: "h2", size: "32 / 26", cls: "text-h2 font-display", sample: "3 plats, 28 repas" },
  { name: "h3", size: "20", cls: "text-h3 font-display font-bold tracking-[-0.015em]", sample: "Ranger 6 boîtes" },
  { name: "lead", size: "21 / 19", cls: "text-lead", sample: "La semaine tient en une session de 2 h 40, le dimanche matin." },
  { name: "body", size: "17", cls: "text-body", sample: "Saisis le porc en deux fournées dans la grande poêle, sans le remuer." },
  { name: "small", size: "14", cls: "text-small text-ink-2", sample: "Frigo 3 jours · se congèle · 4 repas à deux" },
  { name: "label", size: "12", cls: "label", sample: "Bol A · à vérifier" },
  { name: "num-xl", size: "72 / 56", cls: "text-num-xl num-tight", sample: `2${NB}h${NB}40` },
];

const SPACE = [4, 8, 12, 16, 24, 32, 48, 72, 112];
const MOTION: { v: string; ms: string; use: string }[] = [
  { v: "--dur-1", ms: "120 ms", use: "Survol, pression, focus" },
  { v: "--dur-2", ms: "200 ms", use: "Un élément apparaît ou s’en va" },
  { v: "--dur-3", ms: "280 ms", use: "Le contenu d’une page arrive" },
  { v: "--dur-sheet", ms: "460 ms", use: "Tiroir, courbe iOS" },
];

export function Systeme() {
  return (
    <div className="grid gap-12 sm:gap-18">
      <header className="grid gap-8 lg:grid-cols-12 lg:gap-x-6">
        <div className="grid content-start gap-4 lg:col-span-7">
          <p className="label text-faint">Kit interne · non lié dans la navigation</p>
          <h1 className="text-display">Carnet de marché</h1>
          <p className="max-w-[48ch] text-lead text-ink-2">
            De grandes lettres larges sur papier, la nappe vichy sous chaque plat, des filets fins plutôt que des cartes, et un seul bleu de cocotte pour ce qu’on fait maintenant.
          </p>
          <p className="text-small text-faint">
            Fait foi : <code className="num">docs/design/systeme.md</code>. Jetons : <code className="num">src/app/cuisine-tokens.css</code>. Composants : <code className="num">@/components/ui</code>. Le thème se bascule en haut à droite.
          </p>
        </div>
        <div className="grid content-start gap-4 border-t border-line-strong pt-6 lg:col-span-4 lg:col-start-9 lg:self-end">
          <Wordmark className="!text-h1" />
          <p className="text-small text-ink-2">Le mot-symbole : le o est une cocotte bleue à couvercle tomate. La vapeur monte au survol du lien.</p>
        </div>
      </header>

      <Part id="couleurs" title="Couleurs" lead="Un papier, une encre en trois gris, des filets. La cocotte seulement là où l’on agit ; la tomate pour une seule chose qui presse ; ok, warn, ko réservés aux verdicts, toujours avec une forme ou un mot.">
        <div className="grid gap-8">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
            {SURFACES.map((s) => (
              <Swatch key={s.v} {...s} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-6">
            {INKS.map((s) => (
              <Swatch key={s.v} {...s} big />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
            {SIGNALS.map((s) => (
              <Swatch key={s.v} {...s} />
            ))}
          </div>
          <div className="grid gap-3">
            <p className="label text-faint">La couleur, c’est le plat : recipe-1 à 8</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {RECIPES.map((r, i) => (
                <div key={r} className="grid gap-2">
                  <span className="block h-18 rounded-[4px]" style={{ background: `var(--c-recipe-${i + 1})` }} />
                  <span className="text-small text-ink-2">{r}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 pt-2">
              <Tape tint="var(--c-recipe-6)" seed="chasseur">Chasseur de porc</Tape>
              <Tape tint="var(--c-recipe-5)" seed="pasta">Pasta al forno</Tape>
              <Tape tint="var(--c-recipe-3)" seed="colombo">Mardi midi</Tape>
            </div>
          </div>
        </div>
      </Part>

      <Part id="typo" title="Typographie" lead="Deux polices. Archivo très large pour les titres, très serrée pour les chiffres et les étiquettes. Atkinson Hyperlegible Next pour tout ce qui se lit, de loin, à côté du feu.">
        <ul className="grid border-t border-line">
          {TYPE.map((t) => (
            <li key={t.name} className="grid gap-2 border-b border-line py-4 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-baseline sm:gap-6">
              <span className="grid gap-1">
                <span className="label text-ink">{t.name}</span>
                <span className="num text-small text-faint">{t.size}</span>
              </span>
              <span className={`min-w-0 break-words ${t.cls}`}>{t.sample}</span>
            </li>
          ))}
        </ul>
      </Part>

      <Part id="espace" title="Espacements" lead="Une seule échelle, en pixels. 72 entre deux sections sur bureau, 48 sur téléphone ; 24 entre un titre et son contenu ; 16 dans une ligne de liste.">
        <ul className="grid gap-2">
          {SPACE.map((n) => (
            <li key={n} className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-4">
              <span className="num text-right text-small text-ink-2">{n}</span>
              <span className="block h-3 bg-ink" style={{ width: n } as CSSProperties} />
            </li>
          ))}
        </ul>
      </Part>

      <Part id="formes" title="Rayons et ombre" lead="Trois rayons : 4 pour une étiquette, 8 pour un bouton ou un champ, 14 pour ce qui flotte. Une seule ombre, pour ce qui flotte au-dessus de la page.">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {[4, 8, 14].map((r) => (
            <div key={r} className="grid gap-2">
              <span className="block h-18 border border-line-strong bg-surface" style={{ borderRadius: r }} />
              <span className="num text-small text-ink-2">{r}{NB}px</span>
            </div>
          ))}
          <div className="grid gap-2">
            <span className="block h-18 rounded-[14px] bg-surface shadow-float" />
            <span className="text-small text-ink-2">sh-float</span>
          </div>
        </div>
      </Part>

      <Part id="mouvement" title="Mouvement" lead="Le mouvement fait paraître l’appli plus rapide, pas plus vivante : ease-out, moins de 300 ms, rien sur un geste fréquent. Survole une ligne pour voir la durée.">
        <ul className="grid border-t border-line">
          {MOTION.map((m) => (
            <li key={m.v} className="group grid grid-cols-[96px_minmax(0,1fr)] items-center gap-4 border-b border-line py-4 sm:grid-cols-[96px_minmax(0,1fr)_200px]">
              <span className="num text-small font-bold">{m.ms}</span>
              <span className="text-small text-ink-2">{m.use}</span>
              <span className="relative col-span-2 h-2 rounded-[4px] bg-surface-2 sm:col-span-1">
                <span
                  className="absolute left-0 top-0 h-2 w-8 rounded-[4px] bg-ink transition-transform ease-[var(--ease-out)] group-hover:translate-x-[calc(200px-32px)] motion-reduce:transition-none"
                  style={{ transitionDuration: `var(${m.v})` }}
                />
              </span>
            </li>
          ))}
        </ul>
      </Part>

      <Part id="ton" title="Ton" lead="Tutoiement, phrases courtes, des chiffres plutôt que des adjectifs. On nomme ce qu’on fait. Apostrophe courbe, guillemets français, espaces fines insécables.">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="grid content-start gap-3 border-t-2 border-ink pt-4">
            <p className="label text-ink">Oui</p>
            <p className="text-h3">3 plats, 28 repas, 2{NB}h{NB}40 dimanche</p>
            <p className="text-body">Cuisiner dimanche · Ranger 6 boîtes · Je la mange</p>
            <p className="text-body">Il restera 120{NB}g de crème.</p>
          </div>
          <div className="grid content-start gap-3 border-t border-line-strong pt-4 text-faint">
            <p className="label">Non</p>
            <p className="text-h3 line-through decoration-1">Votre semaine est prête !</p>
            <p className="text-body line-through decoration-1">Simplifiez vos repas</p>
            <p className="text-body line-through decoration-1">Découvrez nos suggestions</p>
          </div>
        </div>
      </Part>
    </div>
  );
}
