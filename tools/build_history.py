#!/usr/bin/env python3
"""Build history-data.js from the term-by-term CICS documents in pdfs/.

Usage (from the planner folder):
    python3 -I tools/build_history.py > history-data.js

Each term has <term>-descriptions, <term>-schedule and <term>-eligibility files
(see pdfs/SOURCES.md). A term whose PDF is gone uses the .html copy with the same
name. Also reads pdfs/new-course-numbers.html and pdfs/course-changes.html, which
are the official lists of renumbered courses and approved changes.

Rows are merged across a renumbering only if CICS lists it. A topic number that's
reused for an unrelated course (same number, different title and description) is
split into separate rows unless CICS lists it as a title change. Findings the build
can't settle go to stderr.
"""
import difflib
import html
import json
import os
import re
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PDFS = os.path.join(ROOT, "pdfs")
TERMS = ["F22", "S23", "F23", "S24", "F24", "S25", "F25", "S26", "F26", "S27"]
SEASON = {"F": "Fall", "S": "Spring"}
SUBJECTS = "CICS|COMPSCI|INFO"
ID = rf"({SUBJECTS}) ?(H?\d{{3}}[A-Z0-9]*)"
# Same course under a new number, on neither of CICS's renumbering lists.
FROM_NOTES = "CICS's SPIRE notes call this the previous number, but its renumbering lists don't include it"
SAME_COURSE = [
    ("CICS 290P", "CICS 127", "S24", "Matched by title and description (79% the same); no CICS document says so directly"),
    ("COMPSCI 390R", "COMPSCI 367", "S25", FROM_NOTES),
    ("COMPSCI 391L", "COMPSCI 363", "F23", FROM_NOTES),
    ("COMPSCI 590T", "COMPSCI 515", "F23", FROM_NOTES),
]
# Another department's renumbering, so that its old and new numbers are one course on the map.
SAME_NUMBER = {"STATISTC 515": "STATISTC 315", "LINGUIST 492B": "LINGUIST 429B"}
OTHER_SUBJECTS = r"MATH|STATISTC|STATISTCS|STAT|PHYSICS|E&C-ENG|ECE|ENGLWRIT|LINGUIST|PSYCH|OIM|RES-ECON|SOCIOL"
# Lists after "previously" that run on into courses that aren't old numbers. COMPSCI 564 says
# "COMPSCI 360 (previously COMPSCI 460 or COMPSCI 365 or ...)", but only 460 is 360's old number:
# the rest are separate courses, as the planner and SPIRE's later listing show. "CICS 160
# (previously ... or CICS 210)" is CICS's approved change to accept CICS 210, a later course.
RUN_ON_PREVIOUSLY = [("PREVIOUSLY COMPSCI 460 OR ", "PREVIOUSLY COMPSCI 460) OR ("), (" OR CICS 210)", ") OR CICS 210")]
# Sentences that name a course without requiring it: INFO 150 points CS majors elsewhere
# ("should see COMPSCI 240 and 250"), and COMPSCI 677 says 377 is "helpful but not required".
NOT_REQUIRED = r"STUDENTS INTERESTED IN [^.]*SHOULD SEE [^.]*|[^.]*HELPFUL BUT NOT REQUIRED"

REWRITE_BELOW = 0.6  # description word similarity below this counts as a rewrite
UNRELATED_BELOW = 0.3  # same number, different title and this dissimilar: a different course


def label(term):
    return f"{SEASON[term[0]]} 20{term[1:]}"


def warn(*args):
    print(*args, file=sys.stderr)


def squash(s):
    return re.sub(r"\s+", " ", s).strip()


def strip_tags(s):
    return squash(html.unescape(re.sub(r"<[^>]+>", " ", s)))


def pdf_text(path):
    return subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True).stdout


def split_body(body):
    """Split a course's text into description, prerequisite text and credits."""
    body = squash(body)
    cr = re.search(r"(\d+(?:-\d+)?)\s*credits?\.?\s*$", body, re.I)
    credits = cr[1] if cr else None
    if cr:
        body = body[:cr.start()].strip()
    pre = re.search(r"(?:Undergraduate |Graduate )?Pre-?req(?:uisite)?s?\s*:?(?=\s)", body)
    if pre:
        return body[:pre.start()].strip(), body[pre.start():].strip(), credits
    return body, "", credits


def is_furniture(ln):
    s = ln.strip()
    return ("UMassAmherst" in ln or "Manning College" in ln or re.search(r"---\s+page\s+\d+\s+---", ln) is not None
            or re.fullmatch(r"\d{1,3}|\d{1,2}/\d{1,2}/\d{4}", s) is not None)


