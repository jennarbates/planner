// Course history page: compares the CICS listings term by term. Data is in history-data.js.

"use strict";

const { terms: TERMS, courses: COURSES } = window.HISTORY;
const TERM_IDS = TERMS.map(t => t.id);
const TERM_LABEL = Object.fromEntries(TERMS.map(t => [t.id, t.label]));

const CHANGE = {
  prereq: { chip: "P", hard: true, label: "Prerequisite requirement", short: "Prerequisites" },
  credits: { chip: "C", hard: true, label: "Credits", short: "Credits" },
  title: { chip: "T", hard: true, label: "Title", short: "Title" },
  number: { chip: "#", hard: true, label: "Renumbered", short: "Number" },
  rewrite: { chip: "R", hard: true, label: "Description rewritten", short: "Description" },
  eligibility: { chip: "E", hard: false, label: "Eligibility", short: "Eligibility" },
  description: { chip: "D", hard: false, label: "Description edited", short: "Description" },
  "prereq-wording": { chip: "w", hard: false, label: "Prerequisite wording", short: "Prerequisite wording" },
};
const CHIP_ORDER = Object.keys(CHANGE);

const SUBJECT_TO_CHANGE = "S27"; // as labelled on the CICS courses page

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const state = {
  from: TERM_IDS[0],
  to: TERM_IDS[TERM_IDS.length - 1],
  search: "",
  subject: "",
  level: "",
  category: "regular",
  show: "",
  stat: null,
  key: null,
  mode: "history",
  focusTerm: null,
  currentOpen: true,
  whenOpen: true,
  pairA: null,
  pairB: null,
};

const inRange = t => {
  const i = TERM_IDS.indexOf(t);
  return i >= TERM_IDS.indexOf(state.from) && i <= TERM_IDS.indexOf(state.to);
};
const rangeTerms = () => TERM_IDS.filter(inRange);
const listedTerms = c => TERM_IDS.filter(t => c.offerings[t]);
const changesIn = c => c.changes.filter(ch => inRange(ch.term));

// Most courses run only in fall or only in spring, so "new" and "gone" look past the
// nearest neighbouring term: new means absent from the range's first two terms, gone
// means absent from its last two.
function isNew(c) {
  const r = rangeTerms();
  if (r.length < 3) return false;
  const head = r.slice(0, 2);
  return !listedTerms(c).some(t => TERM_IDS.indexOf(t) <= TERM_IDS.indexOf(head[1])) && r.some(t => c.offerings[t]);
}
function isGone(c) {
  const r = rangeTerms();
  if (r.length < 3) return false;
  const tail = r.slice(-2);
  return !listedTerms(c).some(t => TERM_IDS.indexOf(t) >= TERM_IDS.indexOf(tail[0])) && r.some(t => c.offerings[t]);
}

// A letter in the number marks an experimental course. The latest number decides, so a
// course that became permanent counts as regular for all of its terms.
const isExperimental = c => /\d[A-Z]/.test(c.id);

function matchesCategory(c) {
  if (state.category === "all") return true;
  return isExperimental(c) === (state.category === "experimental");
}

function matchesFilters(c) {
  return matchesCategory(c) && matchesOtherFilters(c);
}

