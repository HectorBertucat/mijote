// Module Course : toutes les constantes, en un seul endroit. Chacune renvoie à la section de docs/course.md
// qui la justifie (source publiée ou choix de Mijote). Un calcul qui change = RUNNING_VERSION + 1 : les
// analyses gardées en base (workout_details.summary) sont refaites à la lecture suivante.

/** Version des calculs (comme NUTRITION_VERSION). */
export const RUNNING_VERSION = 1;

// ─── § 1.1 Les trois repères ───

/** FCmax estimée de Tanaka : 208 − 0,7 × âge. */
export const TANAKA = { a: 208, b: 0.7 };
/** Bornes d'une FCmax observée autour de Tanaka : au-delà, c'est un artefact. */
export const HRMAX_OBS_BELOW_TANAKA = 25;
export const HRMAX_OBS_ABOVE_TANAKA = 30;
export const HRMAX_ABS = 230;
/** Un pic n'est retenu que si une autre sortie des 365 jours a un pic à 5 bpm ou moins. */
export const HRMAX_CONFIRM_BPM = 5;
export const HRMAX_WINDOW_DAYS = 365;
/** Moyenne glissante du pic : 30 s, valide si au moins 25 s mesurées. */
export const PEAK_WINDOW_S = 30;
export const PEAK_MIN_VALID_S = 25;
/** Un changement de repère n'est retenu qu'à partir de 2 bpm (pas de zones qui sautillent). */
export const HR_CHANGE_MIN = 2;

/** FC au repos : médiane des 30 derniers jours, au moins 7 mesures ; sinon la dernière de moins de 90 jours ; sinon 60. */
export const REST_WINDOW_DAYS = 30;
export const REST_MIN_SAMPLES = 7;
export const REST_FALLBACK_DAYS = 90;
export const REST_DEFAULT = 60;

/** FC au seuil par défaut : FCrepos + 0,80 × réserve (choix de Mijote). */
export const THRESHOLD_RESERVE = 0.8;

// ─── § 1.2 Les cinq zones ───

/** Bornes basses de Z1 à Z5 en part de la réserve (Karvonen, comme Apple). */
export const RESERVE_ZONES = [0.5, 0.6, 0.7, 0.8, 0.9] as const;
/** Bornes basses de Z2 à Z5 en part de la FCseuil (Friel, course à pied ; 5a–5c réunies). */
export const FRIEL_ZONES = [0.85, 0.9, 0.95, 1.0] as const;
/** Répartition de Seiler : au moins 80 % du temps de course en facile (sous les zones, Z1, Z2) sur 4 semaines. */
export const EASY_SHARE_MIN = 0.8;

// ─── § 3.1 Préparation des séries ───

/** Plage plausible d'une FC mesurée. */
export const HR_VALID = { min: 35, max: 230 };
/** Interpolation à 1 Hz entre deux mesures séparées de 10 s au plus ; au-delà, trou. */
export const RESAMPLE_MAX_GAP_S = 10;
/** Pic retiré : saut de plus de 25 bpm (en 5 s ou moins) par rapport à la médiane des 30 s précédentes. */
export const SPIKE_BPM = 25;
export const SPIKE_WINDOW_S = 30;
/** Verrouillage sur la cadence : |FC − cadence| ≤ 3 sur au moins 30 s. */
export const CADENCE_LOCK_BPM = 3;
export const CADENCE_LOCK_MIN_S = 30;
/** Plus de 20 % de la durée retirée : « FC douteuse » (exclue des tendances et de la FCmax). */
export const DOUBTFUL_SHARE = 0.2;
/** La première minute est exclue des analyses de FC. */
export const HR_SKIP_FIRST_S = 60;
/** Course si vitesse ≥ 2,0 m/s ; arrêt sous 0,5 m/s ; marche entre les deux. */
export const RUN_SPEED_MS = 2.0;
export const STOP_SPEED_MS = 0.5;

// ─── § 2 Charge et forme ───

