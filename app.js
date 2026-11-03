"use strict";

// Plan model --------------------------------------------------------------
//
// plan.courses maps course id -> { sem, auto, waived }
//   sem: 0..numSemesters-1, TRANSFER (-1), or null (unscheduled)
//   auto: added automatically as a prerequisite; removed again once nothing needs it
//   waived: in the TRANSFER column without credit (still satisfies prerequisites)
// plan.choices maps course id -> { orNodePath: alternative index } for pinned "one of" choices
// plan.waivedPrereqs maps course id -> [prereq ids waived for that course only]
// plan.overrides maps course id -> full course definition (edited or custom courses)

const STORAGE_KEY = "coursePlanner.plan.v1";
const TRANSFER = -1;
const COL_W = 184, NODE_W = 156, NODE_H = 52, GAP = 12, HEAD_H = 64, PAD_X = 14;

const CATALOG = new Map(window.CATALOG.map(c => [c.id, c]));

let plan = loadLocal() || newPlan();
let selected = null;
let editingNew = false;
let hovered = null;

function newPlan() {
  return {
    version: 1,
    name: "My plan",
    start: { season: "Fall", year: new Date().getFullYear() },
    numSemesters: 8,
    maxCredits: 19,
    minCredits: 12,
    priorCredits: 0,
    courses: {},
    choices: {},
    waivedPrereqs: {},
    overrides: {},
  };
}

function migrate(obj) {
  if (!obj || typeof obj !== "object" || typeof obj.courses !== "object") throw new Error("Not a course plan file");
  return { ...newPlan(), ...obj, start: { ...newPlan().start, ...obj.start } };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

// Courses -----------------------------------------------------------------

function normalizeId(s) {
  const m = String(s).trim().toUpperCase().match(/^([A-Z&-]+)\s*(\d{3}[A-Z0-9]*)$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

function getCourse(id) {
  return plan.overrides[id] || CATALOG.get(id) || {
    id, title: "", credits: 3, offered: "", prereq: "", notes: "Not in the catalog. Edit it to fill in details.", stub: true,
  };
}

function allCourseIds() {
  return [...new Set([...CATALOG.keys(), ...Object.keys(plan.overrides)])].sort(compareIds);
}

function compareIds(a, b) {
  const [sa, na] = a.split(" "), [sb, nb] = b.split(" ");
  return sa.localeCompare(sb) || parseInt(na) - parseInt(nb) || na.localeCompare(nb);
}

const OFFERED_LABELS = {
  "": "Unknown", FS: "Fall & Spring", F: "Fall only", S: "Spring only",
  "F-even": "Fall, even years", "F-odd": "Fall, odd years",
  "S-even": "Spring, even years", "S-odd": "Spring, odd years",
};

function offeredIn(course, sem) {
  const code = course.offered;
  if (!code || sem == null || sem === TRANSFER) return true;
  const { season, year } = termOf(sem);
  if (!code.includes(season[0])) return false;
  if (code.endsWith("even")) return year % 2 === 0;
  if (code.endsWith("odd")) return year % 2 === 1;
  return true;
}

// Semesters ---------------------------------------------------------------

function termOf(i) {
  const k = i + (plan.start.season === "Spring" ? 1 : 0);
  const firstFall = plan.start.season === "Fall" ? plan.start.year : plan.start.year - 1;
  return k % 2 === 0
    ? { season: "Fall", year: firstFall + k / 2 }
    : { season: "Spring", year: firstFall + (k + 1) / 2 };
}

function semLabel(sem) {
  if (sem === TRANSFER) return "Transfer / AP / Waived";
  if (sem == null) return "Unscheduled";
  const t = termOf(sem);
  return `${t.season} ${t.year}`;
}

function semOf(id) {
  return plan.courses[id] ? plan.courses[id].sem : undefined;
}

// Prerequisite expressions ------------------------------------------------
//
// Grammar:  expr := term ("|" term)*     term := factor ("&" factor)*
//           factor := "(" expr ")" | "~"? COURSE
// "and"/"or" and "," (as and) are accepted too. "~" marks a corequisite.

const parseCache = new Map();

function parsePrereq(src) {
  src = (src || "").trim();
  if (!parseCache.has(src)) {
    let result;
    try {
      result = { tree: src ? parseExpr(src) : null };
    } catch (e) {
      result = { tree: null, error: e.message };
    }
    parseCache.set(src, result);
  }
  return parseCache.get(src);
}

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:([()~|&,])|([A-Za-z][A-Za-z&-]*\s*\d{3}[A-Za-z0-9]*)|(and|or)\b|(\S+))/giy;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1]) tokens.push(m[1] === "," ? "&" : m[1]);
    else if (m[2]) tokens.push({ id: normalizeId(m[2]) });
    else if (m[3]) tokens.push(m[3].toLowerCase() === "and" ? "&" : "|");
    else if (m[4]) throw new Error(`Unexpected "${m[4]}"`);
  }
  return tokens;
}