function matchesOtherFilters(c) {
  if (state.subject && c.subject !== state.subject) return false;
  if (state.level) {
    const l = Number(state.level);
    if (l === 700 ? c.level < 700 : c.level !== l) return false;
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    const hay = [c.id, c.title, ...c.formerly, ...Object.values(c.offerings).map(o => o.title)].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const matchesBase = c => matchesFilters(c) && rangeTerms().some(t => c.offerings[t]);

function matchesShow(c, show) {
  if (!show) return true;
  if (show === "new") return isNew(c);
  if (show === "gone") return isGone(c);
  const ch = changesIn(c);
  return show === "any" ? ch.length > 0 : ch.some(x => x.type === show);
}

const visibleCourses = () => COURSES.filter(c => matchesBase(c) && matchesShow(c, state.show));

/* Filters */

function fillTermSelect(el, value, allowed = TERM_IDS) {
  el.innerHTML = allowed.map(t => `<option value="${t}" ${t === value ? "selected" : ""}>${esc(TERM_LABEL[t])}</option>`).join("");
}

function renderFilters() {
  fillTermSelect($("#f-from"), state.from);
  fillTermSelect($("#f-to"), state.to);
  $("#f-show").value = state.show;
  $("#f-category").value = state.category;
}

/* Summary tiles */

function renderStats() {
  const base = COURSES.filter(matchesBase);
  const r = rangeTerms();
  const first = base.filter(c => c.offerings[r[0]]).length;
  const last = base.filter(c => c.offerings[r[r.length - 1]]).length;
  const experimental = COURSES.filter(c => isExperimental(c) && matchesOtherFilters(c) && rangeTerms().some(t => c.offerings[t])).length;
  const experimentalNote = { regular: "Experimental courses, kept out of these numbers", experimental: "Experimental courses", all: "Experimental courses, included here" }[state.category];
  const tiles = [
    { stat: "listed", show: "", n: `${first} → ${last}`, l: `Courses listed, ${TERM_LABEL[r[0]]} → ${TERM_LABEL[r[r.length - 1]]}` },
    { stat: "new", show: "new", n: base.filter(isNew).length, l: `New since ${TERM_LABEL[r[1] ?? r[0]]}` },
    { stat: "gone", show: "gone", n: base.filter(isGone).length, l: `Not listed in the last two terms` },
    { stat: "prereq", show: "prereq", n: base.filter(c => matchesShow(c, "prereq")).length, l: "Courses whose prerequisites changed" },
    { stat: "number", show: "number", n: base.filter(c => matchesShow(c, "number")).length, l: "Courses renumbered" },
    { stat: "rewrite", show: "rewrite", n: base.filter(c => matchesShow(c, "rewrite")).length, l: "Descriptions rewritten" },
    { stat: "experimental", show: "", n: experimental, l: experimentalNote },
  ];
  $("#h-stats").innerHTML = tiles.map(t => `<button type="button" class="stat" data-stat="${t.stat}" data-show="${t.show}" aria-expanded="${state.stat === t.stat}" aria-controls="h-drill">
      <span class="n">${esc(t.n)}</span><span class="l">${esc(t.l)}</span><span class="more">${state.stat === t.stat ? "Hide list" : "View list"}</span></button>`).join("");
  renderDrill();
}

/* The list behind a summary tile */

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const courseCells = c => [`<b>${esc(c.id)}</b>`, esc(c.title)];

// The list behind one chart bar. It uses the same courses as the bar, so the counts match.
function barContent(kind, term) {
  const pool = COURSES.filter(matchesFilters);
  const label = TERM_LABEL[term];
  const codeCell = c => {
    const code = c.offerings[term].code;
    return `<b>${esc(code)}</b>${code !== c.id ? ` <span class="muted">now ${esc(c.id)}</span>` : ""}`;
  };
  if (kind === "prereq") {
    const earliest = term === TERM_IDS[0];
    return {
      title: `Prerequisite requirements changed in ${label}`,
      note: earliest ? `${label} is the first term here, so there's nothing earlier to compare it with.` : "Compared with each course's previous listing.",
      cols: ["Course", "Title", "What changed"],
      empty: earliest ? "No changes to show for this term." : "No prerequisite changes among these courses this term.",
      rows: pool.flatMap(c => c.changes.filter(ch => ch.term === term && ch.type === "prereq").map(ch => ({
        key: c.key, term, cells: [codeCell(c), esc(c.title), changeBits(ch)],
      }))),
    };
  }
  return {
    title: `Courses listed in ${label}`,
    note: "Changes are compared with each course's previous listing.",
    cols: ["Course", "Title", "Credits", "Changes this term"],
    rows: pool.filter(c => c.offerings[term]).map(c => {
      const types = new Set(c.changes.filter(ch => ch.term === term).map(ch => ch.type));
      const labels = CHIP_ORDER.filter(k => types.has(k)).map(k => CHANGE[k].label);
      const isFirst = listedTerms(c)[0] === term;
      return { key: c.key, term, cells: [codeCell(c), esc(c.title), esc(c.offerings[term].cr ?? "unknown"), esc(labels.join(", ") || (isFirst ? "First listing here" : "None"))] };
    }),
  };
}

function drillContent(stat) {
  if (stat.startsWith("bar:")) {
    const [, kind, term] = stat.split(":");
    return barContent(kind, term);
  }
  if (stat.startsWith("flow:")) return flowContent(stat.slice(5));
  if (stat === "experimental") {
    const listedHere = c => listedTerms(c).filter(inRange);
    return {
      title: "Experimental courses",
      note: "Courses whose latest number has a letter in it, such as topics courses, seminars and practicums. Most listed first.",
      cols: ["Course", "Title", "Times listed", "Last listed"],
      rows: COURSES.filter(c => isExperimental(c) && matchesOtherFilters(c) && listedHere(c).length)
        .sort((x, y) => listedHere(y).length - listedHere(x).length)
        .map(c => ({ key: c.key, term: listedHere(c).at(-1), cells: [...courseCells(c), String(listedHere(c).length), esc(TERM_LABEL[listedHere(c).at(-1)])] })),
    };
  }
  const base = COURSES.filter(matchesBase);
  const r = rangeTerms(), head = r[0], tail = r[r.length - 1];
  const within = c => listedTerms(c).filter(inRange);

  if (stat === "listed") {
    const inFirst = base.filter(c => c.offerings[head]), inLast = base.filter(c => c.offerings[tail]);
    const both = inFirst.filter(c => c.offerings[tail]);
    const row = (c, where, term) => ({ key: c.key, term, cells: [...courseCells(c), esc(where)] });
    return {
      title: `Courses listed in ${TERM_LABEL[head]} and ${TERM_LABEL[tail]}`,
      note: `${both.length} courses are in both, so they aren't shown. Most courses run only in fall or only in spring, so two terms of different seasons differ more than the catalog really changed.`,
      cols: ["Course", "Title", "Listed in"],
      rows: [
        ...inLast.filter(c => !c.offerings[head]).map(c => row(c, `${TERM_LABEL[tail]} only`, tail)),
        ...inFirst.filter(c => !c.offerings[tail]).map(c => row(c, `${TERM_LABEL[head]} only`, head)),
      ],
    };
  }
  if (stat === "new") {
    return {
      title: `New since ${TERM_LABEL[r[1] ?? r[0]]}`,
      note: "First listed after the range's first two terms. Renumbered courses aren't counted as new.",
      cols: ["Course", "Title", "First listed", "Listed since"],
      rows: base.filter(isNew)
        .sort((x, y) => TERM_IDS.indexOf(listedTerms(y)[0]) - TERM_IDS.indexOf(listedTerms(x)[0]))
        .map(c => ({ key: c.key, term: listedTerms(c)[0], cells: [...courseCells(c), esc(TERM_LABEL[listedTerms(c)[0]]), plural(within(c).length, "time")] })),
    };
  }
  if (stat === "gone") {
    const absent = c => r.length - 1 - r.indexOf(within(c).at(-1));
    return {
      title: "Not listed in the last two terms",
      note: `Longest absence first, counted back from ${TERM_LABEL[tail]}. CICS didn't necessarily retire these: seminars and topic courses come and go, and some courses run only every other year.`,
      cols: ["Course", "Title", "Last listed", "Not listed for", "Times listed"],
      rows: base.filter(isGone).sort((x, y) => absent(y) - absent(x)).map(c => {
        const n = absent(c);
        return { key: c.key, term: within(c).at(-1), cells: [...courseCells(c), esc(TERM_LABEL[within(c).at(-1)]), `${plural(n, "term")} (${n / 2} yr)`, String(within(c).length)] };
      }),
    };
  }
  if (stat === "prereq") {
    const rows = base.flatMap(c => changesIn(c).filter(ch => ch.type === "prereq").map(ch => ({
      key: c.key, term: ch.term, cells: [...courseCells(c), esc(TERM_LABEL[ch.term]), changeBits(ch)],
    })));
    const courses = new Set(rows.map(x => x.key)).size;
    return {
      title: "Prerequisite requirements changed",
      note: `${plural(rows.length, "change")} across ${plural(courses, "course")}, in course order. Wording-only changes aren't included.`,
      cols: ["Course", "Title", "Changed in", "What changed"],
      rows,
    };
  }
  if (stat === "number") {
    return {
      title: "Courses renumbered",
      note: "Each pair shares one row in the table below. A reason appears where the change isn't on CICS's renumbering lists.",
      cols: ["Course", "Title", "Changed in", "What changed"],
      rows: base.flatMap(c => changesIn(c).filter(ch => ch.type === "number").map(ch => ({
        key: c.key, term: ch.term, cells: [...courseCells(c), esc(TERM_LABEL[ch.term]), changeBits(ch)],
      }))),
    };
  }
  return {
    title: "Descriptions rewritten",
    note: "Fewer than 60% of the words carried over from the previous listing.",
    cols: ["Course", "Title", "Rewritten in", "Wording kept"],
    rows: base.flatMap(c => changesIn(c).filter(ch => ch.type === "rewrite").map(ch => ({
      key: c.key, term: ch.term, cells: [...courseCells(c), esc(TERM_LABEL[ch.term]), `${Math.round(ch.similarity * 100)}%`],
    }))),
  };
}

function renderDrill() {
  const el = $("#h-drill");
  if (!state.stat) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const d = drillContent(state.stat);
  el.hidden = false;
  el.innerHTML = `<div class="drill-head">
      <div><h2>${esc(d.title)} <span class="muted">(${d.rows.length})</span></h2><p class="muted">${esc(d.note)}</p></div>
      <button type="button" id="drill-close">Close</button>
    </div>
    ${d.rows.length ? `<div class="drill-wrap"><table>
      <thead><tr>${d.cols.map(x => `<th scope="col">${esc(x)}</th>`).join("")}</tr></thead>
      <tbody>${d.rows.map(x => `<tr tabindex="0" data-key="${esc(x.key)}" data-term="${x.term}" title="See this course's full history">${x.cells.map(v => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>` : `<p class="nodata">${esc(d.empty ?? "No courses match these filters.")}</p>`}`;
}

function closeDrill() {
  state.stat = null;
  state.show = "";
  $("#f-show").value = "";
  renderStats();
  renderCharts();
  renderMatrix();
}

function revealRow(key) {
  const wrap = $("#h-matrix-wrap"), row = $(`#h-matrix tr[data-key="${CSS.escape(key)}"]`);
  if (row) wrap.scrollTop = row.offsetTop - wrap.clientHeight / 2;
}

/* Charts */

function barChart({ id, kind, title, sub, values, tip }) {
  const W = 480, H = 132, L = 26, R = 4, T = 16, B = 20;
  const max = Math.max(1, ...values.map(v => v.value));
  const niceStep = [1, 2, 5, 10, 20, 25, 50, 100].find(s => max / s <= 4) ?? 100;
  const top = Math.ceil(max / niceStep) * niceStep;
  const y = v => T + (H - T - B) * (1 - v / top);
  const band = (W - L - R) / values.length;
  const bw = Math.min(24, band - 8);
  const grid = [];
  for (let v = 0; v <= top; v += niceStep) {
    grid.push(`<line class="${v === 0 ? "base" : "grid"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
      <text x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`);
  }
  const barId = term => `bar:${kind}:${term}`;
  const selected = values.find(v => state.stat === barId(v.term));
  const cols = values.map((v, i) => {
    const x = L + band * i + (band - bw) / 2;
    const yy = y(v.value), base = y(0), r = Math.min(4, Math.max(0, base - yy));
    const path = v.value > 0
      ? `M${x},${base}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${base}Z` : "";
    return `<g class="col ${inRange(v.term) ? "" : "out"} ${v === selected ? "sel" : ""}" tabindex="0" role="button" aria-pressed="${v === selected}" data-bar="${barId(v.term)}" data-tip="${esc(tip(v))}" aria-label="${esc(tip(v))}">
      <rect class="hit" x="${L + band * i}" y="${T - 12}" width="${band}" height="${H - T - B + 12}"/>
      ${path ? `<path class="bar" d="${path}"/>` : ""}
      <text class="val" x="${x + bw / 2}" y="${yy - 4}" text-anchor="middle">${v.value}</text>
      <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${v.term}</text>
    </g>`;
  }).join("");
  return `<figure class="chart" id="${id}" style="margin:0">
    <h3>${esc(title)}</h3><p>${esc(sub)}</p>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid.join("")}${cols}</svg>
  </figure>`;
}

function renderCharts() {
  const pool = COURSES.filter(matchesFilters);
  const listed = TERM_IDS.map(t => ({ term: t, value: pool.filter(c => c.offerings[t]).length }));
  const prereq = TERM_IDS.map(t => ({ term: t, value: pool.filter(c => c.changes.some(ch => ch.term === t && ch.type === "prereq")).length }));
  const tableOpen = $("details.table-view")?.open;
  const flow = flowChart();
  $("#h-charts").innerHTML =
    barChart({ id: "c-listed", kind: "listed", title: "Courses listed each term", sub: "Click a bar to list its courses. Terms outside the selected range are faded.", values: listed, tip: v => `${TERM_LABEL[v.term]}: ${plural(v.value, "course")} listed` }) +
    barChart({ id: "c-prereq", kind: "prereq", title: "Prerequisite requirements changed", sub: "Courses whose requirement differs from their previous listing. Click a bar to list them.", values: prereq, tip: v => `${TERM_LABEL[v.term]}: ${plural(v.value, "course")} changed` }) +
    flow +
    `<details class="table-view" ${tableOpen ? "open" : ""}><summary>Show these numbers as a table</summary>
      <table><thead><tr><th>Term</th><th>Courses listed</th><th>Prerequisite changes</th></tr></thead><tbody>
      ${TERM_IDS.map((t, i) => `<tr><td>${esc(TERM_LABEL[t])}</td><td>${listed[i].value}</td><td>${prereq[i].value}</td></tr>`).join("")}
      </tbody></table></details>`;
}

/* Where experimental courses ended up */

const hasLetter = code => /\d[A-Z]/.test(code);
const FLOW = {
  permanent: { label: "Became permanent", main: true },
  running: { label: "Still running as experimental" },
  gone: { label: "No longer listed" },
};

function flowOutcome(c) {
  const list = listedTerms(c);
  if (!list.some(t => hasLetter(c.offerings[t].code))) return null;
  if (!hasLetter(c.id)) return "permanent";
  const recent = TERM_IDS.slice(-2);
  return list.some(t => recent.includes(t)) ? "running" : "gone";
}

const flowPool = () => COURSES.filter(c => matchesOtherFilters(c) && flowOutcome(c));

function flowChart() {
  const pool = flowPool();
  const counts = Object.fromEntries(Object.keys(FLOW).map(k => [k, pool.filter(c => flowOutcome(c) === k).length]));
  const total = pool.length;
  const head = `<h3>Where experimental courses ended up</h3><p>${plural(total, "course")} had a letter in the number at some point. Click a group to list its courses. The Category filter doesn't apply here.</p>`;
  if (!total) return `<figure class="chart wide" style="margin:0">${head}</figure>`;

  const W = Math.max(320, ($("#h-charts").clientWidth || 900) - 36);
  const labelW = 210, barW = 10, gap = 12, T = 4, unit = 120 / total;
  const H = T * 2 + Object.values(counts).filter(Boolean).length * gap + 120;
  const left = 0, right = W - labelW - barW;
  let ly = T + (H - T * 2 - 120) / 2, ry = T;
  const groups = Object.entries(FLOW).filter(([k]) => counts[k]).map(([k, f]) => {
    const h = Math.max(3, counts[k] * unit);
    const cls = f.main ? "main" : "rest";
    const lx = left + barW, mid = (right - lx) / 2;
    const ribbon = `M${lx},${ly} C${lx + mid},${ly} ${right - mid},${ry} ${right},${ry} L${right},${ry + h} C${right - mid},${ry + h} ${lx + mid},${ly + h} ${lx},${ly + h} Z`;
    const pct = Math.round(counts[k] / total * 100);
    const tipText = `${f.label}: ${plural(counts[k], "course")}, ${pct}%`;
    const id = `flow:${k}`;
    const textY = ry + Math.max(h, 18) / 2;
    const out = `<g class="col ${state.stat === id ? "sel" : ""}" tabindex="0" role="button" aria-pressed="${state.stat === id}" data-bar="${id}" data-tip="${esc(tipText)}" aria-label="${esc(tipText)}">
      <path class="ribbon ${cls}" d="${ribbon}"/>
      <rect class="flow-bar ${cls}" x="${right}" y="${ry}" width="${barW}" height="${h}" rx="2"/>
      <text class="flow-n" x="${right + barW + 8}" y="${textY + 5}">${counts[k]}</text>
      <text class="flow-l" x="${right + barW + 34}" y="${textY + 4}">${esc(f.label)}</text>
    </g>`;
    ly += h;
    ry += h + gap;
    return out;
  });
  return `<figure class="chart wide" style="margin:0">${head}
    <svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="group" aria-label="Where experimental courses ended up">
      <rect class="flow-source" x="${left}" y="${T + (H - T * 2 - 120) / 2}" width="${barW}" height="120" rx="2"/>
      ${groups.join("")}
    </svg></figure>`;
}

function flowContent(kind) {
  const rows = flowPool().filter(c => flowOutcome(c) === kind);
  const times = c => listedTerms(c).length;
  const last = c => TERM_LABEL[listedTerms(c).at(-1)];
  if (kind === "permanent") {
    const turned = c => listedTerms(c).find(t => !hasLetter(c.offerings[t].code));
    return {
      title: "Experimental courses that became permanent",
      note: "They count as regular courses everywhere else on this page, for all of their terms.",
      cols: ["Course", "Title", "Was", "Plain number since", "Listings before that"],
      rows: rows.sort((x, y) => TERM_IDS.indexOf(turned(y)) - TERM_IDS.indexOf(turned(x))).map(c => ({
        key: c.key, term: turned(c), cells: [...courseCells(c), esc(c.formerly.join(", ")), esc(TERM_LABEL[turned(c)]), String(listedTerms(c).indexOf(turned(c)))],
      })),
    };
  }
  return {
    title: kind === "running" ? "Experimental courses still running" : "Experimental courses no longer listed",
    note: kind === "running" ? "Listed in the last two terms with a letter in the number. Most listed first." : "Not listed in the last two terms, most recent first. Some topics and seminars may return.",
    cols: ["Course", "Title", "Times listed", "Last listed"],
    rows: rows.sort(kind === "running"
      ? (x, y) => times(y) - times(x)
      : (x, y) => TERM_IDS.indexOf(listedTerms(y).at(-1)) - TERM_IDS.indexOf(listedTerms(x).at(-1)))
      .map(c => ({ key: c.key, term: listedTerms(c).at(-1), cells: [...courseCells(c), String(times(c)), esc(last(c))] })),
  };
}

/* Matrix */

function renderLegend(count) {
  const items = CHIP_ORDER.map(k => `<span class="lg-item"><span class="chip ${CHANGE[k].hard ? "hard" : "soft"}">${esc(CHANGE[k].chip)}</span>${esc(CHANGE[k].label)}</span>`);
  $("#h-legend").innerHTML = `<span id="h-count">${count} course${count === 1 ? "" : "s"}</span>
    <span class="lg-item"><span class="dot"></span>Listed, no change</span>${items.join("")}`;
}

function cellHtml(c, t) {
  const o = c.offerings[t];
  if (!o) return "";
  const types = new Set(c.changes.filter(ch => ch.term === t).map(ch => ch.type));
  const chips = CHIP_ORDER.filter(k => types.has(k));
  if (!chips.length) return `<span class="dot"></span>`;
  return `<span class="chips">${chips.map(k => `<span class="chip ${CHANGE[k].hard ? "hard" : "soft"}" title="${esc(CHANGE[k].label)}">${esc(CHANGE[k].chip)}</span>`).join("")}</span>`;
}

function renderMatrix() {
  const rows = visibleCourses();
  renderLegend(rows.length);
  const head = `<thead><tr><th class="name" scope="col">Course</th>${TERM_IDS.map(t =>
    `<th scope="col" title="${esc(TERM_LABEL[t])}" class="${t[0] === "F" ? "fall" : ""} ${inRange(t) ? "" : "out"}">${t}</th>`).join("")}</tr></thead>`;
  const body = rows.map(c => {
    const formerly = c.formerly.length ? ` <span class="was">was ${esc(c.formerly.join(", "))}</span>` : "";
    return `<tr data-key="${esc(c.key)}" class="${c.key === state.key ? "selected" : ""}" tabindex="0">
      <th class="name" scope="row"><span class="code">${esc(c.id)}${formerly}</span><span class="title" title="${esc(c.title)}">${esc(c.title)}</span></th>
      ${TERM_IDS.map(t => {
        const picked = c.key === state.key && (state.mode === "compare" ? t === state.pairA || t === state.pairB : t === state.focusTerm);
        return `<td class="cell ${t[0] === "F" ? "fall" : ""} ${inRange(t) ? "" : "out"} ${picked ? "picked" : ""}" data-term="${t}" title="${esc(cellTitle(c, t))}">${cellHtml(c, t)}</td>`;
      }).join("")}
    </tr>`;
  }).join("");
  $("#h-matrix").innerHTML = head + `<tbody>${body || `<tr><td class="empty-msg" colspan="${TERM_IDS.length + 1}">No courses match these filters.</td></tr>`}</tbody>`;
}

function cellTitle(c, t) {
  const o = c.offerings[t];
  if (!o) return `${TERM_LABEL[t]}: not listed`;
  const types = c.changes.filter(ch => ch.term === t).map(ch => CHANGE[ch.type].label);
  return `${TERM_LABEL[t]}: ${o.code}${types.length ? ` · ${types.join(", ")}` : ""}`;
}

/* Word diff */

function tokens(s) {
  return String(s ?? "").split(/\s+/).filter(Boolean);
}

function diffHtml(a, b) {
  const x = tokens(a), y = tokens(b);
  const norm = w => w.toLowerCase().replace(/[.,;:()]/g, "");
  const n = x.length, m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = norm(x[i]) === norm(y[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts = [];
  const push = (type, w) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.words.push(w);
    else parts.push({ type, words: [w] });
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && norm(x[i]) === norm(y[j])) { push("same", y[j]); i++; j++; }
    else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) { push("del", x[i]); i++; }
    else { push("ins", y[j]); j++; }
  }
  return parts.map(p => {
    const text = esc(p.words.join(" "));
    return p.type === "same" ? text : `<${p.type}>${text}</${p.type}>`;
  }).join(" ");
}

function fieldDiff(a, b, emptyText = "None listed.") {
  if (!a && !b) return `<p class="nodata">${esc(emptyText)}</p>`;
  // A term whose document has no entry isn't a removal, so there's nothing to diff against.
  if (a === undefined || b === undefined) return `<p class="field">${esc(a ?? b)}</p>`;
  return `<p class="field">${diffHtml(a, b)}</p>`;
}

// Same comparison as words() in tools/build_history.py, so this agrees with the change markers.
const wordKey = s => (String(s ?? "").toLowerCase().replace(/-\s+/g, "").match(/[a-z0-9&+]+/g) ?? []).join(" ");
const sameText = (a, b) => wordKey(a) === wordKey(b);

/* Detail */

function defaultPair(c, focusTerm) {
  const list = listedTerms(c);
  if (focusTerm && c.offerings[focusTerm]) {
    const i = list.indexOf(focusTerm);
    return i > 0 ? [list[i - 1], focusTerm] : [focusTerm, list[1] ?? focusTerm];
  }
  const within = list.filter(inRange);
  const use = within.length ? within : list;
  return [use[0], use[use.length - 1]];
}

function changeBits(ch) {
  return esc(ch.summary) + (ch.basis ? ` <span class="muted">${esc(ch.basis)}.</span>` : "");
}

function changeLine(ch) {
  const meta = CHANGE[ch.type];
  return `<li class="change"><span class="chip ${meta.hard ? "hard" : "soft"}" title="${esc(meta.label)}">${esc(meta.chip)}</span><span><b>${esc(meta.short)}:</b> ${changeBits(ch)}</span></li>`;
}

function officialLine(o) {
  const kinds = { prereq: "Prerequisite", number: "Number", title: "Title", credits: "Credits" };
  const fromTo = o.from ? `<br>From: ${esc(o.from)}<br>To: ${esc(o.to)}` : o.to ? `<br>${esc(o.to)}` : "";
  return `<div class="official"><b>Approved: ${esc(kinds[o.kind] ?? o.kind)}, effective ${esc(o.effective)}</b> (${esc(o.id)})${fromTo}</div>`;
}

function sourceLink(term, kind, text) {
  const file = TERMS.find(t => t.id === term).files[kind];
  return file ? `<a href="pdfs/${encodeURIComponent(file)}" target="_blank" rel="noopener">${esc(text)}</a>` : "";
}

function sectionsList(o) {
  return o?.sections?.length
    ? `<ul class="sections">${o.sections.map(s => `<li>${esc(s)}</li>`).join("")}</ul>`
    : `<p class="nodata">No sections on the schedule.</p>`;
}

const SECTION_NAMES = { LEC: "lecture", LAB: "lab", DIS: "discussion", SEM: "seminar", IND: "independent study", PRA: "practicum" };

function sectionSummary(o) {
  if (!o.sections?.length) return "";
  const counts = {};
  for (const sec of o.sections) {
    const kind = sec.split(" ")[0];
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => {
    const name = SECTION_NAMES[k] ?? k.toLowerCase();
    return `${n} ${name}${n === 1 || name.endsWith("y") ? "" : "s"}`;
  }).join(", ");
}

const creditsText = o => (o?.cr ? `${esc(o.cr)}${o.crDesc ? ` <span class="muted">(description text says ${esc(o.crDesc)})</span>` : ""}` : "unknown");

const HISTORY_FIELDS = [
  { key: "pre", label: "Prerequisites (course description)", get: o => o.pre },
  { key: "spire", label: "Prerequisites (SPIRE)", get: o => o.elig?.pre },
  { key: "restrict", label: "Eligibility (SPIRE)", get: o => o.elig?.restrict },
  { key: "desc", label: "Description", get: o => o.desc },
];

// Everything published for one term, behind the summary of what changed.
function fullListing(t, o) {
  const body = (label, v) => `<h4>${esc(label)}</h4>${v ? `<p class="field">${esc(v)}</p>` : `<p class="nodata">None listed.</p>`}`;
  const links = [sourceLink(t, "descriptions", "Descriptions"), sourceLink(t, "schedule", "Schedule"), sourceLink(t, "eligibility", "SPIRE")].filter(Boolean).join(" · ");
  return `<details class="listing"><summary>Full ${esc(TERM_LABEL[t])} listing</summary>
    ${body("Title", o.title)}
    ${"desc" in o ? body("Description", o.desc) : `<p class="nodata">No description text this term.</p>`}
    ${"pre" in o ? body("Prerequisites (course description)", o.pre) : ""}
    ${o.elig ? body("Prerequisites (SPIRE)", o.elig.pre) + body("Eligibility (SPIRE)", o.elig.restrict) + body("Notes (SPIRE)", o.elig.notes) : `<p class="nodata">Not in this term's SPIRE document.</p>`}
    <h4>Sections</h4>${sectionsList(o)}
    <p class="diffkey">Original documents: ${links}</p>
  </details>`;
}

function historyEntries(c) {
  const list = listedTerms(c);
  // Official changes appear at the first listing they could affect; any others go at the end.
  const placed = new Map(), leftover = [];
  for (const off of c.official) {
    const i = TERM_IDS.indexOf(off.term);
    const at = i < 0 ? undefined : list.find(t => TERM_IDS.indexOf(t) >= i);
    if (at) placed.set(at, [...(placed.get(at) ?? []), off]);
    else leftover.push(off);
  }

  const lastSeen = {};
  const parts = list.map((t, n) => {
    const o = c.offerings[t], first = n === 0;
    const prev = list[n - 1];
    const missed = first ? [] : TERM_IDS.slice(TERM_IDS.indexOf(prev) + 1, TERM_IDS.indexOf(t));
    const gap = missed.length ? `<li class="gap">Not listed in ${esc(missed.map(m => TERM_LABEL[m]).join(", "))}</li>` : "";

    const changes = c.changes.filter(ch => ch.term === t).sort((x, y) => CHIP_ORDER.indexOf(x.type) - CHIP_ORDER.indexOf(y.type));
    const blocks = [], unchanged = [];
    for (const f of HISTORY_FIELDS) {
      const v = f.get(o);
      if (v === undefined) continue;
      const before = lastSeen[f.key];
      if (before === undefined) {
        // The first listing states everything; later ones only what's new to the record.
        blocks.push(`<h4>${esc(f.label)}</h4>${v ? `<p class="field">${esc(v)}</p>` : `<p class="nodata">None listed.</p>`}`);
      } else if (sameText(before, v)) {
        unchanged.push(f.label.replace(" (course description)", "").replace(" (SPIRE)", " in SPIRE"));
      } else {
        blocks.push(`<h4>${esc(f.label)}</h4>${fieldDiff(before, v)}`);
      }
      lastSeen[f.key] = v;
    }
    const titleChanged = changes.some(ch => ch.type === "title" || ch.type === "number");
    const facts = [`${creditsText(o)} credits`, sectionSummary(o)].filter(Boolean).join(" · ");
    const notes = [
      o.regenerated ? `This text comes from a copy CICS regenerated in January 2024, so its wording may be newer than 2022.` : "",
      o.alsoListedAs ? `Also on this term's schedule as ${esc(o.alsoListedAs)}.` : "",
    ].filter(Boolean).map(x => `<div class="note">${x}</div>`).join("");

    return `${gap}<li class="entry ${t === state.focusTerm ? "focus" : ""}" data-entry="${t}">
      <div class="entry-head">
        <span><b>${esc(TERM_LABEL[t])}</b>${n === list.length - 1 ? ` <span class="badge ${currentStatus(c).isCurrent ? "" : "old"}">${currentStatus(c).isCurrent ? "Current" : "Last listed"}</span>` : ""}</span>
        ${prev ? `<button type="button" data-a="${prev}" data-b="${t}" title="Compare ${esc(TERM_LABEL[prev])} with ${esc(TERM_LABEL[t])}">compare</button>` : ""}
      </div>
      <div class="facts">${esc(o.code)}${first || titleChanged ? ` · ${esc(o.title)}` : ""} · ${facts}</div>
      ${o.instr ? `<div class="facts">Instructors: ${esc(o.instr)}</div>` : ""}
      ${first ? "" : changes.length ? `<ul class="changes">${changes.map(changeLine).join("")}</ul>` : blocks.length ? "" : `<p class="nochange">No changes from ${esc(TERM_LABEL[prev])}.</p>`}
      ${(placed.get(t) ?? []).map(officialLine).join("")}
      ${notes}
      ${blocks.join("")}
      ${unchanged.length && changes.length ? `<p class="same-note">Unchanged: ${esc(unchanged.join(", "))}.</p>` : ""}
      ${fullListing(t, o)}
    </li>`;
  });
  const after = leftover.length ? `<li class="entry"><div class="entry-head"><b>Other approved changes</b></div>${leftover.map(officialLine).join("")}</li>` : "";
  return `<ol class="course-history">${parts.join("")}${after}</ol>`;
}

