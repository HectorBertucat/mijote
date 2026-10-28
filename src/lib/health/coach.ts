// Coach Santé : une conversation par personne pour fixer des objectifs réalistes. Sonnet, sortie
// structurée (réponse, proposition d'objectifs, réponses rapides). Le coach reçoit les vraies
// données (tendance, dépense mesurée, journal, séances, programme) et ne calcule rien lui-même :
// sa proposition passe par checkProposal (./goals) avant d'être montrée, et on l'applique d'un tap.
import { randomUUID } from "crypto";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/open";
import { coachMessages, foodLog } from "@/lib/db/schema";
import { MODELS, structured } from "@/lib/ai";
import { programFor } from "@/lib/training/programs";
import { addDays } from "@/lib/week/propose";
import { ACTIVITY_LABEL, ageOn, dailyWeights, GOAL_LABEL, rateOf, trendSeries, weeklyRate } from "./core";
import { SPORT_KEYS, SPORTS, weeklyCounts, type GoalProposal, type Sport } from "./goals";
import { check, currentMonday, listSessions, planOf } from "./objectives";
import { currentReview, intakeDays, listWaist, listWeighIns, todayParis, toProfile, type Person } from "./store";

export type CoachMessage = typeof coachMessages.$inferSelect;

const n = <T extends z.ZodType>(t: T) => t.nullable();

export const CoachReply = z.object({
  reply: z.string().describe("Ta réponse, en français, tutoiement, 2 à 8 phrases. Du texte simple : des retours à la ligne, des tirets pour une liste courte, pas de titres."),
  proposal: n(
    z.object({
      sex: n(z.enum(["m", "f"])),
      birthDate: n(z.string().describe("AAAA-MM-JJ")),
      heightCm: n(z.number()),
      weightKg: n(z.number().describe("Poids du jour donné par la personne, seulement si elle n'a aucune pesée")),
      goal: n(z.enum(["lose", "maintain", "gain", "recomp"])),
      ratePct: n(z.number().describe("% du poids par semaine, négatif pour perdre")),
      proteinGPerKg: n(z.number()),
      proteinG: n(z.number()),
      targetWeightKg: n(z.number()),
      targetDate: n(z.string().describe("AAAA-MM-JJ")),
      sportPlan: n(z.array(z.object({ kind: z.enum(SPORT_KEYS as [Sport, ...Sport[]]), perWeek: z.number(), minutes: z.number() }))),
      constraints: n(z.string().describe("Ce que la personne peut ou ne peut pas faire, en une ou deux phrases")),
      why: z.string().describe("En une phrase : pourquoi ces objectifs"),
    })
  ).describe("Objectifs à proposer, seulement quand tu as assez d'éléments et que la personne est d'accord sur le principe ; null sinon. Ne mets que les champs qui changent, null pour les autres."),
  suggestions: z.array(z.string()).describe("2 ou 3 réponses courtes que la personne pourrait taper ensuite (moins de 45 caractères chacune)"),
});
export type CoachReply = z.infer<typeof CoachReply>;

const SYSTEM = `Tu es le coach santé de Mijote, une appli de cuisine et de santé pour un foyer. Tu parles avec une seule personne à la fois, en français, en la tutoyant, comme un coach sportif et nutrition compétent et direct : pas de sermon, pas de mise en garde répétée, un risque se dit une fois, factuellement.

Ton rôle : l'aider à fixer et ajuster ses objectifs (poids visé et échéance, rythme, protéines, sport réaliste selon ce qu'elle peut faire), et répondre à ses questions sur sa progression. Tu t'appuies sur ses données réelles, données plus bas ; ne les invente jamais, et dis quand elles manquent.

Comment l'appli calcule (tu ne recalcules pas, tu expliques) :
- tendance du poids lissée (moyenne exponentielle), rythme en % du poids par semaine ;
- dépense « mesurée » d'après les apports des journées complètes et la tendance sur 21 jours ; avant ça, estimation par formule ;
- cible kcal = dépense + rythme visé, elle bouge de 150 kcal au plus par semaine ;
- protéines en g/kg de la tendance ou en grammes fixes ;
- les repas viennent surtout du batch cooking de la semaine (2 repas par jour ; la part de chacun suit sa cible) ; les cibles servent au bilan nutrition de la Semaine.

Repères (l'appli vérifie de toute façon et corrige) : rythme entre −1 % et +0,5 %/sem. (−0,3 à −0,5 % en recomposition, +0,25 % pour prendre du muscle) ; protéines 1,6 g/kg, jusqu'à 2,2 en déficit avec musculation ; jamais sous le métabolisme de base ; poids visé dans un IMC sain. Le sport doit coller à ce que la personne fait vraiment ou peut tenir (matériel, temps, envie) : mieux vaut 2 séances tenues que 5 prévues.

Façon de faire :
- une question à la fois quand il te manque quelque chose d'important (objectif réel, contraintes, sport possible) ;
- propose des objectifs (proposal) quand tu as de quoi le faire, sinon proposal = null ; la personne les applique d'un bouton, l'appli les vérifie ;
- pour le sport, utilise les sports connus : ${SPORT_KEYS.map((k) => `${k} (${SPORTS[k]})`).join(", ")} ;
- sois concret : chiffres, semaines, ce qu'elle doit faire cette semaine.`;