function parseExpr(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const group = (type, parseChild, op) => {
    const args = [parseChild()];
    while (peek() === op) { i++; args.push(parseChild()); }
    if (args.length === 1) return args[0];
    return { type, args: args.flatMap(a => a.type === type ? a.args : [a]) };
  };
  const factor = () => {
    const t = toks[i++];
    if (t === "(") {
      const e = expr();
      if (toks[i++] !== ")") throw new Error("Missing )");
      return e;
    }
    if (t === "~") {
      const c = toks[i++];
      if (!c || !c.id) throw new Error("~ must be followed by a course");
      return { type: "course", id: c.id, coreq: true };
    }
    if (t && t.id) return { type: "course", id: t.id, coreq: false };
    throw new Error(t ? `Unexpected "${t}"` : "Expression ends early");
  };
  const term = () => group("and", factor, "&");
  const expr = () => group("or", term, "|");
  const tree = expr();
  if (i < toks.length) throw new Error(`Unexpected "${toks[i].id || toks[i]}"`);
  return tree;
}

function prereqTree(id) {
  return parsePrereq(getCourse(id).prereq).tree;
}

function leafSatisfied(leaf, sem) {
  const p = semOf(leaf.id);
  if (p == null) return false;
  return p < sem || (leaf.coreq && p <= sem);
}

function prereqWaived(courseId, prereqId) {
  return !!plan.waivedPrereqs[courseId]?.includes(prereqId);
}

// A prerequisite waived for a course counts as satisfied for that course.
function treeSatisfied(courseId, node, sem) {
  if (node.type === "course") return prereqWaived(courseId, node.id) || leafSatisfied(node, sem);
  if (node.type === "and") return node.args.every(a => treeSatisfied(courseId, a, sem));
  return node.args.some(a => treeSatisfied(courseId, a, sem));
}

function treePresent(courseId, node) {
  if (node.type === "course") return prereqWaived(courseId, node.id) || node.id in plan.courses;
  if (node.type === "and") return node.args.every(a => treePresent(courseId, a));
  return node.args.some(a => treePresent(courseId, a));
}

// Which alternative of a "one of" node is active: the pinned one, otherwise the
// first already satisfied, otherwise the first already in the plan, otherwise the first.
function chooseAlt(courseId, node, path, sem) {
  const pinned = plan.choices[courseId]?.[path];
  if (Number.isInteger(pinned) && pinned < node.args.length) return { index: pinned, pinned: true };
  let index = sem == null ? -1 : node.args.findIndex(a => treeSatisfied(courseId, a, sem));
  if (index < 0) index = node.args.findIndex(a => treePresent(courseId, a));
  return { index: Math.max(index, 0), pinned: false };
}

// Prerequisite courses on the chosen alternatives, excluding ones waived for this course.
function activeLeaves(courseId) {
  const tree = prereqTree(courseId);
  const sem = semOf(courseId);
  const out = [];
  const walk = (node, path) => {
    if (node.type === "course") { if (!prereqWaived(courseId, node.id)) out.push(node); }
    else if (node.type === "and") node.args.forEach((a, i) => walk(a, `${path}.${i}`));
    else {
      const { index } = chooseAlt(courseId, node, path, sem);
      walk(node.args[index], `${path}.${index}`);
    }
  };
  if (tree) walk(tree, "r");
  return out;
}

function dependents(id) {
  return Object.keys(plan.courses).filter(c => plan.courses[c].sem !== TRANSFER && activeLeaves(c).some(l => l.id === id));
}

function warningsFor(id) {
  const sem = semOf(id);
  if (sem == null || sem === TRANSFER) return [];
  const course = getCourse(id);
  const out = [];
  const parsed = parsePrereq(course.prereq);
  if (parsed.error) out.push(`Prerequisite expression error: ${parsed.error}`);
  for (const leaf of activeLeaves(id)) {
    const p = semOf(leaf.id);
    if (p === undefined) out.push(`Missing prerequisite ${leaf.id}`);
    else if (p === null) out.push(`Prerequisite ${leaf.id} is unscheduled`);
    else if (!leafSatisfied(leaf, sem)) {
      out.push(leaf.coreq
        ? `Corequisite ${leaf.id} (${semLabel(p)}) must be this semester or earlier`
        : `Prerequisite ${leaf.id} (${semLabel(p)}) must come before this semester`);
    }
  }
  if (!offeredIn(course, sem)) out.push(`Not usually offered ${termOf(sem).season} ${termOf(sem).year} (${OFFERED_LABELS[course.offered]})`);
  return out;
}

// Mutations ---------------------------------------------------------------

// Latest semester at or before `max` in which the course is offered.
function latestSlot(id, max) {
  if (max < 0) return null;
  const course = getCourse(id);
  for (let t = max; t >= 0; t--) if (offeredIn(course, t)) return t;
  return max;
}

function ensurePrereqs(id, seen = new Set(), added = []) {
  if (seen.has(id)) return added;
  seen.add(id);
  const sem = semOf(id);
  if (sem == null || sem === TRANSFER) return added;
  for (const leaf of activeLeaves(id)) {
    if (!plan.courses[leaf.id]) {
      plan.courses[leaf.id] = { sem: latestSlot(leaf.id, leaf.coreq ? sem : sem - 1), auto: true };
      added.push(leaf.id);
    }
    ensurePrereqs(leaf.id, seen, added);
  }
  return added;
}

