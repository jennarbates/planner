// Data reliability page: what the site's data comes from, what was checked, what to keep
// in mind, and every course with links back to its source pages. Read-only. The counts
// are worked out here from the data, except the text checks, which need the documents
// and so come from tools/build_verify.py.

const { terms: TERMS, courses: COURSES } = window.HISTORY;
const { pages: PAGES, origins: ORIGINS, problems: PROBLEMS, textChecks: TEXT } = window.VERIFY_SOURCES;
const CATALOG = window.CATALOG;
const TERM_IDS = TERMS.map(t => t.id);
const TERM_LABEL = Object.fromEntries(TERMS.map(t => [t.id, t.label]));
const TERM_FILES = Object.fromEntries(TERMS.map(t => [t.id, t.files]));

const REGENERATED_FILE = "F22-descriptions-2024-01-regenerated.pdf";
// The planner leaves these out on purpose (see the README), so naming them isn't a disagreement.
const RETIRED = new Set(["COMPSCI 121", "COMPSCI 186", "COMPSCI 187", "INFO 190S", "INFO 190T"]);
const COURSE_CODE = /[A-Z&-]+ \d{3}[A-Z0-9]*/g;
const KINDS = { descriptions: "Descriptions", schedule: "Schedule", eligibility: "SPIRE" };
const SHOW_DOCUMENTS_HERE = true; // tools/build_site.py turns this off, since claude.ai can't embed other sites

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const n = x => x.toLocaleString();
const plural = (count, word) => `${n(count)} ${word}${count === 1 ? "" : "s"}`;

const listedTerms = c => TERM_IDS.filter(t => c.offerings[t]);
const allListings = () => COURSES.flatMap(c => listedTerms(c).map(term => ({ c, term, o: c.offerings[term] })));

function listingFile(term, o, kind) {
  return kind === "descriptions" && o.regenerated ? REGENERATED_FILE : TERM_FILES[term][kind];
}

function sourceHref(file, code) {
  const place = PAGES[file]?.[code];
  const fragment = typeof place === "number" ? `#page=${place}` : place ? `#${encodeURIComponent(place)}` : "";
  return `pdfs/${encodeURIComponent(file)}${fragment}`;
}

function documentLink(file, code, title, text) {
  return `<a class="v-doc" href="${esc(sourceHref(file, code))}" data-file="${esc(file)}" data-code="${esc(code)}" data-title="${esc(title)}" target="_blank" rel="noopener">${esc(text)}</a>`;
}

function sourceLink(term, o, kind) {
  const file = listingFile(term, o, kind);
  const place = PAGES[file]?.[o.code];
  if (place === undefined) return "";
  const page = typeof place === "number" ? `, p. ${place}` : "";
  return documentLink(file, o.code, `${TERM_LABEL[term]} ${KINDS[kind]}`, `${KINDS[kind]}${page}`);
}

// ---- Comparing the data with itself and with CICS's lists ----

function compareApproved() {
  const out = { compared: 0, detected: 0, listOnly: [], missed: [] };
  for (const c of COURSES) {
    const listed = listedTerms(c).map(t => TERM_IDS.indexOf(t));
    for (const approved of c.official) {
      const at = TERM_IDS.indexOf(approved.term);
      // It can only show up as a change if the course is listed both before and after it.
      if (at < 0 || !listed.some(i => i < at) || !listed.some(i => i >= at)) continue;
      out.compared++;
      const types = approved.kind === "prereq" ? ["prereq", "prereq-wording"] : [approved.kind];
      // It has to be the change between the listings either side of when it took effect.
      const changes = c.changes.filter(ch => types.includes(ch.type) && TERM_IDS.indexOf(ch.prevTerm) < at && at <= TERM_IDS.indexOf(ch.term));
      const entry = { c, approved };
      if (changes.some(ch => ch.source !== "official list")) out.detected++;
      else if (changes.length) out.listOnly.push(entry);
      else out.missed.push(entry);
    }
  }
  return out;
}

