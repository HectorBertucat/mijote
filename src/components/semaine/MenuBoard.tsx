"use client";

// Le menu de la semaine, comme une feuille de marché : un jour par ligne sous un filet, midi et soir en colonnes,
// chaque plat en étiquette d'étiqueteuse (Tape) sur sa couleur. « Partager » dessine la même feuille dans une image
// (canvas, couleurs et polices lues sur la page) et ouvre la feuille de partage du téléphone ; sans partage de
// fichiers (ordinateur), l'image se télécharge.
import { useRef, useState } from "react";
import { Button, Tape } from "@/components/ui";

export type BoardDay = { label: string; lunch: { name: string; color: string }[]; dinner: { name: string; color: string }[] };

const short = (name: string) => name.replace(/\s*\(.*\)\s*/g, "").split(/,| façon | au | aux | à la /)[0].trim();
const MEALS = [
  ["lunch", "midi"],
  ["dinner", "soir"],
] as const;

export function MenuBoard({ title, days, ready }: { title: string; days: BoardDay[]; ready: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const shown = days.filter((d) => d.lunch.length || d.dinner.length);

  async function share() {
    const el = ref.current;
    if (!el) return;
    setBusy(true);
    setMsg(null);
    try {
      const blob = await drawBoard(el, title, shown, ready);
      const file = new File([blob], `menu-${title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-")}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: `Menu · ${title}` });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setMsg("Image téléchargée.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg("Impossible de faire l’image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <div ref={ref} className="grid max-w-[880px]">
        <div className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)] gap-x-4 pb-2 sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]" aria-hidden>
          <span />
          {MEALS.map(([, l]) => (
            <span key={l} className="label text-ink-3">
              {l}
            </span>
          ))}
        </div>
        <ul className="border-b border-line" aria-label={`Menu, ${title}`}>
          {shown.map((d) => (
            <li key={d.label} className="grid grid-cols-[56px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-4 border-t border-line py-3 sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]">
              <span className="label pt-1 text-ink">{d.label}</span>
              {MEALS.map(([m, l]) => (
                <span key={m} className="flex min-w-0 flex-wrap gap-2" aria-label={`${l} : ${d[m].map((x) => x.name).join(", ") || "rien"}`}>
                  {d[m].length ? (
                    d[m].map((x) => (
                      <Tape key={x.name} tint={x.color} seed={`${d.label}${m}${x.name}`}>
                        {short(x.name)}
                      </Tape>
                    ))
                  ) : (
                    <span className="pt-1 text-small text-ink-3">—</span>
                  )}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" icon="link" state={busy ? "loading" : "idle"} loadingLabel="J’imprime le menu…" onClick={share}>
          Partager le menu en image
        </Button>
        {msg && <span className="text-small text-ink-2" role="status">{msg}</span>}
      </div>
    </div>
  );
}

/** La feuille en PNG (1080 px de large), avec les couleurs et polices réelles de la page (aucune couleur en dur). */
async function drawBoard(el: HTMLElement, title: string, days: BoardDay[], ready: boolean): Promise<Blob> {
  const root = getComputedStyle(document.documentElement);
  const v = (name: string) => root.getPropertyValue(name).trim();
  const display = getComputedStyle(el.querySelector(".label") ?? el).fontFamily;
  await document.fonts?.ready;
  const W = 1080;
  const rowH = 132;
  const top = 300;
  const H = top + days.length * rowH + 140;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const stretch = (s: CanvasFontStretch) => {
    if ("fontStretch" in g) g.fontStretch = s;
  };
  g.fillStyle = v("--c-bg");
  g.fillRect(0, 0, W, H);
  g.fillStyle = v("--c-ink");
  g.textBaseline = "alphabetic";
  stretch("expanded");
  g.font = `800 112px ${display}`;
  g.fillText("Au menu", 72, 170);
  stretch("normal");
  g.fillStyle = v("--c-ink-2");
  g.font = `600 40px ${display}`;
  g.fillText(title, 72, 232);
  const col = [72, 260, 660];
  stretch("condensed");
  g.fillStyle = v("--c-ink-3");
  g.font = `650 26px ${display}`;
  g.fillText("MIDI", col[1], top - 16);
  g.fillText("SOIR", col[2], top - 16);
  days.forEach((d, i) => {
    const y = top + i * rowH;
    g.fillStyle = v("--c-line");
    g.fillRect(72, y, W - 144, 2);
    g.fillStyle = v("--c-ink");
    g.font = `650 30px ${display}`;
    g.fillText(d.label.toUpperCase(), col[0], y + 62);
    MEALS.forEach(([m], k) => {
      let ly = y + 24;
      for (const dish of d[m].slice(0, 2)) {
        const text = fit(g, short(dish.name).toUpperCase(), 360);
        const tw = g.measureText(text).width;
        g.save();
        g.translate(col[k + 1], ly);
        g.rotate((-1.5 * Math.PI) / 180);
        g.fillStyle = resolveColor(dish.color, v);
        g.fillRect(0, 0, tw + 28, 46);
        g.fillStyle = v("--c-on-recipe");
        g.fillText(text, 14, 34);
        g.restore();
        ly += 54;
      }
    });
  });
  g.fillStyle = v("--c-line");
  g.fillRect(72, top + days.length * rowH, W - 144, 2);
  if (ready) {
    g.save();
    g.translate(W - 230, H - 80);
    g.rotate(-0.12);
    g.strokeStyle = v("--c-hot");
    g.fillStyle = v("--c-hot");
    g.lineWidth = 6;
    g.strokeRect(-150, -46, 300, 92);
    stretch("expanded");
    g.font = `800 36px ${display}`;
    g.textAlign = "center";
    g.fillText("SEMAINE PRÊTE", 0, 13);
    g.restore();
  }
  return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
}

/** Coupe un texte avec « … » pour qu'il tienne dans `max` px. */
function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** « var(--c-recipe-3) » → sa valeur calculée. */
function resolveColor(c: string, v: (n: string) => string): string {
  const m = /var\((--[^)]+)\)/.exec(c);
  return m ? v(m[1]) : c;
}
