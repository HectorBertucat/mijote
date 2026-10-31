// La base de la requête en cours, en démo. proxy.ts pose l'identifiant du visiteur (cookie) dans l'en-tête
// x-mijote-demo ; on le lit ici sans attendre (les fonctions de l'appli reçoivent `db` sans await), dans
// le contexte de requête que Next garde pour headers() (module partagé, exclu des paquets par Next).
// Sans visiteur reconnu (construction des pages, appel hors requête) : la base modèle en lecture seule.
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import type { Db } from "@/lib/db/open";
import { DEMO_HEADER, isVisitorId } from "./core";
import { templateDb, visitorDb } from "./store";

/** L'identifiant du visiteur de la requête en cours, s'il y en a un. */
export function currentVisitor(): string | null {
  const store = workUnitAsyncStorage.getStore() as { headers?: { get(name: string): string | null } } | undefined;
  const id = store?.headers?.get(DEMO_HEADER) ?? null;
  return isVisitorId(id) ? id : null;
}

export function requestDemoDb(): Db {
  const id = currentVisitor();
  return id ? visitorDb(id) : templateDb();
}
