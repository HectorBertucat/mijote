// Poses clés et tempo de chaque exercice (vue de côté, tourné vers la droite, sol à y = 186).
// Le tempo suit les consignes de programme.ts : la figure dure exactement ce que dit l'écran.
// Les angles peuvent dépasser ±180° : on interpole les nombres, donc on choisit le sens de rotation
// (un avant-bras qui passe derrière la tête, une jambe qui se tend au-dessus du sol et non à travers).
import type { Angles, Constraints } from "./skeleton";
import { tempo, type Key, type Motion } from "./motion";

const G = 183; // hauteur des chevilles et des mains posées au sol
const STAND: Angles = { torso: 2, neck: 0, thighN: 2, shinN: -2, thighF: 2, shinF: -2, upperN: 4, foreN: 8, upperF: 2, foreF: 6 };
const stand = (o: Partial<Angles>): Angles => ({ ...STAND, ...o });
const feet = (x = 100): Constraints => ({ anchor: "ankleN", at: [x, G] });

// Kettlebell tenue par les cornes contre le sternum : la boule pend sous les mains.
const GOBLET = { upperN: 18, foreN: 172, upperF: 14, foreF: 170 };
const hornsBell = { hand: "handN" as const, dx: 2, dy: 9 };
const hangBell = { hand: "handN" as const, dx: 0, dy: 11 };

