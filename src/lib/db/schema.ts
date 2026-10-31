// Schéma de référence : docs/schema.md. Ids en texte, dates ISO 8601 UTC,
// quantités en grammes (1 ml = 1 g sauf indication), prix en euros.
import { sql } from "drizzle-orm";
import type { IngredientYield } from "@/lib/nutrition/compute";
import type { Program } from "@/lib/training/program";
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

// ─── 1. Personnes, préférences, équipement ───

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  portionUnits: integer("portion_units").notNull(),
  notes: text("notes"),
  rank: integer("rank").notNull().default(0), // ordre dans le foyer (mise en route)
  // Santé (migration 0012) : de quoi estimer la dépense de départ et fixer les cibles.
  sex: text("sex", { enum: ["m", "f"] }),
  birthDate: text("birth_date"), // AAAA-MM-JJ
  heightCm: real("height_cm"),
  activity: text("activity", { enum: ["sedentary", "light", "moderate", "active", "very_active"] }),
  goal: text("goal", { enum: ["lose", "maintain", "gain", "recomp"] }),
  ratePct: real("rate_pct"), // % du poids par semaine, négatif pour perdre
  proteinGPerKg: real("protein_g_per_kg"),
  proteinG: real("protein_g"), // cible fixe en grammes, prime sur g/kg
  // Objectifs (migration 0016) : posés depuis le profil ou proposés par le coach puis vérifiés en code.
  targetWeightKg: real("target_weight_kg"),
  targetDate: text("target_date"), // AAAA-MM-JJ, souhaitée ; l'échéance réaliste se calcule du rythme
  sportPlan: json<{ kind: string; perWeek: number; minutes: number }[]>("sport_plan"),
  constraints: text("constraints"), // ce que la personne peut faire : matériel, temps, douleurs, goûts
  // Portions (migration 0020) : ce que la personne mange par jour hors des repas du batch
  // (petit-déjeuner, en-cas), pour tirer la part d'un repas de sa cible du jour ; et la date
  // à laquelle elle a fini sa mise en route (écran /sante/demarrer).
  outsideKcal: real("outside_kcal"),
  outsideProteinG: real("outside_protein_g"),
  setupDoneAt: text("setup_done_at"),
  // Repère fixe d'un repas (kcal et protéines), choisi par la personne : il sert tant que la dépense
  // n'est pas mesurée par Santé (plus juste qu'une formule quand on connaît déjà ses chiffres).
  fixedMealRef: json<{ kcalMin: number; kcalMax: number; proteinMin: number; proteinMax: number }>("fixed_meal_ref"),
});

export const preferences = sqliteTable("preferences", {
  id: text("id").primaryKey(),
  personId: text("person_id").references(() => people.id),
  kind: text("kind", { enum: ["like", "dislike", "avoid_task", "rule"] }).notNull(),
  text: text("text").notNull(),
  tags: json<string[]>("tags").notNull().default(sql`'[]'`),
});

export const equipment = sqliteTable("equipment", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["hob", "oven", "pan", "pot", "dish", "appliance", "utensil"] }).notNull(),
  name: text("name").notNull(),
  dimsJson: json<Record<string, number | string>>("dims_json"),
  capacityL: real("capacity_l"),
  maxBatchG: integer("max_batch_g"),
  count: integer("count").notNull().default(1),
  notes: text("notes"),
  // false = pas dans cette cuisine : la ligne existe pour les recettes qui la citent (src/lib/kitchen).
  owned: integer("owned", { mode: "boolean" }).notNull().default(true),
});

export const equipmentFit = sqliteTable(
  "equipment_fit",
  {
    equipmentId: text("equipment_id").notNull().references(() => equipment.id),
    hobId: text("hob_id").notNull().references(() => equipment.id),
    // false = possible mais pas idéal (ex. Poêle sur le foyer moyen)
    preferred: integer("preferred", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.equipmentId, t.hobId] })]
);

// ─── 2. Recettes, notes, planning, sessions ───

