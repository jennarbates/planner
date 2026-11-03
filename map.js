// Prerequisite map: which courses name which, term by term. Data is in history-data.js.

"use strict";

const { terms: TERMS, courses: COURSES } = window.HISTORY;
const TERM_IDS = TERMS.map(t => t.id);
const TERM_LABEL = Object.fromEntries(TERMS.map(t => [t.id, t.label]));
const BY_KEY = new Map(COURSES.map(c => [c.key, c]));

const NODE_W = 172, NODE_H = 42, GAP_Y = 8, COL_W = 232, PAD_X = 18, HEAD_H = 28, PAD_Y = 12;

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isExperimental = c => /\d[A-Z]/.test(c.id);

const DEFAULT_COURSE = "COMPSCI 311";

const state = {
  term: TERM_IDS.length - 1,
  base: TERM_IDS[0],
  view: "course",
  scope: "core",
  exp: "connected",
  out: "mathstat",
  selected: DEFAULT_COURSE,
  list: null,
};

let layout = null;
let playTimer = null;

const label = key => BY_KEY.get(key)?.id ?? key;
const title = key => BY_KEY.get(key)?.title ?? "";

// The core view is the undergraduate courses that at least this many regular courses,
// at any level, have named.
const CORE_MIN_NAMED_BY = 2;

const CORE = (() => {
  const namedBy = new Map();
  for (const c of COURSES) {
    if (isExperimental(c)) continue;
    const names = new Set(Object.values(c.offerings).flatMap(o => o.needs ?? []));
    names.forEach(n => namedBy.set(n, (namedBy.get(n) ?? 0) + 1));
  }
  return new Set(COURSES.filter(c => c.level < 500 && !isExperimental(c) && (namedBy.get(c.key) ?? 0) >= CORE_MIN_NAMED_BY).map(c => c.key));
})();

function inScope(c) {
  if (state.scope === "core") return CORE.has(c.key);
  return state.scope === "ugrad" ? c.level < 500 : state.scope === "grad" ? c.level >= 500 : true;
}

// Math below 132 only appears as a placement option for intro courses, so it's left to "All".
function outsideVisible(code) {
  if (state.out === "none") return false;
  if (state.out === "all") return true;
  const m = code.match(/^(MATH|STATISTC) (\d+)/);
  return !!m && (m[1] === "STATISTC" || Number(m[2]) >= 132);
}

// A course stays on the map through the next term, since most run only in fall or spring.
function isActive(c, i) {
  return !!(c.offerings[TERM_IDS[i]] || (i > 0 && c.offerings[TERM_IDS[i - 1]]));
}

function needsAt(c, i) {
  for (let t = i; t >= 0; t--) {
    const o = c.offerings[TERM_IDS[t]];
    if (o?.needs) return o.needs;
  }
  return [];
}

function offeringAt(c, i) {
  for (let t = i; t >= 0; t--) {
    const o = c.offerings[TERM_IDS[t]];
    if (o) return { offering: o, term: TERM_IDS[t] };
  }
  return null;
}

/* Which courses can appear with these settings. Fixed across terms so boxes don't move. */

function shownCourses() {
  const regular = COURSES.filter(c => inScope(c) && !isExperimental(c));
  return state.exp === "all" ? COURSES.filter(inScope) : regular;
}

function edgeVisible(need) {
  const c = BY_KEY.get(need);
  if (!c) return outsideVisible(need);
  if (state.scope === "core") return CORE.has(need) || isExperimental(c);
  return true; // a course named from outside the chosen levels is still part of the picture
}

function edgesAt(i, sources) {
  const set = new Set();
  for (const c of sources) {
    if (!isActive(c, i)) continue;
    for (const n of needsAt(c, i)) if (edgeVisible(n)) set.add(`${n}|${c.key}`);
  }
  return set;
}

