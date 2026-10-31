import { de, HowCalc, KeyFigure, Row, Section, Verdict } from "@/components/sante/carnet";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { ExportImport } from "@/components/sante/ExportImport";
import { CloudflareForm, CopyCode, LinkTools } from "@/components/sante/AppleLink";
import { CF_ID, CF_SECRET, ensureLink, getSetting, installCode } from "@/lib/health/link";
import { db } from "@/lib/db/client";
import type { HealthKind } from "@/lib/db/schema";
import { activePerson } from "@/lib/health/active";
import { lastReceived, receivedCounts, recentDaily, recentWorkouts } from "@/lib/health/samples";
import { todayParis } from "@/lib/health/store";
import { addDays } from "@/lib/week/propose";
import { demoEnabled } from "@/lib/demo/core";
import { DemoNotice } from "@/components/demo/DemoNotice";

export const dynamic = "force-dynamic";

const ago = (iso: string | null) => {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  return h < 1 ? "il y a moins d’une heure" : h < 48 ? `il y a ${Math.round(h)} h` : `il y a ${Math.round(h / 24)} jours`;
};
const fmt = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[40px_minmax(0,1fr)] gap-4 border-b border-line py-4">
      <span className="num-tight text-[32px] leading-[0.9] text-ink-3">{n}</span>
      <div className="min-w-0 max-w-[62ch]">{children}</div>
    </li>
  );
}
const K = ({ children }: { children: React.ReactNode }) => <code className="rounded-[4px] bg-surface-2 px-1 py-0.5 text-small">{children}</code>;

/** Ce qui a été reçu, dans l’ordre de l’écran : nom, et ce que compte une ligne. */
const RECEIVED: [HealthKind | "body_mass", string, string][] = [
  ["body_mass", "Poids", "pesées"],
  ["steps", "Pas", "jours"],
  ["workout", "Séances", "séances"],
  ["sleep", "Sommeil", "phases"],
  ["resting_hr", "FC au repos", "mesures"],
  ["hrv_sdnn", "Variabilité cardiaque", "mesures"],
  ["vo2max", "VO2max", "mesures"],
  ["body_fat", "Masse grasse", "mesures"],
  ["lean_mass", "Masse maigre", "mesures"],
  ["active_kcal", "Énergie active", "jours"],
  ["basal_energy", "Énergie au repos", "jours"],
  ["exercise_min", "Minutes d’exercice", "jours"],
  ["walk_run_m", "Marche et course", "jours"],
  ["diet_energy", "Énergie consommée", "jours"],
  ["diet_protein", "Protéines", "jours"],
  ["water", "Eau", "jours"],
  ["menstrual", "Cycle", "jours notés"],
];