/** TRIMP de Banister : a × e^(b × x). Sexe non renseigné : la moyenne (choix de Mijote). */
export const TRIMP_COEF = { m: { a: 0.64, b: 1.92 }, f: { a: 0.86, b: 1.67 }, x: { a: 0.75, b: 1.795 } } as const;
/** 100 points = 1 h à la FCseuil. */
export const LOAD_PER_THRESHOLD_HOUR = 100;
/** Série de FC valide sur au moins 80 % de la durée : calcul exact. */
export const SERIES_MIN_COVERAGE = 0.8;
/** Effort perçu 1–10 → x (choix de Mijote, ACSM et Foster). */
export const EFFORT_X = [0.4, 0.5, 0.6, 0.67, 0.73, 0.78, 0.83, 0.88, 0.93, 0.97] as const;
/** Allure → FC : au moins 5 courses avec FC dans les 90 jours. */
export const PACE_FIT_MIN_RUNS = 5;
export const PACE_FIT_DAYS = 90;
/** x par défaut selon le type de séance. */
export const DEFAULT_X: Record<string, number> = {
  marche: 0.35,
  marche_course: 0.55,
  footing: 0.62,
  sortie_longue: 0.62,
  fartlek: 0.7,
  cotes: 0.72,
  tempo: 0.78,
  natation: 0.6,
  kettlebell: 0.55,
  renfo: 0.55,
  velo: 0.6,
  autre: 0.5,
};

/** Condition et fatigue : moyennes exponentielles sur 42 et 7 jours. */
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
/** Fraîcheur en % : affichée si la condition de la veille vaut au moins 5. */
export const TSB_PCT_MIN_CTL = 5;
/** Bandes de fraîcheur (%), d'intervals.icu. */
export const TSB_BANDS = { transition: 20, fresh: 5, neutral: -10, risk: -30 } as const;
/** ACWR découplé : 7 jours ÷ moyenne hebdomadaire des jours 8 à 35 ; bande grise affichée. */
export const ACWR_BAND = [0.8, 1.3] as const;

/** § 2.6 La sortie la plus longue des 30 jours : au plus × 1,10 ; une seule sortie « record » par 7 jours. */
export const LONGEST_WINDOW_DAYS = 30;
export const LONGEST_RATIO = 1.1;
export const LONGEST_RATIO_MID = 1.3;
export const LONGEST_RATIO_BIG = 2.0;
export const RECORD_EVERY_DAYS = 7;

/** § 2.7 Volume de la semaine au-delà de 1,30 × la moyenne des 2 précédentes : alerte. Monotonie > 2. */
export const WEEK_SPIKE_RATIO = 1.3;
export const MONOTONY_MAX = 2;

// ─── § 3.3 – 3.6 Analyse d'une sortie ───

/** Minetti 2002 : coût de la course en pente (J/kg/m), g en fraction. */
export const MINETTI = [155.4, -30.4, -43.3, 46.3, 19.5, 3.6] as const;
export const GRADE_MAX = 0.2;
/** Choix de Mijote : en descente, le facteur ne descend pas sous 0,80. */
export const GRADE_FACTOR_MIN = 0.8;
/** Sans au moins 10 m de dénivelé par km en tout, allure ajustée = allure. */
export const GRADE_MIN_ELEV_PER_KM = 10;
/** Tronçon d'au moins 100 m pour une pente. */
export const GRADE_MIN_SEGMENT_M = 100;

/** Section stable : sans les 10 premières minutes, au moins 30 min (20 pour la VO2max effective). */
export const STABLE_SKIP_S = 600;
export const DECOUPLING_MIN_S = 1800;
export const VO2_MIN_S = 1200;
export const DECOUPLING_RUN_SHARE = 0.95;
export const DECOUPLING_EASY_SHARE = 0.9;
export const DECOUPLING_SPEED_CV = 0.15;
export const DECOUPLING_HR_COVERAGE = 0.9;
/** Lecture du découplage (%). */
export const DECOUPLING_BANDS = { artefact: -2, good: 5, fair: 8 } as const;
/** Chaleur : ≥ 25 °C (exclue des tendances et des critères de passage, pas de qualité). */
export const HEAT_C = 25;
/** Au-delà de 30 °C, la natation plutôt que la course (§ 5). */
export const HOT_C = 30;
/** VO2max effective : x̄ ≥ 0,50 (§ 3.6). */
export const VO2_MIN_X = 0.5;