function computeLayout() {
  const sources = shownCourses();
  const allEdges = new Set();
  TERM_IDS.forEach((_, i) => edgesAt(i, sources).forEach(e => allEdges.add(e)));

  const keys = new Set();
  allEdges.forEach(e => e.split("|").forEach(k => keys.add(k)));
  const hidden = sources.filter(c => !keys.has(c.key)).length;

  const colOf = k => (BY_KEY.has(k) ? Math.min(700, BY_KEY.get(k).level) : 0);
  const used = [...new Set([...keys].map(colOf))].sort((a, b) => a - b);
  const columns = new Map(used.map(l => [l, []]));
  [...keys].sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true })).forEach(k => columns.get(colOf(k)).push(k));

  // Ordering each column by its neighbours' positions untangles most of the crossings.
  const pairs = [...allEdges].map(e => e.split("|"));
  const pos = new Map();
  const index = () => columns.forEach(list => list.forEach((k, n) => pos.set(k, n)));
  index();
  for (let sweep = 0; sweep < 8; sweep++) {
    const order = sweep % 2 ? [...used].reverse() : used;
    for (const lvl of order) {
      const score = new Map();
      for (const k of columns.get(lvl)) {
        const near = pairs.filter(([a, b]) => a === k || b === k).map(([a, b]) => pos.get(a === k ? b : a));
        score.set(k, near.length ? near.reduce((x, y) => x + y, 0) / near.length : pos.get(k));
      }
      columns.get(lvl).sort((a, b) => score.get(a) - score.get(b));
      columns.get(lvl).forEach((k, n) => pos.set(k, n));
    }
  }

  const points = new Map();
  let maxRows = 0;
  used.forEach((lvl, col) => {
    const list = columns.get(lvl);
    maxRows = Math.max(maxRows, list.length);
    list.forEach((k, n) => points.set(k, { x: PAD_X + col * COL_W, y: HEAD_H + PAD_Y + n * (NODE_H + GAP_Y) }));
  });
  layout = {
    sources,
    points,
    hidden,
    used,
    width: PAD_X * 2 + used.length * COL_W - (COL_W - NODE_W),
    height: HEAD_H + PAD_Y * 2 + maxRows * (NODE_H + GAP_Y),
  };
}

/* What's drawn for the current term */

function baseIndex() {
  if (state.base === "") return null;
  if (state.base === "prev") return state.term > 0 ? state.term - 1 : null;
  const b = TERM_IDS.indexOf(state.base);
  return b < state.term ? b : null;
}

function currentEdges() {
  const now = edgesAt(state.term, layout.sources);
  const b = baseIndex();
  const before = b === null ? null : edgesAt(b, layout.sources);
  const all = [];
  now.forEach(e => all.push({ id: e, status: before && !before.has(e) ? "added" : "same" }));
  before?.forEach(e => { if (!now.has(e)) all.push({ id: e, status: "dropped" }); });
  return all.map(e => {
    const [from, to] = e.id.split("|");
    return { ...e, from, to };
  });
}

function chainOf(key, edges) {
  const live = edges.filter(e => e.status !== "dropped");
  const walk = (start, next) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const n of next(queue.pop())) {
        if (!seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    return seen;
  };
  const up = walk(key, k => live.filter(e => e.to === k).map(e => e.from));
  const down = walk(key, k => live.filter(e => e.from === k).map(e => e.to));
  return new Set([...up, ...down]);
}

