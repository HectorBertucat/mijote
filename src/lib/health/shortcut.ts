// Le Raccourci iOS « Santé → Mijote », écrit en code (pnpm shortcut:build) au lieu d'être construit à la
// main. Il ne contient aucun secret : au premier lancement il lit le code d'installation copié depuis
// /sante/apple (presse-papiers), le garde dans Raccourcis/mijote-sante.json, puis à chaque lancement :
//   1. demande à l'appli la fenêtre à relire (GET /api/sante/import → { mode, window }) ;
//   2. lit dans Santé les pesées, les pas par jour et les séances de cette fenêtre ;
//   3. les envoie en JSON (POST), et affiche la réponse en notification.
// Le fichier produit doit être signé sur un Mac (`shortcuts sign -m anyone`) pour s'installer sur l'iPhone.
import { createHash } from "crypto";

export const SHORTCUT_NAME = "Santé → Mijote";
export const CODE_FILE = "mijote-sante.json";

type Plist = string | number | boolean | Plist[] | { [k: string]: Plist };

// ---------- Plist XML ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function node(v: Plist, pad: string): string {
  if (typeof v === "string") return `${pad}<string>${esc(v)}</string>`;
  if (typeof v === "boolean") return `${pad}<${v}/>`;
  if (typeof v === "number") return Number.isInteger(v) ? `${pad}<integer>${v}</integer>` : `${pad}<real>${v}</real>`;
  if (Array.isArray(v)) return v.length ? `${pad}<array>\n${v.map((x) => node(x, pad + "\t")).join("\n")}\n${pad}</array>` : `${pad}<array/>`;
  const keys = Object.keys(v);
  if (!keys.length) return `${pad}<dict/>`;
  return `${pad}<dict>\n${keys.map((k) => `${pad}\t<key>${esc(k)}</key>\n${node(v[k], pad + "\t")}`).join("\n")}\n${pad}</dict>`;
}