export const MOTIONS: Record<string, Motion> = {
  goblet: {
    keys: [
      { a: stand({ ...GOBLET }), c: feet(), bell: hornsBell },
      { a: stand({ torso: 34, thighN: 96, shinN: -34, thighF: 94, shinF: -32, upperN: 40, foreN: 178, upperF: 36, foreF: 176 }), c: feet(), bell: hornsBell },
    ],
    steps: tempo(3, 1, 1, 0.4, { down: "Descends", bottom: "Tiens en bas", up: "Remonte fort" }),
  },

  row: rowMotion(1, 1, 2),
  rowPause: rowMotion(1, 2, 3),

  pushup: {
    keys: [
      // En haut, épaules à l'aplomb des mains ; en bas, poitrine à deux doigts du sol, coudes vers l'arrière.
      { a: plank(69, 0), c: { anchor: "toeN", at: [36, 185], ik: { handN: { at: [150, G], bend: -1 }, handF: { at: [148, G], bend: -1 } } } },
      { a: plank(86, 0), c: { anchor: "toeN", at: [36, 185], ik: { handN: { at: [150, G], bend: -1 }, handF: { at: [148, G], bend: -1 } } } },
    ],
    steps: tempo(2, 0, 1, 0.4, { down: "Descends", up: "Pousse" }),
  },

  rdl: {
    keys: [
      { a: stand({ thighF: -6, shinF: -10, upperF: 2, foreF: 2, upperN: 4, foreN: 6 }), c: feet(96), bell: { hand: "handF", dx: 0, dy: 11 } },
      { a: stand({ torso: 84, neck: -8, thighN: 10, shinN: -6, thighF: -84, shinF: -86, upperN: 2, foreN: 2, upperF: -2, foreF: -2 }), c: feet(96), bell: { hand: "handF", dx: 0, dy: 11 } },
    ],
    steps: tempo(3, 0.5, 1, 0.5, { down: "Hanche en arrière", bottom: "Dos plat", up: "Serre le fessier" }),
  },

  curl: {
    keys: [
      { a: stand({ upperN: 2, foreN: 10, upperF: 0, foreF: 8 }), c: feet(), bell: { hand: "handN", dx: 2, dy: 10 } },
      { a: stand({ upperN: 4, foreN: 160, upperF: 2, foreF: 158 }), c: feet(), bell: { hand: "handN", dx: -1, dy: -9 } },
    ],
    steps: [
      { to: 1, dur: 1, label: "Monte" },
      { to: 0, dur: 2, label: "Redescends lentement", count: true },
      { to: 0, dur: 0.4, label: "Bras tendus" },
    ],
  },

  triceps: {
    keys: [
      { a: stand({ upperN: 168, foreN: 348, upperF: 166, foreF: 346 }), c: feet(), bell: { hand: "handN", dx: -3, dy: 9 } },
      { a: stand({ upperN: 172, foreN: 176, upperF: 170, foreF: 174 }), c: feet(), bell: { hand: "handN", dx: 0, dy: -9 } },
    ],
    steps: [
      { to: 1, dur: 1, label: "Tends les bras" },
      { to: 0, dur: 2, label: "Redescends derrière la tête", count: true },
      { to: 0, dur: 0.3, label: "Coudes fixes" },
    ],
  },

  bulgare: {
    keys: [
      { a: stand({ ...GOBLET, torso: 4, thighN: 4, shinN: -2, footF: 186 }), c: { anchor: "ankleN", at: [122, G], ik: { ankleF: { at: [62, 146], bend: 1 } } }, bell: hornsBell },
      { a: stand({ ...GOBLET, torso: 12, thighN: 80, shinN: -8, upperN: 24, upperF: 20, footF: 176 }), c: { anchor: "ankleN", at: [122, G], ik: { ankleF: { at: [62, 146], bend: 1 } } }, bell: hornsBell },
    ],
    steps: tempo(2, 0, 1, 0.4, { down: "Descends droit", up: "Pousse dans le talon" }),
    props: [{ kind: "bench", x: 14, y: 149, w: 50, h: 37 }],
  },

  floorpress: {
    keys: [
      { a: lying({ upperN: -86, foreN: 178 }), c: lyingC(), bell: { hand: "handN", dx: 5, dy: -3 } },
      { a: lying({ upperN: -182, foreN: 178 }), c: lyingC(), bell: { hand: "handN", dx: 5, dy: -3 } },
    ],
    steps: [
      { to: 0, dur: 1, label: "Coude au sol", count: true },
      { to: 1, dur: 1, label: "Pousse" },
      { to: 0, dur: 2, label: "Redescends", count: true },
    ],
  },

  press: {
    keys: [
      { a: stand({ upperN: 16, foreN: 166 }), c: feet(), bell: { hand: "handN", dx: -6, dy: -3 } },
      { a: stand({ upperN: 176, foreN: 178 }), c: feet(), bell: { hand: "handN", dx: -6, dy: -2 } },
    ],
    steps: [
      { to: 1, dur: 1, label: "Pousse" },
      { to: 1, dur: 0.4, label: "Bras verrouillé" },
      { to: 0, dur: 2, label: "Redescends au rack", count: true },
      { to: 0, dur: 0.4, label: "Gaine" },
    ],
  },

  swing: {
    keys: [
      { a: stand({ torso: -4, upperN: 92, foreN: 92, upperF: 90, foreF: 90 }), c: feet(), bell: { hand: "handN", dx: 9, dy: 1 } },
      { a: stand({ torso: 66, neck: -14, thighN: 20, shinN: -14, thighF: 20, shinF: -14, upperN: -24, foreN: -30, upperF: -26, foreF: -32 }), c: feet(), bell: { hand: "handN", dx: -6, dy: 7 } },
      { a: stand({ torso: 0, upperN: 60, foreN: 60, upperF: 58, foreF: 58 }), c: feet(), bell: { hand: "handN", dx: 7, dy: 5 } },
    ],
    steps: [
      { to: 1, dur: 0.55, label: "Charnière" },
      { to: 2, dur: 0.3, label: "Hanche !" },
      { to: 0, dur: 0.2, label: "Flotte" },
      { to: 0, dur: 0.15, label: "Flotte" },
    ],
  },

  deadbug: {
    keys: [
      { a: lying({ thighN: 178, shinN: -92, thighF: 176, shinF: -94, upperN: 178, foreN: 178, upperF: 176, foreF: 176 }), c: { anchor: "hip", at: [84, 176] } },
      { a: lying({ thighN: 178, shinN: -92, thighF: 256, shinF: -104, upperN: 100, foreN: 100, upperF: 176, foreF: 176 }), c: { anchor: "hip", at: [84, 176] } },
    ],
    steps: tempo(2, 0.5, 2, 0.5, { down: "Tends bras et jambe", bottom: "Dos collé", up: "Reviens", top: "Change de côté" }),
  },

  plank: {
    keys: [
      // Planche latérale vue de face : coude sous l'épaule, corps gainé en ligne, bras du dessus vers le plafond.
      { a: { ...plank(74, 0), thighN: -79, shinN: -79, thighF: -79, shinF: -79, upperN: 0, foreN: 90, upperF: 176, foreF: 176, footN: 0, footF: 0 }, c: { anchor: "elbowN", at: [150, G] } },
      { a: { ...plank(77, 0), upperN: 0, foreN: 90, upperF: 180, foreF: 180, footN: 0, footF: 0 }, c: { anchor: "elbowN", at: [150, G] } },
    ],
    steps: [
      { to: 1, dur: 2, label: "Hanche haute", count: true },
      { to: 0, dur: 2, label: "Respire, tiens", count: true },
    ],
  },
};

