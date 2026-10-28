"use client";

import { useActionState } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { loginAction } from "./actions";

export function LoginForm({ suite }: { suite: string }) {
  const [error, login, pending] = useActionState(loginAction, null);
  return (
    <Card pad="md" className="grid max-w-sm gap-3">
      <form action={login} className="grid gap-3">
        <input type="hidden" name="suite" value={suite} />
        <Field label="Mot de passe">{(id) => <Input id={id} name="password" type="password" autoComplete="current-password" required autoFocus />}</Field>
        <Button type="submit" variant="primary" icon="lock" state={pending ? "loading" : "idle"} loadingLabel="…">
          Entrer
        </Button>
        {error && <Alert tone="ko">{error}</Alert>}
      </form>
    </Card>
  );
}