function compareView(c) {
  const list = listedTerms(c);
  const a = c.offerings[state.pairA], b = c.offerings[state.pairB];
  const pick = (id, value) => `<select id="${id}">${list.map(t => `<option value="${t}" ${t === value ? "selected" : ""}>${esc(TERM_LABEL[t])} (${esc(c.offerings[t].code)})</option>`).join("")}</select>`;
  const regen = [a, b].some(o => o?.regenerated) ? `<div class="note">The Fall 2022 text for this course comes from a copy CICS regenerated in January 2024, so its wording may be newer than 2022.</div>` : "";
  const also = [a, b].filter(o => o?.alsoListedAs).map(o => `<div class="note">${esc(o.code)} was also on that term's schedule as ${esc(o.alsoListedAs)}.</div>`).join("");
  return `<div class="pair">
      <label>Compare ${pick("d-a", state.pairA)}</label>
      <label>with ${pick("d-b", state.pairB)}</label>
    </div>
    <p class="diffkey"><span class="field"><del>Removed</del> <ins>Added</ins></span> going from the first term to the second.
      Sources: ${sourceLink(state.pairA, "descriptions", state.pairA)} / ${sourceLink(state.pairB, "descriptions", state.pairB)} descriptions</p>
    ${regen}${also}

    <h3>Title</h3>${fieldDiff(a?.title, b?.title)}
    <h3>Credits</h3><p class="field">${state.pairA === state.pairB || a?.cr === b?.cr ? creditsText(b) : `${creditsText(a)} → ${creditsText(b)}`}</p>

    <h3>Prerequisites (course description)</h3>${fieldDiff(a?.pre, b?.pre)}
    <h3>Prerequisites (SPIRE)</h3>${fieldDiff(a?.elig?.pre, b?.elig?.pre, a?.elig || b?.elig ? "None listed." : "Not in this term's SPIRE document.")}
    <h3>Eligibility (SPIRE)</h3>${fieldDiff(a?.elig?.restrict, b?.elig?.restrict, a?.elig || b?.elig ? "None listed." : "Not in this term's SPIRE document.")}

    <h3>Description</h3>${fieldDiff(a?.desc, b?.desc, "This course has no description text in these listings.")}

    <h3>Instructors</h3>${fieldDiff(a?.instr, b?.instr, "None listed.")}

    <h3>Sections</h3>
    <div class="sections-grid">
      <div><h4>${esc(TERM_LABEL[state.pairA])} ${sourceLink(state.pairA, "schedule", "schedule")}</h4>${sectionsList(a)}</div>
      ${state.pairA !== state.pairB ? `<div><h4>${esc(TERM_LABEL[state.pairB])} ${sourceLink(state.pairB, "schedule", "schedule")}</h4>${sectionsList(b)}</div>` : ""}
    </div>`;
}