// ---------- Modèle renfo maison (renfo.ts) ----------
// Mêmes conventions. Les gestes identiques à ceux du modèle kettlebell reprennent sa figure (rowing, dead bug, planche).
Object.assign(MOTIONS, {
  jBridge: {
    keys: [
      // Sur le dos, tête à droite, pieds à plat : le bassin monte jusqu'à la ligne épaules-hanches-genoux.
      { a: lying({ torso: 90, neck: 0, upperN: -92, foreN: -90, upperF: -94, foreF: -90 }), c: { anchor: "shoulder", at: [132, 177], ik: { ankleN: { at: [46, G], bend: -1 }, ankleF: { at: [44, G], bend: -1 } } } },
      { a: lying({ torso: 118, neck: -28, upperN: -88, foreN: -90, upperF: -90, foreF: -90 }), c: { anchor: "shoulder", at: [132, 177], ik: { ankleN: { at: [46, G], bend: -1 }, ankleF: { at: [44, G], bend: -1 } } } },
    ],
    steps: tempo(1, 2, 2, 0.4, { down: "Pousse dans les talons", bottom: "Serre les fesses", up: "Redescends", top: "Effleure le sol" }),
  },

  jBandRow: {
    keys: [
      // Assise jambes tendues, la bande sous les pieds : les coudes partent vers l'arrière.
      { a: { ...seated(), upperN: 62, foreN: 84, upperF: 60, foreF: 82 }, c: { anchor: "hip", at: [60, 177] } },
      { a: { ...seated(), upperN: -34, foreN: 86, upperF: -36, foreF: 84 }, c: { anchor: "hip", at: [60, 177] } },
    ],
    steps: [
      { to: 1, dur: 1, label: "Coudes vers l'arrière" },
      { to: 1, dur: 1, label: "Serre les omoplates", count: true },
      { to: 0, dur: 2, label: "Reviens lentement", count: true },
      { to: 0, dur: 0.3, label: "Dos droit" },
    ],
  },

  jBoxSquat: {
    keys: [
      { a: stand({ ...GOBLET }), c: feet(112), bell: hornsBell },
      { a: stand({ torso: 30, thighN: 88, shinN: -30, thighF: 86, shinF: -28, upperN: 36, foreN: 178, upperF: 32, foreF: 176 }), c: feet(112), bell: hornsBell },
    ],
    steps: tempo(3, 0.4, 1, 0.4, { down: "Fesses en arrière", bottom: "Effleure la chaise", up: "Remonte" }),
    props: [{ kind: "bench", x: 66, y: 152, w: 36, h: 34 }],
  },

  jInclinePush: {
    keys: [
      // Mains sur le plan de travail, corps en planche inclinée.
      // Bras tendus en haut (les mains atteignent le plan de travail : vérifié par motion-check.ts).
      { a: plank(54, 0), c: { anchor: "toeN", at: [40, 185], ik: { handN: { at: [172, 141], bend: -1 }, handF: { at: [170, 141], bend: -1 } } } },
      { a: plank(60, 0), c: { anchor: "toeN", at: [40, 185], ik: { handN: { at: [172, 141], bend: -1 }, handF: { at: [170, 141], bend: -1 } } } },
    ],
    steps: tempo(2, 0, 1, 0.4, { down: "Approche la poitrine", up: "Pousse" }),
    props: [{ kind: "bench", x: 160, y: 143, w: 38, h: 43 }],
  },

  jLatWalk: {
    keys: [
      // Vue de face, demi-squat, mini-bande aux genoux : un pied s'écarte, l'autre suit, puis retour.
      walkPose(92, 82, 104),
      walkPose(100, 82, 120),
      walkPose(108, 96, 120),
    ],
    steps: [
      { to: 1, dur: 0.8, label: "Pas sur le côté" },
      { to: 2, dur: 0.8, label: "L'autre pied suit" },
      { to: 1, dur: 0.8, label: "Et dans l'autre sens" },
      { to: 0, dur: 0.8, label: "Genoux écartés" },
    ],
  },

  jRevLunge: {
    keys: [
      { a: stand({ upperN: 14, foreN: -34, upperF: 12, foreF: -36 }), c: { anchor: "ankleN", at: [118, G], ik: { ankleF: { at: [112, G], bend: 1 } } } },
      { a: stand({ torso: 6, thighN: 80, shinN: -6, upperN: 14, foreN: -34, upperF: 12, foreF: -36, footF: 40 }), c: { anchor: "ankleN", at: [118, G], ik: { ankleF: { at: [44, 180], bend: 1 } } } },
    ],
    steps: tempo(2, 0.4, 1, 0.4, { down: "Grand pas en arrière", bottom: "Genou vers le sol", up: "Pousse dans le talon avant" }),
  },

  jSeatedPress: {
    keys: [
      { a: { ...sitting(), upperN: 22, foreN: 174, upperF: 18, foreF: 172 }, c: { anchor: "ankleN", at: [130, G] } },
      { a: { ...sitting(), upperN: 176, foreN: 178, upperF: 174, foreF: 176 }, c: { anchor: "ankleN", at: [130, G] } },
    ],
    steps: [
      { to: 1, dur: 1, label: "Pousse vers le plafond" },
      { to: 0, dur: 2, label: "Redescends aux oreilles", count: true },
      { to: 0, dur: 0.4, label: "Côtes basses" },
    ],
    props: [{ kind: "bench", x: 62, y: 148, w: 40, h: 38 }],
  },

  jRdl: {
    keys: [
      { a: stand({ thighN: -2, thighF: -2, shinN: 2, shinF: 2, upperN: 4, foreN: 6, upperF: 2, foreF: 4 }), c: feet(104), bell: hangBell },
      { a: stand({ torso: 78, neck: -10, thighN: -14, shinN: 6, thighF: -14, shinF: 6, upperN: 0, foreN: 0, upperF: -2, foreF: -2 }), c: feet(104), bell: hangBell },
    ],
    steps: tempo(3, 0.4, 1, 0.4, { down: "Fesses vers l'arrière", bottom: "Dos plat, ça étire", up: "Serre les fesses" }),
  },

  jSideLeg: {
    keys: [
      // Allongée sur le côté, vue de face, tête posée sur le bras : la jambe du dessus monte, tendue.
      { a: side(-90), c: { anchor: "hip", at: [84, 174] } },
      { a: side(-128), c: { anchor: "hip", at: [84, 174] } },
    ],
    steps: tempo(1, 1, 2, 0.3, { down: "Monte la jambe", bottom: "Tiens", up: "Redescends lentement", top: "Effleure" }),
  },
} satisfies Record<string, Motion>);
MOTIONS.jRow = MOTIONS.row;
MOTIONS.jDeadbug = MOTIONS.deadbug;
MOTIONS.jPlank = MOTIONS.plank;

