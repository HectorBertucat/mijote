// À deux : A et B affichés sous les prénoms du foyer (« Alex et Sam »), avec repli sur les lettres.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { duoNames, handoffLine, LETTERS, ofName } from "@/lib/session/people";
import { People, PersonMono } from "@/components/session/parts";

test("prénoms : A = le premier du foyer, B = le second, initiales dans la pastille", () => {
  assert.deepEqual(duoNames(["Alex", "Sam", "Léo"]), { A: { name: "Alex", mono: "A" }, B: { name: "Sam", mono: "S" } });
  assert.deepEqual(duoNames(["élise", "Sam"]).A, { name: "élise", mono: "É" });
});

test("prénoms : repli sur les lettres sans prénom, avec un seul, ou en double", () => {
  assert.deepEqual(duoNames([]), LETTERS);
  assert.deepEqual(duoNames(["  ", null]), LETTERS);
  assert.deepEqual(duoNames(["Alex"]), { A: { name: "Alex", mono: "A" }, B: { name: "B", mono: "B" } });
  assert.deepEqual(duoNames(["Sam", "sam"]), { A: { name: "Sam", mono: "S" }, B: { name: "B", mono: "B" } });
  // Deux initiales pareilles : les pastilles gardent A et B pour qu'on les distingue.
  assert.deepEqual(duoNames(["Sam", "Sacha"]), { A: { name: "Sam", mono: "A" }, B: { name: "Sacha", mono: "B" } });
});

test("élision et relais avec les prénoms", () => {
  assert.equal(ofName("Alex"), "d’Alex");
  assert.equal(ofName("Sam"), "de Sam");
  assert.equal(ofName("A"), "de A");
  const names = duoNames(["Alex", "Sam"]);
  assert.equal(handoffLine({ from: "B", to: "A", text: "B libère le faitout pour A" }, names), "Sam libère le faitout pour Alex");
  assert.equal(handoffLine({ from: "B", to: "A", text: "B libère le faitout pour A" }, LETTERS), "B libère le faitout pour A");
  assert.equal(handoffLine({ from: "A", to: "B", text: "Autre chose" }, names), "Autre chose");
});

test("la pastille lit le prénom du contexte, sinon la lettre", () => {
  const html = renderToStaticMarkup(createElement(People.Provider, { value: duoNames(["Alex", "Sam"]) }, createElement(PersonMono, { person: "B" })));
  assert.match(html, /aria-label="Sam"/);
  assert.match(html, />S</);
  assert.match(renderToStaticMarkup(createElement(PersonMono, { person: "B" })), /aria-label="Personne B">B</);
});

test("l’avis « autre écran » nomme la personne par son prénom", async () => {
  const { describe } = await import("@/components/session/useSession");
  const plan = { steps: [{ id: "s1", no: 3 }], prep: { tasks: [] }, recipes: [], mode: "duo" } as unknown as Parameters<typeof describe>[1];
  const e = { id: "e1", at: "2026-10-21T18:00:00Z", kind: "step_start" as const, ref: "s1", payload: { person: "B" } };
  assert.equal(describe(e, plan, duoNames(["Alex", "Sam"])), "Sam · Étape 3 commencée");
  assert.equal(describe(e, plan), "B · Étape 3 commencée");
});