function comparePlanner() {
  const out = { credits: [], extra: [], left: [], noDocument: [] };
  for (const entry of CATALOG) {
    const c = COURSES.find(x => x.id === entry.id);
    if (!c) {
      out.noDocument.push(entry);
      continue;
    }
    const term = listedTerms(c).at(-1);
    const o = c.offerings[term];
    if (o.cr && String(entry.credits) !== o.cr) out.credits.push({ entry, term, o });
    const planned = new Set(entry.prereq.match(COURSE_CODE) ?? []);
    const named = new Set(o.needs ?? []);
    const extra = [...planned].filter(x => !named.has(x));
    const left = [...named].filter(x => !planned.has(x) && !RETIRED.has(x));
    if (o.needs && extra.length) out.extra.push({ entry, term, codes: extra });
    if (left.length) out.left.push({ entry, term, codes: left });
  }
  return out;
}

// ---- Rendering ----

function renderSummary() {
  const listings = allListings();
  const files = new Set(TERMS.flatMap(t => Object.values(t.files)));
  $("#h-sub").textContent = `The course history and map pages are built by a script that reads the documents CICS published for each term, ${TERM_LABEL[TERM_IDS[0]]} to ${TERM_LABEL[TERM_IDS.at(-1)]}, so course details aren't retyped by anyone. The planner is different: its prerequisites were written by hand from those documents.`;
  const tiles = [
    [n(COURSES.length), "CICS, COMPSCI and INFO courses"],
    [n(listings.length), "term-by-term course listings"],
    [n(TERMS.length), "terms"],
    [n(files.size), "source documents, all linked below"],
  ];
  $("#h-stats").innerHTML = tiles.map(([value, label]) => `<div class="stat"><span class="n">${value}</span><span class="l">${esc(label)}</span></div>`).join("");
}

function checkRow(full, title, score, text) {
  return `<li class="v-check"><span class="mark ${full ? "ok" : "partial"}" aria-label="${full ? "Passed" : "Passed with exceptions"}">${full ? "✓" : "!"}</span><b>${esc(title)}</b><span class="score">${esc(score)}</span><p>${text}</p></li>`;
}

function renderChecks(approved) {
  const listings = allListings();
  const traced = listings.filter(({ term, o }) => Object.keys(KINDS).some(k => o.code in (PAGES[listingFile(term, o, k)] ?? {}))).length;
  const textTotal = TEXT.desc.checked + TEXT.pre.checked;
  const textMatched = TEXT.desc.matched + TEXT.pre.matched;
  const creditDiffer = listings.filter(({ o }) => o.crDesc).length;
  const bothCredits = listings.filter(({ o }) => o.crDesc || ("desc" in o && o.sections?.length && o.cr)).length;
  const numberChanges = COURSES.flatMap(c => c.changes.filter(ch => ch.type === "number"));
  const byHand = numberChanges.filter(ch => ch.basis).length;
  $("#v-checks").innerHTML = [
    checkRow(traced === listings.length, "Every listing traces back to a document", `${n(traced)} of ${n(listings.length)}`,
      "Each course and term was found in that term's saved CICS documents."),
    checkRow(textMatched === textTotal, "Descriptions and prerequisite text match the document", `${n(textMatched)} of ${n(textTotal)}`,
      "The site's text was compared with the course's own page in the document, ignoring only punctuation and capitals. This shows it wasn't garbled or attached to the wrong course."),
    checkRow(TEXT.spire.matched === TEXT.spire.checked, "SPIRE prerequisites match the document", `${n(TEXT.spire.matched)} of ${n(TEXT.spire.checked)}`,
      "Every word of each SPIRE prerequisite is on that course's page. SPIRE's columns run together when the PDF is read as text, so this checks the words but not their order."),
    checkRow(creditDiffer === 0, "Two documents agree on credits", `${n(bothCredits - creditDiffer)} of ${n(bothCredits)}`,
      `Where both the schedule and the description give credits, they're compared. In the ${plural(creditDiffer, "case")} where they differ, the site uses the schedule's.`),
    checkRow(approved.detected === approved.compared, "CICS's approved changes show up in the history", `${approved.detected} of ${approved.compared}`,
      "This is the most independent check. CICS publishes its own list of approved changes, and the site separately found changes by comparing one term's documents with the next."),
    checkRow(byHand === 0, "Renumbered courses are backed by CICS's lists", `${numberChanges.length - byHand} of ${numberChanges.length}`,
      `The other ${byHand} were merged by hand, and each shows its reason on the course's page.`),
  ].join("");
}

