import { Settings } from "./Settings";

export const dynamic = "force-dynamic";

export default function Reglages() {
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[36px] sm:leading-none">Réglages</h1>
        <p className="mt-1.5 text-ink-2">Le foyer, la cuisine et les courses. Le profil santé de chacun se règle dans Santé.</p>
      </div>
      <Settings />
    </div>
  );
}
