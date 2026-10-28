import { LoginForm } from "./LoginForm";

export default async function Connexion({ searchParams }: { searchParams: Promise<{ suite?: string }> }) {
  const { suite } = await searchParams;
  return (
    <div className="grid justify-items-start gap-4">
      <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em]">Mijote</h1>
      <p className="text-ink-2">Cette cuisine est protégée par un mot de passe.</p>
      <LoginForm suite={suite ?? "/"} />
    </div>
  );
}
