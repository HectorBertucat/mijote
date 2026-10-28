// Appli ajoutée à l'écran d'accueil : nom, couleurs du lin (tokens bg), plein écran sans barre du navigateur.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mijote",
    short_name: "Mijote",
    description: "Recettes, courses et sessions de cuisine",
    start_url: "/recettes",
    display: "standalone",
    background_color: "#f6f4f0",
    theme_color: "#f6f4f0",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
