"use client";

// Le menu de la semaine en ardoise de bistrot : fond d'encre, écriture à la craie, une pastille par plat.
// « Partager » dessine la même ardoise dans une image (canvas, couleurs et polices lues sur la page) et ouvre
// la feuille de partage du téléphone ; sans partage de fichiers (ordinateur), l'image se télécharge.
import { useRef, useState } from "react";
import { Button, RecipeTile } from "@/components/ui";

export type BoardDay = { label: string; lunch: { name: string; color: string }[]; dinner: { name: string; color: string }[] };

const short = (name: string) => name.replace(/\s*\(.*\)\s*/g, "").trim();

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
      const file = new File([blob], `menu-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`, { type: "image/png" });
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
      if ((e as Error).name !== "AbortError") setMsg("Impossible de faire l'image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="ardoise-titre" className="grid gap-2">
      <div ref={ref} className="kitchen-dark relative overflow-hidden rounded-[16px] border-[6px] border-[color-mix(in_srgb,var(--c-recipe-6)_75%,var(--c-surface))] bg-surface px-5 py-4 text-ink shadow-e2">
        <h2 id="ardoise-titre" className="text-[32px] leading-none">
          Au menu
          <span className="label ml-3 align-middle opacity-70">{title}</span>
        </h2>
        <ul className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {shown.map((d) => (
            <li key={d.label} className="grid grid-cols-[3.2rem_minmax(0,1fr)] items-baseline gap-2 border-b border-dashed border-[color-mix(in_srgb,var(--c-ink)_25%,transparent)] pb-1.5">
              <span className="label opacity-70">{d.label}</span>
              <span className="grid gap-1 text-[16px] leading-[1.3]">
                {(["lunch", "dinner"] as const).map((m) =>
                  d[m].length ? (
                    <span key={m} className="flex min-w-0 items-center gap-1.5">
                      <span className="label w-10 shrink-0 opacity-60">{m === "lunch" ? "midi" : "soir"}</span>
                      {d[m].map((x) => (
                        <span key={x.name} className="inline-flex min-w-0 items-center gap-1.5">
                          <RecipeTile color={x.color} name={x.name} size="sm" className="!size-5 !text-[10px]" />
                          <span className="truncate">{short(x.name)}</span>
                        </span>
                      ))}
                    </span>
                  ) : null
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="link" state={busy ? "loading" : "idle"} loadingLabel="J'écris l'ardoise…" onClick={share}>
          Partager le menu en image
        </Button>
        {msg && <span className="text-[13px] text-ink-2">{msg}</span>}
      </div>
    </section>
  );
}

/** L'ardoise en PNG (2×), avec les couleurs et polices réelles de la page (aucune couleur en dur). */
async function drawBoard(el: HTMLElement, title: string, days: BoardDay[], ready: boolean): Promise<Blob> {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const bg = css.backgroundColor;
  const ink = css.color;
  const frame = css.borderTopColor;
  const hand = getComputedStyle(el.querySelector("h2")!).fontFamily;
  const display = getComputedStyle(document.body).getPropertyValue("--font-display") || "sans-serif";
  await document.fonts?.ready;
  const W = 1080;
  const rowH = 116;
  const H = 230 + days.length * rowH + 90;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = frame;
  g.fillRect(0, 0, W, H);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(24, 24, W - 48, H - 48, 22);
  g.fill();
  g.fillStyle = ink;
  g.textBaseline = "alphabetic";
  g.font = `700 92px ${hand}`;
  g.fillText("Au menu", 80, 150);
  const after = 80 + g.measureText("Au menu").width + 28;
  g.globalAlpha = 0.75;
  g.font = `600 52px ${hand}`;
  g.fillText(title, after, 150);
  g.globalAlpha = 1;
  days.forEach((d, i) => {
    const y = 250 + i * rowH;
    g.globalAlpha = 0.25;
    g.setLineDash([10, 10]);
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(80, y + 78);
    g.lineTo(W - 80, y + 78);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 0.7;
    g.fillStyle = ink;
    g.font = `700 50px ${hand}`;
    g.fillText(d.label, 80, y + 20);
    (["lunch", "dinner"] as const).forEach((m, k) => {
      const ly = y + k * 52;
      let x = 230;
      if (!d[m].length) return;
      g.globalAlpha = 0.6;
      g.font = `600 36px ${hand}`;
      g.fillText(m === "lunch" ? "midi" : "soir", x, ly);
      g.globalAlpha = 1;
      x += 90;
      for (const dish of d[m]) {
        g.fillStyle = resolveColor(dish.color, v);
        g.beginPath();
        g.roundRect(x, ly - 30, 30, 30, 7);
        g.fill();
        g.fillStyle = ink;
        g.font = `600 44px ${hand}`;
        const text = fit(g, short(dish.name), W - 90 - (x + 42));
        g.fillText(text, x + 42, ly);
        x += 42 + g.measureText(text).width + 34;
        if (x > W - 160) break;
      }
    });
  });
  if (ready) {
    g.save();
    g.translate(W - 230, H - 120);
    g.rotate(-0.12);
    g.strokeStyle = v("--c-hot");
    g.fillStyle = v("--c-hot");
    g.lineWidth = 6;
    g.strokeRect(-150, -46, 300, 92);
    g.font = `900 40px ${display}`;
    g.textAlign = "center";
    g.fillText("SEMAINE PRÊTE", 0, 14);
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
