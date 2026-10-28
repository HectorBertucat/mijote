// Profil actif (une personne du foyer) : un cookie par appareil, posé par le sélecteur de la barre du haut.
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { getPerson, listPeople, type Person } from "./store";

export const PROFILE_COOKIE = "mijote.profil";

/** Le profil de l'appareil, sinon la première personne du foyer. */
export async function activeProfileId(): Promise<string> {
  const id = (await cookies()).get(PROFILE_COOKIE)?.value;
  return (id && getPerson(db, id) ? id : listPeople(db)[0]?.id) ?? "";
}

export async function activePerson(): Promise<Person> {
  return getPerson(db, await activeProfileId()) ?? listPeople(db)[0];
}
