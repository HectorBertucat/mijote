"use client";

// Installer le Raccourci « Santé → cuisine » sur l’iPhone de la personne choisie : copier son code
// (ou l’envoyer à son téléphone), ajouter le Raccourci, le lancer une fois. Le code contient la clé de
// la personne et le jeton Cloudflare : il ne sort de l’appli que par le presse-papiers ou le partage.
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClass, Field, Input } from "@/components/ui";
import { newHealthKey, redoHistory, saveCloudflareToken } from "@/app/sante/actions";
import { de } from "./carnet";

export function CopyCode({ code, personName }: { code: string; personName: string }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare("share" in navigator), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setState("done");
      setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("error");
    }
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button icon="copy" variant="primary" state={state === "done" ? "done" : "idle"} doneLabel="Code copié" onClick={copy}>
          Copier le code {de(personName)}
        </Button>
        {canShare && (
          <Button icon="link" onClick={() => navigator.share({ title: `Code Santé → cuisine (${personName})`, text: code }).catch(() => {})}>
            Envoyer à son iPhone
          </Button>
        )}
      </div>
      {state === "error" && <p className="text-small text-ko-ink">Copie refusée par le navigateur : appuie longuement sur le code ci-dessous et copie-le.</p>}
      {state === "error" && <code className="block break-all rounded-[8px] bg-surface-2 p-2 text-[12px]">{code}</code>}
    </div>
  );
}

export function InstallLink({ href }: { href: string | null }) {
  if (!href) return <p className="text-small text-ink-2">Le fichier du Raccourci n’est pas encore en ligne : il doit d’abord être signé sur le Mac.</p>;
  return (
    <a className={buttonClass({ variant: "primary" })} href={href} download="Santé → cuisine.shortcut">
      Ajouter le Raccourci
    </a>
  );
}

export function CloudflareForm({ saved }: { saved: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(!saved);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2 text-small">
        <span>
          Jeton enregistré : <code className="rounded-[6px] bg-surface-2 px-2 py-1 text-small">{saved}</code>
        </span>
        <Button size="sm" variant="quiet" onClick={() => setOpen(true)}>
          Changer
        </Button>
      </div>
    );
  return (
    <form
      className="grid gap-3"
      action={(form) =>
        start(async () => {
          const r = await saveCloudflareToken(form);
          setMessage({ ok: r.ok, text: r.message });
          if (r.ok) {
            setOpen(false);
            router.refresh();
          }
        })
      }
    >
      <Field label="Client ID" help="Il finit par « .access ».">
        {(id, d) => <Input id={id} aria-describedby={d} name="clientId" autoComplete="off" autoCapitalize="off" spellCheck={false} required />}
      </Field>
      <Field label="Client Secret">
        {(id, d) => <Input id={id} aria-describedby={d} name="clientSecret" type="password" autoComplete="off" required />}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" state={pending ? "loading" : "idle"} loadingLabel="Enregistrement…">
          Enregistrer le jeton
        </Button>
        {saved && (
          <Button variant="quiet" onClick={() => setOpen(false)}>
            Annuler
          </Button>
        )}
      </div>
      {message && <p className={`text-small ${message.ok ? "text-ok-ink" : "text-ko-ink"}`}>{message.text}</p>}
    </form>
  );
}

export function LinkTools({ personId }: { personId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (f: (id: string) => Promise<{ message: string }>) =>
    start(async () => {
      setMessage((await f(personId)).message);
      router.refresh();
    });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon="refresh" disabled={pending} onClick={() => run(redoHistory)}>
          Relire 6 mois au prochain envoi
        </Button>
        <Button size="sm" variant="quiet" icon="lock" disabled={pending} onClick={() => run(newHealthKey)}>
          Nouvelle clé
        </Button>
      </div>
      {message && <p className="text-small text-ink-2">{message}</p>}
    </div>
  );
}