function edgePath(e) {
  const a = layout.points.get(e.from), b = layout.points.get(e.to);
  if (!a || !b) return "";
  const y1 = a.y + NODE_H / 2, y2 = b.y + NODE_H / 2;
  if (a.x === b.x) {
    const x = a.x + NODE_W, bend = 26 + Math.min(30, Math.abs(y2 - y1) / 8);
    return `M${x},${y1} C${x + bend},${y1} ${x + bend},${y2} ${x + 5},${y2}`;
  }
  const x1 = a.x + NODE_W, x2 = b.x - 5, mid = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + mid},${y1} ${x2 - mid},${y2} ${x2},${y2}`;
}

const ARROW_DEFS = `<defs>
    <marker id="a-same" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path class="m-arrow" d="M0,0 L6,3 L0,6 Z"/></marker>
    <marker id="a-added" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path class="m-arrow added" d="M0,0 L6,3 L0,6 Z"/></marker>
    <marker id="a-dropped" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path class="m-arrow dropped" d="M0,0 L6,3 L0,6 Z"/></marker>
  </defs>`;

/* One course: what it builds on, and what it leads to */

function courseConnections(key) {
  const c = BY_KEY.get(key);
  const b = baseIndex();
  const i = state.term;
  const statusOf = (now, before, hasBase) => (now ? (hasBase && !before ? "added" : "same") : "dropped");
  const order = { added: 0, same: 1, dropped: 2 };
  const byStatus = (x, y) => order[x.status] - order[y.status] || label(x.key).localeCompare(label(y.key), undefined, { numeric: true });

  const now = isActive(c, i) ? needsAt(c, i) : [];
  const hasBase = b !== null && isActive(c, b);
  const before = hasBase ? needsAt(c, b) : [];
  const needs = [...new Set([...now, ...before])].map(k => ({ key: k, status: statusOf(now.includes(k), before.includes(k), hasBase) }));

  const leads = [];
  for (const x of COURSES) {
    const nowNames = isActive(x, i) && needsAt(x, i).includes(key);
    const beforeNames = b !== null && isActive(x, b) && needsAt(x, b).includes(key);
    if (nowNames || beforeNames) leads.push({ key: x.key, status: statusOf(nowNames, beforeNames, hasBase) });
  }
  return {
    hasBase,
    prereqs: needs.filter(n => BY_KEY.has(n.key)).sort(byStatus),
    outside: needs.filter(n => !BY_KEY.has(n.key)).sort(byStatus),
    leads: leads.sort(byStatus),
  };
}

function renderCourseBoard() {
  const board = $("#m-board");
  const key = state.selected;
  if (!BY_KEY.has(key)) {
    board.style.width = "auto";
    board.style.height = "auto";
    board.innerHTML = `<p class="m-empty">Choose a course above to see what it builds on and what it leads to.</p>`;
    return;
  }
  const W = 200, H = 48, GAP = 10, COL = 300, TOP = HEAD_H + 16;
  const { prereqs, outside, leads } = courseConnections(key);
  const leadCols = leads.length > 8 ? 2 : 1;
  const leadRows = Math.ceil(leads.length / leadCols);
  const outsideLines = Math.ceil(outside.join ? outside.map(o => o.key).join(", ").length / 26 : 0);
  const outsideH = outside.length ? 30 + outsideLines * 15 : 0;
  const leftH = prereqs.length * (H + GAP) + (outside.length ? outsideH + GAP : 0);
  const rightH = leadRows * (H + GAP);
  const height = Math.max(leftH, rightH, H + GAP);
  const width = PAD_X * 2 + COL * 2 + W + (leadCols - 1) * (W + 14);
  const midX = PAD_X + COL, rightX = PAD_X + COL * 2;
  const midY = TOP + (height - H) / 2;
  const center = { x: midX, y: midY };
  const tagText = { added: "Added", dropped: "Dropped" };

  const box = (item, x, y) => {
    const c = BY_KEY.get(item.key);
    return `<div class="m-node big st-${item.status} ${isExperimental(c) ? "exp" : ""}" data-key="${esc(item.key)}" tabindex="0" role="button"
      style="left:${x}px;top:${y}px;width:${W}px;height:${H}px" title="Go to ${esc(c.id)}: ${esc(c.title)}">
      <span class="code">${esc(c.id)}${tagText[item.status] ? ` <span class="tag ${item.status}">${tagText[item.status]}</span>` : ""}</span>
      <span class="title">${esc(c.title)}</span></div>`;
  };
  const curve = (x1, y1, x2, y2, status) => {
    const mid = (x2 - x1) / 2;
    const marker = status === "same" ? "url(#a-same)" : `url(#a-${status})`;
    return `<path class="m-edge strong ${status}" marker-end="${marker}" d="M${x1},${y1} C${x1 + mid},${y1} ${x2 - mid},${y2} ${x2 - 5},${y2}"/>`;
  };

  const parts = [], paths = [];
  let y = TOP + (height - leftH) / 2;
  for (const p of prereqs) {
    parts.push(box(p, PAD_X, y));
    paths.push(curve(PAD_X + W, y + H / 2, midX, midY + H / 2, p.status));
    y += H + GAP;
  }
  if (outside.length) {
    parts.push(`<div class="m-node big ext" style="left:${PAD_X}px;top:${y}px;width:${W}px;height:${outsideH}px">
      <span class="code">Other departments</span><span class="wrap">${esc(outside.map(o => o.key).join(", "))}</span></div>`);
    paths.push(curve(PAD_X + W, y + outsideH / 2, midX, midY + H / 2, "same"));
  }
  leads.forEach((l, n) => {
    const col = n % leadCols, row = Math.floor(n / leadCols);
    const ly = TOP + (height - rightH) / 2 + row * (H + GAP);
    const lx = rightX + col * (W + 14);
    parts.push(box(l, lx, ly));
    if (col === 0) paths.push(curve(midX + W, midY + H / 2, lx, ly + H / 2, l.status));
  });
  const c = BY_KEY.get(key);

  board.style.width = `${width}px`;
  board.style.height = `${TOP + height + 16}px`;
  board.innerHTML = `<div class="m-heads" style="width:${width}px">
      <span style="left:${PAD_X}px">It builds on${prereqs.length + outside.length ? "" : ": nothing named"}</span>
      <span style="left:${midX}px">This course</span>
      <span style="left:${rightX}px">It leads to${leads.length ? "" : ": nothing names it"}</span>
    </div>
    <svg width="${width}" height="${TOP + height + 16}" aria-hidden="true">${ARROW_DEFS}${paths.join("")}</svg>
    ${parts.join("")}
    <div class="m-node big current ${isExperimental(c) ? "exp" : ""}" style="left:${center.x}px;top:${center.y}px;width:${W}px;height:${H}px" title="${esc(c.id)}: ${esc(c.title)}">
      <span class="code">${esc(c.id)}</span><span class="title">${esc(c.title)}</span></div>`;
}

