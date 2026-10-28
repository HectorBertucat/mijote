// Rendu du guide du rythme (affiché seulement en séance guidée) : il se dessine à chaque instant,
// avant, pendant et après la série, sans planter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RhythmGuide } from "@/components/sante/training/RhythmGuide";
import { MOTIONS } from "@/lib/training/figures";
import { cycleDuration } from "@/lib/training/motion";

test("guide du rythme : courbe, bille et prochaine phase, à tout instant", () => {
  const m = MOTIONS.goblet;
  const end = 3 * cycleDuration(m);
  for (const t of [0, 0.5, 3.05, 4.2, end - 0.1, end + 2]) {
    const html = renderToStaticMarkup(createElement(RhythmGuide, { motion: m, t, end, active: true }));
    assert.match(html, /<circle/, `t=${t}`);
    assert.equal((html.match(/<path /g) ?? []).length, 2, `t=${t} : passé et à venir`);
    if (t < end - 1) assert.match(html, /Ensuite : <b[^>]*>/, `t=${t}`);
    assert.ok(!/NaN/.test(html), `t=${t} : pas de NaN`);
  }
  // Sur une figure de la bibliothèque à plus de deux poses aussi.
  for (const [id, mo] of Object.entries(MOTIONS)) assert.ok(!/NaN/.test(renderToStaticMarkup(createElement(RhythmGuide, { motion: mo, t: 1.3, active: false }))), id);
});
