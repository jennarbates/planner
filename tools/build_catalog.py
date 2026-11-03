#!/usr/bin/env python3
"""Build planner/catalog.js from the CICS PDFs and the course offering plan.

Usage (from the repo root):
    pdftotext -layout F26coursedescription.pdf /tmp/F26.txt
    pdftotext -layout S27coursedescription.pdf /tmp/S27.txt
    curl -sL -o /tmp/offering.html https://content.cs.umass.edu/content/course-offering-plan
    python3 planner/tools/build_catalog.py /tmp/offering.html /tmp/F26.txt /tmp/S27.txt > planner/catalog.js

Description files are recognised as Fall/Spring by "F"/"S" at the start of
their file name. Prerequisite text in the PDFs is prose, so the structured
prerequisite expressions live in PREREQS below and are maintained by hand.

Expression syntax: course ids joined by & (and) and | (or), with parentheses.
Prefix an id with ~ when it may be taken concurrently (corequisite).
"""
import html
import json
import os
import re
import sys

# Hand-written from the prerequisite text in the F26/S27 descriptions.
# Where a course lists separate CS-major and INFORM-major paths, the CS path is used.
# Retired course numbers (COMPSCI 121/186/187, INFO 190S/T, ...) are left out.
PREREQS = {
    "CICS 160": "CICS 110",
    "CICS 210": "CICS 160",
    "CICS 256": "CICS 210",
    "CICS 305": "ENGLWRIT 112 & COMPSCI 220 & COMPSCI 230 & (COMPSCI 240 | COMPSCI 250)",
    "COMPSCI 198C": "CICS 160",
    "COMPSCI 220": "CICS 210",
    "COMPSCI 230": "CICS 210 & COMPSCI 198C",
    "COMPSCI 240": "CICS 160 & MATH 132",
    "COMPSCI 250": "CICS 160 & MATH 132",
    "COMPSCI 311": "CICS 210 & (COMPSCI 250 | MATH 455)",
    "COMPSCI 320": "COMPSCI 220",
    "COMPSCI 325": "CICS 210 | (INFO 248 & CICS 160)",
    "COMPSCI 326": "COMPSCI 220",
    "COMPSCI 328": "CICS 210",
    "COMPSCI 335": "COMPSCI 220 | COMPSCI 230",
    "COMPSCI 345": "CICS 210",
    "COMPSCI 348": "CICS 210 & COMPSCI 240 & (COMPSCI 250 | MATH 455)",
    "COMPSCI 349": "CICS 210 & (COMPSCI 220 | COMPSCI 230 | INFO 248) & (COMPSCI 240 | STATISTC 240 | STATISTC 315)",
    "COMPSCI 360": "COMPSCI 230",
    "COMPSCI 363": "COMPSCI 230 & ENGLWRIT 112",
    "COMPSCI 367": "COMPSCI 230",
    "COMPSCI 377": "COMPSCI 230",
    "COMPSCI 383": "CICS 210 & (COMPSCI 240 | STATISTC 315)",
    "COMPSCI 389": "CICS 210 & (COMPSCI 240 | STATISTC 315 | STATISTC 240) & MATH 132",
    "COMPSCI 412": "MATH 132 & MATH 235 & (COMPSCI 240 | STATISTC 315 | PHYSICS 281 | PHYSICS 287)",
    "COMPSCI 420": "COMPSCI 320 | COMPSCI 326",
    "COMPSCI 426": "COMPSCI 320 | COMPSCI 326",
    "COMPSCI 445": "(COMPSCI 220 | COMPSCI 230) & COMPSCI 311 & COMPSCI 345",
    "COMPSCI 446": "COMPSCI 240 | COMPSCI 383",
    "COMPSCI 453": "COMPSCI 230 | COMPSCI 377",
    "COMPSCI 461": "COMPSCI 326 | COMPSCI 345 | COMPSCI 377 | COMPSCI 453",
    "COMPSCI 466": "COMPSCI 311",
    "COMPSCI 485": "(COMPSCI 220 & COMPSCI 240) | LINGUIST 429B",
    "COMPSCI 490M": "((COMPSCI 240 | STATISTC 315) & COMPSCI 311) | (COMPSCI 240 & STATISTC 315 & COMPSCI 311 & MATH 233 & MATH 235)",
    "COMPSCI 491G": "COMPSCI 453",
    "COMPSCI 491P": "COMPSCI 250 & (COMPSCI 383 | COMPSCI 389)",
    "COMPSCI 501": "COMPSCI 311",
    "COMPSCI 514": "((COMPSCI 240 | STATISTC 315) & COMPSCI 311) | (COMPSCI 240 & STATISTC 315 & COMPSCI 311 & MATH 233 & MATH 235)",
    "COMPSCI 515": "COMPSCI 240 & COMPSCI 250",
    "COMPSCI 520": "COMPSCI 320 | (COMPSCI 220 & COMPSCI 326)",
    "COMPSCI 532": "COMPSCI 377 & COMPSCI 445",
    "COMPSCI 535": "COMPSCI 335",
    "COMPSCI 550": "CICS 210 & STATISTC 315",
    "COMPSCI 561": "(COMPSCI 360 | COMPSCI 560 | COMPSCI 660) & COMPSCI 453",
    "COMPSCI 563": "COMPSCI 311 | COMPSCI 383 | COMPSCI 360",
    "COMPSCI 564": "COMPSCI 230 & (COMPSCI 360 | COMPSCI 365 | COMPSCI 466)",
    "COMPSCI 565": "COMPSCI 365 | COMPSCI 377",
    "COMPSCI 571": "COMPSCI 220 | COMPSCI 230 | COMPSCI 326",
    "COMPSCI 575": "COMPSCI 250 | MATH 455",
    # STATISTC 315 may be skipped with a B+ in COMPSCI 240; MATH 545 with B+ in MATH 233 and 235.
    "COMPSCI 589": "(MATH 545 | (MATH 233 & MATH 235)) & COMPSCI 240 & (STATISTC 315 | COMPSCI 240)",
    "COMPSCI 590AF": "COMPSCI 230",
    "COMPSCI 590NN": "COMPSCI 311 | COMPSCI 389 | COMPSCI 589",
    "COMPSCI 590Q": "MATH 235",
    "COMPSCI 590QC": "MATH 235 & (COMPSCI 240 | STATISTC 315)",
    "COMPSCI 590X": "((COMPSCI 240 | STATISTC 315) & CICS 210) | INFO 348",
    "COMPSCI 601": "COMPSCI 501",
    "COMPSCI 611": "COMPSCI 311",
    "COMPSCI 621": "COMPSCI 320",
    "COMPSCI 677": "CICS 210",
    "INFO 248": "(CICS 110 | CICS 160 | COMPSCI 119) & (STATISTC 240 | STATISTC 315 | COMPSCI 240)",
    "INFO 324": "INFO 248 | STATISTC 315 | COMPSCI 240",
    "INFO 348": "INFO 248 & CICS 160",
    "INFO 494PI": "(INFO 248 | COMPSCI 240) & CICS 210",
}

