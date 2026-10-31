// Appli ajoutée à l'écran d'accueil : nom, couleur du papier (jeton --c-bg, aussi le fond de l'écran de démarrage
// Android), plein écran sans barre du navigateur.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mijote",
    short_name: "Mijote",
    description: "Recettes, courses et sessions de cuisine",
    start_url: "/recettes",
    display: "standalone",
    background_color: "#f3f1ec",
    theme_color: "#f3f1ec",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