const fr = (x: number, d = 1) => x.toFixed(d).replace(".", ",");

/** Ce que le coach sait de la personne, en texte. Tout vient de la base et des calculs de l'appli. */
export function coachContext(db: Db, person: Person): string {
  const today = todayParis();
  const lines: string[] = [`Aujourd'hui : ${today}. Personne : ${person.name}.`];
  const age = person.birthDate ? ageOn(person.birthDate, today) : null;
  lines.push(`Profil : ${person.sex === "m" ? "homme" : person.sex === "f" ? "femme" : "sexe non renseigné"}, ${age != null ? `${age} ans` : "âge inconnu"}, ${person.heightCm ? `${person.heightCm} cm` : "taille inconnue"}, activité ${person.activity ? ACTIVITY_LABEL[person.activity] : "non renseignée"}.`);

  const weighs = listWeighIns(db, person.id);
  const series = trendSeries(dailyWeights(weighs), today);
  if (series.length) {
    const last = series[series.length - 1];
    const rate = weeklyRate(series);
    const back = (days: number) => series.find((p) => p.date === addDays(today, -days))?.trend;
    const m2 = back(56);
    const first = series[0];
    lines.push(
      `Poids : tendance ${fr(last.trend)} kg${person.heightCm ? ` (IMC ${fr(last.trend / (person.heightCm / 100) ** 2)})` : ""}, ${rate != null ? `rythme ${rate >= 0 ? "+" : ""}${fr(rate, 2)} kg/sem. sur 2 semaines` : "rythme pas encore mesurable"}${m2 != null ? `, ${last.trend - m2 >= 0 ? "+" : ""}${fr(last.trend - m2)} kg en 8 semaines` : ""} ; ${weighs.length} pesées depuis le ${first.date}.`
    );
  } else lines.push("Poids : aucune pesée.");

  const waist = listWaist(db, person.id);
  if (waist.length) lines.push(`Tour de taille : ${fr(waist[waist.length - 1].cm)} cm le ${waist[waist.length - 1].date}${waist.length > 1 ? ` (${fr(waist[waist.length - 1].cm - waist[0].cm)} cm depuis le ${waist[0].date})` : ""}.`);

  lines.push(
    `Objectifs actuels : ${person.goal ? GOAL_LABEL[person.goal] : "aucun objectif"}, rythme visé ${fr(rateOf(toProfile(person)), 2)} %/sem., protéines ${person.proteinG ? `${person.proteinG} g` : `${fr(person.proteinGPerKg ?? 1.6)} g/kg`}, poids visé ${person.targetWeightKg ? `${fr(person.targetWeightKg)} kg` : "non fixé"}${person.targetDate ? ` pour le ${person.targetDate}` : ""}.`
  );
  const plan = planOf(person);
  lines.push(`Sport prévu : ${plan.length ? plan.map((p) => `${SPORTS[p.kind]} ${p.perWeek}×/sem. ${p.minutes} min`).join(", ") : "rien de fixé"}.${person.constraints ? ` Contraintes notées : ${person.constraints}` : ""}`);

  const review = currentReview(db, person);
  if (review) lines.push(`Semaine en cours : dépense ${review.tdee} kcal (${review.confidence === "adaptive" ? "mesurée" : review.confidence === "holding" ? "dernière mesure gardée" : "estimée par formule"}), cible ${review.targets.kcal} kcal, ${review.targets.proteinG} g de protéines. ${review.explanation}`);
  else lines.push("Pas encore de cible : il manque le profil ou une pesée.");

  const since = addDays(today, -21);
  const days = intakeDays(db, person.id, since);
  const complete = days.filter((d) => d.complete);
  const prot = db
    .select({ date: foodLog.date, p: foodLog.proteinG })
    .from(foodLog)
    .where(and(eq(foodLog.personId, person.id), gte(foodLog.date, since)))
    .all();
  const protByDay = new Map<string, number>();
  for (const r of prot) protByDay.set(r.date, (protByDay.get(r.date) ?? 0) + r.p);
  lines.push(
    complete.length
      ? `Journal sur 21 jours : ${complete.length} journées complètes, en moyenne ${Math.round(complete.reduce((s, d) => s + d.kcal, 0) / complete.length)} kcal et ${Math.round(complete.reduce((s, d) => s + (protByDay.get(d.date) ?? 0), 0) / complete.length)} g de protéines.`
      : `Journal sur 21 jours : ${days.length} jours notés, aucune journée marquée complète.`
  );

  const sessions = listSessions(db, person.id);
  const weeks = weeklyCounts(sessions, currentMonday(), 8);
  const recent = sessions.slice(0, 6);
  lines.push(
    sessions.length
      ? `Séances (carnet + Apple Santé) par semaine sur 8 semaines, de la plus ancienne à celle-ci : ${weeks.map((w) => w.count).join(", ")}. Dernières : ${recent.map((s) => `${s.date} ${s.label}${s.minutes ? ` ${s.minutes} min` : ""}`).join(" ; ")}.`
      : "Séances : aucune enregistrée (ni carnet, ni Apple Santé)."
  );
  const prog = programFor(db, person.id);
  if (prog)
    lines.push(
      `Suit dans l'appli le programme « ${prog.name} » à la maison : séances ${Object.keys(prog.sessions).join("/")} alternées, ${prog.perWeek} par semaine, progression par crans. ${prog.weekNote}${prog.alsoTrack ? ` Fait aussi ${prog.alsoTrack.sport.toLowerCase()} environ ${prog.alsoTrack.target} fois par semaine.` : ""}`
    );
  return lines.join("\n");
}