export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  servingsUnits: integer("servings_units").notNull(),
  tags: json<string[]>("tags").notNull().default(sql`'[]'`),
  fridgeDays: integer("fridge_days"),
  freezerOk: integer("freezer_ok", { mode: "boolean" }).notNull().default(false),
  kcalUnit: real("kcal_unit"),
  proteinUnit: real("protein_unit"),
  // Macros par unité, calculées depuis les ingrédients (src/lib/nutrition), migration 0002
  carbsUnit: real("carbs_unit"),
  fatUnit: real("fat_unit"),
  fiberUnit: real("fiber_unit"),
  nutritionCoverage: real("nutrition_coverage"), // 0 à 1 : part des ingrédients pris en compte
  fixtureHash: text("fixture_hash"), // empreinte du fichier src/seed/recipes importé (migration 0005)
  status: text("status", { enum: ["liked", "to_try", "archived"] }).notNull().default("to_try"),
  source: text("source"),
  // Écart au schéma : conseils transverses (Poêle, conservation) en markdown court.
  tips: text("tips"),
  // Variante : la recette d'origine (toujours la racine, jamais une variante), migration 0011.
  parentId: text("parent_id").references((): AnySQLiteColumn => recipes.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const recipeIngredients = sqliteTable(
  "recipe_ingredients",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    lineRaw: text("line_raw").notNull(), // envoyée telle quelle à chronocatalog /resolve
    item: text("item").notNull(),
    grams: real("grams"),
    units: real("units"), // œufs, gousses… quand le poids n'a pas de sens
    group: text("group"), // bol (lettre) de la prep
    optional: integer("optional", { mode: "boolean" }).notNull().default(false),
    pantry: integer("pantry", { mode: "boolean" }).notNull().default(false), // placard, à vérifier chez soi
    side: integer("side", { mode: "boolean" }).notNull().default(false), // garniture cuite à part (riz, semoule), migration 0003
    foodId: text("food_id"), // table nutritionnelle (src/lib/nutrition/foods.ts)
    // Rendement : part du paquet utilisée, parure retirée, gras resté dans la poêle (migration 0006)
    yield: json<IngredientYield>("yield"),
  },
  (t) => [index("idx_recipe_ingredients_recipe").on(t.recipeId)]
);

export const recipeSteps = sqliteTable(
  "recipe_steps",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    kind: text("kind", { enum: ["prep", "sear", "braise", "boil", "bake", "rest", "cool"] }).notNull(),
    text: text("text").notNull(),
    durationMin: real("duration_min"),
    activeMin: real("active_min"),
    equipmentKind: text("equipment_kind", { enum: ["hob", "oven", "pan", "pot", "dish", "appliance", "utensil"] }),
    equipmentId: text("equipment_id").references(() => equipment.id),
    equipmentAlt: json<string[]>("equipment_alt"), // récipients de rechange (le planificateur choisit)
    hobLevel: integer("hob_level"),
    ovenTemp: integer("oven_temp"),
    bowlRefs: json<string[]>("bowl_refs").notNull().default(sql`'[]'`),
    cue: text("cue"), // signe visuel ou sonore qui dit que c'est prêt
    phases: json<{ text: string; min: number; hobLevel?: number | null; batch?: number | null; wait?: boolean | null }[]>("phases"), // sous-étapes chronométrées
  },
  (t) => [index("idx_recipe_steps_recipe").on(t.recipeId)]
);

export const recipeNotes = sqliteTable(
  "recipe_notes",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
    personId: text("person_id").references(() => people.id),
    category: text("category", {
      enum: ["taste", "prep", "painful_ingredient", "storage", "reheat", "other"],
    }).notNull(),
    text: text("text").notNull(),
    rating: integer("rating"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("idx_recipe_notes_recipe").on(t.recipeId)]
);

export const weekPlans = sqliteTable("week_plans", {
  id: text("id").primaryKey(),
  // Premier jour de la période (un lundi pour une semaine classique, n'importe quel jour sinon).
  weekStart: text("week_start").notNull().unique(),
  notes: text("notes"),
  // Migration 0002 : nombre de jours de la période (7 = une semaine, 14 au plus, src/lib/week/period.ts).
  days: integer("days").notNull().default(7),
});

