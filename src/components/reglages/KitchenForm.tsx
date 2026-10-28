"use client";

// La cuisine du foyer, en quelques choix : la plaque (type, foyers, niveaux), le four, les récipients.
// Le planificateur de session n'utilise que ce qui est coché ici.
import { useState, useTransition } from "react";
import { Alert, Button, Card, Check, Segmented, Stepper } from "@/components/ui";
import { saveKitchenAction, type FormState } from "@/app/reglages/actions";
import { HOB_LABEL, type HobType, type KitchenConfig } from "@/lib/kitchen/presets";

export function KitchenForm({ initial, onSaved }: { initial: KitchenConfig; onSaved?: () => void }) {
  const [c, setC] = useState(initial);
  const [msg, setMsg] = useState<FormState>(null);
  const [pending, start] = useTransition();
  const v = c.vessels;
  const setV = (patch: Partial<KitchenConfig["vessels"]>) => setC({ ...c, vessels: { ...v, ...patch } });
  const setX = (patch: Partial<KitchenConfig["extras"]>) => setC({ ...c, extras: { ...c.extras, ...patch } });
  const save = () =>
    start(async () => {
      const r = await saveKitchenAction(c);
      setMsg(r);
      if (r?.ok) onSaved?.();
    });
  return (
    <Card pad="md" className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-[14px] font-semibold">Plaque</span>
        <Segmented
          label="Type de plaque"
          value={c.hobType}
          onChange={(t) => setC({ ...c, hobType: t, levels: t === "induction" ? 9 : t === "gaz" ? 0 : 9 })}
          options={(Object.keys(HOB_LABEL) as HobType[]).map((t) => ({ value: t, label: t === "vitroceramique" ? "Vitro" : t === "electrique" ? "Électrique" : t === "gaz" ? "Gaz" : "Induction" }))}
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2 text-[14px]">
            <Stepper decLabel="Moins" incLabel="Plus" value={c.hobs} min={1} max={5} onChange={(n) => setC({ ...c, hobs: n })} />
            Foyers
          </span>
          <span className="flex items-center gap-2 text-[14px]">
            <Stepper decLabel="Moins" incLabel="Plus" value={c.levels} min={0} max={12} onChange={(n) => setC({ ...c, levels: n })} />
            Niveaux de puissance (0 = doux, moyen, vif)
          </span>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Check checked={c.oven} onChange={(e) => setC({ ...c, oven: e.target.checked })}>
          Un four
        </Check>
        {c.oven && <span className="flex items-center gap-2 text-[14px]">
            <Stepper decLabel="Moins" incLabel="Plus" value={c.ovenLevels} min={1} max={7} onChange={(n) => setC({ ...c, ovenLevels: n })} />
            Niveaux de grille
          </span>}
      </div>
      <div className="grid gap-1.5">
        <span className="text-[14px] font-semibold">Récipients</span>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Check checked={v.poele} onChange={(e) => setV({ poele: e.target.checked })}>
            Une poêle de 28 cm (inox ou fonte)
          </Check>
          <Check checked={v.cocotte} onChange={(e) => setV({ cocotte: e.target.checked })}>
            Une cocotte en fonte
          </Check>
          <Check checked={v.faitout} onChange={(e) => setV({ faitout: e.target.checked })}>
            Un faitout
          </Check>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2 text-[14px]">
            <Stepper decLabel="Moins" incLabel="Plus" value={v.casseroles} min={0} max={3} onChange={(n) => setV({ casseroles: n })} />
            Casseroles
          </span>
          {c.oven && <span className="flex items-center gap-2 text-[14px]">
            <Stepper decLabel="Moins" incLabel="Plus" value={v.plats} min={0} max={3} onChange={(n) => setV({ plats: n })} />
            Plats à four
          </span>}
          {v.poele && <span className="flex items-center gap-2 text-[14px]">
            <Stepper decLabel="Moins" incLabel="Plus" value={v.poeleMaxG} min={200} max={1500} step={50} onChange={(n) => setV({ poeleMaxG: n })} />
            Viande par fournée dans la poêle (g)
          </span>}
        </div>
      </div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Check checked={c.extras.microOndes} onChange={(e) => setX({ microOndes: e.target.checked })}>
          Micro-ondes
        </Check>
        <Check checked={c.extras.congelateur} onChange={(e) => setX({ congelateur: e.target.checked })}>
          Congélateur
        </Check>
        <Check checked={c.extras.mixeur} onChange={(e) => setX({ mixeur: e.target.checked })}>
          Mixeur
        </Check>
        <Check checked={c.duo} onChange={(e) => setC({ ...c, duo: e.target.checked })}>
          Deux planches et deux grands couteaux (pour cuisiner à deux)
        </Check>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" icon="check" state={pending ? "loading" : "idle"} loadingLabel="Enregistrement…" onClick={save}>
          Enregistrer la cuisine
        </Button>
        {msg?.ok && <span className="text-[14px] text-ok">{msg.message}</span>}
      </div>
      {msg && !msg.ok && <Alert tone="ko">{msg.message}</Alert>}
    </Card>
  );
}
