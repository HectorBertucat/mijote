import type { Metadata, Viewport } from "next";
import { Archivo, Atkinson_Hyperlegible_Next } from "next/font/google";
import { TabBar, TopNav } from "@/components/Nav";
import { SessionBanner } from "@/components/SessionBanner";
import { CommandK } from "@/components/CommandK";
import { Assistant } from "@/components/assistant/Assistant";
import { aiEnabled } from "@/lib/ai";
import { listRecipes } from "@/lib/recipes/queries";
import { recipeIngredients } from "@/lib/db/schema";
import { recipeColor } from "@/lib/ui";
import { CustomArtProvider, FoodIllu } from "@/components/illus/Illu";
import { loadCustomArt } from "@/lib/illus/ai";
import type { FoodArtId } from "@/lib/illus/art";
import { parisMonth, seasonOf, type Season } from "@/lib/recipes/season";
import { db } from "@/lib/db/client";
import { activeProfileId } from "@/lib/health/active";
import { listPeople } from "@/lib/health/store";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSetting, isSetupDone, SETTING } from "@/lib/settings";
import "./globals.css";

const title = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-title", display: "swap" });
const body = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-body", display: "swap" });

// Thème choisi (clair, sombre) posé avant le premier rendu ; sans choix, on suit le système.
const THEME_SCRIPT = `try{var t=localStorage.getItem("mijote.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

// Motif de saison à côté du logo : champignon en automne, agrume en hiver, herbes au printemps, tomate l’été.
const SEASON_ART: Record<Season, { id: FoodArtId; label: string }> = {
  automne: { id: "champignon", label: "automne" },
  hiver: { id: "citron_vert", label: "hiver" },
  printemps: { id: "persil", label: "printemps" },
  ete: { id: "tomate", label: "été" },
};

export const metadata: Metadata = {
  title: "Mijote",
  description: "Batch cooking planifié, courses, nutrition juste et sport à la maison, pour tout le foyer",
  appleWebApp: { capable: true, title: "Mijote", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#111317" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Instance neuve : la mise en route d’abord (le foyer, la cuisine, les courses).
  const path = (await headers()).get("x-mijote-path") ?? "/";
  const open = /^\/(bienvenue|reglages|connexion|kit)(\/|$)/.test(path);
  if (!open && !isSetupDone(db)) redirect("/bienvenue");
  const home = getSetting(db, SETTING.homeName);
  const profiles = listPeople(db).map((p) => ({ id: p.id, name: p.name }));
  const active = await activeProfileId();
  const season = SEASON_ART[seasonOf(parisMonth())];
  // Recherche ⌘K : les recettes et leurs ingrédients (quelques dizaines de lignes).
  const itemsOf = new Map<string, string[]>();
  for (const i of db.select({ recipeId: recipeIngredients.recipeId, item: recipeIngredients.item }).from(recipeIngredients).all()) itemsOf.set(i.recipeId, [...(itemsOf.get(i.recipeId) ?? []), i.item]);
  const searchRecipes = listRecipes(db).map((r) => ({ slug: r.slug, name: r.name, color: recipeColor(r.slug), items: itemsOf.get(r.id) ?? [] }));
  return (
    <html lang="fr" className={`${title.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <CustomArtProvider art={loadCustomArt(db)}>
        <TopNav home={home} profiles={profiles} active={active} motif={<FoodIllu id={season.id} size={22} label={`en ${season.label}`} />} search={<CommandK recipes={searchRecipes} assistant={aiEnabled()} />} assistant={aiEnabled() ? <Assistant /> : null} />
        <SessionBanner />
        <main className="mx-auto max-w-[1240px] px-5 pt-8 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-10 sm:pt-12 sm:pb-28">{children}</main>
        <TabBar />
        </CustomArtProvider>
      </body>
    </html>
  );
}