function noteBlock(title, count, body) {
  return `<details class="v-note"><summary><b>${esc(title)}</b>${count === null ? "" : ` <span class="muted">${n(count)}</span>`}</summary><div class="v-note-body">${body}</div></details>`;
}

const courseLink = id => `<a href="#${encodeURIComponent(id)}" data-course="${esc(id)}">${esc(id)}</a>`;

function renderNotes(approved) {
  const planner = comparePlanner();
  const listings = allListings();
  const credits = listings.filter(({ o }) => o.crDesc);
  const merges = COURSES.flatMap(c => c.changes.filter(ch => ch.basis).map(ch => ({ c, ch })));
  const notInHistory = [...approved.missed, ...approved.listOnly];
  const usedProblems = PROBLEMS.filter(p => !p.about.includes("drafts"));
  const reworded = planner.extra.length + planner.left.length;
  const documents = TERMS.map(t => `<tr><th>${esc(t.label)}</th>${Object.keys(KINDS).map(k => {
    const file = t.files[k];
    return `<td>${documentLink(file, "", `${t.label} ${KINDS[k]}`, KINDS[k])} <span class="muted">${esc(ORIGINS[file]?.origin.split(" (")[0] ?? "")}</span></td>`;
  }).join("")}</tr>`).join("");

  $("#v-notes").innerHTML = [
    noteBlock("What these checks can't show", null, `<ul>
      <li>No person has reviewed the data. These are automatic comparisons with the documents.</li>
      <li>If a CICS document has an error, the site repeats it.</li>
      <li>Instructors and sections weren't compared separately.</li>
      <li>Change summaries and map arrows are worked out by the build script from the document text, so an unusually worded prerequisite can be misread. Each listing below shows the arrows next to the original text.</li>
    </ul>`),
    noteBlock("Courses where credits differ between documents", credits.length, `<p>The site uses the schedule's number.</p><div class="v-table-wrap"><table>
      <thead><tr><th>Course</th><th>Term</th><th>Schedule</th><th>Description</th></tr></thead>
      <tbody>${credits.map(({ c, term, o }) => `<tr><td>${courseLink(c.id)}</td><td>${esc(TERM_LABEL[term])}</td><td>${esc(o.cr)}</td><td>${esc(o.crDesc)}</td></tr>`).join("")}</tbody>
    </table></div>`),
    noteBlock("Approved changes the term comparison didn't find on its own", notInHistory.length, `<p>All of these are still shown on the course's page, because they come from CICS's list.</p><ul>
      ${notInHistory.map(({ c, approved: a }) => `<li>${courseLink(c.id)}: ${esc({ prereq: "prerequisite", title: "title", credits: "credits", number: "number" }[a.kind])} change, effective ${esc(a.effective)}${a.to ? ` <span class="muted">(${esc(a.to.slice(0, 90))}${a.to.length > 90 ? "…" : ""})</span>` : ""}</li>`).join("")}
    </ul>`),
    noteBlock("Courses merged by hand", merges.length, `<ul>
      ${merges.map(({ c, ch }) => `<li>${courseLink(c.id)}: ${esc(ch.from)} became ${esc(ch.to)}. <span class="muted">${esc(ch.basis)}.</span></li>`).join("")}
    </ul>`),
    noteBlock("Course planner: where it differs from the latest listing", planner.credits.length + reworded, `<p>The planner's prerequisites were written by hand from the Fall 2026 and Spring 2027 text. It deliberately follows the CS-major path and leaves out retired courses, so a difference isn't always a mistake.</p>
      <h4>Credits (${planner.credits.length})</h4><ul>${planner.credits.map(({ entry, term, o }) => `<li>${courseLink(entry.id)}: planner says ${esc(entry.credits)}, the ${esc(TERM_LABEL[term])} schedule says ${esc(o.cr)}</li>`).join("")}</ul>
      <h4>The planner requires a course the listing doesn't name (${planner.extra.length})</h4><ul>${planner.extra.map(({ entry, term, codes }) => `<li>${courseLink(entry.id)}: ${esc(codes.join(", "))} <span class="muted">(${esc(TERM_LABEL[term])})</span></li>`).join("")}</ul>
      <h4>The listing names a course the planner leaves out (${planner.left.length})</h4><ul>${planner.left.map(({ entry, term, codes }) => `<li>${courseLink(entry.id)}: ${esc(codes.join(", "))} <span class="muted">(${esc(TERM_LABEL[term])})</span></li>`).join("")}</ul>`),
    noteBlock("Planner courses with no saved document", planner.noDocument.length, `<p>Math, science and writing courses were added by hand from the BS-CS tracking form. The others are on the course offering plan but in no term's documents here. Check these on SPIRE.</p>
      <p>${esc(planner.noDocument.map(e => e.id).join(", "))}</p>`),
    noteBlock("Known problems with the original documents", usedProblems.length, `<ul>
      ${usedProblems.map(p => `<li><b>${esc(p.about)}:</b> ${esc(p.text)}</li>`).join("")}
    </ul>`),
    noteBlock("All source documents", null, `<div class="v-table-wrap"><table><tbody>${documents}</tbody></table></div>`),
  ].join("");
}

