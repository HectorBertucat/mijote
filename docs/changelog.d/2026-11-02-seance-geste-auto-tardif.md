## 2026-11-02 : Séance de sport, pas de geste automatique sur une séance oubliée
- Un écran qui rouvre une séance laissée en plan ne note plus une série guidée finie depuis des heures, ne fait plus passer un repos fini depuis longtemps, ne note plus un finisher : un geste automatique ne part que dans les 5 minutes après la fin (`AUTO_LATE_MS`, `autoDue` dans `src/lib/training/live.ts`) ; après, on attend « Série faite » ou « Passer ».
- API de l'app : `state.autoGesture`, `autoAt`, `autoUntil` donnent ce geste et sa fenêtre.