export const mealSlots = sqliteTable(
  "meal_slots",
  {
    id: text("id").primaryKey(),
    weekPlanId: text("week_plan_id").notNull().references(() => weekPlans.id, { onDelete: "cascade" }),
    day: integer("day").notNull(), // 0 = premier jour de la période (week_plans.week_start)
    meal: text("meal", { enum: ["lunch", "dinner"] }).notNull(),
    personId: text("person_id").notNull().references(() => people.id),
    place: text("place", { enum: ["home", "office", "away"] }).notNull(),
    recipeId: text("recipe_id").references(() => recipes.id),
    // Migration 0020 : unités servies à ce repas, tirées de la cible de la personne et des
    // macros de la recette (src/lib/eaters). NULL = sa part de base (people.portion_units).
    units: real("units"),
  },
  (t) => [uniqueIndex("uq_meal_slot").on(t.weekPlanId, t.day, t.meal, t.personId)]
);

// Migration 0009 (semaine2) : recettes retenues pour la semaine, avec leur multiplicateur
// d'unités cuites (factor × servings_units) et les grammes ajoutés à un ingrédient pour
// finir un paquet entamé (extras : recipe_ingredient_id → grammes en plus, pour toute la cuisson).
export const weekRecipes = sqliteTable(
  "week_recipes",
  {
    id: text("id").primaryKey(),
    weekPlanId: text("week_plan_id").notNull().references(() => weekPlans.id, { onDelete: "cascade" }),
    recipeId: text("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
    factor: real("factor").notNull().default(1),
    extras: json<Record<string, number>>("extras").notNull().default(sql`'{}'`),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_week_recipe").on(t.weekPlanId, t.recipeId)]
);

export const cookSessions = sqliteTable("cook_sessions", {
  id: text("id").primaryKey(),
  weekPlanId: text("week_plan_id").references(() => weekPlans.id),
  startedAt: text("started_at"),
  endedAt: text("ended_at"),
  planJson: json<unknown>("plan_json"),
  status: text("status", { enum: ["planned", "prep", "fridge", "cooking", "done", "abandoned"] }).notNull().default("planned"),
  // Migration 0006 : mode de la session (seul, à deux, prep la veille). Le plan le porte aussi.
  mode: text("mode", { enum: ["solo", "duo", "veille"] }).notNull().default("solo"),
  // Migration 0003 : session créée depuis une liste de courses validée (ingrédients commandés).
  shoppingListId: text("shopping_list_id").references((): AnySQLiteColumn => shoppingLists.id),
  // Migration 0016 : session test (pour montrer l'appli) : hors bandeau si une vraie tourne, durées non apprises.
  test: integer("test", { mode: "boolean" }).notNull().default(false),
});

export const cookEvents = sqliteTable(
  "cook_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => cookSessions.id, { onDelete: "cascade" }),
    at: text("at").notNull().default(now),
    kind: text("kind", {
      enum: ["step_start", "step_done", "bowl_ready", "timer_start", "timer_done", "timer_pause", "timer_resume", "note"],
    }).notNull(),
    ref: text("ref"),
    payloadJson: json<unknown>("payload_json"),
  },
  (t) => [index("idx_cook_events_session").on(t.sessionId, t.at)]
);

// Migration 0008 : durées réelles mesurées dans le journal d'une session terminée
// (src/lib/session/durations.ts). Réécrites quand la session repasse « terminée ».
export const durationSamples = sqliteTable(
  "duration_samples",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull().references(() => cookSessions.id, { onDelete: "cascade" }),
    at: text("at").notNull(),
    kind: text("kind", { enum: ["gesture", "weigh", "step"] }).notNull(),
    key: text("key").notNull(), // cut:oignon, other:<slug>-2, weigh, step:<slug>#4
    ref: text("ref").notNull(), // tâche, bol ou étape du plan
    label: text("label").notNull(),
    grams: real("grams"),
    units: real("units"),
    estMin: real("est_min").notNull(), // référence (avant correction)
    plannedMin: real("planned_min").notNull(),
    realMin: real("real_min").notNull(),
    weight: real("weight").notNull().default(1), // < 1 : part d'un bol coché
    via: text("via"),
  },
  (t) => [index("idx_duration_samples_key").on(t.key), index("idx_duration_samples_session").on(t.sessionId)]
);