// Drop auto-added courses that no remaining course requires.
function collectUnneeded() {
  for (;;) {
    const needed = new Set();
    for (const id of Object.keys(plan.courses)) {
      if (plan.courses[id].sem !== TRANSFER) activeLeaves(id).forEach(l => needed.add(l.id));
    }
    const drop = Object.keys(plan.courses).filter(id => plan.courses[id].auto && !needed.has(id));
    if (!drop.length) return;
    drop.forEach(id => delete plan.courses[id]);
  }
}

function placeCourse(id, sem) {
  const existed = id in plan.courses;
  plan.courses[id] = { sem, auto: false };
  const added = ensurePrereqs(id);
  collectUnneeded();
  commit();
  const verb = existed ? "Moved" : "Added";
  let msg = `${verb} ${id} to ${semLabel(sem)}.`;
  if (added.length) {
    msg += ` Also added prerequisites: ${added.join(", ")}.`;
    const homeless = added.filter(a => plan.courses[a]?.sem === null);
    if (homeless.length) msg += ` No room before it for ${homeless.join(", ")}, so they're in Unscheduled.`;
  }
  toast(msg);
}

function removeCourse(id) {
  delete plan.courses[id];
  delete plan.choices[id];
  delete plan.waivedPrereqs[id];
  collectUnneeded();
  if (selected && !(selected in plan.courses) && !editingNew) selected = null;
  commit();
}

function setChoice(courseId, path, index) {
  const choices = plan.choices[courseId] || (plan.choices[courseId] = {});
  if (index == null) delete choices[path];
  else choices[path] = index;
  if (!Object.keys(choices).length) delete plan.choices[courseId];
  const added = courseId in plan.courses ? ensurePrereqs(courseId) : [];
  collectUnneeded();
  commit();
  if (added.length) toast(`Added prerequisites: ${added.join(", ")}.`);
}

function toggleWaivedPrereq(courseId, prereqId) {
  const list = plan.waivedPrereqs[courseId] || [];
  const waiving = !list.includes(prereqId);
  plan.waivedPrereqs[courseId] = waiving ? [...list, prereqId] : list.filter(p => p !== prereqId);
  if (!plan.waivedPrereqs[courseId].length) delete plan.waivedPrereqs[courseId];
  const added = !waiving && courseId in plan.courses ? ensurePrereqs(courseId) : [];
  collectUnneeded();
  commit();
  toast(waiving
    ? `Waived ${prereqId} for ${courseId}.`
    : `${prereqId} is required for ${courseId} again.${added.length ? ` Added: ${added.join(", ")}.` : ""}`);
}

function setNumSemesters(n) {
  plan.numSemesters = n;
  for (const c of Object.values(plan.courses)) if (c.sem != null && c.sem >= n) c.sem = null;
}

function commit() {
  saveLocal();
  render();
}

// Rendering ---------------------------------------------------------------

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function render() {
  renderSettings();
  renderCatalog();
  renderBoard();
  renderDetails();
}

function columns() {
  const cols = [{ sem: TRANSFER }];
  for (let i = 0; i < plan.numSemesters; i++) cols.push({ sem: i });
  cols.push({ sem: null });
  return cols;
}

function colIndexOf(sem) {
  if (sem === TRANSFER) return 0;
  if (sem == null) return plan.numSemesters + 1;
  return sem + 1;
}

function renderSettings() {
  const set = (sel, v) => { const el = $(sel); if (document.activeElement !== el) el.value = v; };
  set("#plan-name", plan.name);
  set("#start-season", plan.start.season);
  set("#start-year", plan.start.year);
  set("#num-semesters", plan.numSemesters);
  set("#max-credits", plan.maxCredits);
  set("#min-credits", plan.minCredits);
  set("#prior-credits", plan.priorCredits);
  const target = $("#add-target");
  const prev = target.value;
  target.innerHTML = columns().map(c => `<option value="${c.sem ?? "u"}">${esc(semLabel(c.sem))}</option>`).join("");
  target.value = [...target.options].some(o => o.value === prev) ? prev : "0";
}

function parseSemValue(v) {
  return v === "u" ? null : parseInt(v, 10);
}

function renderCatalog() {
  const q = $("#search").value.trim().toLowerCase();
  const ids = allCourseIds().filter(id => !q || id.toLowerCase().includes(q) || getCourse(id).title.toLowerCase().includes(q));
  $("#catalog").innerHTML = ids.map(id => {
    const c = getCourse(id);
    const inPlan = id in plan.courses;
    return `<li data-id="${esc(id)}" class="${inPlan ? "in-plan" : ""} ${id === selected ? "selected" : ""}">
      <div class="cat-main">
        <span class="code">${esc(id)}</span> <span class="cr">${c.credits} cr</span>
        <div class="title">${esc(c.title)}</div>
      </div>
      ${inPlan ? `<span class="where" title="In plan">${esc(plan.courses[id].waived ? "Waived" : semLabel(plan.courses[id].sem))}</span>`
               : `<button class="add" data-add="${esc(id)}" title="Add to plan">+</button>`}
    </li>`;
  }).join("");
}