export function toPlist(v: Plist) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${node(v, "")}\n</plist>\n`;
}

// ---------- Variables et textes ----------

type Ref = { [k: string]: Plist };

/** Identifiants stables (le même code donne le même fichier). */
function ids(seed: string) {
  let n = 0;
  return () => {
    const h = createHash("sha1").update(`${seed}:${n++}`).digest("hex").toUpperCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  };
}

const named = (name: string): Ref => ({ Type: "Variable", VariableName: name });
const attach = (r: Ref): Plist => ({ Value: r, WFSerializationType: "WFTextTokenAttachment" });

/** Texte avec des variables dedans (chaque variable prend la place d'un caractère U+FFFC). */
function text(...parts: (string | Ref)[]): Plist {
  let s = "";
  const at: { [k: string]: Plist } = {};
  for (const p of parts) {
    if (typeof p === "string") s += p;
    else {
      at[`{${s.length}, 1}`] = p;
      s += "￼";
    }
  }
  return { Value: Object.keys(at).length ? { string: s, attachmentsByRange: at } : { string: s }, WFSerializationType: "WFTextTokenString" };
}

function fields(items: [string, string | Ref][]): Plist {
  return {
    Value: { WFDictionaryFieldValueItems: items.map(([k, v]) => ({ WFItemType: 0, WFKey: text(k), WFValue: text(v) })) },
    WFSerializationType: "WFDictionaryFieldValue",
  };
}

// ---------- Le Raccourci ----------

/** Fenêtres demandées par l'appli (voir src/lib/health/link.ts). */
const MODES = [
  { mode: "history", days: 180 },
  { mode: "month", days: 35 },
  { mode: "week", days: 7 },
] as const;

export function buildShortcut() {
  const uuid = ids("mijote-sante-v3");
  const actions: Plist[] = [];
  const act = (id: string, params: Ref = {}, outName?: string): Ref | null => {
    const u = uuid();
    actions.push({ WFWorkflowActionIdentifier: `is.workflow.actions.${id}`, WFWorkflowActionParameters: { UUID: u, ...params } });
    return outName ? { Type: "ActionOutput", OutputUUID: u, OutputName: outName } : null;
  };
  const setVar = (name: string, r: Ref) => act("setvariable", { WFVariableName: name, WFInput: attach(r) });
  const addVar = (name: string, r: Ref) => act("appendvariable", { WFVariableName: name, WFInput: attach(r) });

  // Si / Sinon / Fin : un même GroupingIdentifier relie les trois actions.
  const when = (cond: Ref, body: () => void, otherwise?: () => void) => {
    const g = uuid();
    const conditions = { WFSerializationType: "WFContentPredicateTableTemplate", Value: { WFActionParameterFilterPrefix: 1, WFActionParameterFilterTemplates: [cond] } };
    act("conditional", { GroupingIdentifier: g, WFControlFlowMode: 0, WFConditions: conditions });
    body();
    if (otherwise) {
      act("conditional", { GroupingIdentifier: g, WFControlFlowMode: 1 });
      otherwise();
    }
    act("conditional", { GroupingIdentifier: g, WFControlFlowMode: 2 });
  };
  const each = (list: Ref, body: () => void) => {
    const g = uuid();
    act("repeat.each", { GroupingIdentifier: g, WFControlFlowMode: 0, WFInput: attach(list) });
    body();
    act("repeat.each", { GroupingIdentifier: g, WFControlFlowMode: 2 });
  };
  const empty = (r: Ref): Ref => ({ WFInput: { Type: "Variable", Variable: attach(r) }, WFCondition: 101 });
  const isText = (r: Ref, s: string, op = 4): Ref => ({ WFInput: { Type: "Variable", Variable: attach(r) }, WFCondition: op, WFConditionalActionString: s });

  const health = (type: string, days: number, perDay = false) =>
    act(
      "filter.health.quantity",
      {
        WFContentItemFilter: {
          WFSerializationType: "WFContentPredicateTableTemplate",
          Value: {
            WFActionParameterFilterPrefix: 1,
            WFContentPredicateBoundedDate: false,
            WFActionParameterFilterTemplates: [
              { Property: "Type", Operator: 4, Removable: false, Values: { Enumeration: { WFSerializationType: "WFStringSubstitutableState", Value: type } } },
              { Property: "Start Date", Operator: 1001, Removable: true, Values: { Unit: 16, Number: days } },
            ],
          },
        },
        WFContentItemSortProperty: "Start Date",
        WFContentItemSortOrder: "Oldest First",
        WFContentItemLimitEnabled: false,
        ...(perDay ? { WFHKSampleFilteringGroupBy: "Day", WFHKSampleFilteringFillMissing: false } : {}),
      },
      "Échantillons de santé"
    )!;
  const detail = (sample: Ref, property: string) => act("properties.health.quantity", { WFInput: attach(sample), WFContentItemPropertyName: property }, property)!;
  const iso = (date: Ref) => act("format.date", { WFDate: text(date), WFDateFormatStyle: "ISO 8601", WFISO8601IncludeTime: true }, "Date formatée")!;

  act("comment", { WFCommentActionText: `${SHORTCUT_NAME} : envoie pesées, pas et séances d'Apple Santé à l'appli Mijote. Le code d'installation (copié depuis Mijote › Santé › Apple Santé) est gardé dans Raccourcis/${CODE_FILE}. Pour changer de profil : supprime ce fichier et relance avec le nouveau code copié.` });

  // 1. Le code d'installation : fichier gardé, sinon presse-papiers.
  const file = act("documentpicker.open", { WFGetFilePath: text(CODE_FILE), WFFileErrorIfNotFound: false, WFShowFilePicker: false }, "Fichier")!;
  setVar("Code", file);
  when(empty(named("Code")), () => {
    const clip = act("getclipboard", {}, "Presse-papiers")!;
    when(
      isText(clip, "mijote-sante", 99),
      () => {
        // Le presse-papiers de Safari est du texte enrichi (RTF) : on garde le texte brut.
        const plain = act("detect.text", { WFInput: attach(clip) }, "Texte")!;
        const f = act("setitemname", { WFInput: attach(plain), WFName: text(CODE_FILE), WFDontIncludeFileExtension: true }, "Élément renommé")!;
        act("documentpicker.save", { WFInput: attach(f), WFAskWhereToSave: false, WFSaveFileOverwrite: true, WFFileDestinationPath: text(CODE_FILE) });
        setVar("Code", plain);
      },
      () => {
        act("alert", { WFAlertActionTitle: "Code manquant", WFAlertActionMessage: "Copie d'abord ton code depuis l'appli Mijote (Santé › Apple Santé › Copier le code), puis relance ce Raccourci.", WFAlertActionCancelButtonShown: false });
        act("exit");
      }
    );
  });
  const value = (dict: Ref, k: string) => act("getvalueforkey", { WFInput: attach(dict), WFDictionaryKey: k, WFGetDictionaryValueType: "Value" }, "Valeur du dictionnaire")!;
  // Texte brut d'abord (un fichier gardé par une version précédente peut être en RTF), puis dictionnaire.
  const codeText = act("detect.text", { WFInput: attach(named("Code")) }, "Texte")!;
  when(
    isText(codeText, "mijote-sante", 999),
    () => {
      act("alert", { WFAlertActionTitle: "Code illisible", WFAlertActionMessage: text(`Le code gardé dans Raccourcis/${CODE_FILE} n'est pas celui de l'appli. Supprime ce fichier dans l'app Fichiers, recopie le code depuis Mijote › Santé › Apple Santé, puis relance. Lu : `, codeText), WFAlertActionCancelButtonShown: false });
      act("exit");
    }
  );
  const cfg = act("detect.dictionary", { WFInput: attach(codeText) }, "Dictionnaire")!;
  const url = value(cfg, "url");
  const id = value(cfg, "id");
  const secret = value(cfg, "secret");
  const personKey = value(cfg, "key");
  const headers = (json: boolean) =>
    fields([
      ["CF-Access-Client-Id", id],
      ["CF-Access-Client-Secret", secret],
      ["X-Cuisine-Key", personKey],
      ...(json ? ([["Content-Type", "application/json"]] as [string, string][]) : []),
    ]);

  // 2. La fenêtre à relire.
  // Si Cloudflare Access ne reconnaît pas le jeton, il répond par sa page de connexion (HTML), pas par l'appli :
  // on lit la réponse en texte et on ne la convertit en dictionnaire que si c'est bien le JSON de l'appli.
  const answer = act("downloadurl", { WFURL: text(url), WFHTTPMethod: "GET", ShowHeaders: true, WFHTTPHeaders: headers(false) }, "Contenu de l'URL")!;
  const answerText = act("detect.text", { WFInput: attach(answer) }, "Texte")!;
  when(isText(answerText, `"mode"`, 999), () => {
    act("alert", {
      WFAlertActionTitle: "Cloudflare ou l'appli refuse",
      WFAlertActionMessage: text("Si ton appli est derrière Cloudflare Access : vérifie l'application sur ton-domaine/api/sante/import (règle Service Auth avec le jeton « Raccourci santé »), et le jeton collé dans l'appli. Réponse reçue : ", answerText),
      WFAlertActionCancelButtonShown: false,
    });
    act("exit");
  });
  const plan = act("detect.dictionary", { WFInput: attach(answerText) }, "Dictionnaire")!;
  setVar("Mode", value(plan, "mode"));
  setVar("Fenêtre", value(plan, "window"));

  // 3. Santé : une branche par fenêtre (le filtre de date de l'action n'accepte pas de variable).
  const read = (days: number) => {
    setVar("Poids", health("Weight", days));
    setVar("Pas", health("Steps", days, true));
    setVar("Séances", health("Workouts", days));
  };
  const [history, month, week] = MODES;
  when(
    isText(named("Mode"), history.mode),
    () => read(history.days),
    () => when(isText(named("Mode"), month.mode), () => read(month.days), () => read(week.days))
  );

  each(named("Poids"), () => {
    const item = named("Repeat Item");
    const at = iso(detail(item, "Start Date"));
    const v = detail(item, "Value");
    addVar("Pesées", act("dictionary", { WFItems: fields([["kg", v], ["at", at]]) }, "Dictionnaire")!);
  });
  each(named("Pas"), () => {
    const item = named("Repeat Item");
    const at = iso(detail(item, "Start Date"));
    const v = detail(item, "Value");
    addVar("Jours", act("dictionary", { WFItems: fields([["date", at], ["count", v]]) }, "Dictionnaire")!);
  });
  each(named("Séances"), () => {
    const item = named("Repeat Item");
    const start = iso(detail(item, "Start Date"));
    const end = iso(detail(item, "End Date"));
    const type = detail(item, "Type");
    addVar("Sport", act("dictionary", { WFItems: fields([["type", type], ["name", item], ["start", start], ["end", end]]) }, "Dictionnaire")!);
  });

  // 4. Envoi : un texte JSON (les dictionnaires deviennent du JSON quand on les assemble en texte).
  const join = (name: string) => act("text.combine", { text: attach(named(name)), WFTextSeparator: "Custom", WFTextCustomSeparator: "," }, "Texte combiné")!;
  const w = join("Pesées");
  const s = join("Jours");
  const t = join("Sport");
  const body = act("gettext", { WFTextActionText: text(`{"window": `, named("Fenêtre"), `, "weights": [`, w, `], "steps": [`, s, `], "workouts": [`, t, `]}`) }, "Texte")!;
  const res = act("downloadurl", { WFURL: text(url), WFHTTPMethod: "POST", ShowHeaders: true, WFHTTPHeaders: headers(true), WFHTTPBodyType: "File", WFRequestVariable: attach(body) }, "Contenu de l'URL")!;
  act("notification", { WFNotificationActionTitle: SHORTCUT_NAME, WFNotificationActionBody: text(res), WFNotificationActionSound: false });

  return {
    WFWorkflowName: SHORTCUT_NAME,
    WFWorkflowClientVersion: "2607.0.2",
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: "900",
    WFWorkflowIcon: { WFWorkflowIconStartColor: 4282601983, WFWorkflowIconGlyphNumber: 59511 },
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: [],
    WFQuickActionSurfaces: [],
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowHasOutputFallback: false,
    WFWorkflowActions: actions,
  } satisfies Plist;
}