/** Adresse publique de l’appli (MIJOTE_PUBLIC_URL), sinon celle par laquelle on consulte la page. */
async function publicUrl(): Promise<string> {
  const env = process.env.MIJOTE_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3010";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function Apple() {
  if (demoEnabled())
    return (
      <DemoNotice title="Apple Santé reste chez toi">
        Sur ton instance, l’app Mijote Santé de l’iPhone envoie les pesées, les pas, les séances et le sommeil à Mijote, avec une clé par personne. La démo ne reçoit rien de l’extérieur.
      </DemoNotice>
    );
  const person = await activePerson();
  const clientId = getSetting(db, CF_ID);
  const clientSecret = getSetting(db, CF_SECRET);
  const cfSaved = clientId ? `${clientId.slice(0, 6)}…${clientId.slice(-12)}` : null;
  const link = ensureLink(db, person.id);
  const code = installCode({ url: `${await publicUrl()}/api/sante/import`, key: link.key, clientId: clientId ?? "", clientSecret: clientSecret ?? "" });
  const qr = await QRCode.toString(code, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const last = lastReceived(db, person.id);
  const lastAt = link.lastSyncAt ?? ([last.weight, last.sample].filter(Boolean).sort().pop() || null);
  const counts = receivedCounts(db, person.id);
  const received = RECEIVED.filter(([k]) => counts[k]);
  const since = addDays(todayParis(), -6);
  const steps = recentDaily(db, person.id, "steps", since);
  const workouts = recentWorkouts(db, person.id, 6);
  const avgSteps = steps.length ? Math.round(steps.reduce((s, x) => s + x.value, 0) / steps.length) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <section aria-labelledby="as" className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <div className="grid content-start gap-4 lg:col-span-7">
          <h2 id="as" className="text-h2">Apple Santé</h2>
          <p className="text-lead text-ink-2">L’app Mijote Santé, sur l’iPhone, envoie ce que tu choisis dans Santé : pesées, pas, séances, sommeil, cœur.</p>
          <div className="flex flex-wrap gap-2">
            {lastAt ? <Verdict tone="ok">{`dernier envoi ${ago(lastAt)}`}</Verdict> : <Verdict tone="idle">rien reçu pour l’instant</Verdict>}
            {link.historyCompleteAt ? <Verdict tone="ok">historique complet reçu</Verdict> : <Verdict tone="idle">historique complet attendu</Verdict>}
          </div>
          <HowCalc title="Ce qui sert, ce qui ne sert pas">
            <p>Les pesées font la courbe et la cible. Le sommeil, la fréquence cardiaque au repos, la variabilité cardiaque, la VO2max et la masse grasse s’affichent dans Santé ; les pas et les séances comptent pour les objectifs d’activité.</p>
            <p>Les calories «{" "}actives{" "}» et «{" "}au repos{" "}» de la montre ne servent pas à la cible : la balance mesure mieux la dépense. Les apports et le cycle, si tu les envoies, sont gardés ici et ne sont montrés ni à l’assistant ni au coach.</p>
          </HowCalc>
        </div>
        {(avgSteps != null || workouts.length > 0) && (
          <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            {avgSteps != null && <KeyFigure size="lg" label="Pas par jour" value={avgSteps.toLocaleString("fr-FR")} sub="7 derniers jours" />}
            {workouts.length > 0 && <KeyFigure size="lg" label="Séances" value={workouts.length} sub={`dernière : ${String((workouts[0].meta as { type?: string } | null)?.type ?? "séance")}, ${fmt(workouts[0].start)}`} />}
          </div>
        )}
      </section>

      <div className="grid gap-12 lg:grid-cols-12 lg:gap-6">
        <Section title={`Relier l’iPhone ${de(person.name)}`} id="app" className="lg:col-span-7">
          <div className="grid gap-6">
            <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
              <span
                role="img"
                aria-label={`Code d’installation ${de(person.name)}, à scanner dans l’app Mijote Santé`}
                className="block w-[200px] rounded-[8px] border border-line bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: qr }}
              />
              <ol className="grid border-t border-line">
                <Step n={1}>Ouvre l’app Mijote Santé sur l’iPhone {de(person.name)}.</Step>
                <Step n={2}>Scanne ce code, ou copie-le et colle-le dans l’app. C’est le code qui dit à qui vont les données : un par personne.</Step>
                <Step n={3}>Choisis ce que tu envoies et autorise l’accès à Santé. La première fois, l’app envoie tout l’historique par paquets ; ensuite, seulement ce qui change.</Step>
              </ol>
            </div>
            <CopyCode code={code} personName={person.name} />
            <p className="max-w-[62ch] text-small text-ink-2">«{" "}Tout renvoyer{" "}» redemande l’historique complet au prochain envoi, sans créer de doublon. «{" "}Changer la clé{" "}» refuse l’ancien code : à refaire si le code a circulé.</p>
            <LinkTools personId={person.id} />
          </div>
        </Section>

        <Section title="Reçu" id="recu" className="lg:col-span-5">
          {received.length ? (
            <dl className="grid border-t border-line">
              {received.map(([k, label, unit]) => (
                <Row key={k} k={label}>
                  <span className="num">{counts[k]!.toLocaleString("fr-FR")}</span> {unit}
                </Row>
              ))}
            </dl>
          ) : (
            <p className="text-body text-ink-2">Rien pour l’instant {de(person.name)}.</p>
          )}
        </Section>
      </div>

      <Section title="Derrière Cloudflare Access" id="cf" aside={<span className="label text-ink-2">Facultatif</span>}>
        <p className="max-w-[62ch] text-ink-2">Seulement si ton instance est protégée par Cloudflare Access : l’app ne peut pas se connecter comme toi, elle passe avec un jeton de service limité au seul chemin d’import, le même pour tout le foyer, recopié dans chaque code.</p>
        {!cfSaved && (
          <ol className="grid border-t border-line">
            <Step n={1}>
              Dans Cloudflare Zero Trust : <b>Access → Service credentials → Service tokens → Create</b>. Nom <K>Mijote Santé</K>, durée <K>Non-expiring</K>.
            </Step>
            <Step n={2}>
              <b>Access → Applications → Add an application → Self-hosted</b>. Ton domaine, chemin <K>api/sante/import</K>. Une seule règle : action <b>Service Auth</b>, Include → <b>Service Token</b> → <K>Mijote Santé</K>.
            </Step>
            <Step n={3}>Colle ici le Client ID et le Client Secret. Le code ci-dessus les contient ensuite : rescanne-le dans l’app.</Step>
          </ol>
        )}
        <CloudflareForm saved={cfSaved} />
      </Section>

      <HowCalc title="Importer un export de Santé">
        <p>
          L’historique vient de l’app. Sans elle : dans l’app Santé, ta photo en haut à droite → <b>Exporter toutes les données de santé</b>, puis enregistre <K>export.zip</K> dans Fichiers. Choisis-le ici : il est lu sur ton appareil, seules les pesées, les séances et les pas par jour sont envoyés au profil {de(person.name)}.
        </p>
        <ExportImport personId={person.id} personName={person.name} />
      </HowCalc>
    </div>
  );
}