def parse_descriptions_pdf(path):
    lines = [ln for ln in pdf_text(path).split("\n") if not is_furniture(ln)]
    # A heading is the last non-blank line above INSTRUCTOR(S); wrapped prose can also
    # start with a course code, so the code alone doesn't mark one.
    starts = []
    for i, ln in enumerate(lines):
        if ln.strip().startswith("INSTRUCTOR"):
            j = i - 1
            while j >= 0 and not lines[j].strip():
                j -= 1
            m = re.match(rf"^\s*{ID}(?:\s+(\S.*))?$", lines[j]) if j >= 0 else None
            tail = ""
            if not m and j > 0:  # a long title wraps onto a second line
                tail = " " + lines[j].strip()
                j -= 1
                m = re.match(rf"^\s*{ID}(?:\s+(\S.*))?$", lines[j])
            if m:
                starts.append((j, i, f"{m[1]} {m[2]}", squash((m[3] or "") + tail)))
            else:
                warn(f"{os.path.basename(path)}: no heading above line {i}: {lines[j].strip()[:60]!r}")
    out = []
    for k, (j, i, cid, title) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(lines)
        instr = re.sub(r"^INSTRUCTOR\(S\):?", "", lines[i].strip()).strip()
        rest = lines[i + 1:end]
        while instr.endswith(",") and rest:
            instr += " " + rest.pop(0).strip()
        out.append((cid, title, instr, " ".join(x.strip() for x in rest if x.strip())))
    return out


def parse_descriptions_html(path):
    s = open(path, errors="replace").read()
    blocks = re.findall(rf"<h2>\s*(?:<a[^>]*>)?\s*{ID}\s*:\s*(.*?)(?:</a>)?\s*</h2>(.*?)(?=<h2>|</div>)", s, re.S)
    out = []
    for subj, num, title, rest in blocks:
        ins = re.search(r"<h3>\s*Instructor\(s\):\s*(.*?)</h3>", rest, re.S)
        body = re.sub(r"<h3>.*?</h3>", " ", rest, flags=re.S)
        # The page's footer comes straight after the last course.
        body = re.sub(r"Last automatic generation:.*", "", strip_tags(body))
        out.append((f"{subj} {num}", strip_tags(title), strip_tags(ins[1]) if ins else "", body))
    return out


def load_descriptions(term):
    pdf = os.path.join(PDFS, f"{term}-descriptions.pdf")
    rows = parse_descriptions_pdf(pdf) if os.path.exists(pdf) else parse_descriptions_html(os.path.join(PDFS, f"{term}-descriptions.html"))
    out = {}
    for cid, title, instr, body in rows:
        if " H" in cid:  # honors colloquium attached to a regular course
            continue
        desc, pre, credits = split_body(body)
        if credits is None:
            warn(f"{term} {cid}: no credit count found")
        d = {"title": title, "instr": instr, "desc": desc, "pre": pre, "cr": credits}
        if cid in out:
            prev = out[cid]
            if prev["desc"] != desc:
                warn(f"{term} {cid}: listed twice with different text, keeping the first")
            names = [n.strip() for n in (prev["instr"] + "," + instr).split(",") if n.strip()]
            prev["instr"] = ", ".join(dict.fromkeys(names))
        else:
            out[cid] = d
    return out


def parse_schedule_pdf(path):
    out, cur = {}, None
    for ln in pdf_text(path).split("\n"):
        m = re.match(rf"^\s*({SUBJECTS})\s+(H?\d{{3}}[A-Z0-9]*)\s+(\S.*?)\s+(\d+(?:\s*-\s*\d+)?)\s*cr\b", ln)
        if m:
            cur = None
            if not m[2].startswith("H"):
                cur = out.setdefault(f"{m[1]} {m[2]}", {"title": squash(m[3]), "cr": re.sub(r"\s", "", m[4]), "sections": []})
            continue
        m = re.match(r"^\s*([A-Z0-9]{1,3})\s+(LEC|LAB|DIS|SEM|IND|PRA|CLN|STS|COL)\s+(\S+)\s+(\d{4,6})\s*(.*)$", ln)
        if m and cur is not None:
            cur["sections"].append(f"{m[2]} {m[3]}: " + squash(m[5]))
    return out


