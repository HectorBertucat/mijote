"use client";

// Présence d'une personne à un repas : un tap passe de maison à bureau, puis absent.
// Affichage immédiat (optimiste), petit point qui pulse tant que le serveur n'a pas répondu.
import { useOptimistic, useTransition } from "react";
import { Presence, type Place } from "@/components/ui";
import { togglePlace } from "./actions";

const NEXT: Record<Place, Place> = { home: "office", office: "away", away: "home" };

export function PlaceButton({ slotId, place, initial, name, size = "md" }: { slotId: string; place: Place; initial: string; name: string; size?: "md" | "lg" }) {
  const [shown, setShown] = useOptimistic(place);
  const [pending, start] = useTransition();
  return (
    <Presence
      initial={initial}
      name={name}
      place={shown}
      size={size}
      pending={pending}
      onClick={() =>
        start(async () => {
          setShown(NEXT[shown]);
          await togglePlace(slotId);
        })
      }
    />
  );
}
