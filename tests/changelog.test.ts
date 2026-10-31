import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { FRAGMENTS_DIR, JOURNAL, checkFragment, fold, isFragmentFile } from "../scripts/changelog-core";

const ok = { name: "2026-10-31-ci-plus-rapide.md", text: "## 2026-10-31 : CI plus rapide\n- Une ligne.\n" };

test("journal : les fragments du dépôt sont valides et se versent sans erreur", () => {
  const frags = fs.readdirSync(FRAGMENTS_DIR).filter(isFragmentFile).map((name) => ({ name, text: fs.readFileSync(path.join(FRAGMENTS_DIR, name), "utf8") }));
  assert.deepEqual(frags.flatMap(checkFragment), []);
  const journal = fs.readFileSync(JOURNAL, "utf8");
  const out = fold(journal, frags);
  for (const f of frags) assert.ok(out.includes(f.text.trim()));
  assert.ok(out.endsWith(journal.slice(journal.search(/^## /m))));
});

test("journal : fragment bien formé accepté, les autres refusés avec la raison", () => {
  assert.deepEqual(checkFragment(ok), []);
  assert.match(checkFragment({ ...ok, name: "ci.md" })[0], /nom attendu/);
  assert.match(checkFragment({ ...ok, name: "2026-10-31-CI.md" })[0], /nom attendu/);
  assert.match(checkFragment({ name: "2026-02-30-x.md", text: "## 2026-02-30 : x\n- y" }).join(), /invalide/);
  assert.match(checkFragment({ ...ok, text: "## 2026-10-30 : CI\n- y" }).join(), /première ligne/);
  assert.match(checkFragment({ ...ok, text: "## 2026-10-31 : \n- y" }).join(), /première ligne/);
  assert.match(checkFragment({ ...ok, text: "## 2026-10-31 : CI\n- y\n## 2026-10-31 : autre\n- z" }).join(), /un seul titre/);
  assert.match(checkFragment({ ...ok, text: "## 2026-10-31 : CI\ntexte" }).join(), /au moins une ligne/);
  assert.equal(isFragmentFile("README.md"), false);
});

test("journal : versement le plus récent en tête, sous le titre, rien sans fragment", () => {
  const journal = "# Journal\n\nChapeau.\n\n## 2026-10-01 : ancien\n- a\n";
  assert.equal(fold(journal, []), journal);
  const out = fold(journal, [
    { name: "2026-10-02-b.md", text: "## 2026-10-02 : b\n- b\n" },
    { name: "2026-10-03-c.md", text: "## 2026-10-03 : c\n- c" },
  ]);
  assert.equal(out, "# Journal\n\nChapeau.\n\n## 2026-10-03 : c\n- c\n\n## 2026-10-02 : b\n- b\n\n## 2026-10-01 : ancien\n- a\n");
  assert.equal(fold("# Journal\n", [ok]), "# Journal\n\n## 2026-10-31 : CI plus rapide\n- Une ligne.\n");
  assert.throws(() => fold("pas de titre", [ok]));
});