export const timers = sqliteTable("timers", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => cookSessions.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  stepRef: text("step_ref"),
  endsAt: text("ends_at").notNull(),
  doneAt: text("done_at"),
});

// Migration 0003 : les boîtes du frigo et du congélateur, rangées en fin de session (src/lib/boxes).
// Grammes et macros figés au rangement ; une boîte mangée garde la ligne du journal qu'elle a écrite.
export const mealBoxes = sqliteTable(
  "meal_boxes",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => cookSessions.id, { onDelete: "set null" }),
    recipeId: text("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    name: text("name").notNull(), // nom de la recette au rangement
    personId: text("person_id").references(() => people.id, { onDelete: "set null" }), // pour qui ; null = n'importe qui
    grams: real("grams"), // plat, null si la marmite n'a pas été pesée
    sideGrams: real("side_grams"), // garniture à part (riz, semoule)
    sideLabel: text("side_label"),
    kcal: real("kcal"),
    proteinG: real("protein_g"),
    cookedOn: text("cooked_on").notNull(), // YYYY-MM-DD
    plannedFor: text("planned_for"), // repas prévu par la Semaine (YYYY-MM-DD), null = marge
    plannedMeal: text("planned_meal", { enum: ["lunch", "dinner"] }),
    place: text("place", { enum: ["fridge", "freezer"] }).notNull(),
    fridgeDays: integer("fridge_days").notNull(), // jours au frigo de la recette, au rangement
    frozenOn: text("frozen_on"),
    thawedOn: text("thawed_on"),
    status: text("status", { enum: ["stock", "eaten", "thrown"] }).notNull().default("stock"),
    closedAt: text("closed_at"),
    eatenBy: text("eaten_by").references(() => people.id, { onDelete: "set null" }),
    foodLogId: text("food_log_id"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("idx_meal_boxes_status").on(t.status, t.place), index("idx_meal_boxes_session").on(t.sessionId, t.recipeId)]
);

// ─── 3. Courses, achats, coûts ───

export const shoppingLists = sqliteTable("shopping_lists", {
  id: text("id").primaryKey(),
  weekPlanId: text("week_plan_id").references(() => weekPlans.id),
  createdAt: text("created_at").notNull().default(now),
  status: text("status", { enum: ["draft", "checked", "ordered", "paid"] }).notNull().default("draft"),
  title: text("title"),
  recipeSlugs: json<string[]>("recipe_slugs").notNull().default(sql`'[]'`),
  // Migration 0003 (couts) : progression de la création (les /resolve tournent en tâche de fond)
  // et date de validation de la commande.
  buildDone: integer("build_done"),
  buildTotal: integer("build_total"),
  buildError: text("build_error"),
  orderedAt: text("ordered_at"),
  // Migration 0009 (semaine2) : multiplicateur d'unités par recette (slug → facteur) et grammes
  // ajoutés pour finir un paquet (recipe_ingredient_id → grammes), tels qu'à la création.
  recipeScales: json<Record<string, number>>("recipe_scales").notNull().default(sql`'{}'`),
  recipeExtras: json<Record<string, number>>("recipe_extras").notNull().default(sql`'{}'`),
  // Migration 0016 : liste archivée (rangée sous « Archivées » sur /courses, restaurable).
  archivedAt: text("archived_at"),
  // Migration 0021 (drive) : envoi au vrai panier Chronodrive (tâche du worker de chronocatalog,
  // POST /api/v1/account/jobs) et relecture de la commande passée (prix réellement payés).
  driveJobId: text("drive_job_id"),
  driveStatus: text("drive_status", { enum: ["pending", "done", "failed"] }),
  driveAt: text("drive_at"),
  driveError: text("drive_error"),
  driveSummary: json<Record<string, number>>("drive_summary"),
  orderJobId: text("order_job_id"),
  orderStatus: text("order_status", { enum: ["pending", "done", "failed"] }),
  orderError: text("order_error"),
  chronoOrderId: text("chrono_order_id"),
  orderImportedAt: text("order_imported_at"),
});

