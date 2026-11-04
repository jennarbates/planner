#!/usr/bin/env python3
"""Build verify-data.js, the source lookups and text checks behind verify.html.

Usage (from the planner folder, after build_history.py):
    python3 -I tools/build_verify.py > verify-data.js

For each document in pdfs/ it records the page each course starts on (or its anchor,
for a saved web page), plus where the document came from and any known problems with
it, both read from pdfs/SOURCES.md. It also checks each course's text in history-data.js
against its document. Rerun it if pdfs/ or history-data.js change.
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True  # importing the other script shouldn't leave __pycache__ in tools/
from build_history import ID, PDFS, ROOT, SUBJECTS, TERMS, is_furniture, parse_schedule_html, strip_tags

EXTRA_DESCRIPTIONS = "F22-descriptions-2024-01-regenerated.pdf"


def pdf_pages(path):
    return subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True).stdout.split("\f")


def description_pages(path):
    """A heading is the last non-blank line or two above INSTRUCTOR(S), as in build_history."""
    found = {}
    for n, page in enumerate(pdf_pages(path), 1):
        lines = [ln for ln in page.split("\n") if ln.strip()]
        for i, ln in enumerate(lines):
            if ln.strip().startswith("INSTRUCTOR"):
                for above in lines[max(0, i - 2):i][::-1]:
                    m = re.match(rf"^\s*{ID}\b", above)
                    if m:
                        found.setdefault(f"{m[1]} {m[2]}", n)
                        break
    return found


def schedule_pages(path):
    found = {}
    for n, page in enumerate(pdf_pages(path), 1):
        for m in re.finditer(rf"^\s*({SUBJECTS})\s+(H?\d{{3}}[A-Z0-9]*)\s+\S.*?\s+\d+(?:\s*-\s*\d+)?\s*cr\b", page, re.M):
            found.setdefault(f"{m[1]} {m[2]}", n)
    return found


def eligibility_pages(path):
    found = {}
    for n, page in enumerate(pdf_pages(path), 1):
        # A row's code is at the left margin; further in, a wrapped prerequisite can start with a code.
        for m in re.finditer(rf"^ {{0,5}}({SUBJECTS})\s+(H?\d{{3}}[A-Z0-9]*)\b", page, re.M):
            found.setdefault(f"{m[1]} {m[2]}", n)
    return found


def description_anchors(path):
    text = open(path, errors="replace").read()
    found = {}
    for attrs, subj, num in re.findall(rf"<h2>\s*(?:<a([^>]*)>)?\s*{ID}\s*:", text):
        name = re.search(r'name="([^"]+)"', attrs or "")
        found.setdefault(f"{subj} {num}", name[1] if name else "")
    return found


def locate(name):
    path = os.path.join(PDFS, name)
    kind = re.search(r"descriptions|schedule|eligibility", name)[0]
    if name.endswith(".html"):
        if kind == "schedule":
            return {code: "" for code in parse_schedule_html(path)}
        return description_anchors(path)
    return {"descriptions": description_pages, "schedule": schedule_pages, "eligibility": eligibility_pages}[kind](path)


def read_sources():
    """(where each file came from, known problems) from pdfs/SOURCES.md."""
    text = open(os.path.join(PDFS, "SOURCES.md")).read()
    origins = {}
    for name, origin, url in re.findall(r"^\| `([^`]+)` \| (.+?) \| (\S+) \|$", text, re.M):
        origins[name] = {"origin": origin, "url": url}
    problems = text.split("## Known problems with the originals", 1)[1]
    notes = re.findall(r"^- \*\*(.+?):\*\* (.+)$", problems, re.M)
    return origins, [{"about": about, "text": body.replace("`", "")} for about, body in notes]


def squeeze(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def page_texts(name, cache={}):
    """Each page's text without its headers and footers, or one long page for a saved web page."""
    if name not in cache:
        path = os.path.join(PDFS, name)
        if name.endswith(".html"):
            cache[name] = [strip_tags(open(path, errors="replace").read())]
        else:
            cache[name] = [" ".join(ln for ln in page.split("\n") if not is_furniture(ln)) for page in pdf_pages(path)]
    return cache[name]


def text_checks(pages):
    """Is each course's text on that course's own page of its document (or the page after, if it runs over)?

    SPIRE's table has columns that interleave in plain text, so that field only checks
    that all of its words are there, not their order.
    """
    with open(os.path.join(ROOT, "history-data.js")) as f:
        history = json.loads(f.read().split("window.HISTORY = ", 1)[1].rstrip().rstrip(";"))
    files = {t["id"]: t["files"] for t in history["terms"]}
    out = {k: {"checked": 0, "matched": 0, "misses": []} for k in ("desc", "pre", "spire")}

    def nearby(name, code):
        place = pages[name].get(code)
        texts = page_texts(name)
        return " ".join(texts[place - 1:place + 1]) if isinstance(place, int) else " ".join(texts)

    def record(kind, found, term, code):
        out[kind]["checked"] += 1
        out[kind]["matched" if found else "misses"] += 1 if found else 0
        if not found:
            out[kind]["misses"].append([term, code])

    for course in history["courses"]:
        for term, o in course["offerings"].items():
            name = EXTRA_DESCRIPTIONS if o.get("regenerated") else files[term]["descriptions"]
            for field in ("desc", "pre"):
                if o.get(field):
                    record(field, squeeze(o[field]) in squeeze(nearby(name, o["code"])), term, o["code"])
            spire = (o.get("elig") or {}).get("pre")
            if spire:
                there = set(re.findall(r"[a-z0-9]+", nearby(files[term]["eligibility"], o["code"]).lower()))
                record("spire", set(re.findall(r"[a-z0-9]+", spire.lower())) <= there, term, o["code"])
    return out


def main():
    origins, problems = read_sources()
    pages = {}
    for term in TERMS:
        for kind in ("descriptions", "schedule", "eligibility"):
            name = next((f for f in (f"{term}-{kind}.pdf", f"{term}-{kind}.html") if os.path.exists(os.path.join(PDFS, f))), None)
            if name:
                pages[name] = locate(name)
    pages[EXTRA_DESCRIPTIONS] = locate(EXTRA_DESCRIPTIONS)
    data = {"pages": pages, "origins": origins, "problems": problems, "textChecks": text_checks(pages)}
    print("// Generated by tools/build_verify.py from the documents in pdfs/.")
    print("window.VERIFY_SOURCES = " + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";")


main()
