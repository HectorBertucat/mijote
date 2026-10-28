"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, authToken } from "@/lib/auth";

export async function loginAction(_: string | null, f: FormData): Promise<string | null> {
  const given = String(f.get("password") ?? "");
  const expected = await authToken();
  if ((await authToken(given)) !== expected) return "Mot de passe incorrect.";
  (await cookies()).set(AUTH_COOKIE, expected, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" && process.env.MIJOTE_INSECURE_COOKIE !== "1", maxAge: 60 * 60 * 24 * 365, path: "/" });
  const next = String(f.get("suite") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