function renderBoard(edges) {
  if (state.view === "course") {
    renderCourseBoard();
    return;
  }
  const board = $("#m-board");
  if (!layout.points.size) {
    board.style.width = "auto";
    board.style.height = "auto";
    board.innerHTML = `<p class="m-empty">No connections to show with these settings.</p>`;
    return;
  }
  const chain = state.selected && layout.points.has(state.selected) ? chainOf(state.selected, edges) : null;
  const connected = new Set(edges.flatMap(e => [e.from, e.to]));
  board.style.width = `${layout.width}px`;
  board.style.height = `${layout.height}px`;

  const heads = layout.used.map((lvl, col) => `<span style="left:${PAD_X + col * COL_W}px">${lvl === 0 ? "Other departments" : lvl === 700 ? "700+" : `${lvl} level`}</span>`).join("");
  const paths = edges.map(e => {
    const inChain = chain && chain.has(e.from) && chain.has(e.to);
    const touches = chain && (e.from === state.selected || e.to === state.selected);
    const dim = chain && !inChain && !(e.status === "dropped" && touches);
    const marker = e.status === "same" ? "url(#a-same)" : `url(#a-${e.status})`;
    return `<path class="m-edge ${e.status} ${inChain ? "chain" : ""} ${dim ? "dim" : ""}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" marker-end="${marker}" d="${edgePath(e)}"/>`;
  }).join("");
  const nodes = [...layout.points].map(([k, p]) => {
    const c = BY_KEY.get(k);
    const cls = [
      c ? (isExperimental(c) ? "exp" : "") : "ext",
      c && !isActive(c, state.term) && !connected.has(k) ? "off" : "",
      !c && !connected.has(k) ? "off" : "",
      chain && !chain.has(k) ? "dim" : "",
      chain?.has(k) ? "chain" : "",
      k === state.selected ? "selected" : "",
    ].join(" ");
    const name = c ? `${c.id}: ${c.title}` : k;
    return `<div class="m-node ${cls}" data-key="${esc(k)}" style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px"
      ${c ? `tabindex="0" role="button" aria-pressed="${k === state.selected}"` : ""} title="${esc(name)}">
      <span class="code">${esc(label(k))}</span><span class="title">${c ? esc(c.title) : "Outside CICS listings"}</span></div>`;
  }).join("");
  board.innerHTML = `<div class="m-heads" style="width:${layout.width}px">${heads}</div>
    <svg width="${layout.width}" height="${layout.height}" aria-hidden="true">
      ${ARROW_DEFS}
      ${paths}
    </svg>
    ${nodes}`;
}