# Non-CICS courses from the BS-CS tracking form and prerequisite lists.
# Not in the CICS PDFs: credits, offerings and prerequisites should be verified on SPIRE.
EXTRA = [
    ("MATH 131", "Calculus I", 4, "FS", ""),
    ("MATH 132", "Calculus II", 4, "FS", "MATH 131"),
    ("MATH 233", "Multivariate Calculus", 4, "FS", "MATH 132"),
    ("MATH 235", "Linear Algebra", 3, "FS", "MATH 132"),
    ("MATH 411", "Modern Algebra", 3, "", ""),
    ("MATH 455", "Discrete Mathematics", 3, "", ""),
    ("MATH 545", "Linear Algebra for Applied Math", 3, "", "MATH 233 & MATH 235"),
    ("STATISTC 240", "Introduction to Statistics", 3, "FS", ""),
    ("STATISTC 315", "Statistics I", 3, "FS", "MATH 132"),
    ("ENGLWRIT 112", "College Writing", 3, "FS", ""),
    ("CHEM 111", "General Chemistry I", 4, "", ""),
    ("CHEM 112", "General Chemistry II", 4, "", "CHEM 111"),
    ("PHYSICS 151", "General Physics I", 4, "", ""),
    ("PHYSICS 152", "General Physics II", 4, "", "PHYSICS 151"),
    ("GEOL 101", "Planet Earth", 4, "", ""),
]

