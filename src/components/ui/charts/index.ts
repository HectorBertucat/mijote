// Kit de graphiques (docs/design/systeme.md § Graphiques ; démonstration : /kit/graphiques). Rendu serveur ;
// seule l'île ChartHover est un composant client (survol, doigt, clavier).
export * from "./core";
export * from "./parts";
export * from "./line";
export * from "./bars";
export * from "./spark";
export * from "./calendar";
export * from "./hbar";
export { ChartHover } from "./hover";
export { PeriodScope } from "./period";