// A field can be absent from a course's newest documents, so take its latest stated value.
function latestValue(c, get) {
  for (const t of listedTerms(c).reverse()) {
    const v = get(c.offerings[t]);
    if (v !== undefined) return { value: v, term: t };
  }
  return { value: undefined, term: null };
}

function currentStatus(c) {
  const term = listedTerms(c).at(-1);
  const newest = TERM_IDS.at(-1);
  const absent = TERM_IDS.indexOf(newest) - TERM_IDS.indexOf(term);
  const label = TERM_LABEL[term];
  if (absent === 0) return { term, isCurrent: true, badge: `Current · ${label}`, note: term === SUBJECT_TO_CHANGE ? "CICS marks this term as subject to change." : "This is the newest listing here." };
  if (absent === 1) return { term, isCurrent: true, badge: `Current · ${label}`, note: `This is its latest listing. It isn't on the ${TERM_LABEL[newest]} listing.` };
  return { term, isCurrent: false, badge: `Last listed · ${label}`, note: `Not listed for ${plural(absent, "term")}, so this may no longer be offered.` };
}

function currentBar(c, status) {
  const o = c.offerings[status.term];
  const spire = latestValue(c, x => x.elig?.pre), catalog = latestValue(c, x => x.pre);
  const pre = spire.value || catalog.value;
  return `<div class="d-pinned">
    <h2>${esc(c.id)}</h2>
    <div class="subtitle">${esc(c.title)}</div>
    <div class="pinned-facts"><span class="badge ${status.isCurrent ? "" : "old"}">${esc(status.badge)}</span> ${creditsText(o)} credits</div>
    <div class="pinned-pre" title="${esc(pre || "")}"><b>Prerequisites:</b> ${pre ? esc(pre) : "none listed"}</div>
  </div>`;
}

