"use server";

// Réglages de l'instance (mise en route et page Réglages) : le foyer, la cuisine, le magasin.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { ACTIVITY_LABEL, GOAL_LABEL, type Activity, type Goal } from "@/lib/health/core";
import { addPerson, removePerson, renamePerson } from "@/lib/household";
import { HOB_LABEL, type HobType, type KitchenConfig } from "@/lib/kitchen/presets";
import { applyKitchen } from "@/lib/kitchen/store";
import { SETTING, setSetting } from "@/lib/settings";
import { listPeople } from "@/lib/health/store";

export type FormState = { ok: boolean; message: string } | null;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null;
};
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

const refresh = () => {
  revalidatePath("/", "layout");
};

export async function addPersonAction(_: FormState, f: FormData): Promise<FormState> {
  try {
    const sex = str(f.get("sex"));
    const year = num(f.get("birthYear"));
    const activity = str(f.get("activity"));
    const goal = str(f.get("goal"));
    addPerson(db, {
      name: str(f.get("name")),
      portionUnits: num(f.get("portion")) ?? 4,
      sex: sex === "f" || sex === "m" ? sex : null,
      birthDate: year && year > 1920 && year < 2025 ? `${Math.round(year)}-07-01` : null,
      heightCm: (() => {
        const h = num(f.get("height"));
        return h && h > 100 && h < 230 ? h : null;
      })(),
      weightKg: (() => {
        const w = num(f.get("weight"));
        return w && w > 25 && w < 300 ? w : null;
      })(),
      activity: activity in ACTIVITY_LABEL ? (activity as Activity) : null,
      goal: goal in GOAL_LABEL ? (goal as Goal) : null,
    });
    refresh();
    return { ok: true, message: "Ajouté." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function renamePersonAction(id: string, name: string, portion: number): Promise<FormState> {
  try {
    renamePerson(db, id, name, portion);
    refresh();
    return { ok: true, message: "Enregistré." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function removePersonAction(id: string): Promise<FormState> {
  const r = removePerson(db, id);
  refresh();
  return r.ok ? { ok: true, message: "Retiré." } : { ok: false, message: r.error ?? "Impossible." };
}

export async function saveKitchenAction(c: KitchenConfig): Promise<FormState> {
  const hobType: HobType = c.hobType in HOB_LABEL ? c.hobType : "induction";
  applyKitchen(db, {
    hobType,
    hobs: c.hobs,
    levels: c.levels,
    oven: !!c.oven,
    ovenLevels: c.ovenLevels,
    vessels: { ...c.vessels, poele: !!c.vessels.poele, cocotte: !!c.vessels.cocotte, faitout: !!c.vessels.faitout },
    extras: { microOndes: !!c.extras.microOndes, congelateur: !!c.extras.congelateur, mixeur: !!c.extras.mixeur },
    duo: !!c.duo,
  });
  refresh();
  return { ok: true, message: "Cuisine enregistrée." };
}

export async function saveHomeAction(_: FormState, f: FormData): Promise<FormState> {
  setSetting(db, SETTING.homeName, str(f.get("home")).slice(0, 60) || null);
  setSetting(db, SETTING.storeLabel, str(f.get("store")).slice(0, 80) || null);
  refresh();
  return { ok: true, message: "Enregistré." };
}

/** Fin de la mise en route : l'appli s'ouvre, et chacun finit son profil dans Santé. */
export async function finishSetupAction() {
  const first = listPeople(db)[0];
  if (!first) return;
  setSetting(db, SETTING.setupDone, new Date().toISOString());
  refresh();
  redirect(`/sante/demarrer?p=${encodeURIComponent(first.id)}`);
}