export const shoppingItems = sqliteTable(
  "shopping_items",
  {
    id: text("id").primaryKey(),
    listId: text("list_id").notNull().references(() => shoppingLists.id, { onDelete: "cascade" }),
    item: text("item").notNull(),
    needG: real("need_g"),
    recipeIds: json<string[]>("recipe_ids").notNull().default(sql`'[]'`),
    chronoProductId: text("chrono_product_id"),
    packs: integer("packs"),
    unitPrice: real("unit_price"),
    checkedAt: text("checked_at"),
    availabilityJson: json<unknown>("availability_json"),
    state: text("state", { enum: ["ok", "warn", "ko"] }),
    aisle: text("aisle"),
    // Ajouts (migration 0001) : de quoi afficher et copier la ligne sans rappeler chronocatalog.
    line: text("line"), // ligne envoyée à /resolve
    productJson: json<unknown>("product_json"),
    alternativesJson: json<unknown[]>("alternatives_json"),
    warnings: json<string[]>("warnings").notNull().default(sql`'[]'`),
    totalPrice: real("total_price"),
    pantry: integer("pantry", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull().default(0),
    // Migration 0003 (couts) : coché « dans le panier », et suivi d'une vérification en direct.
    inCartAt: text("in_cart_at"),
    liveRequestId: text("live_request_id"),
    liveStatus: text("live_status"), // pending | done | failed | skipped | fresh
    liveAskedAt: text("live_asked_at"),
    // Migration 0010 (produits) : clé de l'ingrédient générique (ingredient_products.key) et scope
    // du réglage qui a servi (« all », ou le recipe_ingredient_id d'un réglage propre au plat).
    assocKey: text("assoc_key"),
    assocScope: text("assoc_scope"),
    // Migration 0021 (drive) : id Chronodrive (« P123 ») et ce que le panier en a dit
    // (added | already | partial | unavailable | failed | skipped), quantité réellement dans le panier.
    chronoId: text("chrono_id"),
    driveOutcome: text("drive_outcome"),
    driveQty: integer("drive_qty"),
  },
  (t) => [index("idx_shopping_items_list").on(t.listId)]
);

// Quelle ligne de recette chaque ligne de courses couvre (migration 0003). Garde le lien
// jusqu'à l'achat : la session de cuisine sait quel produit a été commandé pour quel ingrédient.
// recipe_ingredient_id passe à null si la recette est réimportée ; recipe_id et line_raw restent.
export const shoppingItemSources = sqliteTable(
  "shopping_item_sources",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => shoppingItems.id, { onDelete: "cascade" }),
    recipeIngredientId: text("recipe_ingredient_id").references(() => recipeIngredients.id, { onDelete: "set null" }),
    recipeId: text("recipe_id").notNull().references(() => recipes.id, { onDelete: "cascade" }),
    lineRaw: text("line_raw").notNull(),
    grams: real("grams"),
    units: real("units"),
  },
  (t) => [index("idx_item_sources_item").on(t.itemId), index("idx_item_sources_recipe").on(t.recipeId)]
);

export const purchases = sqliteTable("purchases", {
  id: text("id").primaryKey(),
  listId: text("list_id").references(() => shoppingLists.id),
  chronoProductId: text("chrono_product_id"),
  name: text("name").notNull(),
  boughtAt: text("bought_at").notNull(),
  packs: integer("packs").notNull().default(1),
  packG: real("pack_g"),
  pricePaid: real("price_paid").notNull(), // total payé pour la ligne (paquets × prix effectif)
  promo: integer("promo", { mode: "boolean" }).notNull().default(false),
  // Migration 0003 : la ligne de courses d'origine (et donc les recettes servies).
  shoppingItemId: text("shopping_item_id").references(() => shoppingItems.id, { onDelete: "set null" }),
  item: text("item"),
  // Migration 0021 : prix estimé à la validation, gardé quand la commande Chronodrive relue
  // donne le prix réellement payé (price_paid), et l'id de cette commande.
  priceEstimated: real("price_estimated"),
  chronoOrderId: text("chrono_order_id"),
});