export function listCoach(db: Db, personId: string, limit = 40): CoachMessage[] {
  return db.select().from(coachMessages).where(eq(coachMessages.personId, personId)).orderBy(desc(coachMessages.createdAt)).limit(limit).all().reverse();
}

export function clearCoach(db: Db, personId: string) {
  db.delete(coachMessages).where(eq(coachMessages.personId, personId)).run();
}

const transcript = (msgs: CoachMessage[]) => msgs.map((m) => `${m.role === "user" ? "Personne" : "Coach"} : ${m.text}${m.status === "applied" ? " [objectifs appliqués]" : m.status === "dismissed" ? " [proposition ignorée]" : ""}`).join("\n");

/** Un échange : le message de la personne, la réponse du coach (proposition vérifiée), tout gardé. */
export async function askCoach(db: Db, person: Person, text: string): Promise<CoachMessage> {
  const msg = text.trim().slice(0, 1500);
  if (!msg) throw new Error("Message vide.");
  const history = listCoach(db, person.id, 16);
  db.insert(coachMessages).values({ id: randomUUID(), personId: person.id, role: "user", text: msg, createdAt: new Date().toISOString() }).run();
  const out = await structured({
    db,
    screen: "sante-coach",
    model: MODELS.plan,
    system: SYSTEM,
    prompt: `Données de ${person.name} (calculées par l'appli) :\n${coachContext(db, person)}\n\n${history.length ? `Conversation jusqu'ici :\n${transcript(history)}\n\n` : ""}Nouveau message de ${person.name} : ${msg}`,
    schema: CoachReply,
    maxTokens: 4000,
    devMock: () => ({
      reply: `Réponse simulée (dev). Tu as écrit : « ${msg.slice(0, 80)} ». Je te propose de viser une recomposition douce.`,
      proposal: { sex: null, birthDate: null, heightCm: null, weightKg: null, goal: "recomp" as const, ratePct: -0.4, proteinGPerKg: null, proteinG: 160, targetWeightKg: 70, targetDate: null, sportPlan: [{ kind: "kettlebell" as const, perWeek: 3, minutes: 30 }, { kind: "natation" as const, perWeek: 3, minutes: 25 }], constraints: null, why: "Simulé." },
      suggestions: ["Et pour les protéines ?", "Plus doucement", "Ça me va"],
    }),
  });
  let proposal: GoalProposal | null = null;
  let notes: string[] | null = null;
  if (out.proposal) {
    const { why, ...raw } = out.proposal;
    const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null)) as GoalProposal;
    if (Object.keys(clean).length) {
      const checked = check(db, person, clean);
      proposal = { ...checked.patch, ...(checked.eta ? { eta: checked.eta } : {}), why } as GoalProposal;
      notes = checked.notes;
    }
  }
  const row = {
    id: randomUUID(),
    personId: person.id,
    role: "coach" as const,
    text: out.reply.trim(),
    proposal: proposal as Record<string, unknown> | null,
    notes,
    suggestions: out.suggestions.slice(0, 3).map((s) => s.slice(0, 60)),
    status: proposal ? ("proposed" as const) : null,
    createdAt: new Date(Date.now() + 1).toISOString(),
  };
  db.insert(coachMessages).values(row).run();
  return db.select().from(coachMessages).where(eq(coachMessages.id, row.id)).get()!;
}

export function getCoachMessage(db: Db, id: string) {
  return db.select().from(coachMessages).where(eq(coachMessages.id, id)).get() ?? null;
}

export function setCoachStatus(db: Db, id: string, status: "applied" | "dismissed") {
  db.update(coachMessages).set({ status }).where(eq(coachMessages.id, id)).run();
}
