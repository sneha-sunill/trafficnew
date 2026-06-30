# Traffic Count Summary — Project Context

Use this file at the start of a new Claude session to resume work without losing context.

---

## What This App Does

A Next.js 15 web app that processes Dubai traffic detector count CSV files (or a ZIP of them) and produces:

- **KPI dashboard** — 8 cards: total traffic, avg daily, peak hour value, survey days, weekday avg, weekend avg, record count, data quality %
- **11 interactive charts** — daily trend, hourly distribution, phase trend, phase contribution (doughnut), day-of-week bar, time band, top-10 peak hours, weekday vs weekend, heatmap, auto insights, master data table
- **Master CSV download** — all aggregated hourly rows
- **Insights Excel download** — weekday/weekend phase frequency + AM/LT/PM peak analysis

No database. No auth. Fully stateless — user uploads files, server processes them, results returned in one response.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) | |
| Language | TypeScript 5 | strict mode |
| Styling | Tailwind CSS 3 + inline styles | CSS variables for theming |
| Charts | Recharts 2 | all client-side |
| CSV parsing | PapaParse 5 | `preview:1` for fast header detection |
| ZIP extraction | JSZip 3 | server-side only |
| Excel export | SheetJS (xlsx 0.18) | dynamic import, client-side |
| Runtime | Node.js (Vercel serverless) | |

### Critical `next.config.ts` setting

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["jszip"],
};
export default nextConfig;
```

**Do not remove `serverExternalPackages: ["jszip"]`.** Without it, Next.js webpack bundles JSZip for the server, causing a CommonJS/ESM resolution failure (`TypeError: Cannot read properties of undefined (reading 'call')`, POST /500) when a ZIP is uploaded.

---

## File Structure

```
/
├── app/
│   ├── page.tsx                  # Server Component — renders <TrafficApp /> only
│   ├── layout.tsx                # Root layout, no className on body
│   ├── globals.css               # Tailwind directives + CSS variables + body background
│   ├── actions.ts                # Server Actions: detectColumns, processTrafficFiles
│   └── components/
│       └── TrafficApp.tsx        # Main client component — all UI, state, charts, exports
├── lib/
│   ├── processor.ts              # Core data processing (pure TS, server-only)
│   └── zip.ts                   # ZIP extraction with bomb detection
├── next.config.ts                # serverExternalPackages: ["jszip"] — do not remove
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Architecture

```
Browser
  │
  │  drag-drop / file-select (.csv or .zip)
  ▼
TrafficApp.tsx ["use client"]
  │
  │  useEffect → detectColumns(formData)   ← fast: reads only first row per file
  │  onClick   → processTrafficFiles(formData, detGroups)
  ▼
app/actions.ts ["use server"]
  │  collectCsvContents(files)  ← handles both CSV and ZIP inputs
  │    └─ ZIP path → lib/zip.ts → extractCsvFromZip()
  │
  ▼
lib/processor.ts
  │  detectDetColumns(csvContents)  → DetColumnInfo (used for phase mapping UI)
  │  processCSVs(csvContents, customDetGroups?)  → ProcessResult
  ▼
TrafficApp.tsx  setResult(data) → renders dashboard
```

### Key design decisions

- **Server Action not API route** — `app/actions.ts` replaces `/api/process/route.ts`. DB connections and server-side API calls can be added directly to `processTrafficFiles` without HTTP wiring.
- **`page.tsx` is a pure Server Component** — no `"use client"`. Future server-fetched data (e.g. reference data from a DB) can be `await`-ed here and passed as props to `<TrafficApp />`.
- **`lib/processor.ts` never imported client-side** — only the `ProcessResult` type is imported in `TrafficApp.tsx` (erased at build time). Processing logic never enters the client bundle.
- **xlsx is a dynamic import** — `await import("xlsx")` inside `downloadExcel()`. Keeps the initial bundle small.

---

## Data Processing Logic (`lib/processor.ts`)

### CSV input format

Each CSV must have:
- `StartTime` — Unix timestamp in **seconds** (UTC)
- `DET*` columns — detector counts (last character = phase letter, e.g. `DETA`, `DETB`)
- `VS*` columns — SCOOT volume per phase (optional)
- `PB*` columns — pedestrian phase counts (optional)

Files can have different column sets — the processor unions all columns across all files.

### Processing steps

1. **Parse** all CSVs with PapaParse, union all column names in order.
2. **Group columns by phase**:
   - `DET` cols → `Phase X` (where X = last char)
   - `VS` cols → `SCOOT Phase X`
   - `PB` cols → `PED Phase X`
   - If user provided a custom mapping, that overrides DET auto-grouping.
3. **Bucket each raw row** into a Dubai-time hour slot:
   - Convert `StartTime` (UTC Unix seconds) to Dubai time (UTC+4), subtract 1 second, floor to hour.
   - Key = `"YYYY-MM-DD|HH"`.
