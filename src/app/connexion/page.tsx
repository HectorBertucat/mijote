import { Wordmark } from "@/components/ui";
import { LoginForm } from "./LoginForm";

export default async function Connexion({ searchParams }: { searchParams: Promise<{ suite?: string }> }) {
  const { suite } = await searchParams;
  return (
    <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-6 lg:pt-12">
      <div className="grid content-start gap-6 lg:col-span-7">
        <h1>
          <Wordmark className="!text-display" />
        </h1>
        <p className="max-w-[32ch] text-lead text-ink-2">Cette cuisine est fermée à clé. Le mot de passe est celui de l’instance.</p>
      </div>
      <div className="lg:col-span-4 lg:col-start-9 lg:pt-6">
        <LoginForm suite={suite ?? "/"} />
      </div>
    </div>
  );
}
