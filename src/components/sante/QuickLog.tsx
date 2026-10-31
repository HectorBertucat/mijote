"use client";

// Saisie rapide d’une pesée ou d’un tour de taille (en attendant l’envoi automatique d’Apple Santé).
import { useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";
import { useToast } from "@/components/cart/Toast";
import { logWaist, logWeight } from "@/app/sante/actions";

export function QuickLog({ personId, kind, placeholder }: { personId: string; kind: "weight" | "waist"; placeholder?: string }) {
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const { show, node } = useToast();
  const unit = kind === "weight" ? "kg" : "cm";
  const submit = () => {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return show(`Un nombre en ${unit}, par exemple ${kind === "weight" ? "73,8" : "84"}.`, false);
    start(async () => {
      const r = kind === "weight" ? await logWeight(personId, n) : await logWaist(personId, n);
      show(r.message, r.ok);
      if (r.ok) setValue("");
    });
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="sr-only" htmlFor={`ql-${kind}`}>
        {kind === "weight" ? "Poids du jour en kg" : "Tour de taille en cm"}
      </label>
      <span className="relative w-32">
        <Input id={`ql-${kind}`} inputMode="decimal" num value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="pr-10" />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-small text-ink-2">{unit}</span>
      </span>
      <Button type="submit" variant="primary" className="min-h-12" state={pending ? "loading" : "idle"}>
        Noter
      </Button>
      {node}
    </form>
  );
}