function renderStats(edges) {
  const b = baseIndex();
  const shown = new Set(edges.filter(e => e.status !== "dropped").flatMap(e => [e.from, e.to]));
  const added = edges.filter(e => e.status === "added").length;
  const dropped = edges.filter(e => e.status === "dropped").length;
  const since = b === null ? "nothing to compare with" : `since ${TERM_LABEL[TERM_IDS[b]]}`;
  const tiles = [
    { id: "connections", n: edges.length - dropped, l: `Connections in ${TERM_LABEL[TERM_IDS[state.term]]}` },
    { id: "added", n: added, l: `Added, ${since}` },
    { id: "dropped", n: dropped, l: `Dropped, ${since}` },
    { id: "courses", n: shown.size, l: "Courses and outside classes connected" },
  ];
  $("#h-stats").innerHTML = tiles.map(t => `<button type="button" class="stat" data-list="${t.id}" aria-expanded="${state.list === t.id}" aria-controls="h-drill">
    <span class="n">${esc(t.n)}</span><span class="l">${esc(t.l)}</span><span class="more">${state.list === t.id ? "Hide list" : "View list"}</span></button>`).join("");
}

function listContent(edges) {
  const sortKey = e => `${label(e.to)} ${label(e.from)}`;
  const byCourse = (x, y) => sortKey(x).localeCompare(sortKey(y), undefined, { numeric: true });
  const b = baseIndex();
  const statusText = { same: "Unchanged", added: "Added", dropped: "Dropped" };
  const edgeRows = list => list.slice().sort(byCourse).map(e => ({
    key: BY_KEY.has(e.to) ? e.to : e.from,
    cells: [`<b>${esc(label(e.to))}</b>`, esc(title(e.to)), esc(label(e.from)), statusText[e.status]],
  }));
  const cols = ["Course", "Title", "Names in its prerequisites", b === null ? "State" : "Status"];
  const term = TERM_LABEL[TERM_IDS[state.term]];
  if (state.list === "added") return { title: `Connections added since ${b === null ? "—" : TERM_LABEL[TERM_IDS[b]]}`, note: `Named in ${term} but not in the earlier term.`, cols, rows: edgeRows(edges.filter(e => e.status === "added")) };
  if (state.list === "dropped") return { title: `Connections dropped since ${b === null ? "—" : TERM_LABEL[TERM_IDS[b]]}`, note: `Named in the earlier term but not in ${term}.`, cols, rows: edgeRows(edges.filter(e => e.status === "dropped")) };
  if (state.list === "connections") return { title: `Connections in ${term}`, note: "Every arrow on the map for this term.", cols, rows: edgeRows(edges.filter(e => e.status !== "dropped")) };

  const live = edges.filter(e => e.status !== "dropped");
  const keys = [...new Set(live.flatMap(e => [e.from, e.to]))].sort((x, y) => label(x).localeCompare(label(y), undefined, { numeric: true }));
  return {
    title: `Courses connected in ${term}`,
    note: `${layout.hidden ? `${plural(layout.hidden, "course")} with no connections aren't shown. ` : ""}Most connected courses are the hardest to change without a ripple.`,
    cols: ["Course", "Title", "Named by", "Names"],
    rows: keys.map(k => ({
      key: BY_KEY.has(k) ? k : null,
      score: live.filter(e => e.from === k).length,
      cells: [`<b>${esc(label(k))}</b>`, esc(title(k)), String(live.filter(e => e.from === k).length), String(live.filter(e => e.to === k).length)],
    })).sort((x, y) => y.score - x.score),
  };
}