FREQ = {
    "Fall and Spring": "FS", "Fall": "F", "Spring": "S",
    "Even Fall": "F-even", "Odd Fall": "F-odd",
    "Even Spring": "S-even", "Odd Spring": "S-odd",
}


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def parse_offering(path):
    out = {}
    for row in re.findall(r"<tr.*?</tr>", open(path).read(), re.S):
        cells = [clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) == 5:
            subj, num, title, cr, freq = cells
            out[f"{subj} {num}"] = {"title": title, "credits": cr, "offered": FREQ.get(freq, "")}
    return out


def parse_descriptions(path):
    term = os.path.basename(path)[0].upper()
    blocks, cur = [], None
    for ln in open(path).read().split("\n"):
        if re.search(r"---\s+page \d+\s+---", ln) or "UMassAmherst" in ln or "Manning College" in ln:
            continue
        m = re.match(r"^\s{0,4}([A-Z]{3,9}) (H?\d{3}[A-Z0-9]*)\s{1,3}(\S.*)$", ln)
        if m and not ln.strip().endswith(".") and len(ln.strip()) < 60:
            cur = {"id": f"{m[1]} {m[2]}", "title": m[3].strip(), "body": ""}
            blocks.append(cur)
        elif cur and ln.strip() and not ln.strip().startswith("INSTRUCTOR"):
            cur["body"] += " " + ln.strip()
    out = {}
    for b in blocks:
        if " H" in b["id"]:  # honors colloquium sections attached to a regular course
            continue
        body = re.sub(r"\s+", " ", b["body"]).strip()
        cr = re.search(r"(\d+)(?:-\d+)? credits?\.?$", body)
        pre = re.search(r"(Prerequisites?:.*?)(?=\s\d+(?:-\d+)? credits?\.?$|$)", body)
        text = pre[1] if pre else ""
        out[b["id"]] = {"title": b["title"], "credits": cr[1] if cr else None, "prereqText": text, "term": term}
    return out


def main():
    offering = parse_offering(sys.argv[1])
    desc = {}
    for path in sys.argv[2:]:
        for cid, d in parse_descriptions(path).items():
            prev = desc.get(cid)
            if prev:
                prev["terms"].add(d["term"])
                if len(d["prereqText"]) > len(prev["prereqText"]):
                    prev["prereqText"] = d["prereqText"]
            else:
                d["terms"] = {d.pop("term")}
                desc[cid] = d

    catalog = {}
    for cid in sorted(set(offering) | set(desc)):
        o, d = offering.get(cid, {}), desc.get(cid, {})
        offered = o.get("offered")
        if offered is None:  # not in the offering plan: infer from which term's PDF listed it
            offered = "".join(t for t in "FS" if t in d.get("terms", ()))
        notes = d.get("prereqText", "")
        if not d:
            notes = "Not in the F26/S27 course descriptions; prerequisites unknown."
        catalog[cid] = {
            "id": cid,
            "title": o.get("title") or d.get("title", ""),
            "credits": int(d.get("credits") or o.get("credits") or 3),
            "offered": offered,
            "prereq": PREREQS.get(cid, ""),
            "notes": notes,
        }
    for cid, title, cr, offered, prereq in EXTRA:
        catalog.setdefault(cid, {
            "id": cid, "title": title, "credits": cr, "offered": offered, "prereq": prereq,
            "notes": "Added from the BS-CS tracking form; verify credits and prerequisites on SPIRE.",
        })

    missing = sorted({t for p in PREREQS.values() for t in re.findall(r"[A-Z&-]+ \d{3}[A-Z0-9]*", p)} - set(catalog))
    if missing:
        print("warning: prereqs reference courses not in catalog:", ", ".join(missing), file=sys.stderr)

    print("// Generated by tools/build_catalog.py; edit PREREQS there rather than here.")
    print("window.CATALOG = " + json.dumps(list(catalog.values()), indent=1) + ";")


main()