/** Assise au sol, jambes tendues devant. */
function seated(): Angles {
  return { torso: 4, neck: 0, thighN: 90, shinN: 90, thighF: 88, shinF: 88, upperN: 0, foreN: 0, upperF: 0, foreF: 0, footN: 90, footF: 90 };
}
/** Assise sur une chaise, cuisses à l'horizontale, tibias verticaux. */
function sitting(): Angles {
  return { torso: 0, neck: 0, thighN: 90, shinN: 0, thighF: 88, shinF: 0, upperN: 0, foreN: 0, upperF: 0, foreF: 0 };
}
/** Vue de face en demi-squat : bassin en x, chevilles posées ; mains sur les hanches. */
function walkPose(hx: number, left: number, right: number): Key {
  return {
    a: { torso: 0, neck: 0, thighN: 10, shinN: -6, thighF: -10, shinF: 6, upperN: 22, foreN: -34, upperF: -22, foreF: 34, footN: 0, footF: 180 },
    c: { anchor: "hip", at: [hx, 110], ik: { ankleN: { at: [right, G], bend: 1 }, ankleF: { at: [left, G], bend: -1 } } },
  };
}
/** Allongée sur le côté, tête à droite posée sur le bras ; `thighF` lève la jambe du dessus. */
function side(thighF: number): Angles {
  return { torso: 90, neck: 0, thighN: -90, shinN: -90, thighF, shinF: thighF, upperN: 90, foreN: 90, upperF: -88, foreF: -88, footN: 90, footF: 90 - (thighF + 90) };
}

