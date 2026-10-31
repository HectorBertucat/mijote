"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { loginAction } from "./actions";

export function LoginForm({ suite }: { suite: string }) {
  const [error, login, pending] = useActionState(loginAction, null);
  return (
    <form action={login} className="grid gap-6 border-t border-line-strong pt-6">
      <input type="hidden" name="suite" value={suite} />
      <Field label="Mot de passe" help="Le même pour tout le foyer, sur chaque appareil.">
        {(id, d) => <Input id={id} aria-describedby={d} name="password" type="password" autoComplete="current-password" required autoFocus invalid={!!error} />}
      </Field>
      <Button type="submit" variant="primary" icon="lock" block state={pending ? "loading" : "idle"} loadingLabel="On ouvre…">
        Entrer
      </Button>
      {error && (
        <Alert tone="ko" role="alert">
          {error}
        </Alert>
      )}
    </form>
  );
}
