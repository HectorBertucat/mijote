// Mot de passe de l'instance (facultatif) : MIJOTE_PASSWORD. Sans lui, l'appli est ouverte à qui
// atteint le serveur (réseau local, VPN, ou un proxy qui protège déjà l'accès). Avec lui, un cookie
// signé par appareil, posé par /connexion. Web Crypto : utilisable dans proxy.ts comme sur les pages.
// En démo (MIJOTE_DEMO=1), le mot de passe est ignoré : la démo est faite pour être ouverte.
import { demoEnabled } from "@/lib/demo/core";

export const AUTH_COOKIE = "mijote.auth";

export const authEnabled = () => !!process.env.MIJOTE_PASSWORD?.trim() && !demoEnabled();

/** Empreinte du mot de passe gardée dans le cookie (jamais le mot de passe lui-même). */
export async function authToken(password = process.env.MIJOTE_PASSWORD ?? ""): Promise<string> {
  const data = new TextEncoder().encode(`mijote:${password.trim()}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Chemins ouverts sans connexion : la page de connexion, l'import Apple Santé (clé par personne), les fichiers publics. */
export const PUBLIC_PATHS = [/^\/connexion/, /^\/api\/health$/, /^\/api\/sante\/import/, /^\/raccourcis\//, /^\/manifest\.webmanifest$/, /^\/icon/, /^\/apple-icon/, /^\/lancement$/];