function currentSection(c, status) {
  const o = c.offerings[status.term];
  const field = (label, get) => {
    const { value, term } = latestValue(c, get);
    if (value === undefined) return "";
    const asOf = term !== status.term ? ` <span class="muted">(as of ${esc(TERM_LABEL[term])})</span>` : "";
    return `<h4>${esc(label)}${asOf}</h4>${value ? `<p class="field">${esc(value)}</p>` : `<p class="nodata">None listed.</p>`}`;
  };
  const links = [sourceLink(status.term, "descriptions", "Descriptions"), sourceLink(status.term, "schedule", "Schedule"), sourceLink(status.term, "eligibility", "SPIRE")].filter(Boolean).join(" · ");
  return `<details class="panel" data-panel="current" ${state.currentOpen ? "open" : ""}>
    <summary>${status.isCurrent ? "Current listing" : "Most recent listing"}: ${esc(TERM_LABEL[status.term])}</summary>
    <div class="note">${esc(status.note)}</div>
    <div class="facts">${esc(o.code)} · ${creditsText(o)} credits${sectionSummary(o) ? ` · ${esc(sectionSummary(o))}` : ""}${o.instr ? `<br>Instructors: ${esc(o.instr)}` : ""}</div>
    ${field("Prerequisites (SPIRE)", x => x.elig?.pre)}
    ${field("Prerequisites (course description)", x => x.pre)}
    ${field("Eligibility (SPIRE)", x => x.elig?.restrict)}
    ${field("Description", x => x.desc)}
    <h4>Sections</h4>${sectionsList(o)}
    <p class="diffkey">Original documents: ${links}</p>
  </details>`;
}