function renderList(edges) {
  const el = $("#h-drill");
  if (!state.list) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const d = listContent(edges);
  el.hidden = false;
  el.innerHTML = `<div class="drill-head">
      <div><h2>${esc(d.title)} <span class="muted">(${d.rows.length})</span></h2><p class="muted">${esc(d.note)}</p></div>
      <button type="button" id="drill-close">Close</button>
    </div>
    ${d.rows.length ? `<div class="drill-wrap"><table>
      <thead><tr>${d.cols.map(x => `<th scope="col">${esc(x)}</th>`).join("")}</tr></thead>
      <tbody>${d.rows.map(x => `<tr ${x.key ? `tabindex="0" data-key="${esc(x.key)}" title="Show this course on the map"` : ""}>${x.cells.map(v => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>` : `<p class="nodata">Nothing to list for this term.</p>`}`;
}

function renderSelected(edges) {
  const el = $("#m-selected");
  const c = BY_KEY.get(state.selected);
  if (!c) {
    el.innerHTML = "";
    return;
  }
  const codeButtons = keys => (keys.length ? keys.map(k => (BY_KEY.has(k) ? `<button type="button" class="code-link" data-key="${esc(k)}">${esc(label(k))}</button>` : esc(k))).join(", ") : "none");
  const sorted = list => list.slice().sort((x, y) => label(x).localeCompare(label(y), undefined, { numeric: true }));
  // These come from every course, since the map may be showing only some of them.
  const names = sorted(isActive(c, state.term) ? needsAt(c, state.term) : []);
  const leads = sorted(COURSES.filter(x => isActive(x, state.term) && needsAt(x, state.term).includes(c.key)).map(x => x.key));
  const added = sorted(edges.filter(e => e.status === "added" && e.to === c.key).map(e => e.from));
  const dropped = sorted(edges.filter(e => e.status === "dropped" && e.to === c.key).map(e => e.from));
  const at = offeringAt(c, state.term);
  const text = at ? at.offering.elig?.pre || at.offering.pre : "";
  const b = baseIndex();
  const changes = b === null || (!added.length && !dropped.length) ? "" : `<p><b>Since ${esc(TERM_LABEL[TERM_IDS[b]])}:</b> ${added.length ? `now names ${codeButtons(added)}` : ""}${added.length && dropped.length ? "; " : ""}${dropped.length ? `no longer names ${codeButtons(dropped)}` : ""}</p>`;
  const course = state.view === "course";
  let courseChanges = "";
  if (course && b !== null) {
    const link = list => codeButtons(list.map(x => x.key));
    const base = TERM_LABEL[TERM_IDS[b]];
    const { hasBase, prereqs, outside, leads: named } = courseConnections(c.key);
    const needs = [...prereqs, ...outside];
    const pick = (list, status) => list.filter(x => x.status === status);
    const parts = [];
    if (pick(needs, "added").length) parts.push(`now names ${link(pick(needs, "added"))}`);
    if (pick(needs, "dropped").length) parts.push(`no longer names ${link(pick(needs, "dropped"))}`);
    if (pick(named, "added").length) parts.push(`newly named by ${link(pick(named, "added"))}`);
    if (pick(named, "dropped").length) parts.push(`no longer named by ${link(pick(named, "dropped"))}`);
    courseChanges = !hasBase
      ? `<p class="muted">Not listed around ${esc(base)}, so there's nothing to compare it with.</p>`
      : `<p><b>Since ${esc(base)}:</b> ${parts.join("; ") || "no changes in what it names or what names it"}</p>`;
  }
  el.innerHTML = `<div class="sel-head">
      <h2>${esc(c.id)}: ${esc(c.title)}</h2>
      <div class="sel-actions">
        <a href="index.html#${encodeURIComponent(c.key)}">Open full history →</a>
        ${course ? "" : `<button type="button" id="m-focus">Focus on this course</button><button type="button" id="m-clear">Clear</button>`}
      </div>
    </div>
    ${course ? courseChanges : `<p><b>Names in its prerequisites:</b> ${codeButtons(names)} · <b>Named by:</b> ${codeButtons(leads)}</p>${changes}`}
    ${text ? `<p><b>Wording${at.term !== TERM_IDS[state.term] ? ` (${esc(TERM_LABEL[at.term])})` : ""}:</b> ${esc(text)}</p>` : at ? "" : `<p class="muted">Not listed yet in this term.</p>`}`;
}

