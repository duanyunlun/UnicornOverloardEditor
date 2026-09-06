import { useEffect, useMemo, useRef, useState } from "react";
import {configureTranslations, setLanguage, t, LANGUAGES} from '../../i18n.js';
import "./App.css";
import {
  SearchableCombobox,
  groupBySymbolPrefix,
  type ComboboxOption,
} from "./SearchableCombobox";
import {
  isClassMarker,
  resolveMarkerHint,
  tacticsForClass,
  tacticsForPreset,
  type ClassLine,
  type ItemSkill,
  type ResolveLine,
} from "./tacticsResolve";
import { validateEdits } from "./exportValidation.ts";
import { prepareMissionPatch } from "./missionPatch.ts";
import { overlayPchtxtOnCatalog } from "./resolvePchtxt";
import { unzipTextFiles, zipStore } from "./zipStore";
import { acceptsParentMessage, isTarget, isView, TARGETS, type Target, type FrameView } from "./frameApi";

type Gear = {
  item_id: number;
  rom_item_id?: number;
  item_symbol: string;
  item_name?: string;
  source?: string;
  edited?: boolean;
  from_equiptype?: boolean;
  equiptype_param_name?: string;
  equiptype_symbol?: string;
  unit_paramset_name?: string;
  chara_param_override?: number;
  equiptype_level?: number;
};
type Line = {
  action: number;
  slot?: number;
  if0: number;
  if1: number;
  if0_symbol?: string;
  if1_symbol?: string;
  skill_id?: number;
  skill_symbol?: string;
  skill_name?: string;
  learn_level?: number;
  from_class_default?: boolean;
  from_item?: boolean;
  from_equipaiset_preset?: boolean;
  ref_kind?: string;
  locked?: boolean;
  marker_id?: number;
  marker_label?: string;
  resolved_skill_id?: number;
  resolved_skill_name?: string;
  resolved_skill_symbol?: string;
  resolved_ambiguous?: boolean;
};
type Slot = {
  slot: number;
  charaset_id: number;
  charaset_symbol: string;
  chara_name?: string;
  class_id: number;
  class_symbol: string;
  flags: number;
  equipaiset_id: number;
  equipaiset_symbol: string;
  gear: Gear[];
  tactics_lines: Line[];
  equip_param?: number;
  equip_param_name?: string;
  chara_param_override?: number;
};
type Squad = {
  unitset_id: number;
  unitset_symbol: string;
  side: string;
  role?: string;
  paramset_name?: string;
  exptype_name?: string;
  join_source?: string;
  slots: Slot[];
};
type Mission = {
  quest_id: number;
  quest_symbol: string;
  stage_name: string;
  region: string;
  enemy_level: string;
  squads: Squad[];
};
type CatalogEntry = { id: number; symbol: string; name?: string; comment?: string; kind?: string };
type ClassTactics = {
  class_id: number;
  class_symbol: string;
  lines: Line[];
};
type PresetRef = {
  quest_id?: number;
  quest_symbol: string;
  stage_name: string;
  context?: string;
  unitset_id: number;
  unitset_symbol: string;
  squad_name: string;
  role?: string;
  slot: number;
  unit?: string;
  charaset_id?: number;
  charaset_symbol?: string;
  class_id?: number;
  class_symbol?: string;
  resolution?: {
    joined_mission?: boolean;
    enemy_level?: number | null;
    level_source?: string;
    assumed_level?: number | null;
    equip_param_name?: string;
    gear?: Gear[];
  };
  resolved_tactics?: Line[];
};
type EquipAiPreset = {
  id: number;
  symbol: string;
  usage: number;
  skill_ai_id: number;
  count_a: number;
  count_b: number;
  lines: Line[];
  references?: PresetRef[];
};
type CharasetCatalogEntry = {
  id: number;
  symbol: string;
  name?: string;
  class_id: number;
  class_symbol: string;
  class_name?: string;
  gear: Gear[];
};

type EquiptypeItem = {
  id: number;
  symbol: string;
  item_col0_id: number;
  item_col0?: string;
  item_col1_id: number;
  item_col1?: string;
  item_col2_id: number;
  item_col2?: string;
  note?: string;
};

type ClassEquiptypeSlot = {
  slot: number;
  equiptype_id: number;
  equiptype_symbol?: string;
};

type ClassEquiptypes = {
  class_id: number;
  class_symbol: string;
  slots: ClassEquiptypeSlot[];
};

type Doc = {
  item_skills?: (ItemSkill & { id: number })[];
  skill_default_conditions?: Record<string, { if0: number; if1: number }>;
  charaset_usage?: Record<string, number>;
  missions: Mission[];
  equipai_if: CatalogEntry[];
  items?: CatalogEntry[];
  skills?: CatalogEntry[];
  charasets?: CharasetCatalogEntry[];
  class_tactics?: ClassTactics[];
  equiptype_items?: EquiptypeItem[];
  class_equiptypes?: ClassEquiptypes[];
  equipaiset_presets?: EquipAiPreset[];
};

type Allocation = {
  key: string;
  source_id: number;
  unitset_id: number;
  slot: number;
  lines: Line[];
};

type PresetCreate = {
  key: string;
  temp_id: number;
  source_id: number;
  symbol: string;
  lines: Line[];
};

type Edits = {
  unitsets: {
    unitset_id: number;
    unitset_symbol?: string;
    slots: {
      slot: number;
      charaset_id: number;
      equipaiset_id: number;
      flags: number;
      use_duplicate?: boolean;
      equipaiset_alloc_key?: string;
    }[];
  }[];
  charasets: {
    charaset_id: number;
    gear: Gear[];
    duplicate_if_shared?: boolean;
  }[];
  equipaiset_lines: Record<string, Line[]>;
  equipaiset_allocations: Allocation[];
  equipaiset_creates: PresetCreate[];
  class_tactics: { class_id: number; lines: Line[] }[];
  equiptype_items: {
    equiptype_id: number;
    equiptype_symbol?: string;
    item_col0_id: number;
    item_col1_id: number;
    item_col2_id: number;
  }[];
  class_equiptypes: {
    class_id: number;
    slots: number[];
  }[];
};

const DATA_URL = "../data/mission_catalog.json.gz";
const MODS_STORAGE_KEY = "uo_mission_editor_mod_paths";

const EMPTY_EDITS: Edits = {
  unitsets: [],
  charasets: [],
  equipaiset_lines: {},
  equipaiset_allocations: [],
  equipaiset_creates: [],
  class_tactics: [],
  equiptype_items: [],
  class_equiptypes: [],
};

function parseImportedEdits(value: unknown): Edits {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("This is not a mission-editor data file.");
  }
  const root = value as Record<string, unknown>;
  const source =
    root.edits && typeof root.edits === "object" && !Array.isArray(root.edits)
      ? (root.edits as Record<string, unknown>)
      : root;
  const array = (key: string) => {
    const entry = source[key];
    if (entry == null) return [];
    if (!Array.isArray(entry)) throw new Error(`Invalid ${key} section.`);
    return entry;
  };
  const lineMap = source.equipaiset_lines;
  if (
    lineMap != null &&
    (typeof lineMap !== "object" || Array.isArray(lineMap))
  ) {
    throw new Error("Invalid equipaiset_lines section.");
  }
  // Drop legacy charaset rows that only mirrored display gear (CreateDefaultEquip
  // etc.) and were never user-edited. Those used to poison exports by duplicating
  // shared CharaSets into reserved slots like PLAYER_START.
  const charasets = (array("charasets") as Edits["charasets"]).filter((c) =>
    (c.gear || []).some((g) => g.edited)
  );
  return {
    unitsets: array("unitsets") as Edits["unitsets"],
    charasets,
    equipaiset_lines: (lineMap ?? {}) as Edits["equipaiset_lines"],
    equipaiset_allocations: array(
      "equipaiset_allocations"
    ) as Edits["equipaiset_allocations"],
    equipaiset_creates: array(
      "equipaiset_creates"
    ) as Edits["equipaiset_creates"],
    class_tactics: array("class_tactics") as Edits["class_tactics"],
    equiptype_items: array("equiptype_items") as Edits["equiptype_items"],
    class_equiptypes: array("class_equiptypes") as Edits["class_equiptypes"],
  };
}

/** Only ship CharaSet gear overrides the user actually changed. */
function sanitizeEditsForExport(edits: Edits): Edits {
  return {
    ...edits,
    charasets: edits.charasets.filter((c) =>
      (c.gear || []).some((g) => g.edited)
    ).map(entry => ({ ...entry })),
  };
}

/** Skills a unit actually has = class skill pool + skills granted by its gear.
 *  A tactics line referencing anything outside this set is inert in-game. */
function availableSkillIds(
  classLines: { skill_id?: number }[],
  gearItemIds: number[],
  itemSkills?: Map<number, ItemSkill>
): Set<number> {
  const ids = new Set<number>();
  for (const l of classLines) {
    const sid = l.skill_id ?? 0;
    if (sid > 0) ids.add(sid);
  }
  if (itemSkills) {
    for (const iid of gearItemIds) {
      const sid = itemSkills.get(iid)?.skill_id ?? 0;
      if (sid > 0) ids.add(sid);
    }
  }
  return ids;
}

/** True when the resolved line is an explicit (non-marker) skill the unit does
 *  not actually have from its class or its equipped gear — so it's inert. */
function isMissingExplicit(
  line: ResolveLine,
  availableIds?: Set<number>
): boolean {
  if (!availableIds) return false;
  if (line.ref_kind === "class_slot") return false;
  const sid = line.skill_id ?? 0;
  if (sid <= 0) return false;
  return !availableIds.has(sid);
}