// Credits a placed course counts for; waived courses count for none.
function creditValue(id) {
  return plan.courses[id]?.waived ? 0 : +getCourse(id).credits || 0;
}

function creditsIn(sem) {
  return Object.keys(plan.courses).filter(id => plan.courses[id].sem === sem).reduce((n, id) => n + creditValue(id), 0);
}

// Order nodes within each column to reduce edge crossings (barycenter sweeps).
function layout(edges) {
  const cols = columns().map(() => []);
  for (const id of Object.keys(plan.courses).sort(compareIds)) cols[colIndexOf(plan.courses[id].sem)].push(id);
  const pos = new Map();
  const reindex = () => cols.forEach(col => col.forEach((id, i) => pos.set(id, i)));
  reindex();
  const preds = new Map(), succs = new Map();
  for (const e of edges) {
    (preds.get(e.to) || preds.set(e.to, []).get(e.to)).push(e.from);
    (succs.get(e.from) || succs.set(e.from, []).get(e.from)).push(e.to);
  }
  const sortBy = (col, nbrs) => {
    const key = new Map(col.map(id => {
      const ns = (nbrs.get(id) || []).filter(n => pos.has(n));
      return [id, ns.length ? ns.reduce((s, n) => s + pos.get(n), 0) / ns.length : pos.get(id)];
    }));
    col.sort((a, b) => key.get(a) - key.get(b) || pos.get(a) - pos.get(b));
  };
  for (let pass = 0; pass < 6; pass++) {
    const order = pass % 2 === 0 ? cols.keys() : [...cols.keys()].reverse();
    for (const ci of order) { sortBy(cols[ci], pass % 2 === 0 ? preds : succs); reindex(); }
  }
  return cols;
}

function relatedTo(id, edges) {
  const set = new Set([id]);
  const walk = (start, from, to) => {
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      for (const e of edges) if (e[from] === cur && !set.has(e[to])) { set.add(e[to]); stack.push(e[to]); }
    }
  };
  walk(id, "to", "from");
  walk(id, "from", "to");
  return set;
}