function renderLegend() {
  const compare = baseIndex() !== null;
  if (state.view === "course") {
    const b = baseIndex();
    $("#m-legend").innerHTML = `<span>Click any course to move to it. It may be a requirement or one option of several, so check the wording above.</span>
      ${compare ? `<span class="key"><span class="ln added"></span>Added since ${esc(TERM_LABEL[TERM_IDS[b]])}</span><span class="key"><span class="ln dropped"></span>Dropped since ${esc(TERM_LABEL[TERM_IDS[b]])}</span>` : ""}
      <span class="key"><span class="bx exp"></span>Experimental</span>`;
    return;
  }
  $("#m-legend").innerHTML = `
    <span class="key"><span class="ln"></span>${compare ? "In both terms" : "Connection"}</span>
    ${compare ? `<span class="key"><span class="ln added"></span>Added</span><span class="key"><span class="ln dropped"></span>Dropped</span>` : ""}
    <span class="key"><span class="bx exp"></span>Experimental</span>
    <span class="key"><span class="bx ext"></span>Outside CICS listings</span>
    <span>Click a course to light up its chain. Click it again to open its history.</span>`;
}

function renderControls() {
  $("#m-term").value = state.term;
  $("#m-term-label").textContent = TERM_LABEL[TERM_IDS[state.term]];
  $("#m-prev").disabled = state.term === 0;
  $("#m-next").disabled = state.term === TERM_IDS.length - 1;
  $("#m-base").value = state.base;
  $("#m-scope").value = state.scope;
  $("#m-exp").value = state.exp;
  $("#m-play").textContent = playTimer ? "Pause" : "Play";
  document.body.classList.toggle("view-course", state.view === "course");
  document.querySelectorAll("[data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  const picker = $("#m-course");
  if (document.activeElement !== picker) picker.value = BY_KEY.get(state.selected)?.id ?? "";
}

function render() {
  const edges = currentEdges();
  renderControls();
  renderLegend();
  renderStats(edges);
  renderList(edges);
  renderSelected(edges);
  renderBoard(edges);
}

function rebuild() {
  computeLayout();
  render();
}

// Moving between courses adds to the browser history, so Back returns to the last one.
function goToCourse(key) {
  state.selected = key;
  const target = `#${encodeURIComponent(key)}`;
  if (location.hash !== target) history.pushState(null, "", target);
  render();
  $("#m-scroller").scrollTo({ left: 0, top: 0 });
}

function selectNode(key, scroll) {
  state.selected = key;
  // A course outside the current view gets shown rather than left off the map.
  if (key && state.view === "all" && !layout.points.has(key)) {
    state.scope = "all";
    computeLayout();
    if (!layout.points.has(key)) {
      state.exp = "all";
      computeLayout();
    }
  }
  history.replaceState(null, "", key ? `#${encodeURIComponent(key)}` : "#");
  render();
  const p = layout.points.get(key);
  if (scroll && p) {
    const box = $("#m-scroller");
    box.scrollTo({ left: Math.max(0, p.x - box.clientWidth / 2 + NODE_W / 2), top: Math.max(0, p.y - box.clientHeight / 2) });
    box.scrollIntoView({ block: "nearest" });
  }
}

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
}

/* Wiring */

$("#m-term").max = TERM_IDS.length - 1;
$("#m-ticks").innerHTML = TERM_IDS.map(t => `<span>${t}</span>`).join("");
$("#m-base").innerHTML = `<option value="prev">Previous term</option>${TERM_IDS.map(t => `<option value="${t}">${esc(TERM_LABEL[t])}</option>`).join("")}<option value="">Nothing</option>`;

$("#m-term").addEventListener("input", e => { stopPlay(); state.term = Number(e.target.value); render(); });
$("#m-prev").addEventListener("click", () => { stopPlay(); state.term = Math.max(0, state.term - 1); render(); });
$("#m-next").addEventListener("click", () => { stopPlay(); state.term = Math.min(TERM_IDS.length - 1, state.term + 1); render(); });
$("#m-play").addEventListener("click", () => {
  if (playTimer) {
    stopPlay();
    render();
    return;
  }
  if (state.term === TERM_IDS.length - 1) state.term = 0;
  playTimer = setInterval(() => {
    if (state.term >= TERM_IDS.length - 1) {
      stopPlay();
    } else {
      state.term++;
    }
    render();
  }, 1400);
  render();
});
$("#m-base").addEventListener("change", e => { state.base = e.target.value; render(); });
$("#m-scope").addEventListener("change", e => { state.scope = e.target.value; rebuild(); });
$("#m-exp").addEventListener("change", e => { state.exp = e.target.value; rebuild(); });
$("#m-out").addEventListener("change", e => { state.out = e.target.value; rebuild(); });

