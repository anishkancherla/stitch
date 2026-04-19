# Stitch — Ribbon Migration Guide

**Purpose:** Switch the primary UI from a concept×lecture heatmap grid to a ribbon + threads model. This is a **rendering-layer migration**, not a rearchitecture. The backend, data model, extraction pipelines, quiz logic, and mastery math all stay exactly the same.

This guide is intended to be given to another LLM or developer along with the main `stitch_spec.md`. It explains what to change and why, section by section.

---

## 1. Why the migration

The heatmap (concept rows × lecture columns) worked but had two problems:

1. **"Stitch" didn't read visually.** The whole product is named after a matching metaphor, but the heatmap displayed stitches as awkward cell-pair highlights. Users had to be told what a stitch was — they couldn't see one.
2. **Lots of dead space.** Most cells were empty ("not covered this lecture"), so the grid felt sparse and wasted screen space.

The ribbon model solves both:

- **Stitches are literally drawn as threads** between two students' ribbons. The name pays off the moment you open the app.
- **No empty cells.** The ribbon only contains subconcepts that actually exist. It's dense by construction.

---

## 2. What stays unchanged

The following are untouched by this migration. Do not modify them:

- **Data model** — `concepts`, `subconcepts`, `lectures`, `user_subconcept_mastery`, `quizzes`, `quiz_questions`, `quiz_attempts`, `quiz_responses`, `mastery_events`, `study_groups`, `group_members` all stay as defined in `stitch_spec.md` §3.
- **Extraction pipelines** — syllabus → concepts, lecture → subconcepts, subconcept → quiz questions. All same.
- **Quiz workflow** — professor generates, tweaks, publishes; student takes; mastery updates. All same.
- **Mastery update rules** — the +0.08 / +0.12 / +0.18 / -0.15 deltas from §5.3 stay as-is.
- **Stitch score math** — the pairwise scoring formula in §2.4 still applies. What changes is only how stitches are *visualized*.
- **Group formation algorithm** — greedy + local-search stays identical.

---

## 3. The ribbon concept

### 3.1 What a ribbon is

One student = one horizontal ribbon. A ribbon is a single row of colored cells, each cell representing one subconcept, colored by that student's mastery on that subconcept. Cells are grouped by parent concept with subtle dividers between groups.

```
YOU
┌──────────────────────┬───────────────┬─────────────────┬─────────────┬───
│ Complexity Analysis  │ Arrays & LL   │ Stacks & Queues │ Recursion   │ ...
│ ▓ ▓ ▒ ░ ▓ ▓ ▒ ░      │ ▒ ▒ ▓         │ ░ ░ ▒           │ (empty)     │
└──────────────────────┴───────────────┴─────────────────┴─────────────┴───

▓ = mastery ≥ 0.7 (green)
▒ = mastery 0.4–0.7 (yellow)
░ = mastery < 0.4 (red)
```

### 3.2 Key properties

- **One cell per subconcept.** Each subconcept in the course has exactly one fixed position in every student's ribbon (same subconcept_id → same position).
- **Grouped by concept.** Subconcepts under the same parent concept are contiguous. Concept name is a label above or below the group.
- **Chronologically ordered within each group.** Subconcepts appear in the order their lectures were uploaded.
- **No empty cells.** If a concept has no subconcepts yet (no lectures uploaded covering it), the group is collapsed or hidden — no "not covered" placeholders.
- **Stable positions across students.** Cell N in Student A's ribbon is the same subconcept as cell N in Student B's ribbon. This is what makes threads possible.

### 3.3 Why this replaces the heatmap

The heatmap encoded time (lectures) on the x-axis and concept on the y-axis. The ribbon flattens this into one axis (grouped by concept, chronological within). You lose the "time as a column" reading, but you gain:
- One clean strip instead of a sparse grid
- Natural stacking for comparison (pairs, groups, class)
- A surface that threads can connect to

If the time dimension needs to be surfaced, it can be shown on hover (tooltip: "Added in Lecture 3") or in the concept drilldown view (§5.5).

---

## 4. Threads — the stitch made visual

### 4.1 What a thread is

When two or more ribbons are displayed together, a **thread** is drawn between two cells where the stitch condition is met:

> Cell is a stitch if: one student has mastery ≥ 0.7 and another has mastery < 0.4 on the same subconcept.

Each qualifying cell-pair gets one thread. The thread is literally a curve connecting the two cells.

```
YOU     ▓   ▒   ░   ▓   ░   ▒   ▓   ▓   ▒   ░
             │        │              │
             │ stitch │  stitch      │ stitch     ← curves between cells
             ▼        ▼              ▼
THEM    ░   ▒   ▓   ▒   ▓   ░   ▓   ▒   ▓   ▓
```

