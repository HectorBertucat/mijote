// Modèle « Renfo maison » : 2 séances de 25-30 min par semaine, pour débuter, avec peu de matériel :
// tapis, mini-bandes, grande bande élastique, haltères légers, une kettlebell légère, une chaise, un canapé.
// Fessiers et hanches passent en premier (ils gardent les genoux dans l'axe). Chaque exercice a son
// `guide` pas à pas. Figures dans figures.ts, sous la même clé (préfixe j).
import type { Block, Exercise, Program, SessionDef } from "./program";

const KNEE = "Le genou reste au-dessus du 2e orteil : il ne rentre jamais vers l'intérieur";

export const RENFO_EXERCISES: Record<string, Exercise> = {
  jBridge: {
    name: "Pont fessier", short: "Pont fessier", muscles: "Fessiers, arrière des cuisses", reps: [12, 20], uni: false, tempo: "2 s serrées en haut",
    cues: ["Pieds à plat, talons à une main des fesses", "Pousse dans les talons, bassin en ligne avec les épaules et les genoux", "Serre fort les fesses 2 secondes en haut", "Redescends en 2 secondes, effleure le sol"],
    errors: ["Ça tire dans le bas du dos : monte moins haut et rentre le ventre", "Ce sont les ischios qui chauffent : rapproche les pieds des fesses", "Les genoux s'écartent ou se touchent : ils restent alignés avec les pieds"],
    ladder: ["Pont fessier au poids du corps", "Mini-bande au-dessus des genoux (pousse-les vers l'extérieur)", "Kettlebell 6 kg posée sur les hanches", "Pont une jambe", "Kettlebell plus lourde sur les hanches"],
    guide: {
      position: "Allongée sur le dos sur le tapis, genoux pliés, pieds à plat écartés de la largeur des hanches. Bras le long du corps, paumes au sol.",
      movement: "Pousse dans les talons et monte le bassin jusqu'à former une ligne droite épaules-hanches-genoux. Serre les fesses 2 secondes, redescends en 2 secondes, effleure le sol et repars.",
      feel: "Les fesses. Pas le bas du dos.",
      breathing: "Souffle en montant, inspire en descendant.",
      easier: "Monte moins haut, sans pause en haut.",
    },
  },
  jBandRow: {
    name: "Rowing à la bande, assise", short: "Rowing bande", muscles: "Milieu du dos, arrière des épaules", reps: [12, 15], uni: false, tempo: "1 s omoplates serrées",
    cues: ["Assise jambes tendues, bande sous les pieds, dos droit", "Tire les coudes vers l'arrière, près du corps", "Serre les omoplates 1 seconde", "Reviens lentement"],
    errors: ["Les épaules montent vers les oreilles : garde-les basses", "Tu te penches en arrière pour tirer : le buste reste immobile"],
    ladder: ["Bande prise longue", "Bande prise plus court", "Pause 2 s omoplates serrées", "Bande plus dure (ou doublée)"],
    guide: {
      position: "Assise au sol, jambes tendues (genoux un peu pliés si ça tire), la bande passée sous la plante des pieds, une extrémité dans chaque main. Dos droit, comme au Pilates.",
      movement: "Amène les mains vers le bas des côtes en tirant les coudes vers l'arrière, près du corps. Serre les omoplates l'une contre l'autre 1 seconde, puis reviens en 2 secondes.",
      feel: "Entre les omoplates. Pas dans les bras ni la nuque.",
      breathing: "Souffle en tirant.",
      easier: "Prends la bande plus long (plus loin des mains).",
    },
  },
  jBoxSquat: {
    name: "Squat sur chaise, kettlebell contre la poitrine", short: "Squat chaise", muscles: "Cuisses, fessiers", reps: [10, 15], uni: false, tempo: "3 s pour descendre",
    cues: ["Dos à la chaise, pieds un peu plus larges que les hanches", "Kettlebell tenue par les côtés de la poignée, collée à la poitrine", "Fesses en arrière, descends en 3 secondes jusqu'à effleurer la chaise", "Remonte en poussant dans tout le pied", KNEE],
    errors: ["Tu t'assois et tu te relâches : on effleure seulement", "Un genou rentre en remontant : enlève la kettlebell ou prends une chaise plus haute", "Le dos s'arrondit : poitrine fière"],
    ladder: ["Squat chaise sans charge", "Kettlebell 6 kg contre la poitrine", "Chaise plus basse", "Squat complet sans chaise", "Pause 2 s en bas"],
    guide: {
      position: "Debout devant une chaise, dos à elle, pieds un peu plus larges que les hanches, pointes légèrement ouvertes. La kettlebell tenue par les côtés de la poignée, contre la poitrine, coudes vers le bas.",
      movement: "Envoie les fesses en arrière comme pour t'asseoir et descends en 3 secondes jusqu'à effleurer la chaise. Ne t'assois pas : remonte aussitôt en poussant dans tout le pied.",
      feel: "Les cuisses et les fesses.",
      breathing: "Inspire en descendant, souffle en remontant.",
      easier: "Sans la kettlebell, ou une chaise plus haute.",
    },
  },
  jInclinePush: {
    name: "Pompes inclinées", short: "Pompes inclinées", muscles: "Pectoraux, arrière des bras, gainage", reps: [8, 12], uni: false, tempo: "2 s pour descendre",
    cues: ["Mains un peu plus larges que les épaules, à hauteur de poitrine", "Corps en planche droite, de la tête aux talons", "Coudes à 45° du corps, pas en croix", "Approche la poitrine, pousse pour revenir"],
    errors: ["Le bassin s'affaisse ou les fesses montent : serre ventre et fesses", "Coudes écartés en croix : rapproche-les du corps"],
    ladder: ["Mains au mur", "Mains sur le plan de travail", "Mains sur le dossier du canapé", "Mains sur l'assise du canapé", "Pompes genoux au sol"],
    guide: {
      position: "Mains sur le mur (puis le plan de travail, puis le canapé), un peu plus larges que les épaules. Recule les pieds jusqu'à ce que ton corps soit une planche droite.",
      movement: "Plie les coudes en les gardant près du corps et approche la poitrine du support en 2 secondes. Pousse pour revenir, sans casser la planche.",
      feel: "La poitrine et l'arrière des bras. Le ventre et les fesses tiennent la planche.",
      breathing: "Inspire en descendant, souffle en poussant.",
      easier: "Rapproche les pieds du support : plus tu es droite, plus c'est facile.",
    },
  },
  jLatWalk: {
    name: "Marche latérale, mini-bande", short: "Marche latérale", muscles: "Côté des fesses (stabilise le genou)", reps: [10, 15], uni: true, tempo: "pas lents, bande tendue",
    cues: ["Mini-bande au-dessus des genoux", "Demi-squat, genoux poussés vers l'extérieur", "Pas chassés sur le côté, les pieds ne se touchent jamais", "Autant de pas à droite qu'à gauche"],
    errors: ["Tu te redresses : reste en demi-squat", "Les genoux rentrent : pousse-les vers l'extérieur contre la bande"],
    ladder: ["Bande au-dessus des genoux", "Bande plus dure", "Bande aux chevilles", "Bande aux chevilles, squat plus bas"],
    guide: {
      position: "Debout, mini-bande au-dessus des genoux, pieds écartés de la largeur des hanches. Plie un peu les genoux et pousse les fesses en arrière (demi-squat).",
      movement: "Fais un pas sur le côté, puis ramène l'autre pied sans que les pieds se touchent : la bande reste tendue. Tous les pas d'un côté, puis reviens.",
      feel: "Le côté des fesses : c'est le muscle qui garde le genou dans l'axe.",
      easier: "Bande plus légère, ou plus haut sur les cuisses.",
    },
  },
  jPlank: {
    name: "Planche latérale", short: "Planche latérale", muscles: "Obliques, gainage", reps: [20, 40], uni: true, unit: "s", tempo: "secondes par côté",
    cues: ["Avant-bras au sol, coude sous l'épaule", "Hanches levées, corps en ligne", "Genoux au sol au début, puis pieds"],
    errors: ["La hanche tombe : raccourcis la durée", "Les fesses partent en arrière : pousse le bassin vers l'avant"],
    ladder: ["Planche latérale genoux au sol", "Planche latérale sur les pieds, 20 s", "40 s sur les pieds", "Jambe du dessus levée"],
    guide: {
      position: "Allongée sur le côté, en appui sur l'avant-bras (coude sous l'épaule), genoux pliés et posés au sol.",
      movement: "Lève les hanches jusqu'à ce que le corps soit en ligne des genoux à la tête. Tiens, puis change de côté.",
      feel: "Le côté du ventre (obliques) et l'épaule d'appui.",
      breathing: "Respire normalement, ne bloque pas.",
      easier: "Moins longtemps, ou hanches à mi-hauteur.",
    },
  },
  jRevLunge: {
    name: "Fente arrière", short: "Fente arrière", muscles: "Cuisses, fessiers (une jambe à la fois)", reps: [8, 12], uni: true, tempo: "2 s pour descendre",
    cues: ["Grand pas en arrière", "Descends le genou arrière vers le sol, sans le poser", "Pousse dans le talon de la jambe avant pour remonter", "Commence par la jambe droite", KNEE],
    errors: ["Le genou avant part loin devant ou vers l'intérieur : allonge ton pas", "Tu perds l'équilibre : une main sur le dossier d'une chaise"],
    ladder: ["Avec une main sur une chaise", "Sans appui", "Haltères 1,5 kg dans chaque main", "Kettlebell 6 kg contre la poitrine", "Fente bulgare (pied arrière sur le canapé)"],
    guide: {
      position: "Debout, pieds sous les hanches, mains sur les hanches. Les deux premières semaines, une main sur le dossier d'une chaise.",
      movement: "Fais un grand pas en arrière et descends en 2 secondes jusqu'à ce que les deux genoux soient à angle droit, le genou arrière juste au-dessus du sol. Remonte en poussant dans le talon avant. Toutes les reps d'une jambe, puis l'autre : la droite d'abord, et le même nombre à gauche.",
      feel: "La fesse et la cuisse de la jambe avant.",
      breathing: "Inspire en descendant, souffle en remontant.",
      easier: "Descends moins bas, et garde l'appui sur la chaise.",
    },
  },
  jSeatedPress: {
    name: "Développé épaules assise, haltères", short: "Développé épaules", muscles: "Épaules, arrière des bras", reps: [10, 15], uni: false, tempo: "2 s pour redescendre",
    cues: ["Assise au bord d'une chaise, dos droit", "Haltères à hauteur d'épaules, paumes vers l'avant", "Pousse vers le plafond, bras presque tendus", "Redescends en 2 secondes à hauteur d'oreilles"],
    errors: ["Le bas du dos se cambre : ventre rentré, côtes basses", "Les épaules montent aux oreilles : garde-les basses"],
    ladder: ["Haltères 1,5 kg", "Haltères 1,5 kg, 3 s pour redescendre", "Haltères 3 kg", "Debout"],
    guide: {
      position: "Assise au bord d'une chaise, pieds au sol, dos droit. Un haltère dans chaque main à hauteur d'épaules, paumes vers l'avant, coudes sous les poignets.",
      movement: "Pousse les haltères vers le plafond jusqu'à avoir les bras presque tendus, puis redescends en 2 secondes à hauteur d'oreilles.",
      feel: "Le dessus des épaules et l'arrière des bras.",
      breathing: "Souffle en poussant.",
      easier: "Un bras à la fois, ou moins haut.",
    },
  },
  jRdl: {
    name: "Soulevé de terre roumain, kettlebell", short: "Soulevé roumain", muscles: "Arrière des cuisses, fessiers", reps: [10, 15], uni: false, tempo: "3 s pour descendre",
    cues: ["Genoux un peu fléchis, et ils ne bougent plus", "Fesses vers l'arrière, comme pour fermer une porte avec", "La kettlebell glisse le long des cuisses", "Remonte en serrant les fesses"],
    errors: ["Le dos s'arrondit : descends moins bas, regard au sol à 2 m", "Tu plies les genoux comme un squat : ce sont les fesses qui reculent", "Ça tire dans le bas du dos : arrête la série et revois le geste sans charge"],
    ladder: ["Sans charge, fesses qui vont toucher un mur", "Kettlebell 6 kg", "3 s pour descendre", "Une jambe, main sur un mur", "Kettlebell plus lourde à deux mains"],
    guide: {
      position: "Debout, pieds sous les hanches, genoux légèrement fléchis. La kettlebell tenue à deux mains devant les cuisses, bras tendus.",
      movement: "Pousse les fesses vers l'arrière : le buste s'incline et la kettlebell glisse le long des cuisses. Descends jusqu'à sentir un fort étirement derrière les cuisses (souvent à mi-tibia), puis remonte en serrant les fesses. La 1re semaine, sans charge, mains sur les hanches, les fesses vont toucher un mur derrière toi.",
      feel: "L'arrière des cuisses et les fesses. Jamais le bas du dos.",
      breathing: "Inspire en descendant, souffle en remontant.",
      easier: "Descends moins bas, ou sans la kettlebell.",
    },
  },
  jRow: {
    name: "Rowing un bras, appui sur le canapé", short: "Rowing un bras", muscles: "Dos, arrière des épaules", reps: [10, 15], uni: true, tempo: "1 s en haut",
    cues: ["Main et genou sur le canapé, dos plat", "Tire le coude vers la hanche, pas vers l'épaule", "Pause 1 seconde en haut", "Redescends lentement"],
    errors: ["Tu tournes le buste pour tricher : épaules parallèles au sol", "Tu tires avec la main : pense « coude »"],
    ladder: ["Haltère 1,5 kg", "Kettlebell 6 kg", "Pause 2 s en haut", "Kettlebell 6 kg, 3 s pour redescendre"],
    guide: {
      position: "Main gauche et genou gauche sur le canapé, pied droit au sol, dos plat parallèle au sol. Le poids dans la main droite, bras tendu vers le sol.",
      movement: "Tire le coude vers la hanche, garde 1 seconde en haut, redescends lentement. Toutes les reps d'un bras, puis change de côté.",
      feel: "Le côté et le milieu du dos.",
      breathing: "Souffle en tirant.",
      easier: "L'haltère au lieu de la kettlebell.",
    },
  },
  jDeadbug: {
    name: "Dead bug", short: "Dead bug", muscles: "Abdominaux profonds", reps: [6, 10], uni: true, tempo: "lent, dos collé au sol",
    cues: ["Sur le dos, bras vers le plafond, jambes en table", "Bas du dos plaqué au sol", "Descends un bras et la jambe opposée, sans que le dos décolle", "Reviens, change de côté"],
    errors: ["Le dos décolle : descends moins bas"],
    ladder: ["Dead bug, pied qui effleure le sol", "Jambe tendue", "4 s par mouvement", "Haltère 1,5 kg dans les mains"],
    guide: {
      position: "Sur le dos, bras tendus vers le plafond, hanches et genoux pliés à angle droit (jambes « en table »). Plaque le bas du dos au sol, comme au Pilates.",
      movement: "Descends en même temps le bras droit derrière la tête et la jambe gauche vers le sol, lentement, sans que le dos décolle. Reviens, puis l'autre côté.",
      feel: "Le ventre, en profondeur.",
      breathing: "Souffle en allongeant bras et jambe.",
      easier: "Ne bouge que les jambes, bras fixes.",
    },
  },
  jSideLeg: {
    name: "Jambe levée sur le côté", short: "Jambe sur le côté", muscles: "Côté des fesses (stabilise le genou)", reps: [12, 20], uni: true, tempo: "1 s en haut, 2 s pour redescendre",
    cues: ["Allongée sur le côté, corps en ligne, tête posée sur le bras", "Monte la jambe du dessus tendue, pointe de pied vers l'avant", "Tiens 1 seconde, redescends en 2 secondes", "Le bassin ne roule pas vers l'arrière"],
    errors: ["Le pied tourne vers le plafond : garde la pointe vers l'avant", "Tu montes trop haut et le bassin bascule : moins haut"],
    ladder: ["Poids du corps", "Mini-bande aux chevilles", "Bande plus dure", "Pause 3 s en haut"],
    guide: {
      position: "Allongée sur le côté, corps bien aligné des épaules aux pieds, tête posée sur le bras du dessous. La main du dessus en appui au sol devant toi.",
      movement: "Monte la jambe du dessus, tendue, d'une trentaine de centimètres. Tiens 1 seconde, redescends en 2 secondes sans la poser. Toutes les reps, puis l'autre côté.",
      feel: "Le côté de la fesse, en haut de la cuisse.",
      easier: "Monte moins haut, sans bande.",
    },
  },
};

