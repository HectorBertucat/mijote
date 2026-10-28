#!/usr/bin/env node
// Garde-fou avant commit et push : rien de privé ne doit arriver dans le dépôt public.
// - Toujours : clés d'API et jetons reconnaissables, fichiers de base ou d'environnement.
// - Si le mainteneur a un contexte privé (perso/denylist.txt, dossier ignoré par git) : ses motifs
//   (noms, adresses, domaines…), une expression régulière par ligne, « # » pour un commentaire.
// - Messages de commit : pas de mention d'IA en co-auteur (Co-Authored-By: Claude…, « Generated with »).
//   node scripts/check-private.mjs --staged        fichiers indexés (hook pre-commit)
//   node scripts/check-private.mjs --message <f>   message de commit (hook commit-msg)
//   node scripts/check-private.mjs --range <a..b>  commits à pousser (hook pre-push)
//   node scripts/check-private.mjs --all           tout le dépôt suivi
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const BUILTIN = [
  /sk-ant-[a-zA-Z0-9_-]{20,}/, // clé Anthropic
  /ghp_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}/, // jeton GitHub
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, // clé AWS
];
const FORBIDDEN_FILES = [/(^|\/)\.env(\.|$)(?!example$)/, /\.db(-wal|-shm)?$/, /(^|\/)perso\//];
const AI_TRAILERS = [/^co-authored-by:.*\b(claude|anthropic|openai|chatgpt|copilot)\b/im, /generated with \[?claude code/i, /🤖 generated with/i];

function denylist() {
  const f = "perso/denylist.txt";
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => new RegExp(l, "i"));
}

function scan(name, text, patterns) {
  const out = [];
  if (FORBIDDEN_FILES.some((r) => r.test(name))) out.push(`${name} : fichier qui ne doit pas être versionné`);
  text.split("\n").forEach((line, i) => {
    for (const r of patterns) if (r.test(line)) out.push(`${name}:${i + 1} : « ${line.trim().slice(0, 100)} » (motif ${r.source.slice(0, 40)})`);
  });
  return out;
}

const [mode, arg] = process.argv.slice(2);
const patterns = [...BUILTIN, ...denylist()];
let problems = [];

if (mode === "--message") {
  const msg = fs.readFileSync(arg, "utf8").replace(/^#.*$/gm, "");
  for (const r of AI_TRAILERS) if (r.test(msg)) problems.push(`message de commit : mention d'IA en attribution (${r.source})`);
  problems.push(...scan("message de commit", msg, patterns).map((p) => p.replace(/^message de commit : fichier.*$/, "")).filter(Boolean));
} else {
  const files =
    mode === "--staged" ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR").split("\n").filter(Boolean)
    : mode === "--range" ? git("diff", "--name-only", "--diff-filter=ACMR", arg).split("\n").filter(Boolean)
    : git("ls-files").split("\n").filter(Boolean);
  const rev = mode === "--range" ? arg.split("..")[1] || "HEAD" : null;
  for (const f of files) {
    let text = "";
    try {
      text = mode === "--staged" ? git("show", `:${f}`) : rev ? git("show", `${rev}:${f}`) : fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) {
      if (FORBIDDEN_FILES.some((r) => r.test(f))) problems.push(`${f} : fichier qui ne doit pas être versionné`);
      continue;
    }
    problems.push(...scan(f, text, patterns));
  }
  if (mode === "--range") for (const sha of git("rev-list", arg).split("\n").filter(Boolean)) {
    const msg = git("log", "-1", "--format=%B", sha);
    for (const r of AI_TRAILERS) if (r.test(msg)) problems.push(`commit ${sha.slice(0, 7)} : mention d'IA en attribution`);
    problems.push(...scan(`commit ${sha.slice(0, 7)}`, msg, patterns.slice(BUILTIN.length)).filter((p) => !p.includes("fichier qui")));
  }
}

if (problems.length) {
  console.error(`✖ Contenu privé ou interdit (${problems.length}) :\n  ${problems.slice(0, 30).join("\n  ")}`);
  console.error("\nRetire-le avant de continuer. Les motifs privés sont dans perso/denylist.txt (jamais publié).");
  process.exit(1);
}
