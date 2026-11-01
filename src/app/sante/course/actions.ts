"use server";

// Course : réglages, ressenti, pause et reprise, depuis la page /sante/course. Tout est relu côté serveur
// (src/lib/running/store.ts, schémas bornés) : rien ne passe tel quel du navigateur.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { todayParis } from "@/lib/health/store";
import { noteFeedback, pausePlan, resumePlan, saveRunSettings, PAIN_PLACES } from "@/lib/running/store";
import { GOALS } from "@/lib/running/plan";

const int = (v: FormDataEntryValue | null) => (v == null || String(v).trim() === "" ? null : Math.round(Number(v)));
const str = (v: FormDataEntryValue | null) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const back = (error?: string) => {
  revalidatePath("/sante/course");
  redirect(error ? `/sante/course?erreur=${encodeURIComponent(error)}` : "/sante/course");
};

export async function saveSettingsAction(form: FormData) {
  const personId = await activeProfileId();
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => form.get(`day${d}`) === "on").map((weekday) => ({ weekday, time: str(form.get(`time${weekday}`)) }));
  const goal = String(form.get("goal") ?? "plus_longtemps");
  let error: string | undefined;
  try {
    saveRunSettings(
      db,
      personId,
      {
        enabled: form.get("enabled") === "on",
        days,
        perWeek: int(form.get("perWeek")) ?? 3,
        goal: (GOALS as readonly string[]).includes(goal) ? (goal as (typeof GOALS)[number]) : "plus_longtemps",
        goalNote: str(form.get("goalNote")),
        longRunDay: int(form.get("longRunDay")),
        time: str(form.get("time")),
        hrMax: int(form.get("hrMax")),
        hrRest: int(form.get("hrRest")),
        hrThreshold: int(form.get("hrThreshold")),
        thresholdSource: form.get("thresholdTest") === "on" ? "test" : "saisie",
        fixed: null,
      },
      todayParis()
    );
  } catch (e) {
    error = e instanceof Error && "issues" in e ? (e as unknown as { issues: { message: string }[] }).issues.map((i) => i.message).join(", ") : "Réglages invalides.";
  }
  back(error);
}

export async function feedbackAction(form: FormData) {
  const personId = await activeProfileId();
  const where = str(form.get("painWhere"));
  let error: string | undefined;
  try {
    noteFeedback(db, personId, {
      date: str(form.get("date")) ?? todayParis(),
      effort: int(form.get("effort")),
      pain: int(form.get("pain")),
      painWhere: where && (PAIN_PLACES as readonly string[]).includes(where) ? (where as (typeof PAIN_PLACES)[number]) : null,
      sick: form.get("sick") === "on",
      note: str(form.get("note")),
    });
  } catch {
    error = "Ressenti invalide (effort 1 à 10, douleur 0 à 10).";
  }
  back(error);
}

export async function pauseAction() {
  pausePlan(db, await activeProfileId(), "personne", todayParis());
  back();
}

export async function resumeAction() {
  resumePlan(db, await activeProfileId(), todayParis());
  back();
}
