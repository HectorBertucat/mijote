// Test de fumée de l'appli construite (pnpm build d'abord) : le serveur de production démarre sur une
// base vide, la mise en route s'ouvre, puis, foyer créé, chaque page répond sans erreur, avec et sans
// mot de passe ; enfin le mode démo (MIJOTE_DEMO=1), une base par visiteur. Sert en local et en CI (la
// même chose que l'image Docker exécute).
//   pnpm build && pnpm test:smoke
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "@/lib/db/open";
import { addPerson } from "@/lib/household";
import { setSetting, SETTING } from "@/lib/settings";
import { authToken } from "@/lib/auth";
import { buildShoppingList } from "@/lib/shopping/build";
import { addEvent, createSession } from "@/lib/session/store";
import { storeBoxes } from "@/lib/boxes/store";
import { cookEvents, cookSessions, recipes, shoppingLists } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { assignProgram } from "@/lib/training/programs";
import { generateProgram } from "@/lib/training/generate";
import { ensureLink } from "@/lib/health/link";

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, ".next/standalone");
const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;
let failures = 0;

function check(ok: boolean, label: string) {
  console.log(`${ok ? "✔" : "✖"} ${label}`);
  if (!ok) failures++;
}

/** Comme l'image Docker : fichiers statiques et publics à côté du serveur autonome. */
function prepare() {
  if (!fs.existsSync(path.join(STANDALONE, "server.js"))) throw new Error("Pas de build autonome : lancer `pnpm build` d'abord.");
  fs.cpSync(path.join(ROOT, ".next/static"), path.join(STANDALONE, ".next/static"), { recursive: true });
  fs.cpSync(path.join(ROOT, "public"), path.join(STANDALONE, "public"), { recursive: true });
}

/** Arrête le serveur et attend qu'il ait libéré le port (sinon le suivant répondrait à sa place). */
async function stop(child: ChildProcess) {
  if (child.exitCode != null) return;
  const exited = once(child, "exit");
  child.kill();
  await exited;
}