export const RENFO_ORDER = ["jBridge", "jBoxSquat", "jRevLunge", "jRdl", "jLatWalk", "jSideLeg", "jBandRow", "jRow", "jInclinePush", "jSeatedPress", "jDeadbug", "jPlank"];

// 3 tours dès le départ : les semaines 1-2, s'arrêter à 3 reps de l'échec (consigne dans la description).
const SESSIONS: Record<string, SessionDef> = {
  A: {
    name: "Séance A",
    sub: "Fessiers · dos · squat · pompes · gainage",
    blocks: [
      { label: "Bloc 1", sets: 3, items: ["jBridge", "jBandRow"], rest: 75 },
      { label: "Bloc 2", sets: 3, items: ["jBoxSquat", "jInclinePush"], rest: 75 },
      { label: "Fin : hanches et gainage", sets: 2, items: ["jLatWalk", "jPlank"], rest: 30 },
    ],
  },
  B: {
    name: "Séance B",
    sub: "Fentes · épaules · ischios · dos · gainage",
    blocks: [
      { label: "Bloc 1", sets: 3, items: ["jRevLunge", "jSeatedPress"], rest: 75 },
      { label: "Bloc 2", sets: 3, items: ["jRdl", "jRow"], rest: 75 },
      { label: "Fin : gainage et hanches", sets: 2, items: ["jDeadbug", "jSideLeg"], rest: 30 },
    ],
  },
};

