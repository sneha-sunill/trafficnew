import Papa from "papaparse";

export interface DetColumnInfo {
  detCols: string[];
  phases: string[];
  detToPhase: Record<string, string>;
}

// Fast header-only detection — reads just the first row of each CSV.
export function detectDetColumns(csvContents: string[]): DetColumnInfo {
  const allFields = new Set<string>();
  for (const content of csvContents) {
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, preview: 1 });
    for (const field of parsed.meta.fields ?? []) allFields.add(field);
  }

  const detCols = Array.from(allFields).filter((c) => c.startsWith("DET"));
  const phases = new Set<string>();
  const detToPhase: Record<string, string> = {};
  for (const col of detCols) {
    const phase = col[col.length - 1];
    detToPhase[col] = phase;
    phases.add(phase);
  }

  return { detCols, phases: Array.from(phases).sort(), detToPhase };
}

export interface ResultRow {
  Date: string;
  Day: string;
  Hour: string;
  "Highest Volume Phase": string;
  [key: string]: string;
}

export interface ChartEntry {
  hour: string;
  [key: string]: string | number | null;
}

export interface ChartDataByDate {
  date: string;
  day: string;
  dayType: string;
  data: ChartEntry[];
}

export interface FrequencyRow {
  rank: number;
  phase: string;
  frequency: number;
}

export interface PeakRow {
  period: string;
  phase: string;
}

export interface InsightsData {
  weekday: FrequencyRow[];
  weekend: FrequencyRow[];
  weekdayPeak: PeakRow[];
  weekendPeak: PeakRow[];
}

export interface ProcessResult {
  rows: ResultRow[];
  phaseCols: string[];
  allDataCols: string[];
  chartData: ChartDataByDate[];
  insights: InsightsData;
  masterCsv: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DUBAI_OFFSET_S = 4 * 3600;
const WEEKDAY_DAYS = new Set(["Monday", "Tuesday", "Wednesday", "Thursday"]);

interface HourBucket {
  dateStr: string;
  dayName: string;
  hourLabel: string;
  hourKey: string;
}

function getHourBucket(unixSeconds: number): HourBucket {
  // Convert to Dubai time (UTC+4), apply -1s adjustment, floor to hour
  const dubaiSec = unixSeconds + DUBAI_OFFSET_S - 1;
  const hourStartSec = Math.floor(dubaiSec / 3600) * 3600;
  const d = new Date(hourStartSec * 1000);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = d.getUTCHours();
  const dateStr = `${y}-${mo}-${day}`;
  const dayName = DAY_NAMES[d.getUTCDay()];
  const hh = String(h).padStart(2, "0");
  const nextHH = String((h + 1) % 24).padStart(2, "0");
  return {
    dateStr,
    dayName,
    hourLabel: `${hh}:00 - ${nextHH}:00`,
    hourKey: `${dateStr}|${hh}`,
  };
}

function customSum(vals: (number | null)[]): number | null {
  const nonNull = vals.filter((v): v is number => v !== null);
  return nonNull.length === 0 ? null : nonNull.reduce((a, b) => a + b, 0);
}

interface RawRow {
  StartTime: string;
  [key: string]: string;
}

interface TempRow extends HourBucket {
  [key: string]: string | number | null;
}

export function processCSVs(csvContents: string[], customDetGroups?: Record<string, string[]>): ProcessResult {
  const allRawRows: RawRow[] = [];
  // Collect all column names across all files (some files may have extra columns)
  const orderedCols: string[] = [];
  const colsSeen = new Set<string>(["StartTime"]);

  for (const content of csvContents) {
    const parsed = Papa.parse<RawRow>(content, { header: true, skipEmptyLines: true });
    allRawRows.push(...parsed.data);
    for (const field of parsed.meta.fields ?? []) {
      if (!colsSeen.has(field)) {
        colsSeen.add(field);
        orderedCols.push(field);
      }
    }
  }

  if (allRawRows.length === 0) throw new Error("No data found in CSV files");

  // Group detector/VS/PB columns by phase (last character of column name)
  const vsCols = orderedCols.filter((c) => c.startsWith("VS"));
  const pbCols = orderedCols.filter((c) => c.startsWith("PB"));

  const detGroups: Record<string, string[]> = {};
  if (customDetGroups) {
    Object.assign(detGroups, customDetGroups);
  } else {
    for (const col of orderedCols.filter((c) => c.startsWith("DET"))) {
      const phase = col[col.length - 1];
      (detGroups[phase] ??= []).push(col);
    }
  }

  const vsGroups: Record<string, string[]> = {};
  for (const col of vsCols) {
    const phase = col[col.length - 1];
    (vsGroups[phase] ??= []).push(col);
  }

  // Build per-raw-row temp data
  const tempRows: TempRow[] = [];

  for (const raw of allRawRows) {
    const unix = parseInt(raw.StartTime, 10);
    if (isNaN(unix)) continue;

    const bucket = getHourBucket(unix);
    const row: TempRow = { ...bucket };

    for (const [phase, cols] of Object.entries(detGroups)) {
      const vals = cols.map((c) => {
        const v = parseFloat(raw[c]);
        return isNaN(v) ? null : v;
      });
      row[`Phase ${phase}`] = customSum(vals);
    }

    for (const [phase, cols] of Object.entries(vsGroups)) {
      const vals = cols.map((c) => {
        const v = parseFloat(raw[c]);
        return isNaN(v) ? null : v;
      });
      row[`SCOOT Phase ${phase}`] = customSum(vals);
    }

    for (const col of pbCols) {
      const phase = col[col.length - 1];
      const v = parseFloat(raw[col]);
      row[`PED Phase ${phase}`] = isNaN(v) ? null : v;
    }

    tempRows.push(row);
  }

  // Group temp rows by hourKey
  const grouped = new Map<string, TempRow[]>();
  for (const row of tempRows) {
    const bucket = grouped.get(row.hourKey);
    if (bucket) bucket.push(row);
    else grouped.set(row.hourKey, [row]);
  }

  // Determine data column names (everything except the bucket metadata)
  const metaKeys = new Set(["dateStr", "dayName", "hourLabel", "hourKey"]);
  const allDataCols = Object.keys(tempRows[0] ?? {}).filter((k) => !metaKeys.has(k));
  const phaseCols = allDataCols.filter((k) => k.startsWith("Phase "));

  // Aggregate each hourly group
  const sortedKeys = Array.from(grouped.keys()).sort();
  const resultRows: ResultRow[] = [];

  for (const key of sortedKeys) {
    const rows = grouped.get(key)!;
    const first = rows[0];

    const result: ResultRow = {
      Date: first.dateStr,
      Day: first.dayName,
      Hour: first.hourLabel,
      "Highest Volume Phase": "DNF",
    };

    for (const col of allDataCols) {
      const vals = rows.map((r) => r[col] as number | null);
      const sum = customSum(vals);
      result[col] = sum !== null ? String(sum) : "DNF";
    }

    // Highest volume phase = phase col with the largest sum
    let maxVal = -Infinity;
    let maxPhase = "DNF";
    for (const col of phaseCols) {
      const v = parseFloat(result[col]);
      if (!isNaN(v) && v > maxVal) {
        maxVal = v;
        maxPhase = col;
      }
    }
    result["Highest Volume Phase"] = maxPhase;

    resultRows.push(result);
  }

  // Build chart data grouped by date
  const dateMap = new Map<string, ResultRow[]>();
  for (const row of resultRows) {
    const existing = dateMap.get(row.Date);
    if (existing) existing.push(row);
    else dateMap.set(row.Date, [row]);
  }

  const chartData: ChartDataByDate[] = [];
  for (const [date, rows] of Array.from(dateMap.entries())) {
    const dayName = rows[0].Day;
    const dayType = WEEKDAY_DAYS.has(dayName) ? "Weekday" : "Weekend";
    const data: ChartEntry[] = rows.map((r) => {
      const entry: ChartEntry = { hour: r.Hour };
      for (const col of phaseCols) {
        const v = parseFloat(r[col]);
        entry[col] = isNaN(v) ? null : v;
      }
      return entry;
    });
    chartData.push({ date, day: dayName, dayType, data });
  }

  // Traffic insights
  const withMeta = resultRows.map((r) => ({
    hvp: r["Highest Volume Phase"],
    dayType: WEEKDAY_DAYS.has(r.Day) ? "Weekday" : "Weekend",
    hourInt: parseInt(r.Hour.slice(0, 2), 10),
  }));

  function calcFrequency(rows: typeof withMeta): FrequencyRow[] {
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      if (r.hvp !== "DNF") {
        counts[r.hvp] = (counts[r.hvp] ?? 0) + 1;
        total++;
      }
    }
    return phaseCols
      .map((phase) => ({
        phase,
        frequency: total > 0 ? Math.round(((counts[phase] ?? 0) / total) * 1000) / 10 : 0,
        rank: 0,
      }))
      .sort((a, b) => b.frequency - a.frequency)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }

  function getDominant(rows: typeof withMeta, start: number, end: number): string {
    const filtered = rows.filter((r) => r.hourInt >= start && r.hourInt < end);
    if (!filtered.length) return "DNF";
    const counts: Record<string, number> = {};
    for (const r of filtered) {
      if (r.hvp !== "DNF") counts[r.hvp] = (counts[r.hvp] ?? 0) + 1;
    }
    const entries = Object.entries(counts);
    if (!entries.length) return "DNF";
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  }

  const wd = withMeta.filter((r) => r.dayType === "Weekday");
  const we = withMeta.filter((r) => r.dayType === "Weekend");

  const insights: InsightsData = {
    weekday: calcFrequency(wd),
    weekend: calcFrequency(we),
    weekdayPeak: [
      { period: "AM Peak (6-9)", phase: getDominant(wd, 6, 9) },
      { period: "LT Peak (12-15)", phase: getDominant(wd, 12, 15) },
      { period: "PM Peak (17-20)", phase: getDominant(wd, 17, 20) },
    ],
    weekendPeak: [
      { period: "AM Peak (6-9)", phase: getDominant(we, 6, 9) },
      { period: "LT Peak (12-15)", phase: getDominant(we, 12, 15) },
      { period: "PM Peak (17-20)", phase: getDominant(we, 17, 20) },
    ],
  };

  // Master CSV
  const headers = ["Date", "Day", "Hour", "Highest Volume Phase", ...allDataCols];
  const lines = [headers.join(",")];
  for (const row of resultRows) {
    lines.push(headers.map((h) => String(row[h] ?? "")).join(","));
  }

  return { rows: resultRows, phaseCols, allDataCols, chartData, insights, masterCsv: lines.join("\n") };
}