export const pantryLots = sqliteTable("pantry_lots", {
  id: text("id").primaryKey(),
  purchaseId: text("purchase_id").references(() => purchases.id),
  item: text("item").notNull(),
  gramsLeft: real("grams_left").notNull(),
  valueLeft: real("value_left").notNull(),
  openedAt: text("opened_at"),
  status: text("status", { enum: ["ok", "used", "lost"] }).notNull().default("ok"),
  // Migration 0003 : taille et valeur d'origine (prix au gramme = value_initial / grams_initial),
  // et date de clôture (utilisé ou perdu). À la clôture, grams_left/value_left gardent ce qui restait.
  gramsInitial: real("grams_initial"),
  valueInitial: real("value_initial"),
  closedAt: text("closed_at"),
});

// Migration 0003 : session_id facultatif (« J'ai cuisiné » hors session), date de la cuisson
// (regroupe les lignes d'une même cuisson) et valeur figée au moment de la consommation.
export const cookUsages = sqliteTable(
  "cook_usages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => cookSessions.id),
    recipeId: text("recipe_id").notNull().references(() => recipes.id),
    lotId: text("lot_id").references(() => pantryLots.id),
    grams: real("grams").notNull(),
    cookedAt: text("cooked_at").notNull().default(now),
    value: real("value"),
    item: text("item"),
  },
  (t) => [index("idx_cook_usages_recipe").on(t.recipeId)]
);

export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull().default(now),
    screen: text("screen").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
    durationMs: integer("duration_ms"), // durée de l'appel, pour caler les chargements (migration 0011)
  },
  (t) => [index("idx_ai_calls_at").on(t.at), index("idx_ai_calls_screen").on(t.screen, t.at)]
);

// ─── 4. Produits du drive associés aux ingrédients (migration 0010) ───

// Association « aliment ↔ produit Chronodrive », au niveau de l'ingrédient générique :
// key = « type:<slug> » (type canonique chronocatalog de la ligne), à défaut « food:<id> »
// (table nutrition), à défaut « item:<nom> » (src/lib/products/keys.ts). scope = « all » : vaut
// pour toutes les recettes, présentes et futures (atelier compris) ; scope = un
// recipe_ingredient_id : réglage propre à cette ligne de recette, qui prime. Un refus
// (« ne correspond pas ») est toujours commun. product_json : la carte produit le jour du choix
// (repli quand /resolve ne la renvoie plus).
export const ingredientProducts = sqliteTable(
  "ingredient_products",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    scope: text("scope").notNull().default("all"),
    label: text("label").notNull(),
    foodId: text("food_id"),
    productId: text("product_id").notNull(),
    status: text("status", { enum: ["accepted", "refused"] }).notNull(),
    preferred: integer("preferred", { mode: "boolean" }).notNull().default(false),
    productJson: json<unknown>("product_json"),
    decidedAt: text("decided_at").notNull().default(now),
  },
  (t) => [uniqueIndex("uq_ingredient_product").on(t.key, t.scope, t.productId), index("idx_ingredient_products_key").on(t.key)]
);

// Proposition « Ajuster » en cours : une seule par recette (pas un historique). Effacée par
// « Effacer » ou « Garder cette version » (migration 0011).
export const adjustProposals = sqliteTable("adjust_proposals", {
  recipeId: text("recipe_id")
    .primaryKey()
    .references(() => recipes.id, { onDelete: "cascade" }),
  proposal: json<unknown>("proposal").notNull(), // Proposal de src/lib/atelier (brouillon + vérification)
  exchanges: json<unknown[]>("exchanges").notNull().default(sql`'[]'`), // demandes et réponses, dans l'ordre
  recipeUpdatedAt: text("recipe_updated_at").notNull(), // fiche à ce moment-là : si elle change, la proposition est périmée
  updatedAt: text("updated_at").notNull().default(now),
});

// ─── 5. Santé (migration 0012) ───
// Dates du jour en YYYY-MM-DD (heure de Paris). Le calcul (tendance, dépense, cibles) est
// dans src/lib/health/, ces tables ne gardent que les mesures et les décisions.

