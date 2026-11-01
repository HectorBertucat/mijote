// L'API de l'app (src/app/api/app/v1) aussi sous le préfixe de l'import : derrière Cloudflare Access, la règle
// « Service Auth » de /api/sante/import la couvre déjà, sans seconde règle à créer. Même traitement, même clé.
export { GET, POST } from "@/app/api/app/v1/[...path]/route";

export const dynamic = "force-dynamic";
