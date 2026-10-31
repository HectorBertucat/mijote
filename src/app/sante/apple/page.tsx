import { de, HowCalc, KeyFigure, Section, Verdict } from "@/components/sante/carnet";
import { existsSync } from "fs";
import { headers } from "next/headers";
import path from "path";
import { ExportImport } from "@/components/sante/ExportImport";
import { CloudflareForm, CopyCode, InstallLink, LinkTools } from "@/components/sante/InstallShortcut";
import { CF_ID, CF_SECRET, ensureLink, getSetting, installCode, syncWindow } from "@/lib/health/link";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { lastReceived, recentDaily, recentWorkouts } from "@/lib/health/samples";
import { todayParis } from "@/lib/health/store";
import { addDays } from "@/lib/week/propose";

export const dynamic = "force-dynamic";

const ago = (iso: string | null) => {
  if (!iso) return null;
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  return h < 1 ? "il y a moins d’une heure" : h < 48 ? `il y a ${Math.round(h)}\u00a0h` : `il y a ${Math.round(h / 24)} jours`;
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

const SHORTCUT_FILE = "raccourcis/sante-mijote.shortcut";

/** Adresse publique de l'appli (MIJOTE_PUBLIC_URL), sinon celle par laquelle on consulte la page. */
async function publicUrl(): Promise<string> {
  const env = process.env.MIJOTE_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3010";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
const NEXT: Record<number, string> = { 180: "les 6 derniers mois (premier envoi)", 35: "le dernier mois", 7: "les 7 derniers jours" };

export default async function Apple() {
  const person = await activePerson();
  const clientId = getSetting(db, CF_ID);
  const clientSecret = getSetting(db, CF_SECRET);
  const cfSaved = clientId ? `${clientId.slice(0, 6)}…${clientId.slice(-12)}` : null;
  const link = ensureLink(db, person.id);
  const code = installCode({ url: `${await publicUrl()}/api/sante/import`, person: person.name, key: link.key, clientId: clientId ?? "", clientSecret: clientSecret ?? "" });
  const shortcutHref = existsSync(path.join(process.cwd(), "public", SHORTCUT_FILE)) ? `/${SHORTCUT_FILE}` : null;
  const last = lastReceived(db, person.id);
  const since = addDays(todayParis(), -6);
  const steps = recentDaily(db, person.id, "steps", since);
  const workouts = recentWorkouts(db, person.id, 6);
  const lastAt = [last.weight, last.sample].filter(Boolean).sort().pop() ?? null;
  const avgSteps = steps.length ? Math.round(steps.reduce((s, x) => s + x.value, 0) / steps.length) : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 lg:gap-18">
      <section aria-labelledby="as" className="grid gap-8 lg:grid-cols-12 lg:gap-6">
        <div className="grid content-start gap-4 lg:col-span-7">
          <h2 id="as" className="text-h2">Apple Santé</h2>
          <p className="text-lead text-ink-2">Un Raccourci de l’iPhone envoie les pesées, les pas par jour et les séances.</p>
          {lastAt ? <Verdict tone="ok">{`dernier envoi ${ago(lastAt)}`}</Verdict> : <Verdict tone="idle">rien reçu pour l’instant</Verdict>}
          {link && <p className="text-small text-ink-2">Prochain envoi : {NEXT[syncWindow(link, new Date())]}.</p>}
          <HowCalc title="Ce qui sert, ce qui ne sert pas">
            <p>Une balance connectée écrit déjà les pesées dans Santé : elles arrivent ici. Les calories «{"\u202f"}actives{"\u202f"}» de la montre ne servent pas à la cible : la balance mesure mieux la dépense.</p>
          </HowCalc>
        </div>
        {(avgSteps != null || workouts.length > 0) && (
          <div className="grid grid-cols-2 gap-6 border-t border-line pt-6 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
            {avgSteps != null && <KeyFigure size="lg" label="Pas par jour" value={avgSteps.toLocaleString("fr-FR")} sub="7 derniers jours" />}
            {workouts.length > 0 && <KeyFigure size="lg" label="Séances" value={workouts.length} sub={`dernière : ${String((workouts[0].meta as { type?: string } | null)?.type ?? "séance")}, ${fmt(workouts[0].start)}`} />}
          </div>
        )}
      </section>

      <Section title={`Installer sur l’iPhone ${de(person.name)}`} id="rc">
        {!code ? null : (
          <div className="grid gap-6">
            <p className="max-w-[62ch] text-ink-2">À faire sur l’iPhone {de(person.name)}, avec le bon profil choisi en haut. Le Raccourci est le même pour tout le monde : c’est le code qui dit à qui vont les données.</p>
            <ol className="grid border-t border-line">
              <Step n={1}>
                <div className="grid gap-3">
                  <span>Copie le code. Si tu es sur un autre téléphone, envoie-le plutôt (AirDrop, Messages).</span>
                  <CopyCode code={code!} personName={person.name} />
                </div>
              </Step>
              <Step n={2}>
                <div className="grid gap-3">
                  <span>
                    Ajoute le Raccourci <b>Santé → Mijote</b>.
                  </span>
                  <div>
                    <InstallLink href={shortcutHref} />
                  </div>
                </div>
              </Step>
              <Step n={3}>
                Lance-le une fois depuis l’app Raccourcis. Il garde le code, demande l’accès à Santé (autorise <b>Poids</b>, <b>Nombre de pas</b> et <b>Entraînements</b>), puis envoie les 6 derniers mois : compte une ou deux minutes.
              </Step>
              <Step n={4}>
                Pour qu’il tourne seul : Raccourcis → <b>Automatisation</b> → <b>+</b> → <b>App</b> → l’app de ta balance → <b>Est fermée</b>, puis <b>Exécuter immédiatement</b> et le Raccourci <b>Santé → Mijote</b>. Sans balance le matin : <b>Alarme</b> → <b>Est arrêtée</b>.
              </Step>
            </ol>
            <p className="max-w-[62ch] text-small text-ink-2">Ensuite, chaque envoi relit les 7 derniers jours, et le dernier mois une fois par semaine. Envoyer deux fois la même chose ne crée pas de doublon.</p>
            <LinkTools personId={person.id} />
          </div>
        )}
      </Section>

      <div className="grid gap-12 lg:grid-cols-2 lg:gap-6">
        <Section title="Tout l’historique" id="hist" aside={<span className="label text-ink-2">Facultatif</span>}>
          <p className="max-w-[62ch] text-ink-2">
            Dans l’app Santé : ta photo en haut à droite → <b>Exporter toutes les données de santé</b>, puis enregistre <K>export.zip</K> dans Fichiers. Choisis-le ici : il est lu sur ton appareil, seules les pesées, les séances et les pas par jour sont envoyés au profil {de(person.name)}. Utile pour remonter plus loin que les 6 mois du Raccourci.
          </p>
          <ExportImport personId={person.id} personName={person.name} />
        </Section>

        <Section title="Derrière Cloudflare Access" id="cf" aside={<span className="label text-ink-2">Facultatif</span>}>
          {!cfSaved && (
            <>
              <p className="max-w-[62ch] text-ink-2">Seulement si ton appli est protégée par Cloudflare Access. Le Raccourci ne peut pas se connecter comme toi : on lui donne un jeton limité au seul chemin d’import, le même pour tout le foyer.</p>
              <ol className="grid border-t border-line">
                <Step n={1}>
                  Dans Cloudflare Zero Trust : <b>Access → Service credentials → Service tokens → Create</b>. Nom <K>Raccourci santé</K>, durée <K>Non-expiring</K>.
                </Step>
                <Step n={2}>
                  <b>Access → Applications → Add an application → Self-hosted</b>. Ton domaine, chemin <K>api/sante/import</K>. Une seule règle : action <b>Service Auth</b>, Include → <b>Service Token</b> → <K>Raccourci santé</K>.
                </Step>
                <Step n={3}>Colle ici le Client ID et le Client Secret. Ils sont gardés dans l’appli et recopiés dans chaque code d’installation.</Step>
              </ol>
            </>
          )}
          <CloudflareForm saved={cfSaved} />
        </Section>
      </div>
    </div>
  );
}