// The course's whole record by date: first listing, gaps, changes and approved changes.
function whatChangedWhen(c) {
  const list = listedTerms(c);
  const groups = [];
  list.forEach((t, n) => {
    const changes = c.changes.filter(ch => ch.term === t).sort((x, y) => CHIP_ORDER.indexOf(x.type) - CHIP_ORDER.indexOf(y.type));
    const approved = c.official.filter(off => {
      const i = TERM_IDS.indexOf(off.term);
      return i >= 0 && list.find(x => TERM_IDS.indexOf(x) >= i) === t;
    });
    const lines = [];
    if (n === 0) lines.push(`<li class="plain">First listing in these documents${TERM_IDS[0] === t ? " (the earliest term here)" : ""}</li>`);
    lines.push(...changes.map(changeLine));
    lines.push(...approved.map(off => `<li class="plain">${officialLine(off)}</li>`));
    if (lines.length) groups.push(`<li class="when-term"><button type="button" class="linkish" data-goto="${t}" title="See this term in the full history">${esc(TERM_LABEL[t])}</button><ul class="changes">${lines.join("")}</ul></li>`);
    const next = list[n + 1];
    const missed = next ? TERM_IDS.slice(TERM_IDS.indexOf(t) + 1, TERM_IDS.indexOf(next)) : [];
    if (missed.length) groups.push(`<li class="gap">Not listed in ${esc(missed.map(m => TERM_LABEL[m]).join(", "))}</li>`);
  });
  const hasChanges = c.changes.length > 0 || c.official.length > 0;
  return `<details class="panel" data-panel="when" ${state.whenOpen ? "open" : ""}>
    <summary>What changed and when ${hasChanges ? `<span class="muted">(${plural(c.changes.length, "change")})</span>` : `<span class="muted">(no changes)</span>`}</summary>
    <ol class="when">${groups.reverse().join("")}</ol>
  </details>`;
}

