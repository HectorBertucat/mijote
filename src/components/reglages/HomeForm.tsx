"use client";

// Le nom de la maison (en-tête) et le magasin où se font les courses (liste, IA).
import { useActionState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { saveHomeAction, type FormState } from "@/app/reglages/actions";

export function HomeForm({ home, store, catalog }: { home: string; store: string; catalog: boolean }) {
  const [state, save, saving] = useActionState<FormState, FormData>(saveHomeAction, null);
  return (
    <Card pad="md" className="grid gap-3">
      <form action={save} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom de la maison (facultatif)">{(id) => <Input id={id} name="home" defaultValue={home} maxLength={60} placeholder="La cuisine des Martin" />}</Field>
          <Field label="Où se font les courses (facultatif)" help="Donné à l'IA pour des produits qu'on trouve vraiment.">
            {(id, d) => <Input id={id} aria-describedby={d} name="store" defaultValue={store} maxLength={80} placeholder="Le drive Leclerc de Rennes" />}
          </Field>
        </div>
        <p className="text-[13px] text-ink-2">
          {catalog
            ? "Catalogue relié (CHRONOCATALOG_URL) : la liste de courses propose des produits, des prix et des remplaçants."
            : "Pas de catalogue relié : la liste de courses donne les quantités à acheter, et les prix se saisissent à la validation. Pour relier un catalogue, voir docs/catalogue.md."}
        </p>
        <div className="flex items-center gap-3">
          <Button type="submit" icon="check" state={saving ? "loading" : "idle"} loadingLabel="Enregistrement…">
            Enregistrer
          </Button>
          {state?.ok && <span className="text-[14px] text-ok">{state.message}</span>}
        </div>
      </form>
    </Card>
  );
}