// ─── § 3.8 Tendances ───

/** Allure en Z2 : secondes de course à ±3 bpm du milieu de Z2, après 10 min, au moins 5 min. */
export const Z2_PACE_BPM = 3;
export const Z2_PACE_MIN_S = 300;
/** Médiane glissante des tendances : 6 semaines. */
export const TREND_WEEKS = 6;
/** Régularité : semaines avec au moins 2 sorties sur les 8 dernières. */
export const REGULAR_WEEKS = 8;
export const REGULAR_MIN_RUNS = 2;

// ─── § 4.8 Signaux du matin ───

/** Bande de référence : 60 jours, au moins 20 mesures ; moyenne 7 jours avec au moins 4 mesures. */
export const BAND_DAYS = 60;
export const BAND_MIN_SAMPLES = 20;
export const SIGNAL_DAYS = 7;
export const SIGNAL_MIN_SAMPLES = 4;
/** Plus petit changement utile : 0,5 écart-type. */
export const SWC_SD = 0.5;
/** FC au repos : moyenne 7 j ≥ référence + 5, ou 2 matins de suite ≥ référence + 7. */
export const REST_HIGH_MEAN = 5;
export const REST_HIGH_TWO_DAYS = 7;
/** Sommeil court : moins de 6 h deux nuits de suite. */
export const SHORT_SLEEP_MIN = 360;

// ─── § 4 Le plan ───

/** § 4.2 Point de départ, selon les jours d'arrêt. */
export const STOP_CONTINUE_DAYS = 7;
export const STOP_BACKOFF_DAYS = 28;
export const STOP_PHASE1_DAYS = 56;
/** Reculer après 8 à 28 jours : volume × 0,75, sortie longue × 0,80. */
export const BACKOFF_VOLUME = 0.75;
export const BACKOFF_LONG = 0.8;
/** Capacité : la plus longue course continue des 8 semaines avant l'arrêt, sorties sur 12 semaines. */
export const CAPACITY_WEEKS = 8;
export const CAPACITY_COUNT_WEEKS = 12;
export const CAPACITY_CONTINUOUS_MIN = 30;
export const CAPACITY_MIN_RUNS = 8;

/** § 4.3 Phase 0 : marche-course en 8 niveaux (course, marche, répétitions ; secondes). */
export const WALK_RUN_LEVELS = [
  { level: 1, run: 60, walk: 90, reps: 8 },
  { level: 2, run: 120, walk: 60, reps: 6 },
  { level: 3, run: 180, walk: 60, reps: 5 },
  { level: 4, run: 300, walk: 60, reps: 4 },
  { level: 5, run: 480, walk: 60, reps: 3 },
  { level: 6, run: 720, walk: 60, reps: 2 },
  { level: 7, run: 1200, walk: 0, reps: 1 },
  // 25 min la première fois, 30 ensuite.
  { level: 8, run: 1500, walk: 0, reps: 1 },
] as const;
export const WALK_RUN_LEVEL8_NEXT_S = 1800;
export const WALK_RUN_WARMUP_S = 300;
/** Monter : effort ≤ 4 et douleur ≤ 2 ; sauter : effort ≤ 3 ; rester : 5–6 ; redescendre : ≥ 7 ou douleur 3–4. */
export const P0_UP_EFFORT = 4;
export const P0_SKIP_EFFORT = 3;
export const P0_DOWN_EFFORT = 7;
export const P0_PAIN_OK = 2;