function renderDetail() {
  const el = $("#h-detail");
  const c = COURSES.find(x => x.key === state.key);
  if (!c) {
    el.innerHTML = `<div class="d-empty">${state.key
      ? `<h2>${esc(state.key)}</h2><p class="muted">This course isn't in any CICS listing from ${esc(TERM_LABEL[TERM_IDS[0]])} to ${esc(TERM_LABEL[TERM_IDS[TERM_IDS.length - 1]])}.</p>`
      : `<h2>Pick a course</h2><p class="muted" style="line-height:1.5">Each row is one course and each column one term. Click a course to see what's current and everything that changed, or click a term to jump to it. You can also compare any two terms word by word.</p>`}</div>`;
    return;
  }
  const list = listedTerms(c);
  const status = currentStatus(c);
  const becomes = c.becomes ? `<div class="note">CICS lists this as becoming ${esc(c.becomes[0])} in ${esc(c.becomes[1].replace("F", "Fall 20").replace("S", "Spring 20"))}, after the last term here.</div>` : "";
  const tab = (mode, text) => `<button type="button" class="tab" data-mode="${mode}" aria-pressed="${state.mode === mode}">${text}</button>`;

  el.innerHTML = `${currentBar(c, status)}
    <div class="facts">${isExperimental(c) ? `<span class="badge old">Experimental</span> ` : ""}Listed in ${list.length} of ${TERM_IDS.length} terms${c.formerly.length ? ` · formerly ${esc(c.formerly.join(", "))}` : ""} · <a href="map.html#${encodeURIComponent(c.key)}">see on the prerequisite map</a></div>
    ${becomes}
    ${currentSection(c, status)}
    ${whatChangedWhen(c)}
    <div class="tabs">${tab("history", "Full history")}${tab("compare", "Compare two terms")}</div>
    ${state.mode === "compare" ? compareView(c) : `<p class="diffkey">Oldest first. Differences from the previous listing: <span class="field"><del>removed</del> <ins>added</ins></span></p>${historyEntries(c)}`}`;
}

function selectCourse(key, focusTerm) {
  state.key = key;
  state.mode = "history";
  state.focusTerm = focusTerm ?? null;
  const c = COURSES.find(x => x.key === key);
  if (c) [state.pairA, state.pairB] = defaultPair(c, focusTerm);
  history.replaceState(null, "", key ? `#${encodeURIComponent(key)}` : "#");
  renderMatrix();
  renderDetail();
  const detail = $("#h-detail");
  detail.scrollTop = 0;
  if (matchMedia("(max-width: 960px)").matches) detail.scrollIntoView();
  const entry = focusTerm && detail.querySelector(`[data-entry="${focusTerm}"]`);
  if (entry) entry.scrollIntoView({ block: "start" });
}

/* Sources */

function renderSources() {
  const cell = (t, k) => {
    const f = t.files[k];
    if (!f) return `<td class="muted">—</td>`;
    const html = f.endsWith(".html");
    return `<td><a href="pdfs/${encodeURIComponent(f)}" target="_blank" rel="noopener">${html ? "HTML copy" : "PDF"}</a></td>`;
  };
  $("#h-sources").innerHTML = `<h2>Sources</h2>
    <table><thead><tr><th>Term</th><th>Descriptions</th><th>Schedule</th><th>Eligibility / SPIRE</th></tr></thead>
    <tbody>${TERMS.map(t => `<tr><th scope="row">${esc(t.label)}</th>${cell(t, "descriptions")}${cell(t, "schedule")}${cell(t, "eligibility")}</tr>`).join("")}</tbody></table>
    <ul>
      <li>Every file is saved in the <code>pdfs/</code> folder. <code>pdfs/SOURCES.md</code> lists where each one came from.</li>
      <li>Fall 2025: CICS reused the file addresses for its Spring 2027 documents, so the Fall 2025 description and schedule PDFs can no longer be downloaded. Those two use CICS's Fall 2025 web pages, which have the same content.</li>
      <li>Fall 2022 to Fall 2023 are archived copies from the Wayback Machine. Each is the document as last captured, so some predate the end of registration for that term.</li>
      <li>A prerequisite counts as changed when the courses or minimum grades named in SPIRE differ, or when the course is on CICS's approved-changes list. A difference only in the catalog's wording counts as wording.</li>
      <li>Topic numbers that were reused for an unrelated course appear as separate rows. Renumbered courses share a row when CICS lists the change. Four pairs missing from those lists also share a row, each with its reason shown in the course's changes: three because SPIRE's notes give the previous number, and one because its title and description match.</li>
      <li>Courses whose latest number has a letter, such as COMPSCI 590X, are treated as experimental and kept out of the numbers unless you choose them under Category. A course that later got a plain number counts as regular for all of its terms, including those under its old number.</li>
      <li>This page compares what CICS published. A course missing from a listing may still have run, and honors colloquia are left out.</li>
    </ul>`;
}

