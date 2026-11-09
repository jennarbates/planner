#!/usr/bin/env python3
"""Copy the site into a publishable folder for a private claude.ai link.

Usage (from the planner folder):
    python3 -I tools/build_site.py . <folder outside this project>

The output folder is deleted and rebuilt each time, so give it one used only for this.
Publish the result to the same link so it keeps its address (see the README).
The project files stay as they are. Differences in the copy:
- Source links go to the original documents, so pdfs/ isn't published.
- The data reliability page links to the originals too.
- Colors follow the viewer's theme setting as well as the system one.
- Planner buttons that rely on downloads or confirm() work within the viewer's limits.
"""
import json
import os
import re
import shutil
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
FILES = ["index.html", "map.html", "planner.html", "history.js", "map.js", "app.js", "catalog.js",
         "history-data.js", "style.css", "history.css", "map.css",
         "verify.html", "verify.js", "verify.css", "verify-data.js"]
UNOFFICIAL = "This is an unofficial comparison, not a CICS publication."


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def replace(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label}: expected text not found: {old[:70]}")
    return text.replace(old, new)


def theme_aware(css):
    """Rewrite prefers-color-scheme blocks so an explicit theme choice wins either way."""
    css = css.replace("color-scheme: light dark;", "color-scheme: light;")
    out, i = [], 0
    marker = "@media (prefers-color-scheme: dark)"
    while True:
        start = css.find(marker, i)
        if start < 0:
            out.append(css[i:])
            return "".join(out)
        out.append(css[i:start])
        open_at = css.index("{", start)
        depth, j = 1, open_at + 1
        while depth:
            depth += {"{": 1, "}": -1}.get(css[j], 0)
            j += 1
        body = css[open_at + 1:j - 1]
        media, explicit = [], []
        for sel, decls in re.findall(r"([^{}]+)\{([^{}]*)\}", body):
            parts = [s.strip() for s in sel.split(",")]
            is_root = parts == [":root"]
            if is_root:
                decls = decls.rstrip() + " color-scheme: dark; "
            guard = ":root:not([data-theme=\"light\"])"
            dark = ":root[data-theme=\"dark\"]"
            media.append(f"  {guard if is_root else ', '.join(f'{guard} {s}' for s in parts)} {{{decls}}}\n")
            explicit.append(f"{dark if is_root else ', '.join(f'{dark} {s}' for s in parts)} {{{decls}}}\n")
        out.append(f"{marker} {{\n{''.join(media)}}}\n{''.join(explicit)}")
        i = j


def source_urls():
    urls = {}
    for line in read("pdfs/SOURCES.md").splitlines():
        m = re.match(r"\| `([^`]+)` \| .*? \| (https?://\S+) \|$", line)
        if m:
            urls[m[1]] = m[2]
    return urls


source, output = os.path.abspath(SRC), os.path.abspath(OUT)
if os.path.commonpath([source, output]) in (source, output):
    raise SystemExit("the output folder can't be inside the project or contain it")
if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT)