// Une ligne par pesée ; plusieurs le même jour possibles, la première du jour compte.
export const weighIns = sqliteTable(
  "weigh_ins",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    date: text("date").notNull(),
    measuredAt: text("measured_at").notNull(),
    kg: real("kg").notNull(),
    source: text("source", { enum: ["manual", "health", "import"] }).notNull().default("manual"),
    externalId: text("external_id"), // dédoublonnage des envois d'Apple Santé
  },
  (t) => [index("idx_weigh_ins_person_date").on(t.personId, t.date), uniqueIndex("uq_weigh_in_external").on(t.personId, t.externalId)]
);

export const waistMeasures = sqliteTable(
  "waist_measures",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    date: text("date").notNull(),
    cm: real("cm").notNull(),
  },
  (t) => [uniqueIndex("uq_waist_person_date").on(t.personId, t.date)]
);

// Ce que chacun a mangé. kcal et macros figés au moment du log (la fiche peut changer après).
export const foodLog = sqliteTable(
  "food_log",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    date: text("date").notNull(),
    meal: text("meal", { enum: ["breakfast", "lunch", "dinner", "snack"] }).notNull(),
    kind: text("kind", { enum: ["recipe", "template", "free"] }).notNull(),
    recipeId: text("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
    templateId: text("template_id"),
    units: real("units"), // parts de la recette (H = 5, J = 4 en temps normal)
    label: text("label").notNull(),
    kcal: real("kcal").notNull(),
    proteinG: real("protein_g").notNull().default(0),
    fatG: real("fat_g"),
    carbsG: real("carbs_g"),
    source: text("source", { enum: ["plan", "manual", "ai"] }).notNull().default("manual"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("idx_food_log_person_date").on(t.personId, t.date)]
);

// Habitudes hors batch (shaker du matin, petit-déjeuner…), cochées en un tap dans le journal.
// person_id nul = pour tout le monde. items : les aliments (src/lib/eaters/habits.ts) ; quand il y
// en a, kcal et macros en sont recalculés ; vides = une ancienne habitude aux chiffres saisis.
export const foodTemplates = sqliteTable("food_templates", {
  id: text("id").primaryKey(),
  personId: text("person_id").references(() => people.id),
  label: text("label").notNull(),
  meal: text("meal", { enum: ["breakfast", "lunch", "dinner", "snack"] }).notNull(),
  kcal: real("kcal").notNull(),
  proteinG: real("protein_g").notNull().default(0),
  fatG: real("fat_g"),
  carbsG: real("carbs_g"),
  weekdays: json<number[]>("weekdays").notNull().default(sql`'[]'`), // 0 = lundi ; jours où il est pris (proposé d'office, compté dans le hors batch)
  items: json<{ food: string; grams: number }[]>("items").notNull().default(sql`'[]'`),
  position: integer("position").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

// « Journée complète » : seules ces journées comptent dans le calcul de la dépense.
export const dayLogs = sqliteTable(
  "day_logs",
  {
    personId: text("person_id").notNull().references(() => people.id),
    date: text("date").notNull(),
    complete: integer("complete", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.personId, t.date] })]
);

// Bilan du lundi : la cible de la semaine et d'où elle vient.
export const weeklyTargets = sqliteTable(
  "weekly_targets",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    weekStart: text("week_start").notNull(),
    tdeeKcal: real("tdee_kcal").notNull(),
    kcalTarget: real("kcal_target").notNull(),
    proteinG: real("protein_g").notNull(),
    fatMinG: real("fat_min_g").notNull(),
    confidence: text("confidence", { enum: ["estimate", "holding", "adaptive"] }).notNull(),
    details: json<Record<string, unknown>>("details").notNull().default(sql`'{}'`),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("uq_weekly_target").on(t.personId, t.weekStart)]
);

// Ce qu'envoie Apple Santé (pas, énergie active, séances). Affiché, pas utilisé pour la cible.
export const healthSamples = sqliteTable(
  "health_samples",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    kind: text("kind", { enum: ["steps", "active_kcal", "workout"] }).notNull(),
    start: text("start").notNull(),
    end: text("end"),
    value: real("value").notNull(),
    unit: text("unit").notNull(),
    meta: json<Record<string, unknown>>("meta"),
    externalId: text("external_id").notNull(),
  },
  (t) => [uniqueIndex("uq_health_sample").on(t.personId, t.kind, t.externalId), index("idx_health_samples_person").on(t.personId, t.kind, t.start)]
);