/* Wiring */

function renderAll() {
  renderFilters();
  renderStats();
  renderCharts();
  renderMatrix();
  renderDetail();
}

function setRange(which, value) {
  state[which] = value;
  if (TERM_IDS.indexOf(state.from) > TERM_IDS.indexOf(state.to)) {
    if (which === "from") state.to = value; else state.from = value;
  }
  const c = COURSES.find(x => x.key === state.key);
  if (c) [state.pairA, state.pairB] = defaultPair(c);
  renderAll();
}

$("#f-from").addEventListener("change", e => setRange("from", e.target.value));
$("#f-to").addEventListener("change", e => setRange("to", e.target.value));
$("#f-search").addEventListener("input", e => { state.search = e.target.value.trim(); renderStats(); renderCharts(); renderMatrix(); });
$("#f-category").addEventListener("change", e => { state.category = e.target.value; renderAll(); });
$("#f-subject").addEventListener("change", e => { state.subject = e.target.value; renderAll(); });
$("#f-level").addEventListener("change", e => { state.level = e.target.value; renderAll(); });
$("#f-show").addEventListener("change", e => { state.show = e.target.value; state.stat = null; renderStats(); renderCharts(); renderMatrix(); });

$("#h-stats").addEventListener("click", e => {
  const b = e.target.closest("[data-stat]");
  if (!b) return;
  if (state.stat === b.dataset.stat) {
    closeDrill();
    return;
  }
  state.stat = b.dataset.stat;
  state.show = b.dataset.show;
  $("#f-show").value = state.show;
  renderStats();
  renderCharts();
  renderMatrix();
  $(`#h-stats [data-stat="${state.stat}"]`).focus({ preventScroll: true });
});

function openDrillRow(tr) {
  selectCourse(tr.dataset.key, tr.dataset.term);
  revealRow(tr.dataset.key);
  $("#h-main").scrollIntoView();
}
$("#h-drill").addEventListener("click", e => {
  if (e.target.closest("#drill-close")) {
    closeDrill();
    return;
  }
  const tr = e.target.closest("tr[data-key]");
  if (tr) openDrillRow(tr);
});
$("#h-drill").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-key]");
  if (!tr) return;
  e.preventDefault();
  openDrillRow(tr);
});

$("#h-matrix").addEventListener("click", e => {
  const tr = e.target.closest("tr[data-key]");
  if (!tr) return;
  const td = e.target.closest("td[data-term]");
  selectCourse(tr.dataset.key, td?.dataset.term);
});
$("#h-matrix").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const tr = e.target.closest("tr[data-key]");
  if (!tr) return;
  e.preventDefault();
  selectCourse(tr.dataset.key);
  const again = $(`#h-matrix tr[data-key="${CSS.escape(tr.dataset.key)}"]`);
  again?.focus();
});

$("#h-detail").addEventListener("change", e => {
  if (e.target.id === "d-a") state.pairA = e.target.value;
  else if (e.target.id === "d-b") state.pairB = e.target.value;
  else return;
  renderMatrix();
  renderDetail();
});
// Keep these two sections open or closed as the details re-render.
$("#h-detail").addEventListener("toggle", e => {
  if (e.target.dataset?.panel === "current") state.currentOpen = e.target.open;
  if (e.target.dataset?.panel === "when") state.whenOpen = e.target.open;
}, true);
$("#h-detail").addEventListener("click", e => {
  const goto = e.target.closest("button[data-goto]");
  if (goto) {
    state.mode = "history";
    state.focusTerm = goto.dataset.goto;
    renderMatrix();
    renderDetail();
    $(`#h-detail [data-entry="${state.focusTerm}"]`)?.scrollIntoView({ block: "start" });
    return;
  }
  const tabBtn = e.target.closest("button[data-mode]");
  if (tabBtn) {
    state.mode = tabBtn.dataset.mode;
    renderMatrix();
    renderDetail();
    $("#h-detail").scrollTop = 0;
    return;
  }
  const b = e.target.closest("button[data-a]");
  if (!b) return;
  state.mode = "compare";
  state.pairA = b.dataset.a;
  state.pairB = b.dataset.b;
  renderMatrix();
  renderDetail();
  $("#h-detail").scrollTop = 0;
});

function openBar(g) {
  $("#h-tip").hidden = true;
  if (state.stat === g.dataset.bar) {
    closeDrill();
    return;
  }
  state.stat = g.dataset.bar;
  state.show = "";
  $("#f-show").value = "";
  renderStats();
  renderCharts();
  renderMatrix();
  $(`#h-charts [data-bar="${state.stat}"]`).focus({ preventScroll: true });
  $("#h-drill").scrollIntoView({ block: "nearest" });
}
$("#h-charts").addEventListener("click", e => {
  const g = e.target.closest("[data-bar]");
  if (g) openBar(g);
});
$("#h-charts").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const g = e.target.closest("[data-bar]");
  if (!g) return;
  e.preventDefault();
  openBar(g);
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 150);
});

const tip = $("#h-tip");
function showTip(target, x, y) {
  tip.textContent = target.dataset.tip;
  tip.hidden = false;
  tip.style.left = `${Math.min(x + 12, innerWidth - 270)}px`;
  tip.style.top = `${y + 14}px`;
}
$("#h-charts").addEventListener("pointermove", e => {
  const g = e.target.closest("[data-tip]");
  if (g) showTip(g, e.clientX, e.clientY); else tip.hidden = true;
});
$("#h-charts").addEventListener("pointerleave", () => { tip.hidden = true; });
$("#h-charts").addEventListener("focusin", e => {
  const g = e.target.closest("[data-tip]");
  if (!g) return;
  const r = g.getBoundingClientRect();
  showTip(g, r.left, r.top);
});
$("#h-charts").addEventListener("focusout", () => { tip.hidden = true; });

function applyHash() {
  const key = decodeURIComponent(location.hash.slice(1));
  if (!key) return;
  const exact = COURSES.find(c => c.key === key);
  const byId = exact ?? COURSES.find(c => c.id === key) ?? COURSES.find(c => c.formerly.includes(key));
  state.key = byId ? byId.key : key;
  if (byId) [state.pairA, state.pairB] = defaultPair(byId);
  // A link straight to a course has to show its row.
  if (byId && !matchesCategory(byId)) state.category = "all";
}
window.addEventListener("hashchange", () => { applyHash(); renderAll(); });

const experimentalTotal = COURSES.filter(isExperimental).length;
$("#h-sub").textContent = `What changed in ${COURSES.length - experimentalTotal} regular CICS, COMPSCI and INFO courses across ${TERMS.length} terms, ${TERMS[0].label} to ${TERMS[TERMS.length - 1].label}, from the college's published course descriptions, schedules and SPIRE registration documents. Another ${experimentalTotal} experimental courses are kept separate.`;
applyHash();
renderAll();
renderSources();
if (state.key) revealRow(state.key);
