import Link from "next/link";
import { activeProfileId } from "@/lib/health/active";
import { Settings } from "./Settings";

export const dynamic = "force-dynamic";

export default async function Reglages() {
  return (
    <div className="grid gap-12 sm:gap-18">
      <header className="grid gap-4 lg:grid-cols-12 lg:gap-x-6">
        <h1 className="text-display lg:col-span-12">Réglages</h1>
        <p className="max-w-[48ch] text-lead text-ink-2 lg:col-span-7">
          Qui mange, avec quoi tu cuisines, où tu fais les courses. Les goûts et la cible de chacun se règlent dans{" "}
          <Link href="/sante/profil" className="text-accent underline decoration-1 underline-offset-4 hover:decoration-2">
            Santé
          </Link>
          .
        </p>
      </header>
      <Settings profileId={await activeProfileId()} />
    </div>
  );
}