def parse_schedule_html(path):
    s = open(path, errors="replace").read()
    out, cur, subj = {}, None, None
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", s, re.S):
        head = re.match(r"\s*<th[^>]*>\s*([A-Z&-]+)\s*</th>", row)
        if head:
            subj = head[1]
            continue
        cells = [strip_tags(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) == 2:
            m = re.match(r"(.*?)\s*\((\d+(?:-\d+)?)\s*CR\)", cells[1])
            cur = None
            if m and subj and re.fullmatch(SUBJECTS, subj) and not cells[0].startswith("H"):
                cur = out.setdefault(f"{subj} {cells[0]}", {"title": m[1], "cr": m[2], "sections": []})
        elif len(cells) == 6 and cur is not None:
            m = re.match(r"\S+\s+([A-Z]{3})(\S+)", cells[0])
            if m:
                days = " ".join(re.findall(r"[A-Z][a-z]+", cells[2]))
                cur["sections"].append(f"{m[1]} {m[2]}: " + squash(f"{days} {cells[3]} {cells[4]} {cells[5]}"))
    return out


def load_schedule(term):
    pdf = os.path.join(PDFS, f"{term}-schedule.pdf")
    return parse_schedule_pdf(pdf) if os.path.exists(pdf) else parse_schedule_html(os.path.join(PDFS, f"{term}-schedule.html"))


def parse_eligibility(path):
    """Read the SPIRE table from word coordinates. Each row's cells start just above
    its course code, and a cell that runs off a page continues at the top of the next."""
    out = {}
    cid, cells = None, None

    def flush():
        if cid and " H" not in cid:
            out[cid] = {k: squash(" ".join(w for _, _, w in sorted(v))) for k, v in cells.items()}

    raw = subprocess.run(["pdftotext", "-bbox", path, "-"], capture_output=True, text=True).stdout
    for page in raw.split("<page ")[1:]:
        found = re.findall(r'xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>([^<]*)<', page)
        words = [(float(y), float(x), html.unescape(t)) for x, y, t in found]
        head = next((y for y, x, t in words if t == "PREREQUISITES"), None)
        if head is None:
            continue
        cols = [next(x for y, x, t in words if t == name and abs(y - head) < 4) for name in ("PREREQUISITES", "ELIGIBILITY", "CLASS")]
        left = min(x for _, x, _ in words)
        codes = {}
        for y, x, t in words:
            if y > head + 4 and x < left + 10 and re.fullmatch(SUBJECTS, t):
                num = next((w for yy, xx, w in words if abs(yy - y) < 1 and left + 10 < xx < cols[0] and re.fullmatch(r"H?\d{3}[A-Z0-9]*", w)), None)
                if num:
                    codes[y] = f"{t} {num}"
        starts = sorted(codes)
        for y, x, t in sorted(words):
            if y <= head + 6:
                continue
            while starts and y >= starts[0] - 4:
                flush()
                cid, cells = codes[starts.pop(0)], {"pre": [], "restrict": [], "notes": []}
            if cells is None or x < cols[0] - 4:
                continue
            key = "notes" if x >= cols[2] - 4 else "restrict" if x >= cols[1] - 4 else "pre"
            cells[key].append((y, x, t))
    flush()
    return out


def parse_renumberings():
    """(from, to, term, title) from the New Course Numbers page."""
    s = open(os.path.join(PDFS, "new-course-numbers.html"), errors="replace").read()
    s = s[s.find("New Course Numbers"):]
    out, term = [], None
    text = re.sub(r"<(?:br|/p|/li|/h\d|/div)[^>]*>", "\n", s)
    for ln in html.unescape(re.sub(r"<[^>]+>", "", text)).split("\n"):
        ln = squash(ln)
        m = re.fullmatch(r"(Fall|Spring|Summer) (20\d\d)", ln)
        if m:
            term = term_of(ln)
            continue
        m = re.match(rf"^({SUBJECTS}|INFOSEC) (\S+).*? changed to ({SUBJECTS}|COMPCI) (\d{{3}}[A-Z0-9]*)\s*(.*)$", ln)
        if m and term:
            out.append((f"{m[1]} {m[2]}", f"{m[3]} {m[4]}", term, m[5]))
    return out


def term_index(term):
    """Position of a term in TERMS; terms outside the window sort before or after it."""
    if term in TERMS:
        return TERMS.index(term)
    return -1 if int(term[1:]) < 22 or term == "S22" else len(TERMS)


def term_of(words):
    m = re.search(r"(Fall|Spring|Summer) (20\d\d)", words)
    if not m:
        return None
    # A summer change first shows up in that fall's listing.
    return ("S" if m[1] == "Spring" else "F") + m[2][2:]


def parse_official_changes():
    """Approved changes per course id, as listed on the changes page."""
    s = open(os.path.join(PDFS, "course-changes.html"), errors="replace").read()
    kinds = {"Prerequisite Changes": "prereq", "Catalog Changes": "number", "Title Changes": "title", "Credit Changes": "credits"}
    out = []
    for section in re.split(r"<summary[^>]*>", s)[1:]:
        heading = strip_tags(section.split("<span", 1)[0])
        kind = next((v for k, v in kinds.items() if heading.startswith(k)), None)
        if not kind:
            continue
        for item in re.findall(r"<li>(.*?)</li>", section, re.S):
            ln = squash(html.unescape(re.sub(r"<[^>]+>", " ", item)))
            if not re.match(rf"^({SUBJECTS}) H?\d{{3}}", ln):  # the site footer also uses <li>
                continue
            m = re.match(rf"^({SUBJECTS}) ([^\s,]+)(?: \(previously \S+\))?(.*?),? effective ((?:Fall|Spring|Summer) 20\d\d)[^:.]*?[:.]?\s*(.*)$", ln)
            if not m:
                warn("official change not understood:", ln[:90])
                continue
            entry = {"id": f"{m[1]} {m[2]}", "kind": kind, "term": term_of(m[4]), "effective": m[4]}
            parts = re.match(r"(.*?)FROM:\s*(.*?)\s*TO:\s*(.*)$", m[5])
            if parts:
                entry.update({"who": parts[1].strip(": "), "from": parts[2], "to": parts[3]})
            else:
                entry["to"] = m[5]
            out.append(entry)
    return out


def words(s):
    return re.findall(r"[a-z0-9&+]+", re.sub(r"-\s+", "", s.lower()))


def similarity(a, b):
    a, b = words(a), words(b)
    if not a and not b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def same_title(a, b):
    """PDF titles are cut to SPIRE's 30 characters, so accept one being an abbreviation of the other."""
    def key(s):
        s = re.sub(r"\band\b|&", "", s.lower())
        s = re.sub(r"^(s-|p-|sem-|st-|special topics-|seminar\s*-\s*)", "", s)
        return re.sub(r"[^a-z0-9]", "", s)
    a, b = key(a), key(b)
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    it = iter(long_)
    return all(c in it for c in short)


def requirement_key(pre):
    """Course codes and grade floors named by a prerequisite, ignoring its wording."""
    # SPIRE's table can wrap a subject at its hyphen, which leaves a space in the text.
    s = pre.upper().replace("RES- ECON", "RES-ECON").replace("E&C- ENG", "E&C-ENG")
    s = s.replace("STATISTCS", "STATISTC").replace("STAT ", "STATISTC ").replace("ECE ", "E&C-ENG ")
    codes = set()
    for m in re.finditer(rf"\b({SUBJECTS}|{OTHER_SUBJECTS})\s+(\d{{3}}[A-Z0-9]*(?:(?:\s*(?:,|&|/|OR|AND)\s*)\d{{3}}[A-Z0-9]*)*)", s):
        for num in re.findall(r"\d{3}[A-Z0-9]*", m[2]):
            codes.add(f"{m[1]} {num}")
    grades = set(re.findall(r"\b([A-D][+-]?)'? OR (?:BETTER|HIGHER)", s)) | set(re.findall(r"GRADE OF '?([A-D][+-]?)'?", s))
    return codes, grades


def history_marked(text):
    """A prerequisite in capitals, with "previously" ending where its list of old numbers does."""
    text = text.upper()
    for run_on, separated in RUN_ON_PREVIOUSLY:
        text = text.replace(run_on, separated)
    return text


def renamed_courses(text):
    """(new number, its old numbers) for each "X (previously Y)" in a prerequisite."""
    upper = history_marked(text)
    out = []
    for m in re.finditer(r"PREVIOUSLY ([^)\]]*)", upper):
        olds = requirement_key(m[1])[0]
        ahead = requirement_key(upper[max(0, m.start() - 40):m.start()])
        codes = re.findall(rf"\b(?:{SUBJECTS}|{OTHER_SUBJECTS}) \d{{3}}[A-Z0-9]*", upper[max(0, m.start() - 40):m.start()].replace("STATISTCS", "STATISTC"))
        if olds and codes and ahead:
            out.append((codes[-1], olds))
    return out


def named_courses(text):
    """Courses a prerequisite actually names, leaving out numbers it only gives as history."""
    current = re.sub(NOT_REQUIRED, "", history_marked(text))
    current = re.sub(r"[,;]?\s*PREVIOUSLY [^)\]]*", "", current)
    return {SAME_NUMBER.get(c, c) for c in requirement_key(current)[0]}


def named_differently(codes, present, absent, canon):
    """The codes that really came or went: a course's old and new numbers are one course,
    and a number mentioned only as history isn't a requirement. One code per course."""
    out = {}
    for code in sorted(codes):
        row = canon(code)
        if row in present and row not in absent and (row not in out or code == row):
            out[row] = code
    return set(out.values())


def compare(prev, cur, canon):
    """Change records between two offerings of the same course."""
    out = []
    if prev["code"] != cur["code"]:
        out.append({"type": "number", "from": prev["code"], "to": cur["code"]})
    # Schedule titles are abbreviated differently, so only compare the ones from the descriptions.
    if prev.get("desc") and cur.get("desc") and prev["title"] and cur["title"] and not same_title(prev["title"], cur["title"]):
        out.append({"type": "title", "from": prev["title"], "to": cur["title"]})
    if prev.get("cr") and cur.get("cr") and prev["cr"] != cur["cr"]:
        out.append({"type": "credits", "from": prev["cr"], "to": cur["cr"]})
    pe, ce = prev.get("elig"), cur.get("elig")
    # SPIRE's field is what's enforced at registration, so it decides whether a requirement
    # changed. The catalog prose also moved a lot (F24 added "grade of C" nearly everywhere).
    if pe and ce:
        before, after = requirement_key(pe["pre"]), requirement_key(ce["pre"])
        source = "SPIRE"
    elif prev.get("pre") is not None and cur.get("pre") is not None:
        before, after = requirement_key(prev["pre"]), requirement_key(cur["pre"])
        source = "catalog text"
    else:
        before = after = None
    added, removed = set(), set()
    if before != after:
        added, removed = after[0] - before[0], before[0] - after[0]
        was_text, now_text = (pe["pre"], ce["pre"]) if pe and ce else (prev["pre"], cur["pre"])
        # "STATISTC 315 (previously 515)" replacing 515 is the other department's renumbering,
        # not a new requirement, so neither number counts as added or dropped.
        for new, olds in renamed_courses(now_text):
            if olds & before[0]:
                added.discard(new)
                removed -= olds
        for new, olds in renamed_courses(was_text):
            if new in after[0]:
                removed -= olds
        was, now = ({canon(c) for c in named_courses(t)} for t in (was_text, now_text))
        added, removed = named_differently(added, now, was, canon), named_differently(removed, was, now, canon)
    if before != after and (added or removed or before[1] != after[1]):
        out.append({"type": "prereq", "source": source, "added": sorted(added), "removed": sorted(removed),
                    "grades": [sorted(before[1]), sorted(after[1])] if before[1] != after[1] else None})
    elif before != after or (pe and ce and words(pe["pre"]) != words(ce["pre"])) or (prev.get("pre") is not None and cur.get("pre") is not None and words(prev["pre"]) != words(cur["pre"])):
        out.append({"type": "prereq-wording"})
    if prev.get("desc") and cur.get("desc") and words(prev["desc"]) != words(cur["desc"]):
        sim = similarity(prev["desc"], cur["desc"])
        out.append({"type": "rewrite" if sim < REWRITE_BELOW else "description", "similarity": round(sim, 3)})
    if pe and ce and words(pe["restrict"]) != words(ce["restrict"]):
        out.append({"type": "eligibility"})
    return out


def tidy(text):
    """SPIRE's fields are in capitals, which are hard to skim. Keep codes and acronyms."""
    if sum(c.isupper() for c in text) < 0.6 * max(1, sum(c.isalpha() for c in text)):
        return text
    out = text.lower()
    out = re.sub(rf"\b({SUBJECTS.lower()}|{OTHER_SUBJECTS.lower()})\b(?= ?\d)", lambda m: m[1].upper(), out)
    out = re.sub(r"\b(cs|bs|ba|ms|phd|cse|cseng|inform|compsci|nsot|ee|ece|r1|r2)\b", lambda m: m[1].upper(), out)
    out = re.sub(r"(\d{3})([a-z]+)\b", lambda m: m[1] + m[2].upper(), out)
    return re.sub(r"\b(grade of '?)([a-d][+-]?)|\b([a-d][+-]?)('? or better)", lambda m: (m[1] or "") + (m[2] or m[3]).upper() + (m[4] or ""), out)


def quoted(tokens, limit=14):
    text = " ".join(tokens).strip(" ,;:.")
    words_ = text.split()
    return "“" + tidy(" ".join(words_[:limit]) + ("…" if len(words_) > limit else "")) + "”"


def edit_groups(a, b):
    """Word-level edits from a to b, as (removed, added) token lists. Edits with only a
    word or two between them are joined so that each reads as one phrase, and a very
    short edit keeps the words around it so it makes sense when quoted alone."""
    x, y = a.split(), b.split()
    norm = lambda w: re.sub(r"[^a-z0-9&+]", "", w.lower())
    ops = difflib.SequenceMatcher(None, [norm(w) for w in x], [norm(w) for w in y], autojunk=False).get_opcodes()
    groups = []
    for tag, i1, i2, j1, j2 in ops:
        if tag == "equal":
            continue
        if groups and i1 - groups[-1][1] <= 2 and j1 - groups[-1][3] <= 2:
            groups[-1][1], groups[-1][3] = i2, j2
        else:
            groups.append([i1, i2, j1, j2])
    out = []
    for i1, i2, j1, j2 in groups:
        removed, added = x[i1:i2], y[j1:j2]
        if len(removed) <= 3 and len(added) <= 3 and not is_trivial((removed, added)):
            before = x[max(0, i1 - 2):i1]
            after = x[i2:i2 + 2]
            removed, added = before + removed + after, y[max(0, j1 - 2):j1] + added + y[j2:j2 + 2]
        out.append((removed, added))
    return out


def is_trivial(group):
    """Plurals, punctuation, hyphens and abbreviations don't change what a sentence says."""
    key = lambda t: re.sub(r"s\b", "", re.sub(r"[^a-z0-9&+ ]", "", " ".join(t).lower())).replace(" ", "")
    a, b = key(group[0]), key(group[1])
    if a == b:
        return True
    return len(group[0]) == 1 and len(group[1]) == 1 and bool(a and b) and (a.startswith(b) or b.startswith(a))


def describe_edits(a, b):
    groups = [g for g in edit_groups(a, b) if not is_trivial(g)]
    if not groups:
        return "Punctuation, spelling or abbreviations only."
    groups.sort(key=lambda g: len(g[0]) + len(g[1]), reverse=True)
    rendered = []
    for removed, added in groups:
        if removed and added:
            line = f"{quoted(removed, 9)} became {quoted(added, 9)}"
        elif added:
            line = f"Added {quoted(added)}"
        else:
            line = f"Removed {quoted(removed)}"
        if line not in rendered:
            rendered.append(line)
    extra = len(rendered) - 2
    return "; ".join(rendered[:2]) + (f"; {extra} smaller edit{'s' if extra != 1 else ''}" if extra > 0 else "") + "."


def name_list(codes, limit=4):
    codes = sorted(codes)
    shown = ", ".join(codes[:limit])
    return f"{shown} and {len(codes) - limit} more" if len(codes) > limit else shown


def former_numbers(text):
    found = set()
    for inner in re.findall(r"PREVIOUSLY ([^)\]]*)", history_marked(text)):
        found |= requirement_key(inner)[0]
    return found


def describe_prereq(ch, before_text, after_text, approved):
    added, removed = set(ch["added"]), set(ch["removed"])
    grades = ch["grades"]
    if approved and approved.get("from") and not (added or removed or grades):
        # Only CICS's list shows this one, so read what changed from its FROM and TO.
        before_text, after_text = approved["from"], approved["to"]
        was, now = requirement_key(before_text), requirement_key(after_text)
        added, removed = now[0] - was[0], was[0] - now[0]
        grades = [sorted(was[1]), sorted(now[1])] if was[1] != now[1] else None
    old_added = added & former_numbers(after_text)
    old_removed = removed & former_numbers(before_text)
    parts = []
    if added - old_added:
        parts.append(f"adds {name_list(added - old_added)}")
    if removed - old_removed:
        parts.append(f"drops {name_list(removed - old_removed)}")
    if old_added:
        parts.append(f"now also counts earlier course {name_list(old_added, 3)}")
    if old_removed:
        parts.append(f"stops mentioning earlier course {name_list(old_removed, 3)}")
    if grades:
        was, now = "/".join(grades[0]), "/".join(grades[1])
        came, went = "/".join(sorted(set(grades[1]) - set(grades[0]))), "/".join(sorted(set(grades[0]) - set(grades[1])))
        if was and now and came and went:
            parts.append(f"minimum grade went from {was} to {now}")
        elif came:
            parts.append(f"minimum grade of {came} now stated")
        else:
            parts.append(f"minimum grade of {went} no longer stated")
    if not parts:
        count = lambda t: (len(re.findall(r"\bAND\b", t.upper())), len(re.findall(r"\bOR\b", t.upper())))
        parts.append("same courses, but the and/or logic changed" if count(before_text) != count(after_text) else "same courses and grades, reworded")
    text = "; ".join(parts)
    text = text[0].upper() + text[1:] + "."
    now_text = re.sub(r"^(?:(?:Undergraduate |Graduate )?Pre-?req(?:uisite)?s?\s*:?\s*)+", "", after_text)
    if now_text:
        text += f" Now: {quoted(now_text.split(), 16)}."
    return text


LEVELS = [("freshmen", r"FRESHM[AE]N"), ("sophomores", r"SOPHO?MORES?"), ("juniors", r"JUNIORS?"), ("seniors", r"SENIORS?")]


def describe_eligibility(before, after):
    """Say who gained or lost access when that's clear from the wording; otherwise quote the edit."""
    parts = []
    if not re.search(r"\b(NOT|EXCEPT|NON-\w+|OTHER THAN)\b", (before + " " + after).upper()):
        has = lambda t: {name for name, pattern in LEVELS if re.search(rf"\b{pattern}\b", t.upper())}
        was, now = has(before), has(after)
        # An empty set means the text doesn't mention years at all, which isn't the same as closing it.
        if was and now and was != now:
            if now - was:
                parts.append(f"Opened to {', '.join(n for n, _ in LEVELS if n in now - was)}")
            if was - now:
                parts.append(f"No longer open to {', '.join(n for n, _ in LEVELS if n in was - now)}")
    if not before and after:
        return f"Restriction added: {quoted(after.split())}."
    if before and not after:
        return f"Restriction removed: {quoted(before.split())}."
    return ". ".join(parts) + "." if parts else describe_edits(before, after)


def nice_title(title, code, full_titles):
    full = full_titles.get(code)
    return full if full and same_title(title, full) else title


def summarize(ch, prev, cur, approved, full_titles):
    """One short sentence on what a change was."""
    kind = ch["type"]
    if kind == "number":
        return f"Renumbered from {ch['from']} to {ch['to']}."
    if kind == "title":
        listed = next((o for o in approved if o["kind"] == "title" and o.get("from")), None)
        if listed:
            return f"Renamed from “{listed['from']}” to “{listed['to']}”."
        return f"Renamed from “{nice_title(ch['from'], prev['code'], full_titles)}” to “{nice_title(ch['to'], cur['code'], full_titles)}”."
    if kind == "credits":
        return f"Went from {ch['from']} to {ch['to']} credit{'' if ch['to'] == '1' else 's'}."
    if kind == "rewrite":
        return f"Largely rewritten, with {round(ch['similarity'] * 100)}% of the words carried over. Now opens: {quoted(cur['desc'].split(), 16)}."
    if kind == "description":
        return describe_edits(prev["desc"], cur["desc"])
    if kind == "eligibility":
        return describe_eligibility(prev["elig"]["restrict"], cur["elig"]["restrict"])
    pe, ce = prev.get("elig"), cur.get("elig")
    if kind == "prereq":
        before_text, after_text = (pe["pre"], ce["pre"]) if ch["source"] != "catalog text" and pe and ce else (prev.get("pre", ""), cur.get("pre", ""))
        listed = next((o for o in approved if o["kind"] == "prereq"), None) if ch["source"] == "official list" else None
        return describe_prereq(ch, before_text, after_text, listed)
    # Wording only: the catalog text if that's what moved, otherwise SPIRE's.
    if prev.get("pre") is not None and cur.get("pre") is not None and words(prev["pre"]) != words(cur["pre"]):
        return describe_edits(prev["pre"], cur["pre"])
    return describe_edits(pe["pre"], ce["pre"])


def main():
    descriptions = {t: load_descriptions(t) for t in TERMS}
    renumberings = parse_renumberings()
    # The F22 PDF is the May 2022 capture. CICS regenerated it in January 2024 with later
    # numbers and wording, so that copy only supplies the courses May 2022 lacks.
    later = {}
    for cid, title, instr, body in parse_descriptions_pdf(os.path.join(PDFS, "F22-descriptions-2024-01-regenerated.pdf")):
        renamed = any(d == cid and s in descriptions["F22"] for s, d, _, _ in renumberings)
        if " H" not in cid and cid not in descriptions["F22"] and not renamed:
            desc, pre, credits = split_body(body)
            later[cid] = {"title": title, "instr": instr, "desc": desc, "pre": pre, "cr": credits, "regenerated": True}
    warn("F22 taken from the regenerated file:", sorted(later))
    descriptions["F22"].update(later)
    schedules = {t: load_schedule(t) for t in TERMS}
    eligibility = {t: parse_eligibility(os.path.join(PDFS, f"{t}-eligibility.pdf")) for t in TERMS}
    official = parse_official_changes()

    catalog = {}
    with open(os.path.join(ROOT, "catalog.js")) as f:
        for c in json.loads(f.read().split("=", 1)[1].rstrip().rstrip(";")):
            catalog[c["id"]] = c["title"]

    full_titles = {}
    for t in TERMS:
        path = os.path.join(PDFS, f"{t}-descriptions.html")
        if os.path.exists(path):
            for cid, title, _, _ in parse_descriptions_html(path):
                full_titles[cid] = title

    offerings = {}
    for t in TERMS:
        for cid in sorted(set(descriptions[t]) | set(schedules[t]) | set(eligibility[t])):
            d, s, e = descriptions[t].get(cid), schedules[t].get(cid), eligibility[t].get(cid)
            if not d and not s:  # SPIRE notes alone don't mean it's on the term's listing
                continue
            title = (d and d["title"]) or (s and s["title"].title().replace("Phd", "PhD")) or ""
            # The schedule comes from SPIRE; the description text has the occasional slip.
            cr = (s and s["cr"]) or (d and d["cr"])
            o = {"code": cid, "title": title, "cr": cr}
            if d and s and d["cr"] and s["cr"] and d["cr"] != s["cr"]:
                o["crDesc"] = d["cr"]
                warn(f"{t} {cid}: description says {d['cr']} credits, schedule says {s['cr']}")
            if d and (d["desc"] or d["pre"]):  # some entries are a heading with no text
                o.update({"instr": d["instr"], "desc": d["desc"], "pre": d["pre"]})
                if d.get("regenerated"):
                    o["regenerated"] = True
            if s and s["sections"]:
                o["sections"] = s["sections"]
            if e:
                o["elig"] = e
            offerings.setdefault(cid, {})[t] = o

    # Merge rows along CICS's renumbering lists, oldest first. A number can be skipped
    # in the listings (497S -> 490STA -> 426 never lists 490STA), so chains run through it.
    edges = list(renumberings)
    for o in official:
        target = re.match(rf"({SUBJECTS}) (\d{{3}}[A-Z0-9]*)", o.get("to", ""))
        if o["kind"] == "number" and target:
            edges.append((o["id"], f"{target[1]} {target[2]}", o["term"], ""))
    edges += [(src, dst, term, "") for src, dst, term, _ in SAME_COURSE]
    parent = {}
    members = {}
    def find(c):
        while c in parent:
            c = parent[c]
        return c
    def listed(root):
        return {t: offerings[c][t] for c in members.get(root, {root}) if c in offerings for t in offerings[c]}
    numbers_used = []
    for src, dst, term, _ in sorted(edges, key=lambda r: (int(r[2][1:]), r[2][0] == "F")):
        dst = dst.replace("COMPCI", "COMPSCI")
        ra, rb = find(src), find(dst)
        if ra == rb or " H" in src:
            continue
        a, b = listed(ra), listed(rb)
        if not b and term_index(term) >= len(TERMS):  # announced for after the last term here
            continue
        overlap = sorted(set(a) & set(b))
        if overlap:
            # Old and new numbers can run side by side in the changeover term.
            sims = [similarity(a[t]["desc"], b[t]["desc"]) for t in overlap if a[t].get("desc") and b[t].get("desc")]
            warn(f"renumbering {src} -> {dst}: both listed in {overlap}, similarity {[round(x, 2) for x in sims]}")
            if sims and min(sims) < 0.6:
                continue
            for t in overlap:
                b[t]["alsoListedAs"] = a[t]["code"]
                del offerings[a[t]["code"]][t]
        members[rb] = members.get(rb, {rb}) | members.get(ra, {ra})
        parent[ra] = rb
        if a and b:
            numbers_used.append((src, dst, term))

    title_change_ids = {(o["id"], o["term"]) for o in official if o["kind"] == "title"}
    rows = {}
    for cid, terms in offerings.items():
        root = find(cid)
        rows.setdefault(root, {}).update(terms)

    # Split a reused number into separate rows.
    final = {}
    splits = []
    for root, terms in rows.items():
        groups, cur, prev = [], {}, None
        for t in TERMS:
            o = terms.get(t)
            if not o:
                continue
            if prev and o["code"] == prev["code"] and not same_title(o["title"], prev["title"]):
                official_rename = any(c == o["code"] for c, _ in title_change_ids)
                sim = similarity(prev["desc"], o["desc"]) if prev.get("desc") and o.get("desc") else 1
                if not official_rename and sim < UNRELATED_BELOW:
                    splits.append((o["code"], prev["title"], o["title"], round(sim, 2), t))
                    groups.append(cur)
                    cur = {}
            cur[t] = o
            prev = o
        groups.append(cur)
        for i, g in enumerate(groups):
            final[root if len(groups) == 1 else f"{root}#{i + 1}"] = g

    # Prerequisites name courses by whatever number they had, so point each at its row.
    row_of = {}
    for key, terms in final.items():
        for o in terms.values():
            row_of[o["code"]] = key
    def canon(code):
        code = SAME_NUMBER.get(code, code)
        return row_of.get(code) or row_of.get(find(code)) or code
    for key, terms in final.items():
        for o in terms.values():
            text = (o.get("elig") or {}).get("pre") or o.get("pre")
            if text is None:
                continue
            o["needs"] = sorted({canon(c) for c in named_courses(text)} - {key})

    courses = []
    for key, terms in final.items():
        order = [t for t in TERMS if t in terms]
        last = terms[order[-1]]
        code = last["code"]
        title = full_titles.get(code) if len(final.get(key, {})) and "#" not in key else None
        if not title:
            title = catalog.get(code) if "#" not in key else None
        title = title or last["title"]
        changes = []
        codes = list(dict.fromkeys(terms[t]["code"] for t in order))
        approved = [o for o in official if o["id"] in codes]
        for a, b in zip(order, order[1:]):
            found = compare(terms[a], terms[b], canon)
            # A listed change counts even when the courses named stay the same (590NN went OR to AND).
            if any(o["kind"] == "prereq" and TERMS.index(a) < term_index(o["term"]) <= TERMS.index(b) for o in approved):
                found = [c for c in found if c["type"] != "prereq-wording"]
                if not any(c["type"] == "prereq" for c in found):
                    found.append({"type": "prereq", "source": "official list", "added": [], "removed": [], "grades": None})
            in_window = [o for o in approved if TERMS.index(a) < term_index(o["term"]) <= TERMS.index(b)]
            # Two abbreviations of one title can look different until both are spelled out.
            found = [c for c in found if not (c["type"] == "title" and nice_title(c["from"], terms[a]["code"], full_titles) == nice_title(c["to"], terms[b]["code"], full_titles))]
            for ch in found:
                ch["summary"] = summarize(ch, terms[a], terms[b], in_window, full_titles)
                basis = next((n for x, y, _, n in SAME_COURSE if ch["type"] == "number" and (x, y) == (ch["from"], ch["to"])), None)
                if basis:
                    ch["basis"] = basis
                changes.append({"term": b, "prevTerm": a, **ch})
        courses.append({
            "key": key,
            "id": code,
            "title": title,
            "subject": code.split()[0],
            "level": int(re.search(r"\d{3}", code)[0]) // 100 * 100,
            "formerly": codes[:-1],
            "offerings": terms,
            "changes": changes,
            "official": approved,
            "becomes": next(([d, t] for s, d, t, _ in renumberings if s == code and int(t[1:]) * 2 + (t[0] == "F") > 54), None)
            # Approved under a new number that no term's documents here use yet.
            or next(([" ".join(o["to"].split()[:2]), o["term"]] for o in approved if o["kind"] == "number" and o["id"] == code), None),
        })
    courses.sort(key=lambda c: (c["subject"], int(re.search(r"\d{3}", c["id"])[0]), c["id"], c["key"]))

    data = {
        "terms": [{"id": t, "label": label(t),
                   "files": {k: next((f for f in (f"{t}-{k}.pdf", f"{t}-{k}.html") if os.path.exists(os.path.join(PDFS, f))), None)
                             for k in ("descriptions", "schedule", "eligibility")}} for t in TERMS],
        "courses": courses,
        "renumberings": [{"from": s, "to": d, "term": t} for s, d, t in numbers_used],
    }

    for s in splits:
        warn("split reused number:", s)
    for t in TERMS:
        warn(f"{t}: descriptions={len(descriptions[t])} schedule={len(schedules[t])} eligibility={len(eligibility[t])} "
             f"no-elig={sorted(set(descriptions[t]) - set(eligibility[t]))[:6]}")
    print("// Generated by tools/build_history.py from the documents in pdfs/.")
    print("window.HISTORY = " + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";")


if __name__ == "__main__":
    main()
