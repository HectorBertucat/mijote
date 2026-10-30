// Test de fumée de l'appli construite (pnpm build d'abord) : le serveur de production démarre sur une
// base vide, la mise en route s'ouvre, puis, foyer créé, chaque page répond sans erreur, avec et sans
// mot de passe. Sert en local et en CI (la même chose que l'image Docker exécute).
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
import { createSession } from "@/lib/session/store";
import { assignProgram } from "@/lib/training/programs";
import { generateProgram } from "@/lib/training/generate";

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

    for (const p of ["/recettes", "/recettes/chasseur-porc", "/semaine", "/composer", "/courses", `/courses/${listId}`, "/couts", "/placard", `/session/${sessionId}`, "/atelier", "/atelier/importer", "/sante", "/sante/demarrer?p=lea", "/sante/aujourdhui", "/sante/objectifs", "/sante/apple", "/sante/profil", "/kit", "/kit/dessins"])
      await page(p, undefined);
    await page("/recettes", undefined, /Léa/);
    await page("/sante/entrainement?vue=programme", "mijote.profil=lea", /Changer de programme/);
    await page("/sante/entrainement", "mijote.profil=tom", /Pas encore de programme pour Tom/);
    check((await get("/bienvenue")).status === 307, "mise en route faite → /bienvenue renvoie à l'accueil");
    check((await get("/api/sante/import", undefined)).status === 401, "import Apple Santé sans clé → 401");
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
  console.log(failures ? `\n${failures} échec(s)` : "\nTout répond.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