### 4.2 Thread properties

- **Directional.** Arrow points toward the student receiving help (the weak one). Optionally, color encodes direction:
  - Teal thread, arrow pointing down → the student below teaches the one above
  - Pink thread, arrow pointing up → the student above teaches the one below
- **Curved, not straight.** Bezier curves look more "stitch-like" and avoid visual clutter when many threads exist close together.
- **Rendered in SVG overlay** on top of the ribbon stack. Ribbons themselves are HTML/CSS; threads are SVG.
- **Hover interactions.**
  - Hover a thread → highlight both connected cells + show a tooltip ("You teach them: Memoization vs tabulation")
  - Hover a cell → highlight all threads attached to it

### 4.3 Why threads matter

The name "Stitch" becomes self-explanatory the moment someone sees two ribbons with threads between them. No tutorial needed. The UI *is* the metaphor.

---

## 5. Views — each one rendered from the ribbon primitive

All five views use the same underlying components. They differ only in which ribbons are shown and which threads are drawn.

### 5.1 Solo view (student home)

One ribbon — the current student's mastery.

- No threads (nothing to connect to).
- Cell colors = mastery (red/yellow/green).
- Click a cell → side panel with subconcept detail, description, recent quiz performance, parent concept.
- Click a concept label → zoom into concept drilldown (see §5.5).

### 5.2 Pair view (stitch view) — primary matching feature

Two ribbons stacked vertically (yours on top, theirs below). Threads drawn between all stitch cells.