const WARMUP = ["Marche latérale avec mini-bande : 10 pas à droite, 10 à gauche", "10 ponts fessiers", "8 squats sur la chaise, lents, sans charge", "6 chat-vache à quatre pattes"];

const BONUS: Block | null = null; // les fins de séance sont déjà du gainage

export const RENFO_TEMPLATE: Program = {
  id: "modele-renfo",
  name: "Renfo maison",
  people: [],
  exercises: RENFO_EXERCISES,
  order: RENFO_ORDER,
  sessions: SESSIONS,
  bonus: BONUS,
  warmup: WARMUP,
  blockRest: 90,
  weekPlan: [["Renfo · A", "Repos", "Repos", "Renfo · B", "Repos", "Repos", "Repos"]],
  checkpoint: null,
  short: "Renfo",
  perWeek: 2,
  alsoTrack: null,
  weekNote: "2 séances de 25 à 30 min par semaine, jamais deux jours de suite. L'onglet Séance propose automatiquement la bonne.",
  principles: [
    { title: "Semaines 1 et 2 : on apprend", text: "Arrête chaque série quand il te reste 3 répétitions en réserve. Le geste propre d'abord, l'effort ensuite." },
    { title: "Ensuite : près de l'échec", text: "À la fin de chaque série, il doit te rester 1 ou 2 répétitions possibles, pas plus. Ce sont les dernières, les plus dures, qui font le résultat." },
    { title: "Double progression", text: "Haut de la fourchette sur toutes les séries : passe à la version suivante de l'exercice et repars du bas. Le carnet le signale." },
    { title: "Les genoux", text: "Le genou reste au-dessus du 2e orteil et ne rentre jamais vers l'intérieur. Commence les exercices sur une jambe par la droite, et fais le même nombre à gauche." },
    { title: "Brûlure ou douleur", text: "Une brûlure dans le muscle, c'est voulu. Une douleur dans une articulation (genou, dos, épaule) : arrête l'exercice et prends la version plus facile. Si une articulation gonfle, on réduit.", wide: true },
    { title: "Ce qui change la silhouette", text: "Le gainage renforce et rentre le ventre, mais le gras ne part pas d'un endroit précis : c'est le renfo de tout le corps et assez de protéines qui dessinent. Mesure le tour de taille une fois par semaine plutôt que de regarder la balance.", wide: true },
  ],
};