function FinalTacticsTable({
  lines,
  haveSkillIds,
  skillMap,
}: {
  lines: ResolveLine[];
  haveSkillIds?: Set<number>;
  skillMap?: Map<number, { name?: string; symbol?: string }>;
}) {
  if (!lines.length) {
    return <p className="hint">无战术行（空列表）。</p>;
  }
  return (
    <table className="tactics-table">
      <thead>
        <tr>
          <th>技能</th>
          <th>IF0</th>
          <th>IF1</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, li) => {
          const isMarker = line.ref_kind === "class_slot";
          const explicit = !isMarker && (line.skill_id ?? 0) > 0;
          const missing = isMissingExplicit(line, haveSkillIds);
          return (
            <tr
              key={li}
              className={[
                line.locked ? "locked-skill" : "",
                missing ? "skill-missing" : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined}
            >
              <td>
                {skillTitle(line as Line, skillMap)}
                {missing ? " ⚠" : ""}
              </td>
              <td>{line.if0_symbol || (line.if0 ? String(line.if0) : "—")}</td>
              <td>{line.if1_symbol || (line.if1 ? String(line.if1) : "—")}</td>
              <td>
                {[
                  line.locked ? "locked" : "",
                  isMarker ? "class slot (= default)" : "",
                  explicit ? "显式" : "",
                  missing ? "inert — unit lacks this skill" : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function timeStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function slugModName(raw: string): string {
  const s = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || `mission_squad_${timeStamp()}`;
}

// Match in-game formation UI: Back row on top, Front on bottom.
// Within each row, visual Left→Right is slot order 2,1,0 / 5,4,3
// (engine indices: 0/3 = Right, 1/4 = Middle, 2/5 = Left).
const FORMATION_COLS = ["Left", "Middle", "Right"] as const;
const FORMATION_ROWS = [
  { label: "Back", slots: [5, 4, 3] as const },
  { label: "Front", slots: [2, 1, 0] as const },
] as const;

function formationLabel(slot: number): string {
  const row = slot < 3 ? "Front" : "Back";
  // Visual column: Right=0/3, Middle=1/4, Left=2/5
  const col = FORMATION_COLS[2 - (slot % 3)] ?? "?";
  return `${row} ${col}`;
}

function emptyGear(): Gear[] {
  return [0, 1, 2, 3].map(() => ({
    item_id: 0,
    rom_item_id: 0,
    item_symbol: "",
    item_name: "",
    source: "empty",
  }));
}

function cloneGear(gear: Gear[] | undefined): Gear[] {
  const rows = gear && gear.length ? gear : emptyGear();
  return [0, 1, 2, 3].map((i) => {
    const g = rows[i];
    return g
      ? { ...g, edited: false }
      : {
          item_id: 0,
          rom_item_id: 0,
          item_symbol: "",
          item_name: "",
          source: "empty",
          edited: false,
        };
  });
}

function catalogGearRows(
  catalog: CharasetCatalogEntry | undefined
): Gear[] {
  return cloneGear(catalog?.gear).map((g) => ({
    ...g,
    source: g.item_id ? "charaset" : g.source || "empty",
  }));
}

function emptySlot(slot: number): Slot {
  return {
    slot,
    charaset_id: 0,
    charaset_symbol: "",
    chara_name: "",
    class_id: 0,
    class_symbol: "",
    flags: 0,
    equipaiset_id: 0,
    equipaiset_symbol: "",
    gear: emptyGear(),
    tactics_lines: [],
  };
}

function allocKey(unitsetId: number, slot: number): string {
  return `${unitsetId}:${slot}`;
}

function skillTitle(
  ln: Line,
  skillsById?: Map<number, { name?: string; symbol?: string }>
): string {
  const sid = Number(ln.skill_id || 0);
  const isMarker = ln.ref_kind === "class_slot" || (sid >= 2 && sid <= 10);
  if (!isMarker && sid > 0) {
    const official = (skillsById?.get(sid)?.name || "").trim();
    if (official) return official.replace(/^\((A|P)\)\s*/i, "");
  }
  const name = (ln.skill_name || "").trim();
  if (name) return name.replace(/^\((A|P)\)\s*/i, "");
  const sym = (
    skillsById?.get(sid)?.symbol ||
    ln.skill_symbol ||
    ""
  ).trim();
  if (sym) {
    return sym
      .replace(/^(ACT_|PAS_|DEFAULT_)/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return sid ? `Skill ${sid}` : "Unset skill";
}

/** Rewrite stored skill_name/symbol from the official catalog (FMS EN names). */
function withOfficialSkillNames(
  line: Line,
  skills: Map<number, { name?: string; symbol?: string }>
): Line {
  const sid = Number(line.skill_id || 0);
  if (!sid || sid <= 10 || line.ref_kind === "class_slot") return line;
  const meta = skills.get(sid);
  if (!meta?.name) return line;
  return {
    ...line,
    skill_name: meta.name,
    skill_symbol: meta.symbol || line.skill_symbol,
  };
}

function refreshEditsSkillNames(
  source: Edits,
  skills: Map<number, { name?: string; symbol?: string }>
): Edits {
  const mapLines = (lines: Line[]) =>
    lines.map((line) => withOfficialSkillNames(line, skills));
  const equipaiset_lines: Edits["equipaiset_lines"] = {};
  for (const [k, lines] of Object.entries(source.equipaiset_lines)) {
    equipaiset_lines[k] = mapLines(lines);
  }
  return {
    ...source,
    equipaiset_lines,
    equipaiset_allocations: source.equipaiset_allocations.map((a) => ({
      ...a,
      lines: mapLines(a.lines),
    })),
    equipaiset_creates: source.equipaiset_creates.map((c) => ({
      ...c,
      lines: mapLines(c.lines),
    })),
    class_tactics: source.class_tactics.map((c) => ({
      ...c,
      lines: mapLines(c.lines),
    })),
  };
}

function App() {
  const [language,setEditorLanguage]=useState(()=>{const value=new URLSearchParams(location.search).get('language')||'zh-CN';const selected=LANGUAGES.includes(value)?value:'zh-CN';setLanguage(selected);return selected;});
  useEffect(()=>{document.documentElement.lang=language;},[language]);
  const [frameView, setFrameView] = useState<FrameView>(() => {
    const value = new URLSearchParams(location.search).get("view");
    return isView(value) ? value : "missions";
  });
  const view = frameView === "gear" ? "equiptypes" : frameView;
  const setView = (next: "missions" | "classes" | "presets" | "equiptypes") => {
    const requested = next === "equiptypes" ? "gear" : next;
    if (window.parent !== window) {
      window.parent.postMessage({ type: "uo-navigate", view: requested }, location.origin);
    } else setFrameView(requested);
  };
  const [target, setTarget] = useState<Target>(() => {
    const value = new URLSearchParams(location.search).get("target");
    return isTarget(value) ? value : "asia";
  });
  const [doc, setDoc] = useState<Doc | null>(null);
  const [err, setErr] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("ALL");
  const [missionSort, setMissionSort] = useState<"name" | "level">("name");
  const [sideFilter, setSideFilter] = useState("EN");
  const [missionId, setMissionId] = useState<number | null>(null);
  const [squadId, setSquadId] = useState<number | null>(null);
  const [slotIdx, setSlotIdx] = useState<number | null>(null);
  /** null = show all presets; otherwise only presets used by that mission's units */
  const [presetMissionId, setPresetMissionId] = useState<number | null>(null);
  const [exportMsg, setExportMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  const [modNameInput, setModNameInput] = useState("");
  const [editEpoch, setEditEpoch] = useState(0);
  const [edits, setEdits] = useState<Edits>(EMPTY_EDITS);
  const [classFilter, setClassFilter] = useState("");
  const [classId, setClassId] = useState<number | null>(null);
  const [presetFilter, setPresetFilter] = useState("");
  const [presetId, setPresetId] = useState<number | null>(null);
  const [equiptypeFilter, setEquiptypeFilter] = useState("");
  const [equiptypeId, setEquiptypeId] = useState<number | null>(null);
  useEffect(()=>{document.querySelectorAll<HTMLElement>('.panel.wide').forEach(panel=>{panel.scrollTop=0;});},[missionId,squadId,slotIdx,classId,presetId,equiptypeId]);
  useEffect(()=>{const panel=document.querySelector<HTMLElement>('.layout > .panel:nth-child(2)');if(panel)panel.scrollTop=0;},[missionId]);
  const [liveClassTactics, setLiveClassTactics] = useState<ClassTactics[] | null>(
    null
  );
  const [liveItemSkills, setLiveItemSkills] = useState<Map<
    number,
    ItemSkill
  > | null>(null);
  const [loadedModPaths, setLoadedModPaths] = useState<string[]>([]);
  const [modStatus, setModStatus] = useState("");
  const [modLoading, setModLoading] = useState(false);
  const [createSeq, setCreateSeq] = useState(1);
  const modFolderInputRef = useRef<HTMLInputElement | null>(null);
  const editorImportInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!acceptsParentMessage(event, location.origin, window.parent) || !event.data || typeof event.data !== "object") return;
      if(event.data.type==='uo-language'&&LANGUAGES.includes(event.data.language)){setLanguage(event.data.language);setEditorLanguage(event.data.language);}
      if ((event.data.type === "uo-target" || event.data.type === "uo-view") && isTarget(event.data.target) && event.data.target !== target) {
        setTarget(event.data.target);
        setLiveClassTactics(null);
        setLiveItemSkills(null);
        setLoadedModPaths([]);
        setModStatus("目标已切换；已清除补丁预览，编辑保留。");
      }
      if (event.data.type === "uo-view" && isView(event.data.view)) setFrameView(event.data.view);
      if (event.data.type === "uo-request-edits") {
        window.parent.postMessage({ type: "uo-edits", target, view: frameView, requestId: event.data.requestId, edits: sanitizeEditsForExport(edits) }, location.origin);
      }
      if (event.data.type === "uo-load-edits") {
        try {
          if (!doc) throw new Error("目录正在加载，请等待 uo-ready");
          if (!isTarget(event.data.target)) throw new Error("无效的游戏目标");
          const imported = parseImportedEdits(event.data.edits);
          validateEdits(imported, doc, true);
          applyImportedEdits("父页面工程", imported);
          setTarget(event.data.target);
          setLiveClassTactics(null);
          setLiveItemSkills(null);
          setLoadedModPaths([]);
          window.parent.postMessage({ type: "uo-loaded", requestId: event.data.requestId, target: event.data.target, edits: imported }, location.origin);
        } catch (error) {
          window.parent.postMessage({ type: "uo-loaded", requestId: event.data.requestId, error: String(error) }, location.origin);
        }
      }
      if (event.data.type === "uo-request-patch") {
        const payload = sanitizeEditsForExport(edits);
        try {
          if (!doc) throw new Error("目录正在加载，请等待 uo-ready");
          if (!isTarget(event.data.target)) throw new Error("无效的游戏目标");
          const result = prepareMissionPatch(payload, doc, event.data.target, confirmSharedGear);
          window.parent.postMessage({ type: "uo-patch", requestId: event.data.requestId, target: event.data.target, content: result.content, edits: result.edits }, location.origin);
        } catch (error) {
          window.parent.postMessage({ type: "uo-patch", requestId: event.data.requestId, error: String(error), edits: payload }, location.origin);
        }
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [target, frameView, edits, doc]);

  useEffect(() => {
    if (doc) window.parent.postMessage({ type: "uo-ready", target, view: frameView }, location.origin);
  }, [doc, target, frameView]);

  useEffect(() => {
    fetch('../data/catalog.json').then(response=>{if(!response.ok)throw new Error('Language catalog unavailable');return response.json();}).then(data=>{configureTranslations(data);return fetch(DATA_URL);})
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${DATA_URL}`);
        if (!r.body) throw new Error("目录响应为空");
        return new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).json();
      })
      .then((d: Doc) => {
        const classes = new Map((d.class_tactics ?? []).map(entry => [entry.class_id, entry.lines]));
        const presets = new Map((d.equipaiset_presets ?? []).map(entry => [entry.id, entry.lines]));
        const skills = new Map((d.skills ?? []).map(entry => [entry.id, entry]));
        const conditions = new Map(d.equipai_if.map(entry => [entry.id, entry.name || entry.symbol]));
        const itemSkills = new Map((d.item_skills ?? []).map(entry => [entry.id, entry]));
        for (const mission of d.missions) for (const squad of mission.squads) for (const slot of squad.slots) {
          const lines = classes.get(slot.class_id) ?? [];
          slot.tactics_lines = slot.equipaiset_id === 0
            ? tacticsForClass(lines, Number(mission.enemy_level) || 1, slot.gear.map(gear => gear.item_id), itemSkills, conditions)
            : tacticsForPreset(lines, Number(mission.enemy_level) || 1, presets.get(slot.equipaiset_id) ?? [], skills, conditions);
        }
        for (const preset of d.equipaiset_presets ?? []) for (const reference of preset.references ?? []) {
          reference.resolved_tactics = tacticsForPreset(classes.get(reference.class_id ?? 0) ?? [], reference.resolution?.enemy_level ?? reference.resolution?.assumed_level ?? 1, preset.lines, skills, conditions);
        }
        setDoc(d);
        const first = d.missions.find((m) => m.squads.length > 0);
        if (first) setMissionId(first.quest_id);
        if (d.class_tactics?.length) setClassId(d.class_tactics[0].class_id);
        if (d.equipaiset_presets?.length) setPresetId(d.equipaiset_presets[0].id);
        setEdits((prev) => refreshEditsSkillNames(prev, skills));
      })
      .catch((e) => setErr(String(e)));
  }, []);

  async function applyModPatchContents(
    files: { name: string; text: string }[],
    persistLabels?: string[]
  ) {
    if (!doc) {
      setModStatus("目录正在加载。");
      return;
    }
    setModLoading(true);
    setModStatus("正在应用 pchtxt 预览…");
    try {
      const skills = new Map(
        (doc.skills ?? []).map((sk) => [
          sk.id,
          { name: sk.name, symbol: sk.symbol },
        ])
      );
      const ifs = new Map(
        (doc.equipai_if ?? []).map((row) => [row.id, row.name || row.symbol || ""])
      );
      const overlay = overlayPchtxtOnCatalog(
        files,
        doc.class_tactics ?? [],
        skills,
        ifs,
        new Map((doc.item_skills ?? []).map(entry => [entry.id, entry])),
        doc.skill_default_conditions,
        target
      );
      setLiveClassTactics(overlay.class_tactics);
      setLiveItemSkills(overlay.item_skills);
      const labels = persistLabels ?? files.map((f) => f.name);
      setLoadedModPaths(labels);
      localStorage.setItem(MODS_STORAGE_KEY, JSON.stringify(labels));
      setModStatus(
        `Loaded ${files.length} .pchtxt · ${overlay.patches_applied} patches` +
          (labels.length
            ? ` · ${labels.map((n) => String(n).split(/[/\\]/).pop()).join(", ")}`
            : "")
      );
    } catch (e) {
      setModStatus(String(e));
    } finally {
      setModLoading(false);
    }
  }

  async function readPchtxtFromDirectoryHandle(
    dir: FileSystemDirectoryHandle,
    prefix = ""
  ): Promise<{ name: string; text: string }[]> {
    const out: { name: string; text: string }[] = [];
    for await (const [name, handle] of dir.entries()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        out.push(
          ...(await readPchtxtFromDirectoryHandle(
            handle as FileSystemDirectoryHandle,
            rel
          ))
        );
      } else if (
        handle.kind === "file" &&
        name.toLowerCase().endsWith(".pchtxt")
      ) {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.push({ name: rel.replace(/\\/g, "/"), text: await file.text() });
      }
    }
    return out;
  }

  async function pickAndLoadMods() {
    try {
      // Chromium/Edge: native folder picker
      const w = window as Window & {
        showDirectoryPicker?: (opts?: {
          id?: string;
          mode?: "read";
        }) => Promise<FileSystemDirectoryHandle>;
      };
      if (typeof w.showDirectoryPicker === "function") {
        const dir = await w.showDirectoryPicker({
          id: "uo-mods",
          mode: "read",
        });
        const files = await readPchtxtFromDirectoryHandle(dir);
        if (!files.length) {
          setModStatus(
            `No .pchtxt files under “${dir.name}”. Pick a mod folder (e.g. class_editor) or its exefs subfolder.`
          );
          return;
        }
        await applyModPatchContents(
          files,
          files.map((f) => `${dir.name}/${f.name}`)
        );
        return;
      }
      // Fallback: hidden <input webkitdirectory>
      modFolderInputRef.current?.click();
    } catch (e) {
      const msg = String(e);
      if (/abort/i.test(msg)) return;
      setModStatus(msg);
    }
  }

  async function onModFolderInputChange(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files: { name: string; text: string }[] = [];
    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith(".pchtxt")) continue;
      const rel =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
        file.name;
      files.push({ name: rel.replace(/\\/g, "/"), text: await file.text() });
    }
    if (!files.length) {
      setModStatus("No .pchtxt files in the selected folder.");
      return;
    }
    await applyModPatchContents(files);
    if (modFolderInputRef.current) modFolderInputRef.current.value = "";
  }

  function clearLoadedMods() {
    setLiveClassTactics(null);
    setLiveItemSkills(null);
    setLoadedModPaths([]);
    localStorage.removeItem(MODS_STORAGE_KEY);
    setModStatus("已清除补丁预览，使用原版目录。");
  }

  const equipAiUsage = useMemo(() => {
    const counts = new Map<number, number>();
    if (!doc) return counts;
    for (const preset of doc.equipaiset_presets ?? []) {
      if (preset.id) counts.set(preset.id, preset.usage || 0);
    }
    if (counts.size > 0) return counts;
    for (const m of doc.missions) {
      for (const sq of m.squads) {
        for (const sl of sq.slots) {
          const id = sl.equipaiset_id;
          if (id) counts.set(id, (counts.get(id) || 0) + 1);
        }
      }
    }
    return counts;
  }, [doc]);

  // Index every mission unit by unitset:slot so pending edits can be enriched
  // (name/class/level) and shown under the preset they were reassigned to.
  const unitIndex = useMemo(() => {
    const m = new Map<string, { mission: Mission; squad: Squad; slot: Slot }>();
    for (const mi of doc?.missions ?? []) {
      for (const sq of mi.squads) {
        for (const sl of sq.slots) {
          m.set(`${sq.unitset_id}:${sl.slot}`, { mission: mi, squad: sq, slot: sl });
        }
      }
    }
    return m;
  }, [doc]);

  const unitSlotEdits = useMemo(() => {
    const m = new Map<
      string,
      {
        equipaiset_id: number;
        charaset_id: number;
        flags: number;
        equipaiset_alloc_key?: string;
      }
    >();
    for (const u of edits.unitsets) {
      for (const s of u.slots) m.set(`${u.unitset_id}:${s.slot}`, s);
    }
    return m;
  }, [edits.unitsets]);

  const gearEditsByCharaset = useMemo(() => {
    const m = new Map<number, Gear[]>();
    for (const c of edits.charasets) m.set(c.charaset_id, c.gear);
    return m;
  }, [edits.charasets]);

  const presetSymbolById = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of doc?.equipaiset_presets ?? []) m.set(p.id, p.symbol);
    for (const c of edits.equipaiset_creates) m.set(c.temp_id, c.symbol);
    return m;
  }, [doc, edits.equipaiset_creates]);

  const itemOptions: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = [
      { id: 0, label: "空位", secondary: "", group: "空位" },
    ];
    for (const it of doc?.items ?? []) {
      if (!it.id) continue;
      opts.push({
        id: it.id,
        label: it.name || it.symbol || `Item ${it.id}`,
        secondary: it.symbol,
        group: groupBySymbolPrefix(it.symbol || "", "Other"),
      });
    }
    return opts;
  }, [doc]);

  const charasetById = useMemo(() => {
    const m = new Map<number, CharasetCatalogEntry>();
    for (const c of doc?.charasets ?? []) m.set(c.id, c);
    return m;
  }, [doc]);

  const charasetOptions: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = [];
    for (const c of doc?.charasets ?? []) {
      if (!c.id || c.id <= 1) continue; // UNKNOWN / PLAYER_START reserved
      const classLabel = c.class_name || c.class_symbol || "Unknown class";
      const name = (c.name || "").trim();
      opts.push({
        id: c.id,
        label: name
          ? `${name} · ${classLabel}`
          : `${c.symbol || `CharaSet ${c.id}`} · ${classLabel}`,
        secondary: `#${c.id} · ${c.symbol}`,
        group: classLabel,
      });
    }
    return opts;
  }, [doc]);

  const equiptypeEntries = useMemo(() => {
    const q = equiptypeFilter.trim().toLowerCase();
    return (doc?.equiptype_items ?? []).filter((entry) => {
      if (!q) return true;
      return (
        (entry.symbol+' '+t(entry.symbol)).toLowerCase().includes(q) ||
        String(entry.id).includes(q) ||
        [entry.item_col0, entry.item_col1, entry.item_col2].some(value=>((value||'')+' '+t(value||'')).toLowerCase().includes(q))
      );
    });
  }, [doc, equiptypeFilter, language]);

  const ifOptions: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = [
      { id: 0, label: "(none)", secondary: "", group: "(none)" },
    ];
    for (const it of doc?.equipai_if ?? []) {
      if (!it.id) continue;
      opts.push({
        id: it.id,
        label: it.name || it.symbol || `IF ${it.id}`,
        secondary: it.symbol ? `#${it.id} · ${it.symbol}` : `#${it.id}`,
        group: groupBySymbolPrefix(it.symbol || "", "Other"),
      });
    }
    return opts;
  }, [doc]);

  const skillOptions: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = [
      { id: 0, label: "Unset skill", secondary: "", group: "Unset" },
    ];
    const markers: [number, string][] = [
      [3, "Active Lv1"],
      [4, "Active Lv2"],
      [5, "Active Lv3"],
      [6, "Active Lv4"],
      [7, "Passive Lv1"],
      [8, "Passive Lv2"],
      [9, "Passive Lv3"],
      [10, "Passive Lv4"],
      [2, "Normal Attack"],
    ];
    for (const [id, label] of markers) {
      opts.push({
        id,
        label: `Class ${label}`,
        secondary: "class skill in this slot",
        group: "Class slot (per class)",
      });
    }
    for (const sk of doc?.skills ?? []) {
      if (!sk.id) continue;
      const group =
        sk.kind === "active"
          ? "ACT"
          : sk.kind === "passive"
            ? "PAS"
            : groupBySymbolPrefix(sk.symbol || "", "Other");
      opts.push({
        id: sk.id,
        label: sk.name || sk.symbol || `Skill ${sk.id}`,
        secondary: sk.symbol ? `#${sk.id} · ${sk.symbol}` : `#${sk.id}`,
        group,
      });
    }
    return opts;
  }, [doc]);

  const skillsById = useMemo(() => {
    const m = new Map<number, CatalogEntry>();
    for (const sk of doc?.skills ?? []) m.set(sk.id, sk);
    return m;
  }, [doc]);

  const regions = useMemo(() => {
    if (!doc) return [] as string[];
    const set = new Set<string>();
    for (const m of doc.missions) {
      if (m.region) set.add(m.region);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [doc]);

  const missions = useMemo(() => {
    if (!doc) return [];
    const q = filter.trim().toLowerCase();
    const filtered = doc.missions.filter((m) => {
      if (!m.squads.length) return false;
      if (regionFilter !== "ALL" && m.region !== regionFilter) return false;
      if (!q) return true;
      return (
        (m.stage_name+' '+t(m.stage_name)).toLowerCase().includes(q) ||
        m.quest_symbol.toLowerCase().includes(q) ||
        (m.region+' '+t(m.region)).toLowerCase().includes(q) ||
        m.squads.some(
          (s) =>
            s.unitset_symbol.toLowerCase().includes(q) ||
            s.slots.some(
              (sl) =>
                ((sl.chara_name || "")+' '+t(sl.chara_name || "")).toLowerCase().includes(q) ||
                sl.charaset_symbol.toLowerCase().includes(q) ||
                (sl.class_symbol+' '+t(sl.class_symbol)).toLowerCase().includes(q)
            )
        )
      );
    });
    const levelNum = (m: Mission) => {
      const n = Number(m.enemy_level);
      return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
    };
    const nameKey = (m: Mission) =>
      t(m.stage_name || m.quest_symbol || "").toLowerCase();
    return [...filtered].sort((a, b) => {
      if (missionSort === "level") {
        const d = levelNum(a) - levelNum(b);
        if (d !== 0) return d;
      }
      const byName = nameKey(a).localeCompare(nameKey(b));
      if (byName !== 0) return byName;
      return a.quest_id - b.quest_id;
    });
  }, [doc, filter, missionSort, regionFilter, language]);

  const missionsByName = useMemo(() => {
    if (!doc) return [] as Mission[];
    return [...doc.missions]
      .filter((m) => m.squads.length > 0)
      .sort((a, b) =>
        (a.stage_name || a.quest_symbol).localeCompare(
          b.stage_name || b.quest_symbol
        )
      );
  }, [doc]);

  const presetMissionUnitsets = useMemo(() => {
    if (!doc || presetMissionId == null) return null;
    const m = doc.missions.find((x) => x.quest_id === presetMissionId);
    if (!m) return null;
    return new Set(m.squads.map((s) => s.unitset_id));
  }, [doc, presetMissionId]);

  const presetMissionLabel = useMemo(() => {
    if (presetMissionId == null || !doc) return "";
    const m = doc.missions.find((x) => x.quest_id === presetMissionId);
    return m?.stage_name || m?.quest_symbol || "";
  }, [doc, presetMissionId]);

  const mission = doc?.missions.find((m) => m.quest_id === missionId) ?? null;
  const squads =
    mission?.squads.filter(
      (s) =>
        sideFilter === "ALL" ||
        s.side === sideFilter ||
        (sideFilter === "EN" && s.side === "UNKNOWN")
    ) ?? [];
  const rawSquad = squads.find((s) => s.unitset_id === squadId) ?? squads[0] ?? null;
  // Overlay pending edits onto the squad's slots so assignments/gear persist when
  // switching tabs. Memoized so unedited slots keep a stable identity (otherwise
  // UnitPanel would reset its local state every render).
  const squad = useMemo(() => {
    if (!rawSquad) return null;
    const baseBySlot = new Map(rawSquad.slots.map((s) => [s.slot, s]));
    const slots: Slot[] = [];
    for (let i = 0; i < 6; i++) {
      const base = baseBySlot.get(i);
      const e = unitSlotEdits.get(`${rawSquad.unitset_id}:${i}`);
      if (e) {
        if (!e.charaset_id) {
          slots.push(emptySlot(i));
          continue;
        }
        const catalog = charasetById.get(e.charaset_id);
        const fromBase = base && base.charaset_id === e.charaset_id;
        const eid = e.equipaiset_id;
        slots.push({
          slot: i,
          charaset_id: e.charaset_id,
          charaset_symbol: fromBase
            ? base.charaset_symbol
            : catalog?.symbol || "",
          chara_name: fromBase ? base.chara_name || "" : catalog?.name || "",
          class_id: fromBase ? base.class_id : catalog?.class_id || 0,
          class_symbol: fromBase
            ? base.class_symbol
            : catalog?.class_symbol || "",
          flags: e.flags,
          equipaiset_id: eid,
          equipaiset_symbol:
            eid === 0
              ? ""
              : presetSymbolById.get(eid) ||
                (fromBase ? base.equipaiset_symbol : ""),
          gear:
            gearEditsByCharaset.get(e.charaset_id) ??
            (fromBase ? base.gear : catalog?.gear ?? emptyGear()),
          tactics_lines: fromBase ? base.tactics_lines : [],
          equip_param: fromBase ? base.equip_param : undefined,
          equip_param_name: fromBase ? base.equip_param_name : undefined,
          chara_param_override: fromBase
            ? base.chara_param_override
            : undefined,
        });
        continue;
      }
      if (base) {
        const gear = gearEditsByCharaset.get(base.charaset_id) ?? base.gear;
        slots.push(gear === base.gear ? base : { ...base, gear });
      } else {
        slots.push(emptySlot(i));
      }
    }
    return { ...rawSquad, slots };
  }, [
    rawSquad,
    unitSlotEdits,
    gearEditsByCharaset,
    presetSymbolById,
    charasetById,
  ]);
  const slot =
    squad?.slots.find((s) => s.slot === slotIdx) ??
    squad?.slots.find((s) => s.charaset_id > 0) ??
    squad?.slots[0] ??
    null;

  useEffect(() => {
    if (!squad) return;
    const stillValid =
      slotIdx !== null && squad.slots.some((s) => s.slot === slotIdx);
    if (stillValid) return;
    const leader =
      squad.slots.find(
        (s) => s.charaset_id > 0 && (s.flags & 0x100) !== 0
      ) ||
      squad.slots.find(
        (s) => s.charaset_id > 0 && /_BOSS$/.test(s.charaset_symbol)
      ) ||
      squad.slots.find((s) => s.charaset_id > 0) ||
      squad.slots[0];
    setSlotIdx(leader?.slot ?? null);
  }, [squad, slotIdx]);

  function upsertUnitSlot(
    next: Slot,
    extra?: { equipaiset_alloc_key?: string }
  ) {
    if (!squad) return;
    setEdits((prev) => {
      const unitsets = [...prev.unitsets];
      let ue = unitsets.find((u) => u.unitset_id === squad.unitset_id);
      if (!ue) {
        ue = {
          unitset_id: squad.unitset_id,
          unitset_symbol: squad.unitset_symbol,
          slots: [],
        };
        unitsets.push(ue);
      }
      const prevSlot = ue.slots.find((s) => s.slot === next.slot);
      const eid = next.equipaiset_id;
      // Keep create: keys across charaset/flag tweaks. Losing them leaves a
      // temp EquipAiSet id (-N) that export cannot resolve — and used to skip
      // the entire UnitSet row (CharaSet swap never reached the game).
      let allocKey = extra?.equipaiset_alloc_key;
      if (eid < 0) {
        if (allocKey === undefined) {
          allocKey = prevSlot?.equipaiset_alloc_key;
        }
        if (!allocKey) {
          allocKey = prev.equipaiset_creates.find((c) => c.temp_id === eid)?.key;
        }
      } else {
        allocKey = undefined;
      }
      const slots = ue.slots.filter((s) => s.slot !== next.slot);
      slots.push({
        slot: next.slot,
        charaset_id: next.charaset_id,
        equipaiset_id: eid,
        flags: next.flags,
        use_duplicate: true,
        ...(allocKey ? { equipaiset_alloc_key: allocKey } : {}),
      });
      ue.slots = slots;
      return { ...prev, unitsets };
    });
  }

  /** Swap/move two formation seats (UnitSet slot indices 0–5). */
  function swapFormationSlots(slotA: number, slotB: number) {
    if (!squad || slotA === slotB) return;
    const a = squad.slots.find((s) => s.slot === slotA);
    const b = squad.slots.find((s) => s.slot === slotB);
    if (!a || !b) return;
    if (!a.charaset_id && !b.charaset_id) return;

    const uid = squad.unitset_id;
    const keyA = allocKey(uid, slotA);
    const keyB = allocKey(uid, slotB);

    function remapAllocKey(
      key: string | undefined,
      fromSlot: number,
      toSlot: number
    ): string | undefined {
      if (!key) return undefined;
      if (key === allocKey(uid, fromSlot)) return allocKey(uid, toSlot);
      return key;
    }

    setEdits((prev) => {
      const unitsets = [...prev.unitsets];
      let ue = unitsets.find((u) => u.unitset_id === uid);
      if (!ue) {
        ue = {
          unitset_id: uid,
          unitset_symbol: squad.unitset_symbol,
          slots: [],
        };
        unitsets.push(ue);
      }
      const editA = ue.slots.find((s) => s.slot === slotA);
      const editB = ue.slots.find((s) => s.slot === slotB);
      const allocKeyFromA = editA?.equipaiset_alloc_key;
      const allocKeyFromB = editB?.equipaiset_alloc_key;

      const writeFor = (
        source: Slot,
        destSlot: number,
        sourceSlot: number,
        sourceAllocKey: string | undefined
      ) => {
        if (!source.charaset_id) {
          return {
            slot: destSlot,
            charaset_id: 0,
            equipaiset_id: 0,
            flags: 0,
            use_duplicate: true as const,
          };
        }
        const remapped = remapAllocKey(sourceAllocKey, sourceSlot, destSlot);
        let alloc = remapped;
        if (!alloc && source.equipaiset_id < 0) {
          // Recover create: key by temp id if a prior upsert dropped it.
          const created = prev.equipaiset_creates.find(
            (c) => c.temp_id === source.equipaiset_id
          );
          alloc = created?.key;
        }
        return {
          slot: destSlot,
          charaset_id: source.charaset_id,
          equipaiset_id: source.equipaiset_id,
          flags: source.flags,
          use_duplicate: true as const,
          ...(alloc ? { equipaiset_alloc_key: alloc } : {}),
        };
      };

      const nextSlots = ue.slots.filter(
        (s) => s.slot !== slotA && s.slot !== slotB
      );
      nextSlots.push(writeFor(a, slotB, slotA, allocKeyFromA));
      nextSlots.push(writeFor(b, slotA, slotB, allocKeyFromB));
      ue.slots = nextSlots;

      const allocA = prev.equipaiset_allocations.find((x) => x.key === keyA);
      const allocB = prev.equipaiset_allocations.find((x) => x.key === keyB);
      let allocations = prev.equipaiset_allocations.filter(
        (x) => x.key !== keyA && x.key !== keyB
      );
      if (allocA && a.charaset_id) {
        allocations.push({ ...allocA, key: keyB, slot: slotB });
      }
      if (allocB && b.charaset_id) {
        allocations.push({ ...allocB, key: keyA, slot: slotA });
      }

      return { ...prev, unitsets, equipaiset_allocations: allocations };
    });
    setSlotIdx(a.charaset_id ? slotB : b.charaset_id ? slotA : slotB);
    setEditEpoch((n) => n + 1);
  }

  function upsertGear(next: Slot) {
    setEdits((prev) => {
      const charasets = prev.charasets.filter(
        (c) => c.charaset_id !== next.charaset_id
      );
      // Only record a CharaSet gear override when the user actually changed a
      // gear slot. Untouched slots keep their true ROM value (0 for slots the
      // game fills at runtime via CreateDefaultEquip) so exporting them is a
      // no-op instead of baking runtime defaults into a shared CharaSet.
      const anyEdited = next.gear.some((g) => g.edited);
      if (anyEdited) {
        charasets.push({
          charaset_id: next.charaset_id,
          gear: next.gear,
          duplicate_if_shared: true,
        });
      }
      return { ...prev, charasets };
    });
  }

  function commitTacticsLines(unit: Slot, lines: Line[]) {
    if (!squad) return;
    const sourceId = unit.equipaiset_id;
    const key = allocKey(squad.unitset_id, unit.slot);
    const shared = sourceId === 0 || (equipAiUsage.get(sourceId) || 0) > 1;

    setEdits((prev) => {
      const existingAlloc = prev.equipaiset_allocations.find((a) => a.key === key);
      const unitsets = [...prev.unitsets];
      let ue = unitsets.find((u) => u.unitset_id === squad.unitset_id);
      if (!ue) {
        ue = {
          unitset_id: squad.unitset_id,
          unitset_symbol: squad.unitset_symbol,
          slots: [],
        };
        unitsets.push(ue);
      }

      if (!(shared || existingAlloc)) {
        const slots = ue.slots.filter((s) => s.slot !== unit.slot);
        slots.push({
          slot: unit.slot,
          charaset_id: unit.charaset_id,
          equipaiset_id: sourceId,
          flags: unit.flags,
          use_duplicate: true,
        });
        ue.slots = slots;
        return {
          ...prev,
          unitsets,
          equipaiset_lines: {
            ...prev.equipaiset_lines,
            [String(sourceId)]: lines,
          },
        };
      }

      const allocations = prev.equipaiset_allocations.filter((a) => a.key !== key);
      allocations.push({
        key,
        source_id: existingAlloc?.source_id ?? sourceId,
        unitset_id: squad.unitset_id,
        slot: unit.slot,
        lines,
      });
      const slots = ue.slots.filter((s) => s.slot !== unit.slot);
      slots.push({
        slot: unit.slot,
        charaset_id: unit.charaset_id,
        equipaiset_id: existingAlloc?.source_id ?? sourceId,
        flags: unit.flags,
        use_duplicate: true,
        equipaiset_alloc_key: key,
      });
      ue.slots = slots;
      const linesMap = { ...prev.equipaiset_lines };
      delete linesMap["0"];
      return {
        ...prev,
        unitsets,
        equipaiset_allocations: allocations,
        equipaiset_lines: linesMap,
      };
    });
  }

  function hasEdits(): boolean {
    return (
      edits.unitsets.length > 0 ||
      edits.charasets.length > 0 ||
      edits.class_tactics.length > 0 ||
      edits.equiptype_items.length > 0 ||
      edits.class_equiptypes.length > 0 ||
      edits.equipaiset_allocations.length > 0 ||
      edits.equipaiset_creates.length > 0 ||
      Object.keys(edits.equipaiset_lines).length > 0
    );
  }

  function createEmptyPreset(sourceId = 0, copiedLines: Line[] = [], copiedName?: string): PresetCreate {
    const key = `create:${createSeq}`;
    const temp_id = -createSeq;
    setCreateSeq((n) => n + 1);
    const created: PresetCreate = {
      key,
      temp_id,
      source_id: Math.max(0, sourceId),
      symbol: copiedName ?? `新预设_${createSeq}`,
      lines: structuredClone(copiedLines),
    };
    setEdits((prev) => ({
      ...prev,
      equipaiset_creates: [...prev.equipaiset_creates, created],
    }));
    setPresetId(temp_id);
    setPresetMissionId(null);
    setView("presets");
    setExportMsg(
      `已创建预设 ${created.symbol}，导出时分配空闲 ID。绑定单位后才生效；绑定空预设会清空战术。`
    );
    return created;
  }

  function commitCreateLines(key: string, lines: Line[]) {
    setEdits((prev) => ({
      ...prev,
      equipaiset_creates: prev.equipaiset_creates.map((c) =>
        c.key === key ? { ...c, lines } : c
      ),
    }));
  }

  function commitCreateSymbol(key: string, symbol: string) {
    setEdits((prev) => ({
      ...prev,
      equipaiset_creates: prev.equipaiset_creates.map((c) =>
        c.key === key ? { ...c, symbol } : c
      ),
    }));
  }

  const effectiveClassTactics = useMemo(() => (liveClassTactics ?? doc?.class_tactics ?? []).map(entry => ({
    ...entry, lines: edits.class_tactics.find(edit => edit.class_id === entry.class_id)?.lines ?? entry.lines,
  })), [liveClassTactics, doc, edits.class_tactics]);

  const ifMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const it of doc?.equipai_if ?? []) {
      m.set(it.id, it.name || it.symbol || `IF ${it.id}`);
    }
    return m;
  }, [doc]);

  const skillMap = useMemo(() => {
    const m = new Map<number, { id: number; symbol?: string; name?: string }>();
    for (const sk of doc?.skills ?? []) {
      m.set(sk.id, { id: sk.id, symbol: sk.symbol, name: sk.name });
    }
    return m;
  }, [doc]);

  const itemSkillMap = useMemo(() => {
    if (liveItemSkills) return liveItemSkills;
    return new Map<number, ItemSkill>((doc?.item_skills ?? []).map(entry => [entry.id, entry]));
  }, [liveItemSkills, doc]);

  const syntheticPresets: EquipAiPreset[] = useMemo(() => {
    return edits.equipaiset_creates.map((c) => ({
      id: c.temp_id,
      symbol: c.symbol,
      usage: 0,
      skill_ai_id: 0,
      count_a: 0,
      count_b: 0,
      lines: c.lines,
      references: [],
    }));
  }, [edits.equipaiset_creates]);

  function commitClassTactics(classEntry: ClassTactics, lines: Line[]) {
    setEdits((prev) => ({
      ...prev,
      class_tactics: [
        ...prev.class_tactics.filter((x) => x.class_id !== classEntry.class_id),
        { class_id: classEntry.class_id, lines },
      ],
    }));
  }

  function commitEquiptypeItems(entry: EquiptypeItem, cols: [number, number, number]) {
    const vanilla = doc?.equiptype_items?.find((e) => e.id === entry.id);
    const same =
      vanilla &&
      vanilla.item_col0_id === cols[0] &&
      vanilla.item_col1_id === cols[1] &&
      vanilla.item_col2_id === cols[2];
    setEdits((prev) => {
      const rest = prev.equiptype_items.filter(
        (x) => x.equiptype_id !== entry.id
      );
      if (same) return { ...prev, equiptype_items: rest };
      return {
        ...prev,
        equiptype_items: [
          ...rest,
          {
            equiptype_id: entry.id,
            equiptype_symbol: entry.symbol,
            item_col0_id: cols[0],
            item_col1_id: cols[1],
            item_col2_id: cols[2],
          },
        ],
      };
    });
  }

  function commitPresetLines(preset: EquipAiPreset, lines: Line[]) {
    setEdits((prev) => ({
      ...prev,
      equipaiset_lines: {
        ...prev.equipaiset_lines,
        [String(preset.id)]: lines,
      },
    }));
  }

  function resetChanges() {
    if (hasEdits() && !window.confirm(t("丢弃所有未保存的修改？"))) return;
    setEdits(EMPTY_EDITS);
    setEditEpoch((n) => n + 1);
    setExportMsg("修改已重置。");
  }

  function downloadEdits() {
    const name = `mission_edits_${timeStamp()}.json`;
    const blob = new Blob([JSON.stringify(edits, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  }

  function applyImportedEdits(label: string, imported: Edits) {
    const skills = new Map(
      (doc?.skills ?? []).map((sk) => [sk.id, sk] as const)
    );
    setEdits(refreshEditsSkillNames(imported, skills));
    const usedSequences = imported.equipaiset_creates
      .map((create) => Number(String(create.key).match(/(\d+)$/)?.[1] || 0))
      .filter((n) => Number.isFinite(n));
    setCreateSeq(Math.max(0, ...usedSequences) + 1);
    setEditEpoch((n) => n + 1);
    setExportMsg(
      `Imported ${label}: ${imported.unitsets.length} UnitSet edits, ` +
        `${imported.equipaiset_creates.length} new presets, ` +
        `${Object.keys(imported.equipaiset_lines).length} preset edits.`
    );
  }

  /** Pick the editor data file from a folder's contents (name + text pairs). */
  function pickEditsFile(
    files: { name: string; text: string }[]
  ): { name: string; text: string } | null {
    const base = (n: string) => n.split(/[/\\]/).pop()?.toLowerCase() || "";
    const jsons = files.filter((f) => base(f.name).endsWith(".json"));
    return (
      jsons.find((f) => base(f.name) === "mission_editor_edits.json") ||
      jsons.find((f) => base(f.name).startsWith("mission_edits")) ||
      // Ignore exporter side-cars that are not the edit set.
      jsons.find(
        (f) =>
          base(f.name) !== "export_meta.json" &&
          base(f.name) !== "equipaiset_line_overrides.json"
      ) ||
      null
    );
  }

  function importEditorText(label: string, text: string) {
    if (hasEdits() && !window.confirm(t("替换当前所有未保存的修改？"))) {
      return false;
    }
    const imported = parseImportedEdits(JSON.parse(text));
    if (!doc) throw new Error("目录正在加载。");
    validateEdits(imported, doc, true);
    applyImportedEdits(label, imported);
    return true;
  }

  async function onEditorImportInputChange(fileList: FileList | null) {
    if (!fileList?.length) return;
    try {
      const all = Array.from(fileList);
      if (all.length === 1 && all[0].name.toLowerCase().endsWith(".zip")) {
        const unzipped = await unzipTextFiles(await all[0].arrayBuffer());
        const hit = pickEditsFile(unzipped);
        if (!hit) {
          setExportMsg(
            "Import failed: that zip has no mission_editor_edits.json."
          );
          return;
        }
        importEditorText(hit.name.split(/[/\\]/).pop() || hit.name, hit.text);
        return;
      }
      // Single JSON file selected directly.
      if (all.length === 1 && all[0].name.toLowerCase().endsWith(".json")) {
        importEditorText(all[0].name, await all[0].text());
        return;
      }
      // Folder selected (webkitdirectory): find the edits JSON inside it.
      const files = await Promise.all(
        all
          .filter((f) => f.name.toLowerCase().endsWith(".json"))
          .map(async (f) => ({
            name:
              (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
              f.name,
            text: await f.text(),
          }))
      );
      const hit = pickEditsFile(files);
      if (!hit) {
        setExportMsg(
          "Import failed: no mission_editor_edits.json (or mission_edits*.json) in that folder."
        );
        return;
      }
      importEditorText(hit.name.split(/[/\\]/).pop() || hit.name, hit.text);
    } catch (e) {
      setExportMsg(`Import failed: ${String(e)}`);
    } finally {
      if (editorImportInputRef.current) {
        editorImportInputRef.current.value = "";
      }
    }
  }

  async function pickAndImportEditorData() {
    editorImportInputRef.current?.click();
  }

  function confirmSharedGear() {
    return window.confirm(t("装备修改可能影响所有引用相同 CharaSet 的单位。本编辑器无法自动克隆角色模板。确认允许全局装备影响并导出？"));
  }

  async function exportMod() {
    setExporting(true);
    setExportMsg("");
    const payload = sanitizeEditsForExport(edits);
    const modName = slugModName(
      modNameInput || `mission_squad_${timeStamp()}`
    );
    try {
      if (!doc) throw new Error("目录正在加载。");
      const built = prepareMissionPatch(payload, doc, target, confirmSharedGear, modName);
      if (built.content == null) { setExportMsg("没有修改，无需生成补丁。"); return; }
      const blob = zipStore(built.files);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${modName}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setExportMsg(
        `Downloaded ${modName}.zip (${built.patchCount} patches). Unzip and copy the folder into Ryujinx → Open Mods Directory.`
      );
    } catch (e) {
      setExportMsg(String(e));
    } finally {
      setExporting(false);
    }
  }

  if (err) {
    return (
      <div className="app">
        <p className="error">{err}</p>
        <p>
          请确认同源 <code>../data/mission_catalog.json.gz</code> 存在，且浏览器支持 DecompressionStream。
        </p>
      </div>
    );
  }
  if (!doc) return <div className="app">加载中…</div>;

  const slotAlloc =
    squad && slot
      ? edits.equipaiset_allocations.find(
          (a) => a.key === allocKey(squad.unitset_id, slot.slot)
        )
      : undefined;
  const classEntries = effectiveClassTactics.filter((entry) => {
    const q = classFilter.trim().toLowerCase();
    return (
      !q ||
      (entry.class_symbol+' '+t(entry.class_symbol)).toLowerCase().includes(q) ||
      String(entry.class_id).includes(q)
    );
  });
  const selectedClass =
    effectiveClassTactics.find((entry) => entry.class_id === classId) ??
    classEntries[0] ??
    null;

  const selectedEquiptype =
    (doc.equiptype_items ?? []).find((e) => e.id === equiptypeId) ??
    equiptypeEntries[0] ??
    null;

  // Map every edited unit slot to its (pending) EquipAiSet id so Affects reflects
  // reassignments before export.
  const editedUnitTarget = new Map<string, number>();
  for (const u of edits.unitsets) {
    for (const s of u.slots) {
      editedUnitTarget.set(`${u.unitset_id}:${s.slot}`, s.equipaiset_id);
    }
  }

  /** Live unit identity after pending CharaSet / class swaps (not ROM baseline). */
  function liveUnitIdentity(
    unitsetId: number,
    slotNum: number
  ): {
    unit: string;
    charaset_id: number;
    charaset_symbol: string;
    class_id: number;
    class_symbol: string;
  } | null {
    const hit = unitIndex.get(`${unitsetId}:${slotNum}`);
    const e = unitSlotEdits.get(`${unitsetId}:${slotNum}`);
    if (!hit && !e) return null;
    if (e) {
      if (!e.charaset_id) {
        return {
          unit: "(empty)",
          charaset_id: 0,
          charaset_symbol: "",
          class_id: 0,
          class_symbol: "",
        };
      }
      const base = hit?.slot;
      const fromBase = !!base && base.charaset_id === e.charaset_id;
      const catalog = charasetById.get(e.charaset_id);
      return {
        unit: fromBase
          ? base.chara_name || base.charaset_symbol
          : catalog?.name || catalog?.symbol || `CharaSet ${e.charaset_id}`,
        charaset_id: e.charaset_id,
        charaset_symbol: fromBase
          ? base.charaset_symbol
          : catalog?.symbol || "",
        class_id: fromBase ? base.class_id : catalog?.class_id || 0,
        class_symbol: fromBase
          ? base.class_symbol
          : catalog?.class_symbol || "",
      };
    }
    const sl = hit!.slot;
    return {
      unit: sl.chara_name || sl.charaset_symbol,
      charaset_id: sl.charaset_id,
      charaset_symbol: sl.charaset_symbol,
      class_id: sl.class_id,
      class_symbol: sl.class_symbol,
    };
  }

  function buildPendingRef(unitsetId: number, slotNum: number): PresetRef | null {
    const hit = unitIndex.get(`${unitsetId}:${slotNum}`);
    if (!hit) return null;
    const identity = liveUnitIdentity(unitsetId, slotNum);
    if (!identity || !identity.charaset_id) return null;
    const { mission: mi, squad: sq } = hit;
    const lvl = Number(mi.enemy_level);
    const hasLevel = Number.isFinite(lvl) && lvl > 0;
    return {
      unitset_id: unitsetId,
      unitset_symbol: sq.unitset_symbol,
      squad_name: sq.unitset_symbol.replace("UC_UNITSET_", ""),
      slot: slotNum,
      unit: identity.unit,
      quest_symbol: mi.quest_symbol,
      stage_name: mi.stage_name,
      context: mi.stage_name,
      charaset_id: identity.charaset_id,
      charaset_symbol: identity.charaset_symbol,
      class_id: identity.class_id,
      class_symbol: identity.class_symbol,
      resolution: hasLevel
        ? { level_source: "stage", enemy_level: lvl }
        : { level_source: "assumed", assumed_level: 1 },
    };
  }

  function enrichRef(ref: PresetRef): PresetRef {
    const identity = liveUnitIdentity(ref.unitset_id, ref.slot);
    if (!identity) return ref;
    if (
      identity.charaset_id === ref.charaset_id &&
      identity.class_id === ref.class_id &&
      identity.unit === ref.unit
    ) {
      return ref;
    }
    return {
      ...ref,
      unit: identity.unit,
      charaset_id: identity.charaset_id,
      charaset_symbol: identity.charaset_symbol,
      class_id: identity.class_id,
      class_symbol: identity.class_symbol,
    };
  }

  function withPendingRefs(entry: EquipAiPreset): EquipAiPreset {
    if (editedUnitTarget.size === 0) return entry;
    const base = (entry.references ?? []).filter((r) => {
      const t = editedUnitTarget.get(`${r.unitset_id}:${r.slot}`);
      return t === undefined || t === entry.id;
    });
    const seen = new Set(base.map((r) => `${r.unitset_id}:${r.slot}`));
    const pend: PresetRef[] = [];
    for (const [k, t] of editedUnitTarget) {
      if (t !== entry.id || seen.has(k)) continue;
      const [usid, sn] = k.split(":").map(Number);
      const ref = buildPendingRef(usid, sn);
      if (ref) pend.push(ref);
    }
    const references = [...base, ...pend].map(enrichRef);
    const changed =
      pend.length > 0 ||
      references.length !== (entry.references?.length ?? 0) ||
      references.some((r, i) => {
        const prev = (entry.references ?? [])[i];
        return (
          !prev ||
          prev.charaset_id !== r.charaset_id ||
          prev.class_id !== r.class_id ||
          prev.unit !== r.unit
        );
      });
    if (!changed) return entry;
    return { ...entry, references, usage: references.length };
  }

  const allPresetEntries = [...syntheticPresets, ...(doc.equipaiset_presets ?? [])]
    .map(withPendingRefs)
    .filter(
    (entry) => {
      if (presetMissionUnitsets) {
        const usedHere = (entry.references ?? []).some((r) =>
          presetMissionUnitsets.has(r.unitset_id)
        );
        if (!usedHere) return false;
      }
      const q = presetFilter.trim().toLowerCase();
      if (!q) return true;
      if (
        entry.symbol.toLowerCase().includes(q) ||
        String(entry.id).includes(q)
      ) {
        return true;
      }
      return (entry.references ?? []).some((r) => {
        const hay = [
          r.stage_name,
          r.quest_symbol,
          r.context,
          r.unit,
          r.squad_name,
          r.unitset_symbol,
          r.class_symbol,
          r.charaset_symbol,
        ]
          .filter(Boolean)
          .join(" ");
        return hay.toLowerCase().includes(q) || t(hay).toLowerCase().includes(q);
      });
    }
  );

  function presetMissionHitLabel(entry: EquipAiPreset): string {
    if (!presetMissionUnitsets) return "";
    const hits = (entry.references ?? []).filter((r) =>
      presetMissionUnitsets.has(r.unitset_id)
    );
    if (!hits.length) return "";
    const names = hits
      .map((r) => r.unit || r.class_symbol || r.squad_name)
      .filter(Boolean)
      .slice(0, 3);
    const extra = hits.length > names.length ? ` +${hits.length - names.length}` : "";
    return `${hits.length} in mission · ${names.join(", ")}${extra}`;
  }
  const selectedPreset =
    allPresetEntries.find((entry) => entry.id === presetId) ??
    allPresetEntries[0] ??
    null;

  return (
    <div className="app">
      <details className="module-tools">
      <summary>导入 / 独立导出</summary>
      <header className="header">
        <div>
          <p className="sub">
            {TARGETS[target].name} · TitleID {TARGETS[target].titleId} · 独立 ExeFS 补丁包
          </p>
          <p className="hint">底部「保存工程 / 导出 MOD 包」包含这里的修改，并统一检查冲突；这里也可单独导出。导入 pchtxt 仅用于预览，不会暗中合并进导出包。</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={() => void pickAndLoadMods()}
            disabled={modLoading}
            title="Open a mod folder and apply its .pchtxt to class/item preview"
          >
            {modLoading ? "加载补丁中…" : "加载 pchtxt 文件夹…"}
          </button>
          {loadedModPaths.length > 0 && (
            <button type="button" onClick={clearLoadedMods} disabled={modLoading}>
              清除补丁预览
            </button>
          )}
          <input
            ref={modFolderInputRef}
            type="file"
            // @ts-expect-error non-standard folder selection
            webkitdirectory=""
            multiple
            style={{ display: "none" }}
            onChange={(e) => void onModFolderInputChange(e.target.files)}
          />
          <label className="mod-name-field">
            MOD 文件夹名称
            <input
              type="text"
              placeholder={`mission_squad_${timeStamp()}`}
              value={modNameInput}
              onChange={(e) => setModNameInput(e.target.value)}
            />
          </label>
          <button type="button" onClick={resetChanges} disabled={!hasEdits()}>
            重置修改
          </button>
          <button type="button" onClick={downloadEdits} disabled={!hasEdits()}>
            下载编辑 JSON
          </button>
          <button
            type="button"
            onClick={() => void pickAndImportEditorData()}
            title="Pick an exported zip, a mod folder, or mission_editor_edits.json"
          >
            导入编辑 JSON / ZIP…
          </button>
          <input
            ref={editorImportInputRef}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            style={{ display: "none" }}
            onChange={(e) => void onEditorImportInputChange(e.target.files)}
          />
          <button
            type="button"
            className="primary"
            disabled={exporting || !hasEdits()}
            onClick={() => void exportMod()}
            title="Downloads a zip with exefs/main.pchtxt — copy that folder into Ryujinx"
          >
            {exporting ? "导出中…" : "导出独立 MOD ZIP"}
          </button>
        </div>
      </header>
      </details>
      {modStatus && <p className="export-msg">{modStatus}</p>}
      {exportMsg && <p className="export-msg">{exportMsg}</p>}

      <nav className="view-tabs" hidden>
        <button
          type="button"
          className={view === "missions" ? "active" : ""}
          onClick={() => setView("missions")}
        >
          关卡编队
        </button>
        <button
          type="button"
          className={view === "classes" ? "active" : ""}
          onClick={() => setView("classes")}
        >
          职业默认战术
        </button>
        <button
          type="button"
          className={view === "presets" ? "active" : ""}
          onClick={() => setView("presets")}
        >
          命名战术预设
        </button>
        <button
          type="button"
          className={view === "equiptypes" ? "active" : ""}
          onClick={() => setView("equiptypes")}
        >
          职业默认装备
        </button>
      </nav>

      {view === "missions" ? <div className="layout">
        <aside className="panel">
          <input
            className="search"
            placeholder="筛选关卡、单位、职业…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="sort-row">
            地区
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
            >
              <option value="ALL">全部地区</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="sort-row">
            排序
            <select
              value={missionSort}
              onChange={(e) =>
                setMissionSort(e.target.value === "level" ? "level" : "name")
              }
            >
              <option value="name">名称</option>
              <option value="level">等级</option>
            </select>
          </label>
          <ul className="list">
            {missions.map((m) => (
              <li key={m.quest_id}>
                <button
                  type="button"
                  className={m.quest_id === missionId ? "active" : ""}
                  onClick={() => {
                    setMissionId(m.quest_id);
                    setPresetMissionId(m.quest_id);
                    setSquadId(null);
                  }}
                >
                  <strong>{m.stage_name || m.quest_symbol}</strong>
                  <span>
                    {m.region} · Lv {m.enemy_level || "?"} · {m.squads.length}{" "}
                    编队
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="panel">
          <div className="row">
            <h2>{mission?.stage_name || "关卡"}</h2>
            <div className="row-actions">
              {mission && (
                <button
                  type="button"
                  title="Show EquipAiSet presets used by this mission"
                  onClick={() => {
                    setPresetMissionId(mission.quest_id);
                    setView("presets");
                  }}
                >
                  本关卡战术预设
                </button>
              )}
              <select
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value)}
              >
                <option value="EN">敌方</option>
                <option value="NE">中立 NE</option>
                <option value="NT">中立 NT</option>
                <option value="FR">友方</option>
                <option value="PL">玩家</option>
                <option value="ALL">全部</option>
              </select>
            </div>
          </div>
          <ul className="list">
            {squads.map((s) => (
              <li key={s.unitset_id}>
                <button
                  type="button"
                  className={
                    s.unitset_id === (squad?.unitset_id ?? -1) ? "active" : ""
                  }
                  onClick={() => setSquadId(s.unitset_id)}
                >
                  <strong>{s.unitset_symbol.replace("UC_UNITSET_", "")}</strong>
                  <span>
                    {s.side}
                    {s.paramset_name ? ` · ${s.paramset_name}` : ""}
                    {" · "}
                    {s.slots.filter((sl) => sl.charaset_id > 0).length} 单位
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel wide">
          {!slot || !squad ? (
            <p>请选择关卡、编队及单位。</p>
          ) : (
            <UnitPanel
              key={`${squad.unitset_id}-${slot.slot}-${editEpoch}`}
              slot={slot}
              squad={squad}
              missionLevel={Number(mission?.enemy_level) || 1}
              itemOptions={itemOptions}
              charasetOptions={charasetOptions}
              charasetById={charasetById}
              ifOptions={ifOptions}
              presets={doc.equipaiset_presets ?? []}
              creates={edits.equipaiset_creates}
              allocation={slotAlloc}
              editedPresetLines={
                slot.equipaiset_id > 0
                  ? edits.equipaiset_lines[String(slot.equipaiset_id)]
                  : undefined
              }
              classTactics={effectiveClassTactics}
              itemSkills={itemSkillMap}
              ifMap={ifMap}
              skillMap={skillMap}
              sharedPreset={
                slot.equipaiset_id === 0 ||
                (equipAiUsage.get(slot.equipaiset_id) || 0) > 1
              }
              onSelectSlot={setSlotIdx}
              onSwapSlots={swapFormationSlots}
              onChangeSlot={(s, extra) => {
                upsertUnitSlot(s, extra);
              }}
              onChangeGear={(s) => {
                upsertGear(s);
              }}
              baselineGear={(() => {
                const base = rawSquad?.slots.find((s) => s.slot === slot.slot);
                if (base && base.charaset_id === slot.charaset_id) {
                  return cloneGear(base.gear);
                }
                return catalogGearRows(charasetById.get(slot.charaset_id));
              })()}
              onChangeLines={(lines) => commitTacticsLines(slot, lines)}
              onCreateEmptyPreset={() => createEmptyPreset(slot.equipaiset_id)}
              onOpenPreset={(id) => {
                setPresetId(id);
                setView("presets");
              }}
            />
          )}
        </section>
      </div> : view === "classes" ? (
        <div className="catalog-layout">
          <aside className="panel">
            <input
              className="search"
              placeholder="筛选职业…"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            />
            <ul className="list">
              {classEntries.map((entry) => (
                <li key={entry.class_id}>
                  <button
                    type="button"
                    className={entry.class_id === selectedClass?.class_id ? "active" : ""}
                    onClick={() => setClassId(entry.class_id)}
                  >
                    <strong>{entry.class_symbol}</strong>
                    <span>职业 {entry.class_id} · {entry.lines.length} 技能</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <section className="panel wide">
            {selectedClass ? (
              <ClassTacticsPanel
                key={`${selectedClass.class_id}-${editEpoch}`}
                entry={
                  effectiveClassTactics.find(
                    (c) => c.class_id === selectedClass.class_id
                  ) ?? selectedClass
                }
                editedLines={
                  edits.class_tactics.find((x) => x.class_id === selectedClass.class_id)
                    ?.lines
                }
                skillOptions={skillOptions}
                skillsById={skillsById}
                ifOptions={ifOptions}
                onChange={(lines) => commitClassTactics(selectedClass, lines)}
              />
            ) : (
              <p>无职业数据。</p>
            )}
          </section>
        </div>
      ) : view === "presets" ? (
        <div className="catalog-layout">
          <aside className="panel">
            <label className="sort-row">
              关卡
              <select
                value={presetMissionId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    setPresetMissionId(null);
                    return;
                  }
                  const id = Number(v);
                  setPresetMissionId(id);
                  setMissionId(id);
                  setSquadId(null);
                }}
              >
                <option value="">全部关卡</option>
                {missionsByName.map((m) => (
                  <option key={m.quest_id} value={m.quest_id}>
                    {m.stage_name || m.quest_symbol}
                    {m.region ? ` (${m.region})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <input
                className="search"
                placeholder="Filter presets, units, missions…"
                value={presetFilter}
                onChange={(e) => setPresetFilter(e.target.value)}
              />
              <button type="button" onClick={() => createEmptyPreset(0)}>
                新建空预设
              </button>
              <button type="button" disabled={!selectedPreset} onClick={() => {
                if (!selectedPreset) return;
                const lines = edits.equipaiset_lines[String(selectedPreset.id)] ?? selectedPreset.lines;
                createEmptyPreset(selectedPreset.id, lines, `${selectedPreset.symbol}_副本`);
              }}>复制当前预设</button>
            </div>
            {presetMissionId != null && (
              <p className="hint filter-hint">
                当前关卡的预设：{" "}
                <strong>{presetMissionLabel || "selected mission"}</strong>
                {" · "}
                {allPresetEntries.length} 匹配
                {allPresetEntries.length === 1 ? "" : "es"}
                {" · "}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setPresetMissionId(null)}
                >
                  清除
                </button>
              </p>
            )}
            <ul className="list">
              {allPresetEntries.map((entry) => {
                const missionHit = presetMissionHitLabel(entry);
                const fallbackRef = entry.references?.[0];
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={entry.id === selectedPreset?.id ? "active" : ""}
                      onClick={() => setPresetId(entry.id)}
                    >
                      <strong>{entry.symbol || `EquipAiSet ${entry.id}`}</strong>
                      <span>
                        {entry.id < 0
                          ? "New (unexported)"
                          : `ID ${entry.id} · ${entry.usage} ref${entry.usage === 1 ? "" : "s"}`}
                        {missionHit
                          ? ` · ${missionHit}`
                          : fallbackRef
                            ? ` · ${fallbackRef.unit || fallbackRef.squad_name}${
                                fallbackRef.stage_name
                                  ? ` · ${fallbackRef.stage_name}`
                                  : fallbackRef.context
                                    ? ` · ${fallbackRef.context}`
                                    : ""
                              }`
                            : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          <section className="panel wide">
            {selectedPreset ? (
              <PresetPanel
                key={`${selectedPreset.id}-${editEpoch}-${loadedModPaths.join("|")}`}
                preset={selectedPreset}
                editedLines={
                  selectedPreset.id < 0
                    ? edits.equipaiset_creates.find(
                        (c) => c.temp_id === selectedPreset.id
                      )?.lines
                    : edits.equipaiset_lines[String(selectedPreset.id)]
                }
                ifOptions={ifOptions}
                skillOptions={skillOptions}
                classTactics={effectiveClassTactics}
                ifMap={ifMap}
                skillMap={skillMap}
                itemSkills={itemSkillMap}
                focusUnitsetIds={presetMissionUnitsets}
                focusMissionLabel={presetMissionLabel}
                onRename={
                  selectedPreset.id < 0
                    ? (symbol) => {
                        const c = edits.equipaiset_creates.find(
                          (x) => x.temp_id === selectedPreset.id
                        );
                        if (c) commitCreateSymbol(c.key, symbol);
                      }
                    : undefined
                }
                onChange={(lines) => {
                  if (selectedPreset.id < 0) {
                    const c = edits.equipaiset_creates.find(
                      (x) => x.temp_id === selectedPreset.id
                    );
                    if (c) commitCreateLines(c.key, lines);
                  } else {
                    commitPresetLines(selectedPreset, lines);
                  }
                }}
              />
            ) : (
              <p>
                {presetMissionId != null
                  ? "No presets used by this mission (units may all use Preset 0)."
                  : "No non-zero presets."}
              </p>
            )}
          </section>
        </div>
      ) : (
        <div className="catalog-layout">
          <aside className="panel">
            <details>
            <summary>默认装备规则</summary>
            <p className="hint">
              CreateDefaultEquip 默认装备表。职业表仅存储 DEFAULT_* 槽位 <em>类型</em> （如 lance、sword、_M）；运行时加上档位×11，并按等级选列。普通关卡敌人使用{" "}
              <strong>NORMAL_*</strong> （并非 DEFAULT_*）。ZAKO 限定为 DEFAULT_*；POWER/BOSS 使用相应档位。ENEMY_* 在限定后不使用。请按需要修改不同档位，不要只改 DEFAULT_*。
            </p>
            </details>
            <input
              className="search"
              placeholder="筛选默认装备 / 道具…"
              value={equiptypeFilter}
              onChange={(e) => setEquiptypeFilter(e.target.value)}
            />
            <ul className="list">
              {equiptypeEntries.map((entry) => {
                const dirty = edits.equiptype_items.some(
                  (x) => x.equiptype_id === entry.id
                );
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={
                        entry.id === selectedEquiptype?.id ? "active" : ""
                      }
                      onClick={() => setEquiptypeId(entry.id)}
                    >
                      <strong>
                        {entry.symbol}
                        {dirty ? " *" : ""}
                      </strong>
                      <span>#{entry.id}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>
          <section className="panel wide">
            {selectedEquiptype ? (
              <EquiptypeItemsPanel
                key={`${selectedEquiptype.id}-${editEpoch}`}
                entry={selectedEquiptype}
                edited={edits.equiptype_items.find(
                  (x) => x.equiptype_id === selectedEquiptype.id
                )}
                itemOptions={itemOptions}
                onChange={(cols) =>
                  commitEquiptypeItems(selectedEquiptype, cols)
                }
              />
            ) : (
              <p>目录缺少默认装备数据。</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function EquiptypeItemsPanel({
  entry,
  edited,
  itemOptions,
  onChange,
}: {
  entry: EquiptypeItem;
  edited?: Edits["equiptype_items"][number];
  itemOptions: ComboboxOption[];
  onChange: (cols: [number, number, number]) => void;
}) {
  const cols: [number, number, number] = [
    edited?.item_col0_id ?? entry.item_col0_id,
    edited?.item_col1_id ?? entry.item_col1_id,
    edited?.item_col2_id ?? entry.item_col2_id,
  ];
  const labels = ["Lv 1–14", "Lv 15–27", "Lv 28–50"];

  function setCol(index: number, itemId: number) {
    const next: [number, number, number] = [...cols];
    next[index] = itemId;
    onChange(next);
  }

  return (
    <div>
      <h2>{entry.symbol}</h2>
      <details>
      <summary>默认装备规则</summary>
      <p className="hint">
        默认装备类型 #{entry.id}。CharaSet 空装备槽按职业基础类型加档位×11，选择此行。
        {entry.symbol.startsWith("DEFAULT_")
          ? " DEFAULT_* is only ZAKO / clamped-DEFAULT — most mission enemies use the matching NORMAL_* row instead."
          : entry.symbol.startsWith("ENEMY_")
            ? " ENEMY_* is unused: ZAKO clamps to DEFAULT_*."
            : entry.symbol.startsWith("NORMAL_")
              ? " NORMAL_* is the band most mission / fodder enemies use."
              : ""}{" "}
        关卡默认装备显示来自目录快照；修改默认装备表不会重算关卡显示，实际游戏按新表生成。
      </p>
      </details>
      <div className="equiptype-cols">
        {labels.map((label, i) => (
          <label key={label} className="equiptype-col">
            <span>{label}</span>
            <div className="gear-slot-row">
              <SearchableCombobox
                options={itemOptions}
                value={cols[i]}
                onChange={(id) => setCol(i, id)}
              />
              <button
                type="button"
                className="gear-clear"
                title="清空此装备槽"
                aria-label={`清空装备档位 ${i + 1}`}
                onClick={() => setCol(i, 0)}
              >
                ×
              </button>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function ClassTacticsPanel({
  entry,
  editedLines,
  skillOptions,
  skillsById,
  ifOptions,
  onChange,
}: {
  entry: ClassTactics;
  editedLines?: Line[];
  skillOptions: ComboboxOption[];
  skillsById: Map<number, CatalogEntry>;
  ifOptions: ComboboxOption[];
  onChange: (lines: Line[]) => void;
}) {
  const [lines, setLines] = useState<Line[]>(editedLines ?? entry.lines);
  const actions = [6, 5, 4, 3, 10, 9, 8, 7];

  function setActionLine(action: number, patch: Partial<Line>) {
    const existing = lines.find((line) => line.action === action);
    const nextLine = { action, if0: 0, if1: 0, learn_level: 1, ...existing, ...patch };
    let next = lines.filter((line) => line.action !== action);
    if (nextLine.skill_id) next.push(nextLine);
    next = next.sort((a, b) => actions.indexOf(a.action) - actions.indexOf(b.action));
    setLines(next);
    onChange(next);
  }

  return (
    <div>
      <h2>{entry.class_symbol}</h2>
      <p className="sub">职业 {entry.class_id}</p>
      <div className="meta-box">
        <strong>全局职业战术</strong>
        <p className="hint">
          技能槽与学习等级影响该职业的所有敌我单位。IF0/IF1 存储在技能表中，会全局影响使用该技能的职业。运行时主动槽按 4→1 排列，随后被动槽按 4→1 排列。
        </p>
      </div>
      <div className="class-lines">
        {actions.map((action) => {
          const line = lines.find((x) => x.action === action);
          const passive = action >= 7;
          const slotNumber = passive ? action - 6 : action - 2;
          return (
            <div className="class-line-row" key={action}>
              <strong>{passive ? "Passive" : "Active"} {slotNumber}</strong>
              <label>
                技能
                <SearchableCombobox
                  options={skillOptions.filter((option) => {
                    if (!option.id) return true;
                    const skill = skillsById.get(option.id);
                    return passive
                      ? skill?.kind === "passive"
                      : skill?.kind === "active";
                  })}
                  value={line?.skill_id || 0}
                  emptyLabel="Empty slot"
                  onChange={(id) => {
                    const skill = skillsById.get(id);
                    setActionLine(action, {
                      skill_id: id || undefined,
                      skill_symbol: skill?.symbol || "",
                      skill_name: skill?.name || "",
                      if0: id === line?.skill_id ? line?.if0 || 0 : 0,
                      if1: id === line?.skill_id ? line?.if1 || 0 : 0,
                    });
                  }}
                />
              </label>
              <label>
                学习等级
                <input
                  type="number"
                  min={1}
                  max={99}
                  disabled={!line?.skill_id}
                  value={line?.learn_level || 1}
                  onChange={(e) =>
                    setActionLine(action, {
                      learn_level: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                />
              </label>
              <label>
                默认条件 IF0
                {line?.skill_id && line.skill_id <= 470 ? (
                  <SearchableCombobox
                    options={ifOptions}
                    value={line.if0 || 0}
                    onChange={(id) =>
                      setActionLine(action, {
                        if0: id,
                        if0_symbol: ifOptions.find((x) => x.id === id)?.label || "",
                      })
                    }
                  />
                ) : (
                  <span className="readonly-skill">
                    {line?.skill_id ? "No default-IF row" : "(empty)"}
                  </span>
                )}
              </label>
              <label>
                默认条件 IF1
                {line?.skill_id && line.skill_id <= 470 ? (
                  <SearchableCombobox
                    options={ifOptions}
                    value={line.if1 || 0}
                    onChange={(id) =>
                      setActionLine(action, {
                        if1: id,
                        if1_symbol: ifOptions.find((x) => x.id === id)?.label || "",
                      })
                    }
                  />
                ) : (
                  <span className="readonly-skill">
                    {line?.skill_id ? "No default-IF row" : "(empty)"}
                  </span>
                )}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PresetPanel({
  preset,
  editedLines,
  ifOptions,
  skillOptions,
  classTactics,
  ifMap,
  skillMap,
  itemSkills,
  focusUnitsetIds,
  focusMissionLabel,
  onRename,
  onChange,
}: {
  preset: EquipAiPreset;
  editedLines?: Line[];
  ifOptions: ComboboxOption[];
  skillOptions: ComboboxOption[];
  classTactics: ClassTactics[];
  ifMap: Map<number, string>;
  skillMap: Map<number, { id: number; symbol?: string; name?: string }>;
  itemSkills: Map<number, ItemSkill>;
  focusUnitsetIds?: Set<number> | null;
  focusMissionLabel?: string;
  onRename?: (symbol: string) => void;
  onChange: (lines: Line[]) => void;
}) {
  function orderLegacyLines(source: Line[]): Line[] {
    return source
      .map((line, originalIndex) => ({ line, originalIndex }))
      .sort(
        (a, b) =>
          (a.line.slot ?? a.originalIndex) - (b.line.slot ?? b.originalIndex)
      )
      .map(({ line }, slot) => ({ ...line, slot }));
  }

  function commitLines(source: Line[]) {
    const next = source.map((line, slot) => ({ ...line, slot }));
    setLines(next);
    onChange(next);
  }

  const [lines, setLines] = useState<Line[]>(() =>
    orderLegacyLines(editedLines ?? preset.lines)
  );
  const [selectedRefKey, setSelectedRefKey] = useState<string | null>(null);
  const [showAllRefs, setShowAllRefs] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    setLines(orderLegacyLines(editedLines ?? preset.lines));
  }, [editedLines, preset.lines, preset.id]);

  useEffect(() => {
    setShowAllRefs(false);
  }, [preset.id, focusUnitsetIds]);

  const orderedRefs = useMemo(() => {
    const refs = preset.references ?? [];
    if (!focusUnitsetIds) return refs.map((ref, i) => ({ ref, i }));
    const focused: { ref: PresetRef; i: number }[] = [];
    const other: { ref: PresetRef; i: number }[] = [];
    refs.forEach((ref, i) => {
      (focusUnitsetIds.has(ref.unitset_id) ? focused : other).push({ ref, i });
    });
    return [...focused, ...other];
  }, [preset.references, focusUnitsetIds]);

  const focusedCount = useMemo(() => {
    if (!focusUnitsetIds) return 0;
    return (preset.references ?? []).filter((r) =>
      focusUnitsetIds.has(r.unitset_id)
    ).length;
  }, [preset.references, focusUnitsetIds]);

  const visibleRefs = useMemo(() => {
    if (!focusUnitsetIds || showAllRefs) return orderedRefs;
    const only = orderedRefs.filter(({ ref }) =>
      focusUnitsetIds.has(ref.unitset_id)
    );
    return only.length ? only : orderedRefs;
  }, [orderedRefs, focusUnitsetIds, showAllRefs]);

  useEffect(() => {
    if (!visibleRefs.length) {
      setSelectedRefKey(null);
      return;
    }
    const preferred = visibleRefs[0];
    const key = `${preferred.ref.unitset_id}-${preferred.ref.slot}-${preferred.i}`;
    setSelectedRefKey((prev) => {
      if (
        prev &&
        visibleRefs.some(
          ({ ref, i }) => `${ref.unitset_id}-${ref.slot}-${i}` === prev
        )
      ) {
        return prev;
      }
      return key;
    });
  }, [preset.id, visibleRefs]);

  function update(index: number, patch: Partial<Line>) {
    const next = lines.map((line, i) => (i === index ? { ...line, ...patch } : line));
    commitLines(next);
  }

  function dropLine(targetIndex: number) {
    if (dragIndex == null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    const next = [...lines];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    commitLines(next);
    setDragIndex(null);
  }

  const selectedRef = useMemo(() => {
    if (!preset.references?.length || !selectedRefKey) return null;
    return (
      preset.references.find(
        (ref, i) => `${ref.unitset_id}-${ref.slot}-${i}` === selectedRefKey
      ) ?? preset.references[0]
    );
  }, [preset.references, selectedRefKey]);

  // Keep a preview target even when the selection is briefly cleared by
  // re-renders while editing, so the Final results table never disappears.
  const effectiveRef = useMemo(
    () => selectedRef ?? preset.references?.[0] ?? null,
    [selectedRef, preset.references]
  );

  const previewClassLines = useMemo(() => {
    const cid = effectiveRef?.class_id;
    if (cid == null) return [] as ClassLine[];
    return (classTactics.find((c) => c.class_id === cid)?.lines ?? []) as ClassLine[];
  }, [classTactics, effectiveRef]);

  const finalResults = useMemo(() => {
    const level =
      effectiveRef?.resolution?.level_source === "stage"
        ? effectiveRef.resolution.enemy_level ?? 1
        : effectiveRef?.resolution?.assumed_level ?? 1;
    return tacticsForPreset(
      previewClassLines,
      level || 1,
      lines as ResolveLine[],
      skillMap,
      ifMap
    );
  }, [effectiveRef, previewClassLines, lines, skillMap, ifMap]);

  const availableIds = useMemo(() => {
    const gearIds = (effectiveRef?.resolution?.gear ?? [])
      .map((g) => g.item_id ?? 0)
      .filter((id) => id > 0);
    return availableSkillIds(previewClassLines, gearIds, itemSkills);
  }, [previewClassLines, effectiveRef, itemSkills]);

  // A preset made only of class-slot markers just re-emits the unit's own class
  // skills, so it behaves the same as no preset (id 0 / default).
  const markerOnlyPreset = useMemo(
    () =>
      lines.length > 0 &&
      lines.every((l) => isClassMarker((l.skill_id ?? l.action) as number)),
    [lines]
  );

  const missingExplicitCount = useMemo(
    () =>
      previewClassLines.length
        ? finalResults.filter((l) => isMissingExplicit(l, availableIds)).length
        : 0,
    [finalResults, availableIds, previewClassLines]
  );

  return (
    <div>
      {preset.id < 0 && onRename ? (
        <label className="new-preset-name">
          新预设名称
          <input
            type="text"
            value={preset.symbol}
            placeholder={`NEW_PRESET_${Math.abs(preset.id)}`}
            onChange={(e) => onRename(e.target.value)}
            onBlur={(e) => {
              if (!e.target.value.trim()) {
                onRename(`NEW_PRESET_${Math.abs(preset.id)}`);
              } else if (e.target.value !== e.target.value.trim()) {
                onRename(e.target.value.trim());
              }
            }}
          />
        </label>
      ) : (
        <h2>{preset.symbol || `EquipAiSet ${preset.id}`}</h2>
      )}
      <p className="sub">
        {preset.id < 0
          ? "New preset (empty until you add slots; export allocates a free id)"
          : `ID ${preset.id} · ${preset.usage} UnitSet references · Skill-AI ${preset.skill_ai_id} · counts ${preset.count_a}/${preset.count_b}`}
      </p>
      <div className="meta-box">
        <strong>共享战术预设</strong>
        <p className="hint">
          非零预设使用战术表 <code>0x270AF48</code> （标记 3–10 指职业主动/被动槽，也可指定技能 ID）。装备技能{" "}
          <em>不会</em> 自动加入；需要时须显式添加。非零预设为空时，游戏中没有战术。
        </p>
      </div>

      <h3>
        影响引用（{preset.references?.length ?? 0}
        {focusUnitsetIds && focusedCount > 0
          ? ` · ${focusedCount} in ${focusMissionLabel || "mission"}`
          : ""}
        )
      </h3>
      {focusUnitsetIds && focusedCount > 0 && (preset.references?.length ?? 0) > focusedCount && (
        <p className="hint filter-hint">
          {showAllRefs
            ? "Showing all references."
            : `Showing only units from ${focusMissionLabel || "this mission"}.`}
          {" · "}
          <button
            type="button"
            className="linkish"
            onClick={() => setShowAllRefs((v) => !v)}
          >
            {showAllRefs ? "Show mission only" : "Show all refs"}
          </button>
        </p>
      )}
      {(preset.references?.length ?? 0) === 0 ? (
        <p className="hint">
          {preset.id < 0
            ? "Not assigned to any unit yet."
            : "Not referenced by any UnitSet."}
        </p>
      ) : (
        <ul className="ref-list">
          {visibleRefs.map(({ ref, i }) => {
            const key = `${ref.unitset_id}-${ref.slot}-${i}`;
            const level =
              ref.resolution?.level_source === "stage"
                ? ref.resolution.enemy_level
                : ref.resolution?.assumed_level;
            const levelLabel =
              ref.resolution?.level_source === "stage"
                ? `Lv ${level}`
                : `Lv? assumed ${level ?? 1}`;
            const selected = selectedRefKey === key;
            const inFocus = focusUnitsetIds?.has(ref.unitset_id);
            return (
              <li
                key={key}
                className={[
                  selected ? "ref-selected" : "",
                  inFocus ? "ref-mission-hit" : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined}
              >
                <button
                  type="button"
                  className="ref-toggle"
                  onClick={() => setSelectedRefKey(key)}
                >
                  <strong>
                    {ref.unit || ref.charaset_symbol || "Unit"}
                    {ref.class_symbol ? ` · ${ref.class_symbol}` : ""}
                    {inFocus ? " · this mission" : ""}
                  </strong>
                  <span>
                    {ref.context || ref.stage_name || ref.quest_symbol || "—"}
                    {" · "}
                    {ref.squad_name} · slot {ref.slot}
                    {` · ${levelLabel}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h3>（一）预设战术编辑</h3>
      {lines.length === 0 && (
        <p className="hint">空列表：创建后必须分配给单位才会生效。</p>
      )}
      {markerOnlyPreset && (
        <div className="warn-box">
          <strong>此预设仅引用职业技能槽，请核对行数、顺序和条件。</strong>
          <p>
            每行均为职业技能槽标记，按单位职业解析。行数、顺序和条件仍可能与默认战术不同。也可添加 <em>显式</em> 技能，或修改顺序及 IF 条件。
          </p>
        </div>
      )}
      {lines.map((line, index) => {
        const sid = line.skill_id ?? line.action;
        const marker = isClassMarker(sid);
        const hint =
          marker && previewClassLines.length
            ? resolveMarkerHint(sid, previewClassLines)
            : marker
              ? {
                  skill_name: line.resolved_skill_name || "",
                  skill_symbol: line.resolved_skill_symbol || "",
                  skill_id: line.resolved_skill_id || 0,
                }
              : null;
        return (
          <div
            className={`preset-line-row${dragIndex === index ? " dragging" : ""}`}
            key={`${index}-${line.skill_id ?? line.action}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              dropLine(index);
            }}
          >
            <span
              className="drag-handle"
              draggable
              role="button"
              tabIndex={0}
              title={`Drag to reorder effect ${index}`}
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(index));
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <span aria-hidden="true">⋮⋮</span>
              <small>{index}</small>
            </span>
            <label>
              技能
              <SearchableCombobox
                options={skillOptions}
                value={sid}
                onChange={(id) => {
                  const opt = skillOptions.find((x) => x.id === id);
                  const meta = skillMap.get(id);
                  const isMarker = isClassMarker(id);
                  update(index, {
                    skill_id: id,
                    action: isMarker ? id : line.action || 3,
                    skill_symbol: isMarker
                      ? opt?.secondary || ""
                      : meta?.symbol || "",
                    skill_name: isMarker
                      ? opt?.label || ""
                      : meta?.name || opt?.label || "",
                    ref_kind: isMarker ? "class_slot" : "skill",
                  });
                }}
              />
              {marker && (
                <span className="marker-resolved">
                  {hint?.skill_name || hint?.skill_symbol
                    ? `→ ${hint.skill_name || hint.skill_symbol}`
                    : "→ class slot (pick a reference to preview)"}
                </span>
              )}
            </label>
            <label>
              IF0
              <SearchableCombobox
                options={ifOptions}
                value={line.if0}
                onChange={(id) =>
                  update(index, {
                    if0: id,
                    if0_symbol: ifOptions.find((x) => x.id === id)?.label || "",
                  })
                }
              />
            </label>
            <label>
              IF1
              <SearchableCombobox
                options={ifOptions}
                value={line.if1}
                onChange={(id) =>
                  update(index, {
                    if1: id,
                    if1_symbol: ifOptions.find((x) => x.id === id)?.label || "",
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const next = lines.filter((_, i) => i !== index);
                commitLines(next);
              }}
            >
              移除
            </button>
          </div>
        );
      })}
      <button
        type="button"
        disabled={lines.length >= 8}
        title={lines.length >= 8 ? "EquipAiSet supports at most 8 effects" : ""}
        onClick={() => {
          const next = [
            ...lines,
            {
              slot: lines.length,
              action: 3,
              skill_id: 3,
              ref_kind: "class_slot",
              if0: 0,
              if1: 0,
            },
          ];
          commitLines(next);
        }}
      >
        {lines.length >= 8 ? "Maximum 8 preset effects" : "Add preset effect"}
      </button>

      <h3>（二）最终战术预览</h3>
      {effectiveRef ? (
        <>
          <p className="hint">
            预览对象：{" "}
            <strong>{effectiveRef.unit || effectiveRef.squad_name}</strong>
            {effectiveRef.class_symbol ? ` (${effectiveRef.class_symbol})` : ""}
            {" · "}
            {effectiveRef.resolution?.level_source === "stage"
              ? `Lv ${effectiveRef.resolution.enemy_level}`
              : `assumed Lv ${effectiveRef.resolution?.assumed_level ?? 1}`}
            。装备技能仅在预设中显式添加时出现。
            {preset.references && preset.references.length > 1
              ? " Pick another unit above to preview it."
              : ""}
          </p>
          {effectiveRef.resolution?.level_source === "assumed" && (
            <p className="hint">
              编队等级未知，锁定状态可能与实际游戏不同。
            </p>
          )}
        </>
      ) : (
        <p className="hint">
          尚未绑定单位，职业槽标记无法解析为具体技能。当前仅显示显式技能；绑定单位后可查看职业槽解析。
        </p>
      )}
      {missingExplicitCount > 0 && (
        <div className="warn-box">
          <strong>
            ⚠ {missingExplicitCount} 显式技能
            {missingExplicitCount > 1 ? "s are" : " is"} 对该单位无效。
          </strong>
          <p>
            预设不会赋予技能。标记的技能并非由单位职业 <em>或</em> 装备提供，在游戏中无效。请更换能提供技能的职业/装备，或移除该行。
          </p>
        </div>
      )}
      <FinalTacticsTable
        lines={finalResults}
        haveSkillIds={availableIds}
        skillMap={skillMap}
      />
    </div>
  );
}

function FormationGrid({
  squad,
  selectedSlot,
  pickSlot,
  onSelect,
}: {
  squad: Squad;
  selectedSlot: number;
  pickSlot: number | null;
  onSelect: (slot: number) => void;
}) {
  return (
    <div className="formation-box">
      <div className="formation-head">
        <strong>六座位编队</strong>
        <span className="hint">
          点击座位选中，再点击另一座位交换或移动（每座位一人）。
        </span>
      </div>
      <div className="formation-grid">
        <div className="formation-corner" />
        {FORMATION_COLS.map((c) => (
          <div key={c} className="formation-col-label">
            {c}
          </div>
        ))}
        {FORMATION_ROWS.map((row) => (
          <div key={row.label} className="formation-row">
            <div className="formation-row-label">{row.label}</div>
            {row.slots.map((i) => {
              const s = squad.slots.find((x) => x.slot === i) ?? emptySlot(i);
              const occupied = s.charaset_id > 0;
              const isSel = selectedSlot === i;
              const isPick = pickSlot === i;
              const leader = occupied && (s.flags & 0x100) !== 0;
              return (
                <button
                  key={i}
                  type="button"
                  className={[
                    "formation-cell",
                    occupied ? "occupied" : "empty",
                    isSel ? "selected" : "",
                    isPick ? "pick" : "",
                    leader ? "leader" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onSelect(i)}
                  title={`${formationLabel(i)} (slot ${i})`}
                >
                  <span className="formation-pos">
                    {formationLabel(i)}
                    <small>#{i}</small>
                  </span>
                  {occupied ? (
                    <>
                      <span className="formation-name">
                        {s.chara_name ||
                          s.charaset_symbol ||
                          `CharaSet ${s.charaset_id}`}
                      </span>
                      <span className="formation-class">
                        {s.class_symbol}
                        {leader ? " · Lead" : ""}
                      </span>
                    </>
                  ) : (
                    <span className="formation-empty">空位</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {pickSlot !== null && (
        <p className="hint">
          已选择 {formationLabel(pickSlot)} — 点击另一座位交换/移动，或再次点击取消。
        </p>
      )}
    </div>
  );
}

function UnitPanel({
  slot,
  squad,
  missionLevel,
  itemOptions,
  charasetOptions,
  charasetById,
  ifOptions,
  presets,
  creates,
  allocation,
  editedPresetLines,
  classTactics,
  itemSkills,
  ifMap,
  skillMap,
  sharedPreset,
  onSelectSlot,
  onSwapSlots,
  onChangeSlot,
  onChangeGear,
  baselineGear,
  onChangeLines,
  onCreateEmptyPreset,
  onOpenPreset,
}: {
  slot: Slot;
  squad: Squad;
  missionLevel: number;
  itemOptions: ComboboxOption[];
  charasetOptions: ComboboxOption[];
  charasetById: Map<number, CharasetCatalogEntry>;
  ifOptions: ComboboxOption[];
  presets: EquipAiPreset[];
  creates: PresetCreate[];
  allocation?: Allocation;
  editedPresetLines?: Line[];
  classTactics: ClassTactics[];
  itemSkills: Map<number, ItemSkill>;
  ifMap: Map<number, string>;
  skillMap: Map<number, { id: number; symbol?: string; name?: string }>;
  sharedPreset: boolean;
  onSelectSlot: (n: number) => void;
  onSwapSlots: (a: number, b: number) => void;
  onChangeSlot: (
    s: Slot,
    extra?: { equipaiset_alloc_key?: string }
  ) => void;
  onChangeGear: (s: Slot) => void;
  baselineGear: Gear[];
  onChangeLines: (lines: Line[]) => void;
  onCreateEmptyPreset: () => PresetCreate;
  onOpenPreset: (id: number) => void;
}) {
  const [local, setLocal] = useState(slot);
  const [lines, setLines] = useState<Line[]>(
    allocation?.lines ?? slot.tactics_lines
  );
  const [pickSlot, setPickSlot] = useState<number | null>(null);

  // Resolve against the live unit class (after CharaSet swap), not a stale prop.
  const classLines = useMemo(
    () =>
      (classTactics.find((c) => c.class_id === local.class_id)?.lines ??
        []) as ClassLine[],
    [classTactics, local.class_id]
  );

  useEffect(() => {
    setLocal(slot);
    setLines(allocation?.lines ?? slot.tactics_lines);
  }, [slot, allocation]);

  useEffect(() => {
    setPickSlot(null);
  }, [squad.unitset_id]);

  function patch(
    p: Partial<Slot>,
    extra?: { equipaiset_alloc_key?: string }
  ) {
    const next = { ...local, ...p };
    setLocal(next);
    onChangeSlot(next, extra);
  }

  function setGearItem(slotIndex: number, itemId: number) {
    const meta = itemOptions.find((o) => o.id === itemId);
    const gear = local.gear.map((x, j) =>
      j === slotIndex
        ? {
            ...x,
            item_id: itemId,
            item_symbol: meta?.secondary || "",
            item_name: meta?.label || "",
            source: "edit",
            edited: true,
            from_equiptype: undefined,
            equiptype_param_name: undefined,
          }
        : x
    );
    const next = { ...local, gear };
    setLocal(next);
    onChangeGear(next);
  }

  function restoreDefaultGear() {
    const gear = cloneGear(baselineGear);
    const next = { ...local, gear };
    setLocal(next);
    onChangeGear(next);
  }

  const gearIsCustom = local.gear.some(
    (g, i) =>
      Boolean(g.edited) || (g.item_id || 0) !== (baselineGear[i]?.item_id || 0)
  );

  function updateLine(i: number, patchLine: Partial<Line>) {
    const next = lines.map((x, j) => (j === i ? { ...x, ...patchLine } : x));
    setLines(next);
    onChangeLines(next);
  }

  function assignCharaset(id: number) {
    if (id <= 1) {
      window.alert(
        "CharaSet 0/1 are reserved engine sentinels and cannot be assigned."
      );
      return;
    }
    const catalog = charasetById.get(id);
    if (!catalog) return;
    if (id === local.charaset_id) return;
    const classLabel =
      catalog.class_name || catalog.class_symbol || `class ${catalog.class_id}`;
    const keepPreset =
      local.equipaiset_id === 0 ||
      window.confirm(t(
        `Swap to ${catalog.name || catalog.symbol} (${classLabel})?\n\n` +
          "OK = keep the current tactics preset (may not match the new class).\n" +
          "Cancel = abort the swap."
      ));
    if (!keepPreset) return;
    const gear = (catalog.gear || []).map((g) => ({
      ...g,
      edited: false,
      source: g.item_id ? "charaset" : "empty",
    }));
    // Class defaults / resolved tactics belong to the old unit — drop them so
    // Final tactics rebuilds from the new class (and IF edits don't show Icebolt).
    if (local.equipaiset_id === 0 && !allocation) {
      setLines([]);
    }
    patch({
      charaset_id: id,
      charaset_symbol: catalog.symbol,
      chara_name: catalog.name || "",
      class_id: catalog.class_id,
      class_symbol: catalog.class_symbol,
      gear,
      tactics_lines: [],
    });
  }

  function assignPreset(value: string) {
    if (value === "__create__") {
      const created = onCreateEmptyPreset();
      // Do not assign yet — user fills slots first
      onOpenPreset(created.temp_id);
      return;
    }
    if (value.startsWith("create:")) {
      const c = creates.find((x) => x.key === value);
      if (!c) return;
      if (
        c.lines.length === 0 &&
        !window.confirm(t(
          "This new preset is still empty. Assigning a non-zero empty preset " +
            "skips class defaults and leaves the unit with NO tactics. Assign anyway?"
        ))
      ) {
        return;
      }
      patch(
        {
          equipaiset_id: c.temp_id,
          equipaiset_symbol: c.symbol,
        },
        { equipaiset_alloc_key: c.key }
      );
      return;
    }
    const id = Number(value);
    if (!Number.isFinite(id)) return;
    if (id === 0) {
      patch({ equipaiset_id: 0, equipaiset_symbol: "" });
      return;
    }
    const preset = presets.find((p) => p.id === id);
    const slotCount = preset?.lines?.length ?? 0;
    if (
      slotCount === 0 &&
      !window.confirm(t(
        `Preset ${id} has an empty tactics list. Assigning it will wipe this unit's tactics. Continue?`
      ))
    ) {
      return;
    }
    patch({
      equipaiset_id: id,
      equipaiset_symbol: preset?.symbol || "",
    });
  }

  const gearIds = local.gear.map((g) => g.item_id).filter((id) => id > 0);
  const createForUnit = creates.find((c) => c.temp_id === local.equipaiset_id);

  const finalResults = useMemo(() => {
    if (local.equipaiset_id === 0 && !allocation) {
      return tacticsForClass(
        classLines,
        missionLevel,
        gearIds,
        itemSkills,
        ifMap
      );
    }
    const srcLines = (allocation?.lines ??
      createForUnit?.lines ??
      editedPresetLines ??
      presets.find((p) => p.id === local.equipaiset_id)?.lines ??
      local.tactics_lines) as ResolveLine[];
    return tacticsForPreset(
      classLines,
      missionLevel,
      srcLines,
      skillMap,
      ifMap
    );
  }, [
    local.equipaiset_id,
    local.tactics_lines,
    allocation,
    createForUnit,
    editedPresetLines,
    presets,
    classLines,
    missionLevel,
    gearIds,
    itemSkills,
    ifMap,
    skillMap,
  ]);

  const classSkillIds = useMemo(
    () => availableSkillIds(classLines, gearIds, itemSkills),
    [classLines, gearIds, itemSkills]
  );

  // Warn when a non-zero preset resolves to nothing but the unit's own class
  // skills (all markers) — it will play identically to default (id 0).
  const activePresetLines = (allocation?.lines ??
    createForUnit?.lines ??
    editedPresetLines ??
    presets.find((p) => p.id === local.equipaiset_id)?.lines ??
    []) as ResolveLine[];
  const markerOnlyPreset =
    (local.equipaiset_id !== 0 || !!allocation) &&
    activePresetLines.length > 0 &&
    activePresetLines.every((l) =>
      isClassMarker((l.skill_id ?? l.action) as number)
    );
  const missingExplicitCount = finalResults.filter((l) =>
    isMissingExplicit(l, classSkillIds)
  ).length;

  const selectValue = createForUnit
    ? createForUnit.key
    : String(local.equipaiset_id);

  return (
    <div>
      <FormationGrid
        squad={squad}
        selectedSlot={slot.slot}
        pickSlot={pickSlot}
        onSelect={(i) => {
          if (pickSlot === null) {
            setPickSlot(i);
            onSelectSlot(i);
            return;
          }
          if (pickSlot === i) {
            setPickSlot(null);
            onSelectSlot(i);
            return;
          }
          onSwapSlots(pickSlot, i);
          setPickSlot(null);
        }}
      />

      {!local.charaset_id ? (
        <>
          <h2>空位 — {formationLabel(local.slot)}</h2>
          <p className="sub">
            座位 #{local.slot}。可在下方指定角色，或从六座位编队中移动单位到此处。
          </p>
          <div className="meta-box">
            <label>
              在此放置单位
              <SearchableCombobox
                options={charasetOptions}
                value={0}
                onChange={assignCharaset}
                placeholder="搜索角色、职业或 CharaSet ID…"
                emptyLabel="(choose a unit)"
              />
            </label>
          </div>
        </>
      ) : (
        <>
      <h2>
        {local.chara_name
          ? `${local.chara_name} (${local.charaset_symbol})`
          : local.charaset_symbol}
      </h2>
      <p className="sub">
        {formationLabel(local.slot)} · class {local.class_symbol} (
        {local.class_id}) · CharaSet {local.charaset_id} · mission Lv{" "}
        {missionLevel}
      </p>

      <div className="meta-box">
        <label>
          单位（角色 / 职业模板）
          <SearchableCombobox
            options={charasetOptions}
            value={local.charaset_id}
            onChange={assignCharaset}
            placeholder="搜索角色、职业或 CharaSet ID…"
          />
        </label>
        <p className="hint">
          修改此座位使用的 CharaSet（职业及原版装备）。空槽仍由 CreateDefaultEquip 填充。共享模板的装备修改影响所有引用者；不能自动克隆，导出前须确认全局影响。
        </p>
        <label>
          战术预设
          <select
            value={selectValue}
            onChange={(e) => assignPreset(e.target.value)}
          >
            <option value="0">0 — 职业默认战术（自动加入装备技能）</option>
            {creates.map((c) => (
              <option key={c.key} value={c.key}>
                {c.symbol} (new{c.lines.length ? "" : ", empty"})
              </option>
            ))}
            {[...presets]
              .sort((a, b) => a.id - b.id)
              .map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.id} — {p.symbol || "preset"} ({p.usage} refs)
                </option>
              ))}
            <option value="__create__">创建空预设…</option>
          </select>
        </label>
        {local.equipaiset_id !== 0 && (
          <button
            type="button"
            className="linkish"
            onClick={() => onOpenPreset(local.equipaiset_id)}
          >
            前往战术预设面板
          </button>
        )}
        {(sharedPreset || allocation) && (
          <p className="hint">
            {allocation
              ? `Private EquipAiSet will be allocated on export (from ${allocation.source_id}).`
              : "Editing IF rows below forks a private EquipAiSet so shared presets stay vanilla."}
          </p>
        )}
        {local.equipaiset_id === 0 ? (
          <p className="hint">
            预设 0 自动使用职业技能及装备技能。
          </p>
        ) : (
          <p className="hint">
            非零预设仅使用列出的战术，不会自动合并装备技能。
          </p>
        )}
      </div>

      <div className="row">
        <h3>装备</h3>
        <button
          type="button"
          disabled={!gearIsCustom}
          title={
            gearIsCustom
              ? "Revert this unit's gear to vanilla CharaSet / CreateDefaultEquip"
              : "Gear is already vanilla"
          }
          onClick={restoreDefaultGear}
        >
          恢复默认
        </button>
      </div>
      <div className="gear-grid">
        {local.gear.map((g, i) => (
          <label key={i}>
            槽位 {i}
            <div className="gear-slot-row">
              <SearchableCombobox
                options={itemOptions}
                value={g.item_id}
                emptyLabel="空位"
                onChange={(id) => setGearItem(i, id)}
              />
              <button
                type="button"
                className="gear-clear"
                title="清空此装备槽"
                aria-label={`清空装备槽 ${i}`}
                disabled={!g.item_id}
                onClick={() => setGearItem(i, 0)}
              >
                ×
              </button>
            </div>
            <span className="hint">
              {g.source === "charaset" || (g.rom_item_id && !g.from_equiptype)
                ? "ROM CharaSet"
                : g.source === "createdefault" || g.from_equiptype
                  ? "Runtime CreateDefaultEquip"
                  : g.item_id
                    ? ""
                    : "空位"}
            </span>
          </label>
        ))}
      </div>

      <h3>最终战术</h3>
      {markerOnlyPreset && (
        <div className="warn-box">
          <strong>此预设仅使用职业技能槽标记。</strong>
          <p>
            标记按本单位职业解析；请核对行数、顺序及条件。可添加显式技能或修改排序与 IF 条件。
          </p>
        </div>
      )}
      {missingExplicitCount > 0 && (
        <div className="warn-box">
          <strong>
            ⚠ {missingExplicitCount} 显式技能
            {missingExplicitCount > 1 ? "s are" : " is"} 对该单位无效。
          </strong>
          <p>
            预设不能赋予技能；标记行不由该单位职业或装备提供，在游戏中无效。
          </p>
        </div>
      )}
      <FinalTacticsTable
        lines={finalResults}
        haveSkillIds={classSkillIds}
        skillMap={skillMap}
      />

      <h3>IF 编辑（共享预设 / 预设 0 分配私有副本）</h3>
      <p className="hint">
        建议在战术预设面板编辑。在此修改 IF 时，共享预设或预设 0 将在导出时分配私有预设（不是克隆角色装备）。
      </p>
      {lines.map((ln, i) => (
        <div className={`line-row${ln.locked ? " line-locked" : ""}`} key={i}>
          <label>
            技能
            <span className="readonly-skill">
              {skillTitle(ln, skillMap)}
              {ln.locked ? (
                <span
                  className="locked-tag"
                  title={`Learns at level ${ln.learn_level ?? "?"}`}
                >
                  locked (Lv {ln.learn_level ?? "?"})
                </span>
              ) : null}
              {ln.from_item ? <span className="item-tag">来自装备</span> : null}
            </span>
          </label>
          <label>
            IF0
            <SearchableCombobox
              options={ifOptions}
              value={ln.if0}
              onChange={(id) => {
                const sym = ifOptions.find((o) => o.id === id)?.label;
                updateLine(i, { if0: id, if0_symbol: id ? sym : "" });
              }}
            />
          </label>
          <label>
            IF1
            <SearchableCombobox
              options={ifOptions}
              value={ln.if1}
              onChange={(id) => {
                const sym = ifOptions.find((o) => o.id === id)?.label;
                updateLine(i, { if1: id, if1_symbol: id ? sym : "" });
              }}
            />
          </label>
        </div>
      ))}
      {!lines.length && (
        <p className="hint">没有可用于 IF 私有副本的原版战术行。</p>
      )}
        </>
      )}
    </div>
  );
}

export default App;