for name in FILES:
    text = read(name)
    if name.endswith(".css"):
        text = theme_aware(text)
    if name == "map.html":
        text = replace(text, "which may be a requirement or one of several options.</p>",
                       f"which may be a requirement or one of several options. {UNOFFICIAL}</p>", name)
    if name == "history.js":
        text = replace(text, '`<a href="pdfs/${encodeURIComponent(file)}" target="_blank" rel="noopener">${esc(text)}</a>`',
                       '`<a href="${esc(window.SOURCE_URLS[file])}" target="_blank" rel="noopener">${esc(text)}</a>`', name)
        text = replace(text, '<a href="pdfs/${encodeURIComponent(f)}" target="_blank" rel="noopener">${html ? "HTML copy" : "PDF"}</a>',
                       '<a href="${esc(window.SOURCE_URLS[f])}" target="_blank" rel="noopener">${html ? "Web page" : "PDF"}</a>', name)
        text = replace(text, "Every file is saved in the <code>pdfs/</code> folder. <code>pdfs/SOURCES.md</code> lists where each one came from.",
                       "These links open the originals on the CICS site or in the Wayback Machine.", name)
        text = replace(text, "Another ${separateTotal} experimental courses, seminars and practicums are kept separate.`",
                       f"Another ${{separateTotal}} experimental courses, seminars and practicums are kept separate. {UNOFFICIAL}`", name)
    if name == "history-data.js":
        urls = source_urls()
        data = json.loads(text.split("=", 1)[1].rstrip().rstrip(";"))
        used = {f for t in data["terms"] for f in t["files"].values() if f} | {"F22-descriptions-2024-01-regenerated.pdf", "new-course-numbers.html", "course-changes.html"}
        missing = sorted(used - set(urls))
        if missing:
            raise SystemExit(f"no source address for {missing}")
        text += "window.SOURCE_URLS = " + json.dumps({f: urls[f] for f in sorted(used)}) + ";\n"
    if name == "verify.html":
        # CICS's own addresses download the file, so a link can't always open at the page.
        text = replace(text, "Click a document link to read the original at that course's page, next to the data.",
                       "Its links go to the original documents, with the page number to look at.", name)
    if name == "verify.js":
        text = replace(text, "return `pdfs/${encodeURIComponent(file)}${fragment}`;", "return `${window.SOURCE_URLS[file]}${fragment}`;", name)
        text = replace(text, "const SHOW_DOCUMENTS_HERE = true;", "const SHOW_DOCUMENTS_HERE = false;", name)
        text = replace(text, "its prerequisites were written by hand from those documents.`", f"its prerequisites were written by hand from those documents. {UNOFFICIAL}`", name)
    if name == "app.js":
        text = replace(text, "  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));",
                       "  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plan)); } catch {}", name)
        text = replace(text, "setDetailsHeight(+localStorage.getItem(DETAILS_HEIGHT_KEY) || 280);",
                       "let savedDetailsHeight = 0;\ntry { savedDetailsHeight = +localStorage.getItem(DETAILS_HEIGHT_KEY); } catch {}\nsetDetailsHeight(savedDetailsHeight || 280);", name)
        text = replace(text, '    localStorage.setItem(DETAILS_HEIGHT_KEY, $("#details").offsetHeight);',
                       '    try { localStorage.setItem(DETAILS_HEIGHT_KEY, $("#details").offsetHeight); } catch {}', name)
        # The viewer ignores confirm() and blocks downloads the page starts.
        text = replace(text, "let toastTimer;\n", '''let toastTimer;
let pendingConfirm = null;
function confirmByClickingTwice(key, message) {
  if (pendingConfirm === key) {
    pendingConfirm = null;
    return true;
  }
  pendingConfirm = key;
  toast(`${message} Click again to confirm.`);
  setTimeout(() => { if (pendingConfirm === key) pendingConfirm = null; }, 6000);
  return false;
}
''', name)
        text = replace(text, 'if (confirm(`Delete ${id} from your courses?`)) {',
                       'if (confirmByClickingTwice(`delete:${id}`, `Delete ${id} from your courses?`)) {', name)
        text = replace(text, '!confirm("Start a new plan? Save this one first if you want to keep it."))',
                       '!confirmByClickingTwice("new", "Start a new plan? Copy this one first if you want to keep it."))', name)
        save = text[text.index('$("#btn-save").addEventListener'):text.index('$("#btn-open").addEventListener')]
        text = text.replace(save, '''$("#btn-save").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
    toast("Copied this plan. Paste it into a .json file to keep it, and load that file with Open.");
  } catch {
    toast("Couldn't copy the plan here. It still autosaves in this browser.");
  }
});

''')
    if name == "planner.html":
        text = replace(text, '<button id="btn-save" type="button">Save</button>', '<button id="btn-save" type="button">Copy plan</button>', name)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(text)
print("built", OUT, sum(os.path.getsize(os.path.join(OUT, n)) for n in FILES), "bytes")