async function portFree(): Promise<boolean> {
  try {
    await fetch(`${BASE}/manifest.webmanifest`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
}

async function start(dataDir: string, env: Record<string, string> = {}): Promise<ChildProcess> {
  if (!(await portFree())) throw new Error(`le port ${PORT} est déjà pris`);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: STANDALONE,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      MIJOTE_DATA_DIR: dataDir,
      MIJOTE_MIGRATIONS_DIR: path.join(ROOT, "src/lib/db/migrations"),
      MIJOTE_RECIPES_DIR: path.join(ROOT, "src/seed/recipes"),
      CHRONOCATALOG_URL: "",
      ANTHROPIC_API_KEY: "",
      MIJOTE_PASSWORD: "",
      MIJOTE_DEMO: "",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout!.on("data", (d) => (log += d));
  child.stderr!.on("data", (d) => (log += d));
  child.on("exit", (code) => code && code !== 143 && console.error(log));
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/manifest.webmanifest`);
      return child;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.error(log);
  throw new Error("le serveur ne démarre pas");
}

const get = (p: string, cookie?: string) => fetch(`${BASE}${p}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
const ERROR_MARKERS = /Application error|Internal Server Error|Unhandled Runtime Error|__next_error__/;

async function page(p: string, cookie?: string, contains?: RegExp) {
  const r = await get(p, cookie);
  const body = r.status === 200 ? await r.text() : "";
  check(r.status === 200 && !ERROR_MARKERS.test(body) && (!contains || contains.test(body)), `${p} → ${r.status}${contains && r.status === 200 && !contains.test(body) ? ` (sans ${contains})` : ""}`);
}

async function main() {
  prepare();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mijote-smoke-"));

  // 1. Instance neuve, sans mot de passe.
  let server = await start(dataDir);
  try {
    const home = await get("/recettes");
    check(home.status === 307 && /\/bienvenue$/.test(home.headers.get("location") ?? ""), "instance neuve → /bienvenue");
    await page("/bienvenue", undefined, /Bienvenue dans Mijote/);
    await page("/reglages", undefined, /La cuisine/);

    // La mise en route, comme si on avait rempli le formulaire (même code que les actions).
    const { db } = openDb(path.join(dataDir, "mijote.db"));
    const lea = addPerson(db, { name: "Léa", portionUnits: 4, sex: "f", birthDate: "1994-07-01", heightCm: 165, weightKg: 60, activity: "light", goal: "maintain" });
    addPerson(db, { name: "Tom", portionUnits: 5 });
    setSetting(db, SETTING.setupDone, new Date().toISOString());
    assignProgram(db, lea, generateProgram({ gear: ["miniBande"], perWeek: 2, minutes: 30, level: 1, focus: "bas" }, ""), "generateur");
    const listId = await buildShoppingList(db, ["chasseur-porc", "pasta-al-forno-saucisse-ricotta"]);
    const sessionId = createSession(db, { slugs: ["chasseur-porc", "pasta-al-forno-saucisse-ricotta"], mode: "solo" });

    for (const p of ["/", "/recettes", "/recettes/chasseur-porc", "/semaine", "/semaine?w=2026-11-05&n=12", "/composer", "/courses", `/courses/${listId}`, "/couts", "/placard", `/session/${sessionId}`, "/atelier", "/atelier/importer", "/sante", "/sante/demarrer?p=lea", "/sante/aujourdhui", "/sante/objectifs", "/sante/apple", "/sante/profil", "/kit", "/kit/dessins", "/kit/boites"])
      await page(p, undefined);
    await page("/recettes", undefined, /Léa/);
    // Prise en main : les premiers pas sur l’accueil, la visite relançable, les images de démarrage iOS.
    await page("/", undefined, /Premiers pas/);
    await page("/?visite=1", undefined);
    await page("/reglages", undefined, /Revoir la visite/);
    const launch = await get("/lancement?w=1179&h=2556&theme=sombre");
    check(launch.status === 200 && launch.headers.get("content-type") === "image/png", "image de démarrage iOS → PNG");
    check((await get("/lancement?w=4000&h=4000")).status === 404, "image de démarrage d’une taille inconnue → 404");
    await page("/sante/habitudes", "mijote.profil=lea", /Shaker protéiné/);
    // Fin de session : la marmite pesée part en boîtes, au frigo et au congélo.
    await page("/frigo", undefined, /Le frigo est vide/);
    await page("/recettes/butter-chicken-express", undefined, /En boîtes/);
    const done = createSession(db, { slugs: ["butter-chicken-express"], mode: "solo" });
    addEvent(db, done, { kind: "note", payload: { status: "done" } });
    const bc = db.select({ id: recipes.id }).from(recipes).where(eq(recipes.slug, "butter-chicken-express")).get()!;
    check(storeBoxes(db, done, bc.id, { dishG: 3800, sideG: 1350 }) > 0, "boîtes rangées en fin de session");
    await page("/frigo", undefined, /Butter chicken/);
    await page(`/session/${done}`, undefined);
    await page("/sante/entrainement?vue=programme", "mijote.profil=lea", /Changer de programme/);
    await page("/sante/entrainement", "mijote.profil=tom", /Pas encore de programme pour Tom/);
    check((await get("/bienvenue")).status === 307, "mise en route faite → /bienvenue renvoie à l'accueil");
    check((await get("/api/sante/import", undefined)).status === 401, "import Apple Santé sans clé → 401");
    // L'app Mijote Santé : un paquet v2 minimal avec la clé de Léa, puis le GET qui ne demande plus l'historique.
    const santeKey = { "X-Mijote-Key": ensureLink(db, lea).key, "Content-Type": "application/json" };
    const v2 = { version: 2, batch: { id: "smoke", index: 0, last: true, history: "complete" }, samples: [{ uuid: "smoke-1", type: "body_mass", start: new Date().toISOString(), value: 60.2, unit: "kg" }], daily: [{ type: "steps", date: new Date().toISOString().slice(0, 10), value: 4200, unit: "count" }] };
    const sent = await fetch(`${BASE}/api/sante/import`, { method: "POST", headers: santeKey, body: JSON.stringify(v2) });
    const sentBody = (await sent.json()) as { accepted?: { samples: number; daily: number } };
    check(sent.status === 200 && sentBody.accepted?.samples === 1 && sentBody.accepted?.daily === 1, `import Apple Santé v2 → ${sent.status}`);
    const state = (await (await fetch(`${BASE}/api/sante/import`, { headers: santeKey })).json()) as { v2?: boolean; history?: string; lastSyncAt?: string };
    check(state.v2 === true && state.history == null && !!state.lastSyncAt, "import Apple Santé : GET v2, historique complet reçu");
    // Sans ANTHROPIC_API_KEY : pas d'assistant (ni bouton, ni route), tout le reste marche.
    const ask = await fetch(`${BASE}/api/assistant`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Bonjour" }) });
    check(ask.status === 404, "assistant sans clé → 404");
    const homeHtml = await (await get("/")).text();
    check(!/Assistant \(⌘I\)/.test(homeHtml), "assistant sans clé : pas de bouton");
    check(!/data-demo-banner/.test(homeHtml) && !(await get("/")).headers.get("set-cookie")?.includes("mijote.demo"), "instance normale : ni bandeau ni cookie de démo");
  } finally {
    await stop(server);
  }

  // 2. Même instance, avec un mot de passe.
  server = await start(dataDir, { MIJOTE_PASSWORD: "test-fumee" });
  try {
    const r = await get("/recettes");
    check(r.status === 307 && /\/connexion\?suite=%2Frecettes/.test(r.headers.get("location") ?? ""), "mot de passe → /connexion");
    check((await get("/api/session/active")).status === 401, "API sans connexion → 401");
    await page("/connexion", undefined, /mot de passe/);
    const cookie = `mijote.auth=${await authToken("test-fumee")}`;
    await page("/recettes", cookie, /Léa/);
  } finally {
    await stop(server);
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  await demo();
  console.log(failures ? `\n${failures} échec(s)` : "\nTout répond.");
  process.exit(failures ? 1 : 0);
}

/** Le cookie de démo posé par la réponse. */
const demoCookie = (r: Response) => /mijote\.demo=([0-9a-f]{32})/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? null;

/** 3. Mode démo : foyer prêt sans mise en route, une base par visiteur, ni mot de passe ni IA même réglés. */
async function demo() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mijote-demo-"));
  const server = await start(dataDir, { MIJOTE_DEMO: "1", MIJOTE_PASSWORD: "ignore-en-demo", ANTHROPIC_API_KEY: "sk-ignoree-en-demo" });
  try {
    const first = await get("/");
    const a = demoCookie(first);
    check(first.status === 200 && a != null, "démo : l'accueil s'ouvre sans mise en route ni mot de passe, cookie de visiteur posé");
    const cookieA = `mijote.demo=${a}`;
    await page("/", cookieA, /data-demo-banner[\s\S]*Recommencer/);
    const fileA = path.join(dataDir, "demo", `v-${a}.db`);
    check(fs.existsSync(fileA), "démo : la base du visiteur est dans le dossier de la démo");
    const { sqlite, db } = openDb(fileA);
    const session = db.select({ id: cookSessions.id }).from(cookSessions).where(eq(cookSessions.status, "done")).all().at(-1)!.id;
    const list = db.select({ id: shoppingLists.id }).from(shoppingLists).where(eq(shoppingLists.status, "draft")).get()!.id;
    for (const p of ["/recettes", "/recettes/butter-chicken-express", "/semaine", "/composer", "/courses", `/courses/${list}`, "/couts", "/placard", "/frigo", `/session/${session}`, "/sante", "/sante/aujourdhui", "/sante/profil", "/sante/habitudes", "/sante/entrainement", "/reglages"])
      await page(p, cookieA);
    await page("/frigo", cookieA, /Congélo|congélo/);
    await page("/semaine", cookieA, /Butter chicken/);
    await page("/sante", cookieA, /Alex/);
    await page("/atelier", cookieA, /besoin de l’IA/);
    await page("/atelier/importer", cookieA, /besoin de l’IA/);
    await page("/sante/objectifs", cookieA, /besoin de l’IA/);
    await page("/sante/apple", cookieA, /Apple Santé reste chez toi/);
    check((await fetch(`${BASE}/api/assistant`, { method: "POST", headers: { cookie: cookieA, "Content-Type": "application/json" }, body: JSON.stringify({ text: "Bonjour" }) })).status === 404, "démo : pas d'assistant, même avec une clé");
    check((await get("/api/sante/import", cookieA)).status === 404, "démo : pas d'import Apple Santé");
    check((await get("/bienvenue", cookieA)).status === 307, "démo : pas de mise en route");

    // Deux visiteurs, deux bases : ce que l'un change, l'autre ne le voit pas.
    setSetting(db, SETTING.homeName, "Maison du visiteur A");
    sqlite.close();
    const b = demoCookie(await get("/recettes"));
    check(b != null && b !== a, "démo : un autre visiteur reçoit son propre cookie");
    await page("/", cookieA, /Maison du visiteur A/);
    const other = await (await get("/", `mijote.demo=${b}`)).text();
    check(!/Maison du visiteur A/.test(other) && /Chez Alex et Sam/.test(other), "démo : le second visiteur a sa base, intacte");
    // Une écriture par l'appli va dans la base du visiteur qui l'a faite (la session a le même id dans les deux).
    const wrote = await fetch(`${BASE}/api/session/${session}/actions`, { method: "POST", headers: { cookie: cookieA, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "note", payload: { text: "essai" } }) });
    const events = (file: string) => {
      const x = openDb(file);
      const n = x.db.select({ id: cookEvents.id }).from(cookEvents).all().length;
      x.sqlite.close();
      return n;
    };
    check(wrote.status === 200 && events(fileA) === 1 && events(path.join(dataDir, "demo", `v-${b}.db`)) === 0, "démo : l'écriture d'un visiteur reste dans sa base");
    // « Recommencer » (formulaire sans script, comme un premier clic) : la base de A repart du modèle.
    const action = /name="(\$ACTION_ID_[^"]+)"/.exec(await (await get("/", cookieA)).text())?.[1];
    const form = new FormData();
    if (action) form.set(action, "");
    const restart = await fetch(`${BASE}/`, { method: "POST", headers: { cookie: cookieA }, body: form, redirect: "manual" });
    check(action != null && restart.status < 400, `démo : « Recommencer » → ${restart.status}`);
    await page("/", cookieA, /Chez Alex et Sam/);
    check(events(fileA) === 0, "démo : après « Recommencer », plus rien du visiteur");
    // Un cookie trafiqué ne sort pas du dossier : un nouvel identifiant est donné.
    const forged = await get("/", "mijote.demo=../../mijote");
    check(forged.status === 200 && demoCookie(forged) != null, "démo : cookie invalide → nouveau visiteur");
    check(!fs.existsSync(path.join(dataDir, "mijote.db")), "démo : la base d'instance n'est jamais créée");
  } finally {
    await stop(server);
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