// ─── 6. Entraînement (migration 0013) ───
// Carnet des séances guidées (séances A/B d'un programme). Le programme lui-même est dans
// src/lib/training/program.ts ; ici seulement ce qui a été fait.
export const workouts = sqliteTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    date: text("date").notNull(),
    ts: integer("ts").notNull(), // ms epoch de la fin de séance (ordre du carnet)
    type: text("type").notNull(), // "A", "B"
    minutes: integer("minutes"),
    note: text("note"),
    entries: json<{ ex: string; sets: number[]; level: number }[]>("entries").notNull(),
  },
  (t) => [index("idx_workouts_person").on(t.personId, t.ts)]
);

// Dessins d'aliments créés par l'IA pour les ingrédients sans dessin propre (src/lib/illus/ai.ts),
// filtrés par sanitizeIllu avant d'être gardés. Clé = nom de l'ingrédient normalisé (artKey).
export const foodArt = sqliteTable("food_art", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  svg: text("svg").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

// Programmes d'entraînement de chacun (src/lib/training/programs.ts) : un modèle copié, un programme
// composé par le générateur, ou créé par l'IA (exercices inventés et leurs figures compris). Le plus
// récent non archivé est le programme en cours de la personne.
export const trainingPrograms = sqliteTable(
  "training_programs",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    program: json<Program>("program").notNull(),
    source: text("source", { enum: ["modele", "generateur", "ia"] }).notNull(),
    request: json<unknown>("request"), // la demande d'origine (générateur, IA)
    createdAt: text("created_at").notNull().default(now),
    archivedAt: text("archived_at"),
  },
  (t) => [index("idx_training_programs_person").on(t.personId, t.createdAt)]
);

// Migration 0018 : la séance en cours, partagée entre les écrans (MacBook + téléphones). `state` = l'objet
// Live de src/lib/training/live.ts ; `version` monte à chaque écriture (le premier écran arrivé gagne).
export const trainingLive = sqliteTable(
  "training_live",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    state: json<unknown>("state").notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: integer("updated_at").notNull(), // ms epoch
    endedAt: integer("ended_at"), // ms epoch : enregistrée ou abandonnée
    workoutId: text("workout_id"),
  },
  (t) => [index("idx_training_live_person").on(t.personId, t.updatedAt)]
);

// ─── 7. Raccourci Apple Santé (migration 0014) ───
// Une clé par personne : le Raccourci l'envoie (X-Cuisine-Key), l'appli en déduit le profil. Les dates
// de synchro décident de la fenêtre demandée au téléphone (6 mois la première fois, le mois chaque semaine).
export const healthLinks = sqliteTable("health_links", {
  personId: text("person_id").primaryKey().references(() => people.id),
  key: text("key").notNull().unique(),
  createdAt: text("created_at").notNull().default(now),
  lastSyncAt: text("last_sync_at"),
  lastMonthAt: text("last_month_at"),
  lastHistoryAt: text("last_history_at"),
});

// Réglages saisis dans l'appli (ex. le jeton de service Cloudflare du Raccourci, recopié dans le code d'installation).
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

// ─── 8. Coach Santé (migration 0016) ───
// Conversation par personne sur les objectifs. Le coach (Sonnet, sortie structurée) répond et peut
// proposer des objectifs ; le code les vérifie (src/lib/health/goals.ts) avant qu'on les applique.
export const coachMessages = sqliteTable(
  "coach_messages",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull().references(() => people.id),
    role: text("role", { enum: ["user", "coach"] }).notNull(),
    text: text("text").notNull(),
    proposal: json<Record<string, unknown>>("proposal"), // objectifs proposés, déjà vérifiés
    notes: json<string[]>("notes"), // ce que la vérification a corrigé ou signale
    suggestions: json<string[]>("suggestions"), // réponses rapides proposées
    status: text("status", { enum: ["proposed", "applied", "dismissed"] }),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("idx_coach_person").on(t.personId, t.createdAt)]
);
