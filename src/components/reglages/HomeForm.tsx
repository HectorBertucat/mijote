"use client";

// Le nom de la maison (en-tête) et le magasin où se font les courses (liste, IA).
// `finish` : dernier écran de la mise en route, enregistrer ouvre l'appli (finishSetupAction).
import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { finishSetupAction, saveHomeAction, type FormState } from "@/app/reglages/actions";

export function HomeForm({ home, store, catalog, finish = false, children }: { home: string; store: string; catalog: boolean; finish?: boolean; children?: React.ReactNode }) {
  const [state, save, saving] = useActionState<FormState, FormData>(async (prev, f) => {
    const r = await saveHomeAction(prev, f);
    if (finish && r?.ok) await finishSetupAction();
    return r;
  }, null);
  return (
    <form action={save} className="grid gap-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Où se font les courses" help="Donné à l’IA, pour des produits qu’on trouve vraiment. Facultatif.">
          {(id, d) => <Input id={id} aria-describedby={d} name="store" defaultValue={store} maxLength={80} placeholder="Le marché du samedi, le drive du quartier" />}
        </Field>
        <Field label="Nom de la maison" help="Affiché au survol du mot-symbole. Facultatif.">
          {(id, d) => <Input id={id} aria-describedby={d} name="home" defaultValue={home} maxLength={60} placeholder="La cuisine du troisième" />}
        </Field>
      </div>
      <p className="max-w-[60ch] border-l-2 border-line-strong pl-4 text-small text-ink-2">
        {catalog
          ? "Catalogue relié : la liste de courses propose des produits, des prix et des remplaçants."
          : "Pas de catalogue relié : la liste de courses donne les quantités par rayon, et les prix se saisissent à la validation. Pour en relier un, voir docs/catalogue.md."}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" icon="check" state={saving ? "loading" : "idle"} loadingLabel={finish ? "On ouvre la cuisine…" : "Enregistrement…"}>
          {finish ? "Ouvrir ma cuisine" : "Enregistrer"}
        </Button>
        {children}
        {state?.ok && !finish && (
          <span role="status" className="text-small font-bold text-ok-ink">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