function plank(t: number, bend: number): Angles {
  return { torso: t, neck: 0, thighN: -t + bend, shinN: -t, thighF: -t + bend, shinF: -t, upperN: 0, foreN: 0, upperF: 0, foreF: 0, footN: -62, footF: -62 };
}

function lying(o: Partial<Angles>): Angles {
  return { torso: 90, neck: 0, thighN: -148, shinN: -18, thighF: -146, shinF: -20, upperN: 178, foreN: 178, upperF: -84, foreF: -90, footN: 0, footF: 0, ...o };
}
function lyingC(): Constraints {
  return { anchor: "hip", at: [80, 176], ik: { ankleN: { at: [48, G], bend: -1 }, ankleF: { at: [46, G], bend: -1 } } };
}

function rowMotion(pull: number, hold: number, lower: number): Motion {
  const base: Partial<Angles> = { torso: 76, neck: -10, thighN: 14, shinN: -2, thighF: -14, shinF: -12, upperF: 70, foreF: 70 };
  const c: Constraints = { anchor: "ankleN", at: [96, G], ik: { handF: { at: [158, 142], bend: 1 } } };
  const keys: Key[] = [
    { a: stand({ ...base, upperN: 2, foreN: 2 }), c, bell: hangBell },
    { a: stand({ ...base, upperN: -64, foreN: 14 }), c, bell: hangBell },
  ];
  return {
    keys,
    steps: [
      { to: 1, dur: pull, label: "Tire le coude vers la hanche" },
      { to: 1, dur: hold, label: "Serre l'omoplate", count: true },
      { to: 0, dur: lower, label: "Redescends lentement", count: true },
      { to: 0, dur: 0.3, label: "Bras tendu" },
    ],
    props: [{ kind: "bench", x: 140, y: 146, w: 56, h: 40 }],
  };
}

/** La figure d'un exercice : celle du programme (exercice inventé), sinon celle de la bibliothèque. */
export function motionOf(p: { motions?: Record<string, Motion> } | null | undefined, ex: string): Motion | null {
  return p?.motions?.[ex] ?? MOTIONS[ex] ?? null;
}