function termBlock(c, term) {
  const o = c.offerings[term];
  const sources = Object.keys(KINDS).map(k => sourceLink(term, o, k)).filter(Boolean).join(" · ");
  const field = (label, value) => (value ? `<h4>${esc(label)}</h4><p class="field">${esc(value)}</p>` : "");
  const facts = [o.code, o.title, o.cr ? `${o.cr} credits${o.crDesc ? ` (description says ${o.crDesc})` : ""}` : "credits not listed", o.instr].filter(Boolean).join(" · ");
  const changes = c.changes.filter(ch => ch.term === term);
  return `<div class="v-term">
    <div class="v-term-head"><b>${esc(TERM_LABEL[term])}</b><span class="v-sources">${sources}</span></div>
    <p class="v-facts">${esc(facts)}</p>
    ${field("Prerequisites (SPIRE)", o.elig?.pre)}
    ${field("Prerequisites (course description)", o.pre)}
    ${field("Eligibility (SPIRE)", o.elig?.restrict)}
    ${field("Description", o.desc)}
    ${o.sections?.length ? `<h4>Sections</h4><ul class="sections">${o.sections.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
    ${o.needs?.length ? field("Arrows on the prerequisite map", o.needs.join(", ")) : ""}
    ${changes.length ? `<h4>Changes recorded since ${esc(TERM_LABEL[changes[0].prevTerm])}</h4><ul class="changes">${changes.map(ch => `<li>${esc(ch.summary)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function courseBody(c) {
  const entry = CATALOG.find(e => e.id === c.id);
  const planner = entry ? `<div class="v-planner"><b>In the planner:</b> ${esc(entry.credits)} credits${entry.prereq ? `, requires <code>${esc(entry.prereq)}</code>` : ", no prerequisites entered"}</div>` : "";
  return `<p class="v-course-links"><a href="index.html#${encodeURIComponent(c.key)}">See this course on the history page</a></p>
    ${planner}${listedTerms(c).reverse().map(t => termBlock(c, t)).join("")}`;
}

function renderCourses() {
  $("#v-courses").innerHTML = COURSES.map(c => {
    const terms = listedTerms(c);
    return `<details class="v-course" data-key="${esc(c.key)}">
      <summary><b>${esc(c.id)}</b><span class="title">${esc(c.title)}</span><span class="terms">${plural(terms.length, "term")}</span></summary>
    </details>`;
  }).join("");
  applySearch("");
}

function courseFor(key) {
  return COURSES.find(c => c.key === key);
}

function applySearch(text) {
  const q = text.trim().toLowerCase();
  let shown = 0;
  for (const el of document.querySelectorAll(".v-course")) {
    const c = courseFor(el.dataset.key);
    const match = !q || [c.id, c.title, ...c.formerly].join(" ").toLowerCase().includes(q);
    el.hidden = !match;
    if (match) shown++;
  }
  $("#v-count").textContent = q ? `${plural(shown, "course")} match.` : `${plural(shown, "course")}.`;
}

function openCourse(id) {
  const c = COURSES.find(x => x.id === id || x.key === id || x.formerly.includes(id));
  if (!c) return;
  $("#v-search").value = "";
  applySearch("");
  const el = document.querySelector(`.v-course[data-key="${CSS.escape(c.key)}"]`);
  el.open = true;
  el.scrollIntoView({ block: "start" });
}

// Each course's listings are only built when it's opened, so the page loads quickly.
$("#v-courses").addEventListener("toggle", e => {
  const el = e.target;
  if (el.open && !el.querySelector(".v-course-body")) {
    el.insertAdjacentHTML("beforeend", `<div class="v-course-body">${courseBody(courseFor(el.dataset.key))}</div>`);
  }
}, true);

$("#v-search").addEventListener("input", e => applySearch(e.target.value));

$("#v-notes").addEventListener("click", e => {
  const link = e.target.closest("[data-course]");
  if (link) {
    e.preventDefault();
    openCourse(link.dataset.course);
  }
});

// ---- Document viewer ----

// Phones show a PDF better on its own, so narrow screens keep the plain new-tab link.
const viewerFits = window.matchMedia("(min-width: 900px)");
let viewerOpener = null;

function showDocument(link) {
  const { file, code, title } = link.dataset;
  const place = PAGES[file]?.[code];
  const where = typeof place === "number" ? ` · page ${place}` : code && !place ? ` · search the page for ${code}` : "";
  const href = sourceHref(file, code);
  // Room for the page itself, not thumbnails.
  const src = file.endsWith(".pdf") ? `${href}${href.includes("#") ? "&" : "#"}navpanes=0&view=FitH` : href;
  // Saved web pages can run scripts of their own, so they're shown without them.
  const sandbox = file.endsWith(".html") ? `sandbox=""` : "";
  $("#v-viewer-title").innerHTML = `<b>${esc(title)}</b>${esc(where)}`;
  $("#v-viewer-open").href = href;
  $("#v-viewer-frame").innerHTML = `<iframe ${sandbox} title="${esc(title)}" src="${esc(src)}"></iframe>`;
  $("#v-viewer").hidden = false;
  document.body.classList.add("v-viewing");
  document.querySelector("a.v-doc.current")?.classList.remove("current");
  link.classList.add("current");
  viewerOpener = link;
  link.scrollIntoView({ block: "nearest" }); // the page just got narrower, which moves it
}

function closeDocument() {
  if ($("#v-viewer").hidden) return;
  $("#v-viewer").hidden = true;
  $("#v-viewer-frame").innerHTML = "";
  document.body.classList.remove("v-viewing");
  document.querySelector("a.v-doc.current")?.classList.remove("current");
  viewerOpener?.focus();
  viewerOpener = null;
}

document.addEventListener("click", e => {
  const link = e.target.closest("a.v-doc");
  // A modified click still means "open this in a new tab".
  if (!link || !SHOW_DOCUMENTS_HERE || !viewerFits.matches || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  showDocument(link);
});
$("#v-viewer-close").addEventListener("click", closeDocument);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDocument();
});
viewerFits.addEventListener("change", () => {
  if (!viewerFits.matches) closeDocument();
});

const approvedChanges = compareApproved();
renderSummary();
renderChecks(approvedChanges);
renderNotes(approvedChanges);
renderCourses();
if (location.hash) openCourse(decodeURIComponent(location.hash.slice(1)));