function renderBoard() {
  const edges = [];
  for (const [id, c] of Object.entries(plan.courses)) {
    if (c.sem == null || c.sem === TRANSFER) continue;
    for (const leaf of activeLeaves(id)) {
      const p = semOf(leaf.id);
      if (p == null) continue;
      edges.push({ from: leaf.id, to: id, coreq: leaf.coreq, bad: !leafSatisfied(leaf, c.sem) });
    }
  }
  const cols = layout(edges);
  const xy = new Map();
  cols.forEach((col, ci) => col.forEach((id, i) => xy.set(id, { x: ci * COL_W + PAD_X, y: HEAD_H + i * (NODE_H + GAP) })));
  const height = HEAD_H + Math.max(4, ...cols.map(c => c.length)) * (NODE_H + GAP) + 40;
  const width = cols.length * COL_W;

  const focus = hovered || selected;
  const related = focus && focus in plan.courses ? relatedTo(focus, edges) : null;

  let cumulative = plan.priorCredits + creditsIn(TRANSFER);
  const headers = columns().map((c, ci) => {
    const cr = creditsIn(c.sem);
    let sub = `${cr} cr`, cls = "";
    if (c.sem === TRANSFER) {
      const waived = Object.values(plan.courses).filter(p => p.sem === TRANSFER && p.waived).length;
      sub = `${cr} cr${plan.priorCredits ? ` + ${plan.priorCredits} other` : ""}${waived ? ` · ${waived} waived` : ""}`;
    }
    else if (c.sem != null) {
      sub = `${cr} cr · ${cumulative}→${cumulative + cr}`;
      cumulative += cr;
      if (cr > plan.maxCredits) cls = "over";
      else if (cr > 0 && cr < plan.minCredits) cls = "under";
    }
    const tip = cls === "over" ? `Over the ${plan.maxCredits}-credit maximum` : cls === "under" ? `Under the ${plan.minCredits}-credit minimum` : "";
    return `<div class="col ${c.sem == null ? "unsched" : c.sem === TRANSFER ? "transfer" : ""}" data-col="${ci}" style="left:${ci * COL_W}px;width:${COL_W}px;height:${height}px">
      <div class="col-head ${cls}" title="${esc(tip)}"><div class="col-title">${esc(semLabel(c.sem))}</div><div class="col-sub">${esc(sub)}${cls ? " ⚠" : ""}</div></div>
    </div>`;
  }).join("");

  const paths = edges.map(e => {
    const a = xy.get(e.from), b = xy.get(e.to);
    const y1 = a.y + NODE_H / 2, y2 = b.y + NODE_H / 2;
    let d;
    if (a.x === b.x) {
      const x = a.x + NODE_W, bulge = x + 22;
      d = `M${x},${y1} C${bulge},${y1} ${bulge},${y2} ${x + 2},${y2}`;
    } else {
      const x1 = a.x + NODE_W, x2 = b.x - 2, dx = Math.max(40, Math.abs(x2 - x1) / 2);
      d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    }
    const hi = related && related.has(e.from) && related.has(e.to);
    const cls = ["edge", e.coreq && "coreq", e.bad && "bad", hi && "hi", related && !hi && "dim"].filter(Boolean).join(" ");
    const marker = e.bad ? "arrow-bad" : hi ? "arrow-hi" : "arrow";
    return `<path class="${cls}" d="${d}" marker-end="url(#${marker})"/>`;
  }).join("");

  const nodes = [...xy].map(([id, { x, y }]) => {
    const c = getCourse(id);
    const warns = warningsFor(id);
    const waived = plan.courses[id].waived;
    const cls = ["node", warns.length && "warn", plan.courses[id].auto && "auto", waived && "waived", id === selected && "selected",
      related && !related.has(id) && "dim", c.stub && "stub"].filter(Boolean).join(" ");
    const tip = [`${id} ${c.title}`, `${waived ? "Waived (no credit)" : `${c.credits} credits`} · ${OFFERED_LABELS[c.offered] ?? c.offered}`, ...warns.map(w => `⚠ ${w}`)];
    if (plan.waivedPrereqs[id]?.length) tip.push(`Waived prerequisites: ${plan.waivedPrereqs[id].join(", ")}`);
    return `<div class="${cls}" data-id="${esc(id)}" style="left:${x}px;top:${y}px;width:${NODE_W}px;height:${NODE_H}px" title="${esc(tip.join("\n"))}">
      <div class="node-top"><span class="code">${esc(id)}</span><span class="cr">${waived ? "waived" : `${c.credits}cr`}</span></div>
      <div class="title">${esc(c.title || "—")}</div>
      ${warns.length ? `<span class="badge">⚠${warns.length > 1 ? warns.length : ""}</span>` : ""}
    </div>`;
  }).join("");

  const board = $("#board");
  board.style.width = `${width}px`;
  board.style.height = `${height}px`;
  board.innerHTML = `${headers}
    <svg width="${width}" height="${height}">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="arrowhead"/></marker>
        <marker id="arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="arrowhead hi"/></marker>
        <marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="arrowhead bad"/></marker>
      </defs>
      ${paths}
    </svg>
    ${nodes}`;

  const scheduled = Object.values(plan.courses).filter(c => c.sem != null && c.sem !== TRANSFER);
  const total = Object.keys(plan.courses)
    .filter(id => plan.courses[id].sem != null).reduce((n, id) => n + creditValue(id), plan.priorCredits);
  const warnCount = Object.keys(plan.courses).filter(id => warningsFor(id).length).length;
  const unsched = Object.values(plan.courses).filter(c => c.sem == null).length;
  $("#summary").innerHTML = `
    <h1>${esc(plan.name)}</h1>
    <span>${total} total credits</span>
    <span>${scheduled.length} courses scheduled</span>
    ${unsched ? `<span>${unsched} unscheduled</span>` : ""}
    <span class="${warnCount ? "warn-text" : ""}">${warnCount ? `⚠ ${warnCount} course${warnCount > 1 ? "s" : ""} with warnings` : "No warnings"}</span>
    <span class="legend"><i class="lg solid"></i>prereq <i class="lg dashed"></i>coreq <i class="lg red"></i>out of order <i class="lg auto"></i>auto-added</span>`;
}

function renderTree(courseId, node, path, sem) {
  if (node.type === "course") {
    const p = semOf(node.id);
    let state, cls;
    const waived = prereqWaived(courseId, node.id);
    const toggle = `<button type="button" class="link" data-waive="${esc(node.id)}" title="${waived ? "Require" : "Waive"} ${esc(node.id)} for ${esc(courseId)} only">${waived ? "unwaive" : "waive"}</button>`;
    if (waived) { state = "waived for this course"; cls = "waived"; }
    else if (p === undefined) { state = "not in plan"; cls = "missing"; }
    else if (p === null) { state = "unscheduled"; cls = "missing"; }
    else if (sem == null || sem === TRANSFER || leafSatisfied(node, sem)) { state = semLabel(p); cls = "ok"; }
    else { state = `${semLabel(p)} — too late`; cls = "late"; }
    return `<span class="leaf ${cls}"><a href="#" data-goto="${esc(node.id)}">${node.coreq ? "~" : ""}${esc(node.id)}</a> <small>${esc(state)}</small> ${toggle}</span>`;
  }
  if (node.type === "and") {
    return `<div class="grp and"><div class="grp-label">All of</div><ul>${node.args.map((a, i) => `<li>${renderTree(courseId, a, `${path}.${i}`, sem)}</li>`).join("")}</ul></div>`;
  }
  const { index, pinned } = chooseAlt(courseId, node, path, sem);
  const name = `alt-${path}`;
  return `<div class="grp or"><div class="grp-label">One of
      <label class="auto-opt"><input type="radio" name="${name}" data-choice="${esc(path)}" value="auto" ${pinned ? "" : "checked"}> auto</label></div>
    <ul>${node.args.map((a, i) => `<li class="${i === index ? "active" : "inactive"}">
      <label><input type="radio" name="${name}" data-choice="${esc(path)}" value="${i}" ${pinned && i === index ? "checked" : ""}></label>
      ${renderTree(courseId, a, `${path}.${i}`, sem)}</li>`).join("")}</ul></div>`;
}