4. **Aggregate** — for each unique hour bucket, sum all detector values across rows. If all values in a phase are null/missing → `"DNF"` (Did Not Fire).
5. **Highest Volume Phase** — phase col with the largest numeric sum in that hour.
6. **Chart data** — group aggregated rows by date.
7. **Insights**:
   - Frequency table: how often each phase was the highest-volume phase (weekday vs weekend), as a percentage.
   - Peak periods: dominant phase in AM (6–9), LT (12–15), PM (17–20) for weekday and weekend.
8. **Master CSV** — all aggregated rows serialised as a CSV string.

### Day classification (Dubai work week)

- **Weekday**: Monday, Tuesday, Wednesday, Thursday
- **Weekend**: Friday, Saturday, Sunday

This is intentional — Dubai's work week runs Mon–Thu; Fri is a weekend day. Do not change this.

### Key exported interfaces

```typescript
ProcessResult {
  rows: ResultRow[]             // aggregated hourly rows
  phaseCols: string[]           // ["Phase A", "Phase B", ...]
  allDataCols: string[]         // all data columns (phases + SCOOT + PED)
  chartData: ChartDataByDate[]
  insights: InsightsData
  masterCsv: string             // full CSV as a string
}

ResultRow {
  Date: string                  // "YYYY-MM-DD"
  Day: string                   // "Monday" etc.
  Hour: string                  // "08:00 - 09:00"
  "Highest Volume Phase": string
  [col: string]: string         // all data columns, value or "DNF"
}

DetColumnInfo {
  detCols: string[]             // raw DET column names
  phases: string[]              // unique phase letters, sorted
  detToPhase: Record<string, string>  // auto-detected mapping
}
```

---

## ZIP Handling (`lib/zip.ts`)

Limits enforced:

| Check | Limit |
|---|---|
| ZIP file size (compressed) | 50 MB |
| Total extracted size | 200 MB |
| Number of CSV files inside | 500 |
| Compression ratio | 500:1 |

Nested ZIPs are rejected. Hidden files (`.*`) are skipped. Non-CSV files inside the ZIP are silently ignored.

---

## Phase Mapping UI (user requirement — must maintain)

When files are selected, `detectColumns()` runs immediately (reads only the first row of each file for speed) and returns auto-detected DET columns and their inferred phase assignments.

The UI shows a **Phase Mapping panel** below the upload zone with a `<select>` per DET column. Rules:
- Each DET column can be assigned to one phase or left "Unassigned".
- If the user changes the mapping and clicks **Process / Regenerate**, `processTrafficFiles` is called with `buildDetGroups(detToPhase)` — a `Record<string, string[]>` mapping phase name to the list of DET columns assigned to it.
- Phase mapping panel is collapsible (▼ Expand / ▲ Collapse toggle).
- Auto-detected mapping is pre-populated; user can adjust.

```typescript
function buildDetGroups(detToPhase: Record<string,string>): Record<string,string[]> {
  const g: Record<string,string[]> = {};
  for (const [det,ph] of Object.entries(detToPhase)) if (ph) (g[ph] ??= []).push(det);
  return g;
}
```

---

## Filters (user requirement — must maintain)

Filters live in the **filter drawer** (see UI section). They affect charts and the master data table only — not the upload/processing flow.

| Filter | Scope |
|---|---|
| Date | Which rows appear (`filteredRows`) |
| Day Type (Weekday/Weekend) | Which rows appear (`filteredRows`) |
| Phase | Which phase column(s) count toward the "total" in volume charts |
| Search | Text filter on the master data table only |

**useMemo chain:**
```
filteredRows  (date + dayType applied to result.rows)
  └── charts useMemo  (phase filter changes rowTotal() computation)
        └── tableRows useMemo  (search filter on top of filteredRows)
```

Phase filter does **not** hide rows — it changes what values are summed when computing a row's total. This is intentional.

---

## UI/UX Requirements (all user-specified — must maintain)

### Layout

- No persistent sidebar. A **filter drawer** slides in from the left (300px wide), toggled by a **Filters button** (three-bar icon) in the sticky topbar.
- Filter drawer shows:
  - If data is loaded: all 4 filter controls + export buttons + "Filters active" badge + "Clear all" when filters are set.
  - If no data: professional empty state — icon, heading, short message directing user to upload files first.
- Drawer closes when backdrop is clicked or when `processFiles` succeeds.
- Topbar is sticky (`position: sticky; top: 0`) with frosted glass (`backdrop-filter: blur(14px)`).
- The Filters button turns blue/filled when the drawer is open; shows a blue dot indicator when filters are active but drawer is closed.

### Onboarding (no data loaded)

- The page shows a **centered upload card only** — no KPIs, no charts, no processing summary.
- Upload card: gradient icon badge, h2 heading, description text, white card (max-width 520px) with upload zone + phase mapping panel + CTA button.
- Below the card: 3 "step" cards (Extract → Master Data → Insights).

### Post-process dashboard