/** § 4.4 Phase 1 : 25 min par sortie la première semaine, sortie longue ≤ 30 min. */
export const P1_START_PER_RUN = 25;
export const P1_START_LONG = 30;
/** Progression : + 10 % visé, + 20 % au plus de la moyenne des 2 semaines réalisées. */
export const PROGRESS_TARGET = 1.1;
export const PROGRESS_MAX = 1.2;
/** Sortie longue : + 5 min par semaine en phase 1, + 10 min toutes les 2 semaines en phase 2. */
export const P1_LONG_STEP = 5;
export const P2_LONG_STEP = 10;
/** Part de la sortie longue dans le volume selon le nombre de sorties. */
export const LONG_SHARE: Record<number, number> = { 1: 1, 2: 0.55, 3: 0.4, 4: 0.35, 5: 0.3 };
/** Footings bornés entre 20 et 50 min ; en dessous de 20, une sortie de moins. */
export const EASY_MIN = 20;
export const EASY_MAX = 50;
/** Lignes droites dès la 3e semaine de phase 1 : 4 × 20 s. */
export const STRIDES_FROM_WEEK = 3;
/** Sortie longue plafonnée : 60 min en phase 1 ; 90 en phase 2 (120 pour « sortie longue ») ; 150 au plus. */
export const LONG_CAP = { p1: 60, p2: 90, p2Long: 120, p3: 150 } as const;
/** Volume plafonné à 4 h par semaine en reprise (phases 1–2). */
export const WEEK_CAP_MIN = 240;

/** Passage en phase 2 (§ 4.4). */
export const P2_MIN_WEEKS = 4;
export const P2_REGULAR_WEEKS = 3;
export const P2_DONE_SHARE = 0.8;
export const P2_LONG_MIN = 50;
export const P2_LONG_EFFORT = 4;
export const P2_PAIN_DAYS = 14;
export const P2_DECOUPLING_MAX = 8;
/** Phase 2 : qualité dès la 3e semaine ; test aérobie toutes les 5 semaines (4 à 6). */
export const P2_QUALITY_FROM_WEEK = 3;
export const AEROBIC_TEST_EVERY = 5;
/** Passage en phase 3 (§ 4.5). */
export const P3_MIN_WEEKS = 6;
export const P3_LONG_MIN = 75;
export const P3_DECOUPLING_MAX = 5;
export const P3_PAIN_DAYS = 21;

/** § 4.8 Adaptation. */
export const EFFORT_HIGH = 6;
export const EFFORT_OVER_PLAN = 2;
export const NO_QUALITY_DAYS = 7;
export const CUT_SHORT = 0.7;
export const HR_HIGH_SHARE = 0.3;
export const HR_HIGH_RUNS = 3;
export const PAIN_WATCH = 3;
export const PAIN_STOP = 5;
export const PAIN_REPEAT = 3;
export const PAIN_REPEAT_DAYS = 14;
export const PAIN_LASTS_DAYS = 7;
export const PAIN_AFTER_DAYS = 7;
export const SICK_REST_DAYS = 2;

/** § 4.9 Décharge : 1 semaine sur 4, volume × 0,70, sortie longue × 0,80. */
export const DELOAD_EVERY = 4;
export const DELOAD_VOLUME = 0.7;
export const DELOAD_LONG = 0.8;

/** § 4.10 Bornes d'une séance. */
export const SESSION_BOUNDS = {
  totalMin: 15,
  totalMax: 180,
  workMinS: 10,
  workMaxS: 90 * 60,
  recoveryMinS: 30,
  recoveryMaxS: 10 * 60,
  edgeMinS: 3 * 60,
  edgeMaxS: 20 * 60,
  iterationsMax: 30,
} as const;
/** Plage d'alerte FC : jamais moins de 8 bpm ; le footing va du bas de Z1 + 5 au haut de Z2. */
export const ALERT_MIN_WIDTH = 8;
export const ALERT_EASY_LOW_OFFSET = 5;

/** § 4.11 Placement : au moins 3 h entre une course et une séance de kettlebell le même jour. */
export const SAME_DAY_GAP_H = 3;
/** Horizon du plan et des propositions (8 semaines), séances envoyées à la montre (J à J+7). */
export const PLAN_HORIZON_DAYS = 56;
export const WATCH_DAYS = 7;
/** Une séance programmée sans heure : 7 h 00 (contrat de l'app). */
export const WATCH_DEFAULT_TIME = "07:00";
