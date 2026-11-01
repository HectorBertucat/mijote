// Jours civils (AAAA-MM-JJ) pour le module Course, sans dépendance : les modules purs les partagent.
// Jamais de date courante cachée : `today` est toujours passé.

export const addDays = (ymd: string, n: number) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Jours de `a` à `b` (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** 0 = lundi … 6 = dimanche. */
export const weekday = (ymd: string) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;

/** Le lundi de la semaine du jour. */
export const mondayOfDay = (ymd: string) => addDays(ymd, -weekday(ymd));

/** Jour civil à Paris d'un instant ISO. */
export const parisDay = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(typeof iso === "string" ? new Date(iso) : iso);

export const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isHm = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export const WEEKDAY_LABEL = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

/** « mar. 4 nov. » */
export const dayLabel = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export const sd = (xs: number[]): number | null => {
  const m = mean(xs);
  if (m == null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

export const round = (x: number, digits = 0) => {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
};

export const round5 = (x: number) => Math.round(x / 5) * 5;
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