function renderDetails() {
  const el = $("#details");
  if (!selected && !editingNew) {
    el.innerHTML = `<div class="d-grid empty">
      <section>
        <h2>Course details</h2>
        <p>Select a course in the graph or the list to see its prerequisites, choose between alternative prerequisites, and edit it.</p>
      </section>
      <section>
        <h3>Automatic prerequisites</h3>
        <p>Adding a course to a semester also adds any missing prerequisites in the latest semester before it in which they're offered. Those are marked as auto-added, and they're removed again when nothing in the plan needs them. Dragging one makes it a regular course.</p>
      </section>
      <section>
        <h3>Prerequisite expressions</h3>
        <p>Prerequisites use expressions like <code>CICS 210 &amp; (COMPSCI 250 | MATH 455)</code>. Prefix a course with <code>~</code> if it can be taken at the same time.</p>
      </section>
    </div>`;
    return;
  }
  const id = editingNew ? "" : selected;
  const c = editingNew ? { id: "", title: "", credits: 3, offered: "", prereq: "", notes: "" } : getCourse(id);
  const placement = editingNew ? undefined : plan.courses[id];
  const inPlan = !!placement;
  const sem = inPlan ? placement.sem : undefined;
  const parsed = parsePrereq(c.prereq);
  const warns = inPlan ? warningsFor(id) : [];
  const deps = inPlan ? dependents(id) : [];
  const overridden = !editingNew && id in plan.overrides;
  const inCatalog = CATALOG.has(id);

  const semOptions = columns().map(col => `<option value="${col.sem ?? "u"}" ${inPlan && col.sem === sem ? "selected" : ""}>${esc(semLabel(col.sem))}</option>`).join("");

  const info = editingNew
    ? `<section class="d-info"><h2>New course</h2><p class="muted">Add a course that isn't in the catalog, such as a gen ed. It's saved with this plan.</p></section>`
    : `<section class="d-info">
      <h2>${esc(id)}</h2>
      <div class="subtitle">${esc(c.title)}</div>
      <div class="facts">${placement?.waived ? "Waived (no credit)" : `${c.credits} credits`} · ${esc(OFFERED_LABELS[c.offered] ?? c.offered)}${placement?.auto ? " · <span class='auto-tag'>auto-added</span>" : ""}${overridden ? " · edited" : ""}${/^(CICS|COMPSCI|INFO) /.test(id) ? ` · <a href="index.html#${encodeURIComponent(id)}">history</a>` : ""}</div>
      <div class="row">
        <label>Semester <select id="d-sem">${inPlan ? "" : `<option value="" selected>— not in plan —</option>`}${semOptions}</select></label>
        ${inPlan ? `<button id="d-remove" type="button" class="danger">Remove</button>` : ""}
      </div>
      ${sem === TRANSFER ? `<label>Credit
        <select id="d-credit">
          <option value="transfer" ${placement.waived ? "" : "selected"}>Transfer / AP credit (${c.credits} cr)</option>
          <option value="waived" ${placement.waived ? "selected" : ""}>Waived (no credit)</option>
        </select></label>` : ""}
      ${warns.length ? `<ul class="warnings">${warns.map(w => `<li>⚠ ${esc(w)}</li>`).join("")}</ul>` : ""}
      ${inPlan && warns.some(w => w.startsWith("Missing")) ? `<button id="d-fill" type="button">Add missing prerequisites</button>` : ""}
      ${placement?.auto ? `<button id="d-keep" type="button" title="Stop treating this as auto-added">Keep even if not needed</button>` : ""}
    </section>
    <section class="d-prereq">
      <h3>Prerequisites</h3>
      ${parsed.error ? `<p class="error">${esc(parsed.error)}</p>` : parsed.tree ? renderTree(id, parsed.tree, "r", sem) : "<p class='muted'>None listed.</p>"}
      ${deps.length ? `<h3>Required by</h3><p>${deps.map(d => `<a href="#" data-goto="${esc(d)}">${esc(d)}</a>`).join(", ")}</p>` : ""}
    </section>
    <section class="d-notes">
      <h3>Catalog text</h3>
      <p class="notes">${c.notes ? esc(c.notes) : "<span class='muted'>None.</span>"}</p>
    </section>`;

  el.innerHTML = `<div class="d-grid">
    ${info}
    <section class="d-edit">
      <h3>${editingNew ? "Details" : "Edit course"}</h3>
      <form id="edit-form">
        ${editingNew ? `<label>Code <input name="id" required placeholder="e.g. HIST 150"></label>` : ""}
        <label>Title <input name="title" value="${esc(c.title)}"></label>
        <div class="row">
          <label>Credits <input name="credits" type="number" min="0" max="20" value="${esc(c.credits)}"></label>
          <label>Offered <select name="offered">${Object.entries(OFFERED_LABELS).map(([k, v]) => `<option value="${k}" ${k === c.offered ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        </div>
        <label>Prerequisites <input name="prereq" value="${esc(c.prereq)}" placeholder="e.g. CICS 210 & (COMPSCI 250 | MATH 455)" autocomplete="off"></label>
        <div id="prereq-check" class="muted"></div>
        <label>Notes <textarea name="notes" rows="2">${esc(editingNew || c.stub ? "" : c.notes)}</textarea></label>
        <div class="row buttons">
          <button type="submit">${editingNew ? "Create" : "Save"}</button>
          ${editingNew ? `<button type="button" id="d-cancel">Cancel</button>` : ""}
          ${overridden && inCatalog ? `<button type="button" id="d-reset">Reset to catalog</button>` : ""}
          ${overridden && !inCatalog ? `<button type="button" id="d-delete" class="danger">Delete course</button>` : ""}
        </div>
      </form>
    </section>
  </div>`;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

function select(id) {
  selected = id;
  editingNew = false;
  render();
}

// Dragging ----------------------------------------------------------------
// One pointer-based drag for both graph nodes and catalog entries; a press
// without movement counts as a click.

let drag = null;

function startDrag(e, id, fromCatalog) {
  if (e.button !== 0) return;
  drag = { id, fromCatalog, x: e.clientX, y: e.clientY, moved: false, ghost: null };
}

document.addEventListener("pointermove", e => {
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.ghost = document.createElement("div");
    drag.ghost.className = "ghost";
    drag.ghost.textContent = drag.id;
    document.body.append(drag.ghost);
    document.body.classList.add("dragging");
  }
  drag.ghost.style.left = `${e.clientX + 8}px`;
  drag.ghost.style.top = `${e.clientY + 8}px`;
  const ci = columnAt(e.clientX, e.clientY);
  document.querySelectorAll(".col").forEach(c => c.classList.toggle("drop", +c.dataset.col === ci));
});

document.addEventListener("pointerup", e => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) {
    select(d.id);
    return;
  }
  d.ghost.remove();
  document.body.classList.remove("dragging");
  const ci = columnAt(e.clientX, e.clientY);
  if (ci == null) { renderBoard(); return; }
  const sem = columns()[ci].sem;
  if (!d.fromCatalog && plan.courses[d.id]?.sem === sem && !plan.courses[d.id].auto) { renderBoard(); return; }
  placeCourse(d.id, sem);
});

function columnAt(x, y) {
  const wrap = $("#graph-wrap").getBoundingClientRect();
  if (x < wrap.left || x > wrap.right || y < wrap.top || y > wrap.bottom) return null;
  const ci = Math.floor((x - $("#board").getBoundingClientRect().left) / COL_W);
  return ci >= 0 && ci < columns().length ? ci : null;
}

// Events ------------------------------------------------------------------

function bindSetting(sel, apply) {
  $(sel).addEventListener("change", e => { apply(e.target.value); commit(); });
}

bindSetting("#plan-name", v => { plan.name = v.trim() || "My plan"; });
bindSetting("#start-season", v => { plan.start.season = v; });
bindSetting("#start-year", v => { plan.start.year = parseInt(v, 10) || plan.start.year; });
bindSetting("#num-semesters", v => {
  const n = Math.min(16, Math.max(1, parseInt(v, 10) || plan.numSemesters));
  const before = Object.values(plan.courses).filter(c => c.sem == null).length;
  setNumSemesters(n);
  const moved = Object.values(plan.courses).filter(c => c.sem == null).length - before;
  if (moved > 0) toast(`${moved} course${moved > 1 ? "s" : ""} moved to Unscheduled.`);
});
bindSetting("#max-credits", v => { plan.maxCredits = parseInt(v, 10) || plan.maxCredits; });
bindSetting("#min-credits", v => { plan.minCredits = parseInt(v, 10) || 0; });
bindSetting("#prior-credits", v => { plan.priorCredits = parseInt(v, 10) || 0; });

$("#search").addEventListener("input", renderCatalog);

$("#catalog").addEventListener("pointerdown", e => {
  if (e.target.closest("button")) return;
  const li = e.target.closest("li[data-id]");
  if (li) { e.preventDefault(); startDrag(e, li.dataset.id, true); }
});
$("#catalog").addEventListener("click", e => {
  const btn = e.target.closest("[data-add]");
  if (btn) placeCourse(btn.dataset.add, parseSemValue($("#add-target").value));
});

$("#board").addEventListener("pointerdown", e => {
  const node = e.target.closest(".node");
  if (node) { e.preventDefault(); startDrag(e, node.dataset.id, false); }
  else if (!e.target.closest(".col-head")) { selected = null; editingNew = false; render(); }
});
$("#board").addEventListener("pointerover", e => {
  const node = e.target.closest(".node");
  const id = node ? node.dataset.id : null;
  if (id !== hovered && !drag) { hovered = id; renderBoard(); }
});
$("#board").addEventListener("pointerleave", () => { if (hovered) { hovered = null; renderBoard(); } });

$("#btn-custom").addEventListener("click", () => { selected = null; editingNew = true; render(); });

$("#details").addEventListener("click", e => {
  const go = e.target.closest("[data-goto]");
  if (go) { e.preventDefault(); select(go.dataset.goto); return; }
  const waive = e.target.closest("[data-waive]");
  if (waive) { toggleWaivedPrereq(selected, waive.dataset.waive); return; }
  const id = selected;
  switch (e.target.id) {
    case "d-remove": removeCourse(id); toast(`Removed ${id}.`); break;
    case "d-fill": {
      const added = ensurePrereqs(id);
      commit();
      toast(added.length ? `Added prerequisites: ${added.join(", ")}.` : "Nothing to add.");
      break;
    }
    case "d-keep": plan.courses[id].auto = false; commit(); break;
    case "d-cancel": editingNew = false; render(); break;
    case "d-reset": delete plan.overrides[id]; collectUnneeded(); commit(); break;
    case "d-delete":
      if (confirm(`Delete ${id} from your courses?`)) {
        delete plan.overrides[id];
        removeCourse(id);
        selected = null;
        commit();
      }
      break;
  }
});

$("#details").addEventListener("change", e => {
  if (e.target.id === "d-credit") {
    plan.courses[selected].waived = e.target.value === "waived";
    commit();
  } else if (e.target.id === "d-sem") {
    if (e.target.value !== "") placeCourse(selected, parseSemValue(e.target.value));
  } else if (e.target.dataset.choice) {
    setChoice(selected, e.target.dataset.choice, e.target.value === "auto" ? null : parseInt(e.target.value, 10));
  }
});

$("#details").addEventListener("input", e => {
  if (e.target.name !== "prereq") return;
  const { tree, error } = parsePrereq(e.target.value);
  const check = $("#prereq-check");
  check.className = error ? "error" : "muted";
  check.textContent = error ? error : tree ? `Courses: ${[...new Set(leafIds(tree))].join(", ")}` : "";
});

function leafIds(node) {
  return node.type === "course" ? [node.id] : node.args.flatMap(leafIds);
}

$("#details").addEventListener("submit", e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const id = editingNew ? normalizeId(f.get("id")) : selected;
  if (!id) { toast("Course code should look like SUBJECT 123, e.g. HIST 150."); return; }
  const prereq = String(f.get("prereq")).trim();
  const { error } = parsePrereq(prereq);
  if (error) { toast(`Fix the prerequisites first: ${error}`); return; }
  if (editingNew && (CATALOG.has(id) || plan.overrides[id])) { toast(`${id} already exists; select it to edit.`); return; }
  const base = getCourse(id);
  const course = {
    id,
    title: String(f.get("title")).trim(),
    credits: parseInt(f.get("credits"), 10) || 0,
    offered: String(f.get("offered")),
    prereq,
    notes: String(f.get("notes")).trim() || (base.stub ? "" : base.notes),
  };
  if (prereq !== base.prereq) delete plan.choices[id];
  plan.overrides[id] = course;
  editingNew = false;
  selected = id;
  if (id in plan.courses) ensurePrereqs(id);
  collectUnneeded();
  commit();
  toast(`Saved ${id}.`);
});

$("#btn-new").addEventListener("click", () => {
  if (Object.keys(plan.courses).length && !confirm("Start a new plan? Save this one first if you want to keep it.")) return;
  plan = newPlan();
  selected = null;
  commit();
});

$("#btn-save").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${plan.name.replace(/[^\w.-]+/g, "_") || "plan"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$("#btn-open").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    plan = migrate(JSON.parse(await file.text()));
    selected = null;
    editingNew = false;
    commit();
    toast(`Opened ${file.name}.`);
  } catch (err) {
    toast(`Couldn't open ${file.name}: ${err.message}`);
  }
});

// Resizable details pane below the graph.
const DETAILS_HEIGHT_KEY = "coursePlanner.detailsHeight";
const setDetailsHeight = h => {
  const max = $("main").clientHeight - 160;
  $("#details").style.height = `${Math.round(Math.max(120, Math.min(max, h)))}px`;
};
setDetailsHeight(+localStorage.getItem(DETAILS_HEIGHT_KEY) || 280);
$("#splitter").addEventListener("pointerdown", e => {
  e.preventDefault();
  const startY = e.clientY, startH = $("#details").offsetHeight;
  const move = ev => setDetailsHeight(startH - (ev.clientY - startY));
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    document.body.classList.remove("resizing");
    localStorage.setItem(DETAILS_HEIGHT_KEY, $("#details").offsetHeight);
  };
  document.body.classList.add("resizing");
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !e.target.closest("input, textarea, select")) { selected = null; editingNew = false; render(); }
});

render();