- **Compact hero** — two columns: re-upload card (left) + processing summary (right).
- **8 KPI cards** in a 2×4 grid (2 cols on mobile, 4 on desktop), each with a colored top border accent.
- **11 charts** in a 1-col (mobile) / 2-col (desktop) grid:
  1. Daily Traffic Trend (wide)
  2. Hourly Traffic Distribution
  3. Phase Volume Trend
  4. Phase Contribution (doughnut)
  5. Day of Week Comparison
  6. Time Band Analysis
  7. Top 10 Peak Hours (horizontal bar)
  8. Weekday vs Weekend
  9. Traffic Heatmap (wide) — day × hour grid, blue opacity scale
  10. Auto Insights (wide) — 3 derived text observations
  11. Master Data Preview (wide) — scrollable table, alternating rows

### Scrolling

- When a filter changes, auto-scroll to the KPI section (`dashboardRef.scrollIntoView({ behavior:"smooth", block:"start" })`).
- When `processFiles` succeeds, also auto-scroll to KPI section (300ms delay to let React re-render).

### Responsive

- Layout is single-column on mobile, two-column grid on `md:` and up.
- Upload zone, KPI grid, chart grid all use Tailwind responsive classes.
- No separate mobile hamburger vs desktop sidebar — the filter drawer works the same on all screen sizes.

### Theme — Light Mode

CSS variables in `globals.css`:

```css
:root {
  --bg:    #eef4fb;
  --panel: #ffffff;
  --card:  #ffffff;
  --muted: #64748b;
  --text:  #0f1e2e;
  --brand: #0284c7;
  --green: #059669;
  --amber: #d97706;
  --red:   #dc2626;
  --line:  #d1e3f0;
}
body {
  background: linear-gradient(160deg, #e8f4fd, #f0f6fb 50%, #edf3f8);
}
```

Color palette for charts: `["#2563eb","#10b981","#f59e0b","#ef4444","#8b5cf6","#0891b2","#f97316","#22c55e","#ec4899","#84cc16","#6366f1"]`

---

## Exports

### Master CSV

Downloaded client-side from `result.masterCsv`. Filename: `master_file_hourly.csv`.
Columns: `Date, Day, Hour, Highest Volume Phase, Phase A, Phase B, … SCOOT Phase A, …, PED Phase A, …`

### Insights Excel

Built client-side with SheetJS (`await import("xlsx")`). Filename: `Traffic_Insights.xlsx`. Layout:

| Cells | Content |
|---|---|
| A1–C* | Weekdays frequency table (rank / phase / frequency%) |
| A*–C* | Weekends frequency table (2-row gap after weekdays) |
| G1–H5 | Weekday peak periods (AM/LT/PM) |
| G7–H11 | Weekend peak periods |

---

## Sub-components in TrafficApp.tsx

| Component | Purpose |
|---|---|
| `BarsIcon` | Three-bar SVG icon for the Filters button |
| `ChartCard` | Wrapper for all charts — consistent title, dot indicator, padding. `height` prop is optional: if set wraps children in a height-constrained div, otherwise renders children directly (needed for heatmap and table). `wide` prop applies `col-span-1 md:col-span-2`. |
| `HeatmapGrid` | Day × hour grid with blue opacity heatmap + legend |
| `UploadZone` | Drag-and-drop zone, shared between onboarding and post-process re-upload card |

---

## Known Bugs Fixed (do not revert)

### ZIP upload POST /500 — `TypeError: Cannot read properties of undefined (reading 'call')`

**Root cause**: Next.js webpack bundled `jszip` for the server action, causing CJS/ESM module resolution failure.
**Fix**: `serverExternalPackages: ["jszip"]` in `next.config.ts`. This tells Next.js to use native Node.js `require` for JSZip instead of bundling it.

### `result possibly null` TypeScript error inside chart render

**Root cause**: Inside `{charts && (...)}`, TypeScript couldn't narrow `result` to non-null even though `charts` useMemo depends on `result`.
**Fix**: Changed guard to `{result && charts && (...)}`.

### `ChartCard height` clipping heatmap/table content

**Root cause**: Height-constrained wrapper div in ChartCard clipped content that overflows (heatmap legend, scrollable table).
**Fix**: Made `height` prop optional. When absent, renders `children` directly with no height constraint.

---

## To Add DB / API Connections

Edit `app/actions.ts` — it's already `"use server"`, just add imports:

```typescript
"use server";
import { db } from "@/lib/db";         // add your DB client
import { processCSVs } from "@/lib/processor";

export async function processTrafficFiles(formData: FormData, customDetGroups?: Record<string,string[]>) {
  const files = formData.getAll("files") as File[];
  const csvContents = await collectCsvContents(files);
  const result = processCSVs(csvContents, customDetGroups);
  await db.insert(trafficRuns).values({ ... });   // example
  return result;
}
```

To pass server data to the page on load, edit `app/page.tsx` (it's already a Server Component):

```typescript
import TrafficApp from "./components/TrafficApp";
import { db } from "@/lib/db";

export default async function Page() {
  const history = await db.select().from(trafficRuns);
  return <TrafficApp history={history} />;
}
```

---

## Running the App

```bash
npm run dev       # localhost:3000
npm run build     # production build
npm start         # serve production build
```

Deployed on Vercel (auto-detected Next.js, no config needed, no environment variables required in current state).
