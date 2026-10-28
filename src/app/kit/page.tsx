import type { Metadata } from "next";
import { KitDemo } from "./KitDemo";

// Démonstration interne du kit (non liée dans la navigation) : chaque composant de src/components/ui/ dans ses états.
export const metadata: Metadata = { title: "Kit · cuisine", robots: { index: false, follow: false } };

export default function KitPage() {
  return <KitDemo />;
}
