import { Card, Macro, MacroRow, Pill } from "@/components/ui";
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
  return h < 1 ? "il y a moins d'une heure" : h < 48 ? `il y a ${Math.round(h)} h` : `il y a ${Math.round(h / 24)} jours`;
};
const fmt = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-2.5">
      <span className="num grid size-7 place-items-center rounded-full bg-accent-soft text-[13px] font-bold text-accent">{n}</span>
      <div className="pt-0.5 text-[15px] leading-[1.7]">{children}</div>
    </li>
  );
}
const K = ({ children }: { children: React.ReactNode }) => <code className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-[13px]">{children}</code>;

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
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <Card pad="md" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[18px] font-bold">Apple Santé · {person.name}</h2>
          {lastAt ? <Pill tone="ok">{`dernier envoi ${ago(lastAt)}`}</Pill> : <Pill tone="idle">rien reçu pour l'instant</Pill>}
        </div>
        <p className="text-[14px] text-ink-2">Un Raccourci de l'iPhone envoie les pesées (une balance connectée les écrit déjà dans Santé), les pas par jour et les séances. Les calories « actives » de la montre ne servent pas à la cible : la balance mesure mieux la dépense.</p>
        {link && <p className="text-[13px] text-ink-2">Prochain envoi : {NEXT[syncWindow(link, new Date())]}.</p>}
        {(avgSteps != null || workouts.length > 0) && (
          <MacroRow>
            {avgSteps != null && <Macro value={avgSteps.toLocaleString("fr-FR")} unit="pas" sub="par jour, 7 derniers jours" icon={null} />}
            {workouts.length > 0 && <Macro value={workouts.length} unit="séances" sub={`dernière : ${String((workouts[0].meta as { type?: string } | null)?.type ?? "séance")}, ${fmt(workouts[0].start)}`} icon={null} />}
          </MacroRow>
        )}
      </Card>

      <section className="grid gap-2.5" aria-labelledby="cf">
        <h2 id="cf" className="text-[18px] font-bold">Facultatif : derrière Cloudflare Access</h2>
        <Card pad="md" className="grid gap-3">
          {!cfSaved && (
            <>
              <p className="text-[14px] text-ink-2">Seulement si ton appli est protégée par Cloudflare Access (sinon, passe directement à l'installation). Le Raccourci ne peut pas se connecter comme toi : on lui donne un jeton limité au seul chemin d'import, le même pour tout le foyer.</p>
              <ol className="grid gap-3">
                <Step n={1}>
                  Dans Cloudflare Zero Trust : <b>Access → Service credentials → Service tokens → Create</b>. Nom <K>Raccourci santé</K>, durée <K>Non-expiring</K>.
                </Step>
                <Step n={2}>
                  <b>Access → Applications → Add an application → Self-hosted</b>. Ton domaine, chemin <K>api/sante/import</K>. Une seule règle : action <b>Service Auth</b>, Include → <b>Service Token</b> → <K>Raccourci santé</K>.
                </Step>
                <Step n={3}>Colle ici le Client ID et le Client Secret. Ils sont gardés dans l'appli et recopiés dans chaque code d'installation.</Step>
              </ol>
            </>
          )}
          <CloudflareForm saved={cfSaved} />
        </Card>
      </section>

      <section className="grid gap-2.5" aria-labelledby="rc">
        <h2 id="rc" className="text-[18px] font-bold">
          Installer sur l'iPhone de {person.name}
        </h2>
        <Card pad="md" className="grid gap-4">
          {!code ? null : (
            <>
              <p className="text-[14px] text-ink-2">
                À faire sur l'iPhone de {person.name}, avec le bon profil choisi en haut. Le Raccourci est le même pour tout le monde : c'est le code qui dit à qui vont les données.
              </p>
              <ol className="grid gap-4">
                <Step n={1}>
                  <div className="grid gap-2">
                    <span>Copie le code. Si tu es sur un autre téléphone, envoie-le plutôt (AirDrop, Messages).</span>
                    <CopyCode code={code!} personName={person.name} />
                  </div>
                </Step>
                <Step n={2}>
                  <div className="grid gap-2">
                    <span>Ajoute le Raccourci <b>Santé → Mijote</b>.</span>
                    <div>
                      <InstallLink href={shortcutHref} />
                    </div>
                  </div>
                </Step>
                <Step n={3}>
                  Lance-le une fois depuis l'app Raccourcis. Il garde le code, demande l'accès à Santé (autorise <b>Poids</b>, <b>Nombre de pas</b> et <b>Entraînements</b>), puis envoie les 6 derniers mois : compte une ou deux minutes.
                </Step>
                <Step n={4}>
                  Pour qu'il tourne seul : Raccourcis → <b>Automatisation</b> → <b>+</b> → <b>App</b> → l'app de ta balance → <b>Est fermée</b>, puis <b>Exécuter immédiatement</b> et le Raccourci <b>Santé → Mijote</b>. Sans balance le matin : <b>Alarme</b> → <b>Est arrêtée</b>.
                </Step>
              </ol>
              <p className="text-[13px] text-ink-2">
                Ensuite, chaque envoi relit les 7 derniers jours, et le dernier mois une fois par semaine. Envoyer deux fois la même chose ne crée pas de doublon.
              </p>
              <LinkTools personId={person.id} />
            </>
          )}
        </Card>
      </section>

      <section className="grid gap-2.5" aria-labelledby="hist">
        <h2 id="hist" className="text-[18px] font-bold">Tout l'historique (facultatif)</h2>
        <Card pad="md" className="grid gap-3">
          <p className="text-[14px] text-ink-2">
            Dans l'app Santé : ta photo en haut à droite → <b>Exporter toutes les données de santé</b>, puis enregistre <K>export.zip</K> dans Fichiers. Choisis-le ici : il est lu sur ton appareil, seules les pesées, les séances et les pas par jour sont envoyés au profil de {person.name}. Utile pour remonter plus loin que les 6 mois du Raccourci.
          </p>
          <ExportImport personId={person.id} personName={person.name} />
        </Card>
      </section>
    </div>
  );
}
