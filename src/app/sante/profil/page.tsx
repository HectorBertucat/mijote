import { FixedRefForm } from "@/components/sante/FixedRefForm";
import { ProfileForm } from "@/components/sante/ProfileForm";
import { db } from "@/lib/db/client";
import { activePerson } from "@/lib/health/active";
import { planOf } from "@/lib/health/objectives";
import { listWeighIns } from "@/lib/health/store";

export const dynamic = "force-dynamic";

export default async function Profil() {
  const p = await activePerson();
  return (
    <div className="grid gap-5">
    <ProfileForm
      key={p.id}
      personId={p.id}
      name={p.name}
      needsWeight={listWeighIns(db, p.id).length === 0}
      values={{ sex: p.sex, birthDate: p.birthDate, heightCm: p.heightCm, activity: p.activity, goal: p.goal, ratePct: p.ratePct, proteinGPerKg: p.proteinGPerKg, proteinG: p.proteinG, targetWeightKg: p.targetWeightKg, targetDate: p.targetDate, sportPlan: planOf(p), constraints: p.constraints }}
    />
    <FixedRefForm key={`${p.id}-ref`} personId={p.id} value={p.fixedMealRef ?? null} />
    </div>
  );
}
