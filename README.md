# CICS Course History

Open `index.html` in a browser to see how CICS, COMPSCI and INFO courses have changed from Fall 2022 to Spring 2027. There is no build step or server. The course planner is a side feature at `planner.html`, linked from the top of the page.

## Course history

`index.html` (also linked from the planner's sidebar and from each CICS, COMPSCI and INFO course's details there) compares how courses changed: when each was listed, and what changed in its prerequisites, credits, title, number, description and eligibility. Click a summary number or a chart bar to list the courses behind it, such as those not listed lately and how long they've been gone. Select a course to see what's current, which stays pinned as you scroll, and a dated list of what changed. Below that is its whole history, term by term, with word-level differences from the previous listing and the full text and source documents for each term. The **Compare two terms** tab compares any two of its listings directly.

The chart of where experimental courses ended up shows how many became permanent, are still running or are no longer listed. `map.html` is a prerequisite map with a term slider. It opens on one course at a time, showing what it builds on and what it leads to, and clicking a course moves to it. **Whole map** shows every connection at once. Both show what was added or dropped compared with another term. An arrow means a course's prerequisites name another course, which can be a requirement or one of several options.

`history-data.js` is generated from the documents saved in `pdfs/` (`pdfs/SOURCES.md` says where each came from):

```
python3 -I tools/build_history.py > history-data.js
```

Some caveats:

- CICS reused the file addresses of the Fall 2025 description and schedule PDFs for Spring 2027, so those two terms' files come from its Fall 2025 web pages instead.
- Fall 2022 uses the May 2022 PDF. CICS regenerated that document in January 2024 with later course numbers and wording, so the 2024 copy only supplies two seminars the May copy lacks.
- A prerequisite counts as changed when the courses or minimum grades named in SPIRE differ (the catalog text where SPIRE has no entry), or when CICS lists the change. Anything else is treated as wording.
- Renumbered courses are merged when CICS lists the change, on either its New Course Numbers or its changes page. Four pairs missing from those lists are merged by hand (`SAME_COURSE` in the script), with the reason shown on the page: three because SPIRE's notes give the previous number, and one because its title and description match. A reused topic number with an unrelated title and description becomes a separate row.
- Courses whose latest number has a letter (`COMPSCI 590X`, `COMPSCI 198C`) are treated as experimental and kept out of the numbers unless chosen under **Category**. A course that later got a plain number counts as regular for all of its terms.
- Each change has a short summary generated from the documents' own text: it quotes what was added or removed, and states who gained or lost access only when the wording makes that clear.
- Honors colloquia are left out, as they are in `catalog.js`.

## Course planner

- **Adding courses:** search the list on the left, then click **+** to add a course to the "Add to" semester, or drag it onto a column. Any missing prerequisites are added automatically, each in the latest earlier semester in which it's offered. Auto-added courses have a dashed border, and they're removed again when nothing in the plan needs them. Dragging one, or clicking "Keep even if not needed", makes it a regular course.
- **Moving courses:** drag nodes between columns, or change the semester in the details panel. **Transfer / AP / Waived** holds courses you already have. Select one to set it as transfer/AP credit or waived; waived courses count for no credit but still satisfy prerequisites. Prerequisites of courses in this column aren't checked. **Unscheduled** holds courses you haven't placed. Courses in semesters removed by lowering the semester count go there too.
- **Alternative prerequisites:** select a course to see its prerequisite tree. Each "One of" group has a radio button per alternative. **auto** picks the first alternative that's already satisfied, otherwise the first one already in the plan, otherwise the first listed.
- **Waiving a single prerequisite:** in a course's prerequisite tree, hover a prerequisite and click **waive**. It's then treated as satisfied for that course only: it isn't auto-added, has no edge, and doesn't raise a warning. Other courses that need it are unaffected. Click **unwaive** to require it again.
- **Warnings:** a course gets a ⚠ badge if a prerequisite is missing or in the wrong semester, or if it isn't usually offered that term. A column header turns orange when it's above the max or below the min credits.
- **Saving:** the plan autosaves to the browser's localStorage. **Save** downloads it as JSON and **Open** loads a saved file. Edited and custom courses are stored in the file.
- **Editing courses:** "Edit course" in the details panel changes a course's credits, offering term or prerequisites for this plan only. "New course" adds one that isn't in the catalog (gen eds, etc.).

## Prerequisite expressions

```
CICS 210 & (COMPSCI 250 | MATH 455)
((COMPSCI 240 | STATISTC 315) & COMPSCI 311) | (COMPSCI 240 & STATISTC 315 & COMPSCI 311 & MATH 233 & MATH 235)
~COMPSCI 250          # ~ = may be taken in the same semester
```

`and`, `or` and `,` also work. `&` binds tighter than `|`.

## Catalog data

`catalog.js` is generated by `tools/build_catalog.py` (see the usage notes at the top of that file) from:

- `F26coursedescription.pdf` / `S27coursedescription.pdf`: titles, credits and prerequisite text.
- The [course offering plan](https://content.cs.umass.edu/content/course-offering-plan): when courses are offered.

The structured prerequisites are in `PREREQS` in that script and were written by hand from the PDF text. Some caveats:

- Where a course has separate CS-major and INFORM-major prerequisites, the CS path is used.
- Retired course numbers (COMPSCI 121/186/187, INFO 190T, ...) are left out.
- Grade conditions (e.g. "B+ in COMPSCI 240 lets you skip STATISTC 315") become alternatives where possible. The full catalog text is shown in the details panel.
- Courses in the offering plan but not in either PDF have unknown prerequisites.
- Non-CICS courses (MATH, STATISTC, ENGLWRIT, lab sciences) were added by hand. Verify them on SPIRE.