- **Header:** "Stitch score: 4.2 · 6 stitches · Alex Chen"
- **Ribbon 1:** your mastery, normal color scale
- **Thread layer:** SVG overlay drawing one thread per stitch
- **Ribbon 2:** their mastery, normal color scale
- **Interactions:**
  - Hover thread → highlight both cells, show subconcept name
  - Click thread → side panel with "Here's what you can teach each other on this subconcept"
  - Toggle: "show all stitches" vs "only show stitches that help you" (filters to threads where you're weak)

This view replaces the "true overlay" mode from the original spec's §2.4. It's strictly better — overlay merged two grids into one abstract colored grid. Thread view keeps both students visible and shows *literal connections* between them.

### 5.3 Group view (3–4 students)

Multiple ribbons stacked (e.g., 4 students). Threads drawn between every stitch-eligible pair across the group — so for 4 students, up to 6 pairs of ribbon × many stitches each.

- Each thread still has two endpoints on two specific ribbons.
- **Thread density = group health.** Many threads = lots of mutual teaching potential. Sparse threads = group has overlapping strengths (not ideal).
- Hover a specific ribbon → dim threads not touching that ribbon (reduces clutter).
- Professor drag-to-swap interaction: drag a student out of the group, drag another in → threads recompute live.

### 5.4 Class view

All students' ribbons stacked (20–500+ rows), sorted by stitch potential with the current viewer at top.

- For a student viewing: "classmates ranked by stitch score with you" — topmost classmate is your best match.
- For a professor: ribbons sorted by "how stitchable this student is overall" (number of above-threshold pairs).
- No threads drawn by default at class scale (too many to be legible) — but hover a classmate's ribbon to draw only the threads between them and the viewer.

Alternative: a **single aggregated class ribbon** showing average mastery per subconcept. Useful for professors to see "class weak spots" — same role the old class heatmap played.

### 5.5 Concept drilldown

Triggered by clicking a concept label in any view. Zooms into just that concept's subconcepts, enlarged.

- Horizontal strip of larger cells (one per subconcept under this concept)
- Each cell shows: subconcept name, current mastery, lecture it came from, recent quiz performance as a sparkline
- For pair/group views: threads within this concept only, clearly labeled

This is the "time axis" resurrected — concept drilldown shows subconcepts in chronological order with the lecture context visible, replacing what the old heatmap's lecture columns offered.

---

## 6. Component structure (React)

New components to build, replacing the old heatmap components:

### 6.1 `<Ribbon />`

Renders one student's ribbon.

```tsx
interface RibbonProps {
  studentId: string;
  concepts: ConceptWithSubconcepts[];  // ordered concept list with subconcepts nested
  mastery: Map<subconceptId, number>;  // 0.0–1.0 per subconcept
  highlightedCells?: Set<subconceptId>;
  onCellClick?: (subconceptId) => void;
  onConceptClick?: (conceptId) => void;
  compact?: boolean;  // for class view, show thinner cells
}
```

Renders an HTML flex container with colored divs for cells. Cells within the same parent concept share a background "group" div with a subtle divider between groups. Concept labels render above (or below) each group.

### 6.2 `<RibbonStack />`

Renders multiple ribbons stacked, with a thread overlay between them.

```tsx
interface RibbonStackProps {
  students: StudentRibbon[];  // array of ribbon data
  showThreads: boolean;
  threadFilter?: 'all' | 'helps-viewer' | 'in-group';
  viewerId?: string;
}
```

Internally: renders one `<Ribbon />` per student, positions them vertically, computes all stitch pairs across the stack, renders `<ThreadLayer />` as an absolutely-positioned SVG on top.

### 6.3 `<ThreadLayer />`

SVG overlay drawing threads between ribbons.

```tsx
interface ThreadLayerProps {
  stitches: Stitch[];  // { from: {studentId, cellId}, to: {studentId, cellId} }
  ribbonPositions: Map<studentId, DOMRect>;  // measured positions
  cellPositions: Map<cellId, DOMRect>;  // measured cell positions
}
```

For each stitch, calculates the two cell center points and draws a cubic bezier between them. Arrow marker at the receiving end. Thread color by direction (teal/pink).

Implementation notes:
- Use `ResizeObserver` or `getBoundingClientRect()` to measure cell positions after render
- Recompute positions on viewport resize
- Use SVG `<path>` with `d="M x1,y1 C cx1,cy1 cx2,cy2 x2,y2"` for smooth curves
- Add `<marker>` definitions for directional arrows

### 6.4 `<StitchHeader />`

Shows metadata above a ribbon stack: stitch count, total score, student names, filter toggle.

### 6.5 `<ConceptDrilldown />`

The zoomed-in single-concept view. Renders a larger version of one concept's cells with quiz history sparklines.

### 6.6 `<CellDetailPanel />`

Slide-out panel shown when a cell is clicked. Shows subconcept description, parent concept, lecture it came from, recent quiz responses.

---

## 7. Interactions

### 7.1 Clicks
- **Cell click** → opens `<CellDetailPanel />`
- **Concept label click** → navigates to `<ConceptDrilldown />` for that concept
- **Thread click** (pair/group views) → opens panel showing the mutual-teaching context for that stitch
- **Ribbon click** (class view) → navigates to pair view with that classmate

### 7.2 Hovers
- **Cell hover** → tooltip with subconcept name and exact mastery value; also highlights any threads attached
- **Thread hover** → tooltip with "A teaches B: [subconcept]"; thickens the thread
- **Concept label hover** → highlights the whole concept group across all visible ribbons

### 7.3 Drag (group view, professor)
- Drag a student from outside the group into a group slot → threads recompute and redraw live
- Drag a student out → same
- Live score update in the group header

---

## 8. Color tokens

Cell colors (student mastery) — unchanged:
- `red-400` at mastery < 0.4
- `yellow-400` at 0.4–0.7
- `green-400` at mastery ≥ 0.7
- `gray-200` placeholder only if a subconcept exists but the student has zero signal (rare — default is 0.5 yellow)

Thread colors (new):
- `teal-500` for "the student below teaches the student above"
- `pink-500` for "the student above teaches the student below"
- OR single neutral color (`gray-700` on light bg, `gray-300` on dark bg) with directional arrow — less visual noise, less info density

Choose one — A/B test later if needed.

---

## 9. Technical rendering

### 9.1 Ribbon itself
Plain Tailwind CSS. Flexbox row of cells. No libraries needed.

```tsx
<div className="flex gap-[1px] items-center">
  {concepts.map(c => (
    <div className="flex gap-[1px] border-l-2 border-gray-300 pl-2 mr-3">
      {c.subconcepts.map(sc => (
        <div
          className={`w-4 h-8 rounded-sm ${colorForMastery(mastery.get(sc.id))}`}
          onClick={() => onCellClick(sc.id)}
        />
      ))}
    </div>
  ))}
</div>
```

### 9.2 Thread layer
SVG absolutely positioned over the ribbon stack container. Z-index above ribbons, pointer-events only on threads themselves (not the empty SVG area).

Measuring cell positions: after mount, use a callback ref on each cell that stores its center coordinates relative to the stack container. Recompute on resize via a shared ResizeObserver at the stack level.

Drawing curves: for each stitch, take cell A's bottom-center and cell B's top-center as endpoints; control points offset vertically so the curve sags naturally.

```tsx
const path = `M ${x1},${y1} C ${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}`;
```

Arrow marker: standard SVG `<marker>` definition, positioned at the end of the path.

### 9.3 Performance
- For solo view: trivial, one ribbon, no threads
- For pair view: one SVG, ~5–20 threads
- For group view (4 students): ~20–50 threads, still fine
- For class view (100 students): don't draw threads by default; draw them only on hover-a-ribbon to show connections from viewer to that student

---

## 10. API changes

Mostly naming:

| Old endpoint | New endpoint |
|---|---|
| `GET /my/courses/:id/heatmap` | `GET /my/courses/:id/ribbon` |
| `GET /my/courses/:id/heatmap/diff` | `GET /my/courses/:id/ribbon/diff` |
| `GET /courses/:id/class-heatmap` | `GET /courses/:id/class-ribbon` |
| `GET /my/courses/:id/stitches/:user_id` | unchanged — returns stitch list for thread rendering |

Response shape change — `/ribbon` now returns concept groups with subconcepts nested, instead of a matrix:

```json
{
  "concepts": [
    {
      "id": "c1",
      "label": "Complexity Analysis",
      "subconcepts": [
        { "id": "sc1", "label": "Big-O Notation", "mastery": 0.72, "lecture_id": "l1" },
        { "id": "sc2", "label": "Space Complexity", "mastery": 0.45, "lecture_id": "l1" },
        ...
      ]
    },
    ...
  ]
}
```

`/stitches/:user_id` response for thread rendering:

```json
{
  "stitch_score": 4.2,
  "stitches": [
    { "subconcept_id": "sc1", "direction": "viewer_teaches", "viewer_mastery": 0.8, "other_mastery": 0.2 },
    { "subconcept_id": "sc7", "direction": "other_teaches", "viewer_mastery": 0.3, "other_mastery": 0.9 },
    ...
  ]
}
```

---

## 11. Spec sections to update in `stitch_spec.md`

Replace or rewrite these sections:

- **§2.1 Heatmap UX** → rewrite as "Ribbon UX" using §3 of this guide
- **§2.2 Views that fall out of the same grid** → "Views that fall out of the same ribbon" using §5 of this guide
- **§2.3 Why this layout works** → updated pros list (stitches are literal, no empty cells, natural stacking)
- **§2.4 Stitches** → keep the scoring math, replace the "Overlay UX" subsection with §4 of this guide (threads)
- **§5.4 Student heatmap view** → "Student ribbon view" using §5.1 of this guide
- **§8 Phase 2, Phase 7** → rename "heatmap" to "ribbon" throughout; Phase 7 now explicitly mentions thread rendering
- **§9 API endpoints** → rename per §10 of this guide
- **§11 Success Metrics** → unchanged; metrics are about data divergence and match quality, not rendering

---

## 12. Migration checklist

In order:

- [ ] Read `stitch_spec.md` §3 (data model) to confirm nothing needs schema changes
- [ ] Replace heatmap components with `<Ribbon />`, `<RibbonStack />`, `<ThreadLayer />`, `<StitchHeader />`
- [ ] Update `/my/courses/:id/heatmap` → `/my/courses/:id/ribbon`; change response shape to nested concept→subconcept structure
- [ ] Implement `<Ribbon />` first, verify solo view works with real data
- [ ] Add `<RibbonStack />` with two students; implement thread layer
- [ ] Add pair view page; wire up `/stitches/:user_id`
- [ ] Add group view (reuse `<RibbonStack />` with 3–4 students)
- [ ] Add class view (reuse `<RibbonStack />` with all students, threads off by default)
- [ ] Add `<ConceptDrilldown />` as its own page, accessible by clicking any concept label
- [ ] Update main spec (`stitch_spec.md`) sections per §11 of this guide
- [ ] Remove old heatmap components and imports

---

## 13. Open design decisions

Call out for a product owner to decide:

1. **Thread color scheme**: directional (teal/pink) or neutral (single color + arrow)? Directional is more informative; neutral is less busy.
2. **Cell width**: fixed (e.g., 16px) or responsive to container? Fixed keeps cells scannable at a glance; responsive fits more subconcepts on small screens.
3. **Concept group dividers**: subtle vertical line, extra gap, or colored background? Affects how obvious the groupings feel.
4. **Class view default**: ribbon stack sorted by stitchability, or single aggregated class ribbon? Stack is richer; aggregate is simpler.
5. **Concept label position**: above each group or below? Above is conventional; below works better if ribbons are stacked tightly in group view.

Default to: directional threads (teal/pink), fixed cell width, subtle dividers, stack for class view, labels above.

---

## 14. Out of scope

This migration does not touch:
- Quiz generation or taking
- Mastery update logic
- Syllabus or lecture extraction pipelines
- Authentication, enrollment, join codes
- Professor concept editor
- Quiz editor
- Any backend code except response shape changes in §10

If you find yourself editing backend logic beyond response shapes, stop — the migration is scoped to rendering only.