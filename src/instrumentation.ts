// Au démarrage du serveur, avant la première requête. En démo (MIJOTE_DEMO=1) : la base modèle du foyer
// d'Alex et Sam se construit, et la purge des bases de visiteurs se lance (src/lib/demo/store.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { demoEnabled } = await import("@/lib/demo/core");
  if (!demoEnabled()) return;
  const { prepareDemo } = await import("@/lib/demo/store");
  await prepareDemo();
}