$("#h-stats").addEventListener("click", e => {
  const b = e.target.closest("[data-list]");
  if (!b) return;
  state.list = state.list === b.dataset.list ? null : b.dataset.list;
  render();
});
$("#h-drill").addEventListener("click", e => {
  if (e.target.closest("#drill-close")) {
    state.list = null;
    render();
    return;
  }
  const tr = e.target.closest("tr[data-key]");
  if (tr) selectNode(tr.dataset.key, true);
});
$("#h-drill").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-key]");
  if (!tr) return;
  e.preventDefault();
  selectNode(tr.dataset.key, true);
});
$("#m-selected").addEventListener("click", e => {
  if (e.target.closest("#m-clear")) {
    selectNode(null);
    return;
  }
  if (e.target.closest("#m-focus")) {
    state.view = "course";
    goToCourse(state.selected);
    return;
  }
  const b = e.target.closest("button[data-key]");
  if (!b) return;
  if (state.view === "course") goToCourse(b.dataset.key);
  else selectNode(b.dataset.key, true);
});

function activateNode(node) {
  const key = node.dataset.key;
  if (!BY_KEY.has(key)) return;
  if (state.view === "course") {
    goToCourse(key);
    return;
  }
  if (state.selected === key) location.href = `index.html#${encodeURIComponent(key)}`;
  else selectNode(key);
  $(`#m-board .m-node[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}
$("#m-board").addEventListener("click", e => {
  const node = e.target.closest(".m-node");
  if (node) activateNode(node);
  else if (state.view === "all" && !e.target.closest(".m-heads")) selectNode(null);
});
$("#m-board").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const node = e.target.closest(".m-node");
  if (!node) return;
  e.preventDefault();
  activateNode(node);
});
$("#m-board").addEventListener("pointerover", e => {
  const node = e.target.closest(".m-node");
  document.querySelectorAll(".m-edge.hi").forEach(p => p.classList.remove("hi"));
  if (!node) return;
  const key = CSS.escape(node.dataset.key);
  document.querySelectorAll(`.m-edge[data-from="${key}"], .m-edge[data-to="${key}"]`).forEach(p => p.classList.add("hi"));
});

function applyHash() {
  const raw = decodeURIComponent(location.hash.slice(1));
  if (!raw) {
    // Back to where the page started.
    if (state.view === "course" && state.selected !== DEFAULT_COURSE) {
      state.selected = DEFAULT_COURSE;
      render();
    }
    return;
  }
  const c = BY_KEY.get(raw) ?? COURSES.find(x => x.id === raw) ?? COURSES.find(x => x.formerly.includes(raw));
  if (!c) return;
  if (state.view === "course") {
    state.selected = c.key;
    render();
  } else {
    selectNode(c.key, true);
  }
}
window.addEventListener("hashchange", applyHash);

// Accepts a course's number, its old number, or a "number: title" suggestion.
function courseFromInput(text) {
  const q = text.trim().toUpperCase();
  if (!q) return null;
  const code = q.split(":")[0].trim();
  return COURSES.find(c => c.id.toUpperCase() === code) ?? COURSES.find(c => c.formerly.some(f => f.toUpperCase() === code))
    ?? COURSES.find(c => c.id.toUpperCase().includes(q) || c.formerly.some(f => f.toUpperCase().includes(q)))
    ?? COURSES.find(c => c.title.toUpperCase().includes(q));
}

$("#m-courses").innerHTML = COURSES.map(c => `<option value="${esc(c.id)}: ${esc(c.title)}"></option>`).join("");
$("#m-course").addEventListener("change", e => {
  const c = courseFromInput(e.target.value);
  if (c) {
    state.view = "course";
    goToCourse(c.key);
  }
  e.target.blur();
  renderControls();
});
$("#m-course").addEventListener("keydown", e => {
  if (e.key === "Enter") e.target.blur();
});
$("#m-starts").addEventListener("click", e => {
  const b = e.target.closest("[data-start]");
  if (!b) return;
  state.view = "course";
  goToCourse(b.dataset.start);
});
$("#m-view").addEventListener("click", e => {
  const b = e.target.closest("[data-view]");
  if (!b) return;
  state.view = b.dataset.view;
  render();
});

rebuild();
applyHash();
