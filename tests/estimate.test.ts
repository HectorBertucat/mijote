import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { RecipeInput } from "@/lib/recipes/format";
import { estimateSession, suggestPairings, type RecipeLike } from "@/lib/session/estimate";

function load(file: string): RecipeLike {
  const r = RecipeInput.parse(JSON.parse(fs.readFileSync(path.join("src/seed/recipes", file), "utf8")));
  return {
    slug: r.slug,
    name: r.name,
    tags: r.tags,
    fridgeDays: r.fridgeDays ?? null,
    steps: r.steps.map((s) => ({
      kind: s.kind,
      durationMin: s.durationMin ?? null,
      activeMin: s.activeMin ?? null,
      equipmentId: s.equipmentId ?? null,
      ovenTemp: s.ovenTemp ?? null,
    })),
  };
}

const chasseur = load("chasseur-porc.json");
const forno = load("pasta-al-forno.json");
const caramel = load("porc-caramel.json");
const colombo = load("colombo-porc.json");

test("chasseur + forno : four à 160 et 200 °C signalé", () => {
  const e = estimateSession([chasseur, forno]);
  assert.ok(e.conflicts.some((c) => c.kind === "oven_temp"));
  assert.ok(e.totalMin > e.activeMin);
  assert.equal(e.fridgeDays, 3);
});

test("caramel + colombo : une seule cocotte", () => {
  const e = estimateSession([caramel, colombo]);
  assert.ok(e.conflicts.some((c) => c.kind === "single_equipment" && c.message.includes("cocotte")));
});

test("les accords évitent un second plat à la cocotte", () => {
  const p = suggestPairings([caramel], [colombo, forno]);
  assert.equal(p[0].slug, forno.slug);
});
