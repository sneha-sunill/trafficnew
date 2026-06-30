"use client";

import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from "react";
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import type { ProcessResult, ResultRow } from "@/lib/processor";
import { processTrafficFiles, detectColumns } from "@/app/actions";

// ─── Constants ───────────────────────────────────────────────────────────────

const PALETTE = ["#2563eb","#10b981","#f59e0b","#ef4444","#8b5cf6","#0891b2","#f97316","#22c55e","#ec4899","#84cc16","#6366f1"];
const WEEKDAY_NAMES = new Set(["Monday","Tuesday","Wednesday","Thursday"]);
const DOW_ORDER    = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const DOW_SHORT    = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const BAND_DEF = [
  { band:"Night",     range:[0,6]  as [number,number], fill:PALETTE[3] },
  { band:"Morning",   range:[6,12] as [number,number], fill:PALETTE[0] },
  { band:"Afternoon", range:[12,18]as [number,number], fill:PALETTE[2] },
  { band:"Evening",   range:[18,24]as [number,number], fill:PALETTE[1] },
];
const TT = {
  contentStyle:{ background:"#fff", border:"1px solid #dde8f0", borderRadius:10, color:"#0f1e2e", fontSize:12, boxShadow:"0 4px 20px rgba(0,0,0,.10)" },
  labelStyle:  { color:"#0f1e2e", fontWeight:600 },
  itemStyle:   { color:"#64748b" },
};
const ATICK = { fill:"#94a3b8", fontSize:11 };
const AGRID = "rgba(0,0,0,.06)";
const fmt = (v: number) =>
  v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(Math.round(v));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function downloadExcel(result: ProcessResult) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws: Record<string, unknown> = {};
  const set = (cell: string, v: string | number) => (ws[cell] = { v, t: typeof v === "number" ? "n" : "s" });
  set("A1","WEEKDAYS"); set("A2","Rank"); set("B2","Phase"); set("C2","Frequency");
  result.insights.weekday.forEach((r,i)=>{ set(`A${3+i}`,r.rank); set(`B${3+i}`,r.phase); set(`C${3+i}`,`${r.frequency}%`); });
  const ws2 = 3+result.insights.weekday.length+2;
  set(`A${ws2}`,"WEEKENDS"); set(`A${ws2+1}`,"Rank"); set(`B${ws2+1}`,"Phase"); set(`C${ws2+1}`,"Frequency");
  result.insights.weekend.forEach((r,i)=>{ set(`A${ws2+2+i}`,r.rank); set(`B${ws2+2+i}`,r.phase); set(`C${ws2+2+i}`,`${r.frequency}%`); });
  set("G1","WEEKDAY PEAK"); set("G2","Time Period"); set("H2","Dominant Phase");
  result.insights.weekdayPeak.forEach((r,i)=>{ set(`G${3+i}`,r.period); set(`H${3+i}`,r.phase); });
  set("G7","WEEKEND PEAK"); set("G8","Time Period"); set("H8","Dominant Phase");
  result.insights.weekendPeak.forEach((r,i)=>{ set(`G${9+i}`,r.period); set(`H${9+i}`,r.phase); });
  const lastRow = Math.max(ws2+1+result.insights.weekend.length, 11);
  ws["!ref"] = `A1:H${lastRow}`; ws["!cols"] = [{wch:8},{wch:20},{wch:12},{},{},{},{wch:18},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws, "Traffic Insights");
  XLSX.writeFile(wb, "Traffic_Insights.xlsx");
}

function buildDetGroups(detToPhase: Record<string,string>): Record<string,string[]> {
  const g: Record<string,string[]> = {};
  for (const [det,ph] of Object.entries(detToPhase)) if (ph) (g[ph] ??= []).push(det);
  return g;
}

function heatColor(val: number, max: number) {
  const a = max > 0 ? 0.08 + (val/max)*0.92 : 0.06;
  return `rgba(2,132,199,${a.toFixed(2)})`;
}

// ─── Shared icon: three horizontal bars ──────────────────────────────────────

function BarsIcon({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3"  width="14" height="2" rx="1" fill={color} />
      <rect x="1" y="7"  width="14" height="2" rx="1" fill={color} />
      <rect x="1" y="11" width="14" height="2" rx="1" fill={color} />
    </svg>
  );
}

// ─── ChartCard ────────────────────────────────────────────────────────────────

function ChartCard({ title, subtitle, badge, wide=false, accent="#2563eb", height, children }: {
  title: string; subtitle?: string; badge?: string; wide?: boolean; accent?: string; height?: number; children: React.ReactNode;
}) {
  return (
    <div
      className={wide ? "col-span-1 md:col-span-2" : ""}
      style={{ background:"#fff", borderRadius:16, border:"1px solid #e8f0f8", boxShadow:"0 1px 4px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.04)", overflow:"hidden" }}
    >
      <div style={{ padding:"15px 20px 13px", borderBottom:"1px solid #f0f6fb" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:accent, display:"inline-block", flexShrink:0 }} />
            <span style={{ fontSize:13, fontWeight:700, color:"#0f1e2e", letterSpacing:-.2 }}>{title}</span>
          </div>
          {badge && <span style={{ fontSize:11, fontWeight:600, color:"#64748b", background:"#f1f7fc", border:"1px solid #dde8f0", borderRadius:6, padding:"2px 9px", whiteSpace:"nowrap" as const }}>{badge}</span>}
        </div>
        {subtitle && <p style={{ margin:"4px 0 0 16px", fontSize:11, color:"#94a3b8" }}>{subtitle}</p>}
      </div>
      <div style={{ padding:"16px 20px 18px" }}>
        {height !== undefined ? <div style={{ height }}>{children}</div> : children}
      </div>
    </div>
  );
}

// ─── HeatmapGrid ─────────────────────────────────────────────────────────────

function HeatmapGrid({ heatMap, max }: { heatMap: Record<string,Record<number,number>>; max: number }) {
  return (
    <div>
      <div style={{ overflowX:"auto" }}>
        <div style={{ display:"grid", gridTemplateColumns:"52px repeat(24,1fr)", gap:3, minWidth:640, fontSize:10 }}>
          <div />
          {Array.from({length:24},(_,h)=>(
            <div key={h} style={{ textAlign:"center", color:"#94a3b8", fontWeight:500 }}>{h}</div>
          ))}
          {DOW_ORDER.map((day,di)=>(
            <Fragment key={day}>
              <div style={{ color:"#64748b", fontWeight:600, alignSelf:"center", fontSize:11 }}>{DOW_SHORT[di]}</div>
              {Array.from({length:24},(_,h)=>{
                const val = heatMap[day]?.[h] ?? 0;
                return (
                  <div key={h}
                    title={`${DOW_SHORT[di]} ${h}:00 — ${Math.round(val).toLocaleString()}`}
                    style={{ height:15, borderRadius:3, background:heatColor(val,max) }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10 }}>
        <span style={{ fontSize:11, color:"#94a3b8" }}>Low</span>
        <div style={{ flex:1, maxWidth:100, height:7, borderRadius:4, background:"linear-gradient(to right,rgba(2,132,199,.08),rgba(2,132,199,1))" }} />
        <span style={{ fontSize:11, color:"#94a3b8" }}>High</span>
      </div>
    </div>
  );
}

// ─── UploadZone ──────────────────────────────────────────────────────────────

function UploadZone({ files, dragging, detectingCols, onDrop, onDragOver, onDragLeave, onClick }: {
  files: File[]; dragging: boolean; detectingCols: boolean;
  onDrop:(e:React.DragEvent)=>void; onDragOver:(e:React.DragEvent)=>void;
  onDragLeave:()=>void; onClick:()=>void;
}) {
  return (
    <div
      onClick={onClick}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      style={{
        border:`2px dashed ${dragging ? "#0284c7" : "#bcd4e8"}`,
        borderRadius:14, padding:"22px 16px", textAlign:"center", cursor:"pointer",
        background: dragging ? "rgba(2,132,199,.05)" : "#f8fbff",
        transition:".2s border-color, .2s background",
      }}
    >
      <div style={{ fontSize:26, marginBottom:6 }}>
        {detectingCols ? "⏳" : files.length > 0 ? "📁" : "☁️"}
      </div>
      <div style={{ fontSize:14, fontWeight:700, color:"#0f1e2e", marginBottom:3 }}>
        {detectingCols ? "Reading file headers…"
          : files.length > 0 ? `${files.length} file${files.length !== 1 ? "s" : ""} selected`
          : "Drop files here or click to browse"}
      </div>
      <div style={{ fontSize:12, color:"#94a3b8" }}>
        {files.length > 0
          ? files.map(f => f.name).join(" · ")
          : "Accepts .csv files or a .zip folder of CSV files"}
      </div>
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Filters { date: string; dayType: string; phase: string; search: string; }

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TrafficApp() {

  // Upload state
  const [files,         setFiles]         = useState<File[]>([]);
  const [dragging,      setDragging]      = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [result,        setResult]        = useState<ProcessResult | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [detectingCols, setDetectingCols] = useState(false);
  const [detectError,   setDetectError]   = useState<string | null>(null);
  const [detCols,       setDetCols]       = useState<string[]>([]);
  const [allPhases,     setAllPhases]     = useState<string[]>([]);
  const [detToPhase,    setDetToPhase]    = useState<Record<string,string>>({});
  const [mappingOpen,   setMappingOpen]   = useState(true);

  // Filter drawer state
  const [filterOpen, setFilterOpen] = useState(false);
  const [reprocessOpen, setReprocessOpen] = useState(false);

  // Dashboard filters
  const [filters, setFilters] = useState<Filters>({ date:"All", dayType:"All", phase:"All", search:"" });

  // Scroll target for auto-scroll on filter change
  const dashboardRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters = filters.date !== "All" || filters.dayType !== "All" || filters.phase !== "All" || filters.search !== "";

  // ── Derived ──────────────────────────────────────────────────────────────────
  const uniqueDates = useMemo(
    () => result ? [...new Set(result.rows.map(r => r.Date))].sort() : [],
    [result]
  );

  const filteredRows = useMemo(() => {
    if (!result) return [];
    return result.rows.filter(row => {
      if (filters.date !== "All" && row.Date !== filters.date) return false;
      if (filters.dayType !== "All") {
        const wd = WEEKDAY_NAMES.has(row.Day);
        if (filters.dayType === "Weekday" && !wd) return false;
        if (filters.dayType === "Weekend" && wd) return false;
      }
      return true;
    });
  }, [result, filters.date, filters.dayType]);

  const charts = useMemo(() => {
    if (!result) return null;

    const rowTotal = (row: ResultRow): number => {
      if (filters.phase !== "All") { const v = parseFloat(row[filters.phase]); return isNaN(v) ? 0 : v; }
      return result.phaseCols.reduce((s,c) => { const v=parseFloat(row[c]); return s+(isNaN(v)?0:v); }, 0);
    };

    const byDate = new Map<string,{date:string;day:string;total:number}>();
    for (const r of filteredRows) {
      const e = byDate.get(r.Date) ?? {date:r.Date,day:r.Day,total:0};
      e.total += rowTotal(r); byDate.set(r.Date,e);
    }
    const daily = [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))
      .map(d => ({...d, label:d.date.slice(8)}));

    const phaseContrib = result.phaseCols.map(col=>({
      name:col, value:filteredRows.reduce((s,r)=>{ const v=parseFloat(r[col]); return s+(isNaN(v)?0:v); },0),
    })).filter(p=>p.value>0);

    const byDow = new Map<string,number>();
    for (const r of filteredRows) byDow.set(r.Day,(byDow.get(r.Day)??0)+rowTotal(r));
    const dow = DOW_ORDER.map((d,i)=>({ day:DOW_SHORT[i], total:byDow.get(d)??0 }));

    const bands = BAND_DEF.map(b=>({
      ...b,
      total:filteredRows.filter(r=>{ const h=parseInt(r.Hour.slice(0,2)); return !isNaN(h)&&h>=b.range[0]&&h<b.range[1]; })
        .reduce((s,r)=>s+rowTotal(r),0),
    }));

    const peakHours = [...filteredRows]
      .map(r=>({ label:r.Date.slice(5)+" "+r.Hour.slice(0,5), total:rowTotal(r) }))
      .sort((a,b)=>b.total-a.total).slice(0,10).reverse();

    const wdRows = filteredRows.filter(r=>WEEKDAY_NAMES.has(r.Day));
    const weRows = filteredRows.filter(r=>!WEEKDAY_NAMES.has(r.Day));
    const wdSlots = new Set(wdRows.map(r=>r.Date+r.Hour)).size||1;
    const weSlots = new Set(weRows.map(r=>r.Date+r.Hour)).size||1;
    const dayTypeChart = [
      { type:"Weekday", avgHourly:wdRows.reduce((s,r)=>s+rowTotal(r),0)/wdSlots },
      { type:"Weekend", avgHourly:weRows.reduce((s,r)=>s+rowTotal(r),0)/weSlots },
    ];

    const phaseByHour = new Map<string,Record<string,number>>();
    for (const r of filteredRows) {
      const h = r.Hour.slice(0, 5);
      const e = phaseByHour.get(h) ?? {};
      for (const col of result.phaseCols) { const v=parseFloat(r[col]); e[col]=(e[col]??0)+(isNaN(v)?0:v); }
      phaseByHour.set(h, e);
    }
    const phaseHourly = [...phaseByHour.entries()]
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([hour,phases])=>({ label:hour, ...phases }));

    const heatMap: Record<string,Record<number,number>> = {};
    for (const r of filteredRows) {
      const h=parseInt(r.Hour.slice(0,2));
      if (!heatMap[r.Day]) heatMap[r.Day]={};
      heatMap[r.Day][h]=(heatMap[r.Day][h]??0)+rowTotal(r);
    }
    const heatMax = Math.max(0,...Object.values(heatMap).flatMap(h=>Object.values(h)));

    const totalTraffic = filteredRows.reduce((s,r)=>s+rowTotal(r),0);
    const dates   = [...new Set(filteredRows.map(r=>r.Date))];
    const avgDaily = dates.length ? totalTraffic/dates.length : 0;
    const peakRow  = filteredRows.length ? [...filteredRows].sort((a,b)=>rowTotal(b)-rowTotal(a))[0] : null;
    const wdDates  = [...new Set(wdRows.map(r=>r.Date))];
    const weDates  = [...new Set(weRows.map(r=>r.Date))];
    const wdAvg    = wdDates.length ? wdRows.reduce((s,r)=>s+rowTotal(r),0)/wdDates.length : 0;
    const weAvg    = weDates.length ? weRows.reduce((s,r)=>s+rowTotal(r),0)/weDates.length : 0;
    const qualPct  = filteredRows.length
      ? Math.round(filteredRows.filter(r=>r["Highest Volume Phase"]!=="DNF").length/filteredRows.length*100) : 0;
    const kpis = { totalTraffic, avgDaily, peakValue:peakRow?rowTotal(peakRow):0,
      peakLabel:peakRow?`${peakRow.Date} • ${peakRow.Hour.slice(0,5)}`:"-",
      days:dates.length, wdAvg, weAvg, records:filteredRows.length, qualPct };

    const topPhase = phaseContrib.length ? phaseContrib.reduce((a,b)=>a.value>b.value?a:b) : null;
    const insights = [
      peakRow ? `Peak load: Highest traffic is ${Math.round(rowTotal(peakRow)).toLocaleString()} during ${peakRow.Hour} on ${peakRow.Day}, ${peakRow.Date}.` : null,
      (wdAvg>0||weAvg>0) ? (weAvg>wdAvg
        ? `Weekend pattern: Weekend daily average (${Math.round(weAvg).toLocaleString()}) exceeds weekday (${Math.round(wdAvg).toLocaleString()}).`
        : `Weekday pattern: Weekday daily average (${Math.round(wdAvg).toLocaleString()}) exceeds weekend (${Math.round(weAvg).toLocaleString()}).`) : null,
      topPhase ? `Main movement: ${topPhase.name} has the largest share in the selected dataset.` : null,
    ].filter(Boolean) as string[];

    return { daily, phaseContrib, dow, bands, peakHours, dayTypeChart, phaseHourly, heatMap, heatMax, kpis, insights };
  }, [filteredRows, filters.phase, result]);

  const tableRows = useMemo(() => {
    const q = filters.search.toLowerCase().trim();
    if (!q) return filteredRows;
    return filteredRows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));
  }, [filteredRows, filters.search]);

  const masterCols = result ? ["Date","Day","Hour","Highest Volume Phase",...result.phaseCols] : [];

  // ── Effect: detect columns on file change ─────────────────────────────────────
  useEffect(() => {
    if (!files.length) { setDetCols([]); setAllPhases([]); setDetToPhase({}); setDetectError(null); return; }
    (async () => {
      setDetectingCols(true); setDetectError(null);
      try {
        const fd = new FormData();
        files.forEach(f => fd.append("files", f));
        const { detCols:dets, phases, detToPhase:mapping } = await detectColumns(fd);
        setDetCols(dets); setAllPhases(phases); setDetToPhase(mapping);
      } catch (e: unknown) {
        setDetectError(e instanceof Error ? e.message : "Failed to read file headers");
        setFiles([]);
      } finally { setDetectingCols(false); }
    })();
  }, [files]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    setFiles(Array.from(incoming).filter(f =>
      f.name.toLowerCase().endsWith(".csv") || f.name.toLowerCase().endsWith(".zip")
    ));
    setError(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const processFiles = async () => {
    if (!files.length) return;
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("files", f));
      const data = await processTrafficFiles(fd, buildDetGroups(detToPhase));
      setResult(data);
      setFilters({ date:"All", dayType:"All", phase:"All", search:"" });
      setFilterOpen(false);
      setReprocessOpen(false);
      setTimeout(() => dashboardRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally { setLoading(false); }
  };

  const setFilter = (key: keyof Filters, val: string) => {
    setFilters(prev => ({ ...prev, [key]: val }));
    setTimeout(() => dashboardRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 100);
  };

  // ── Shared styles ─────────────────────────────────────────────────────────────
  const inputSx: React.CSSProperties = {
    width:"100%", padding:"9px 11px", borderRadius:9,
    background:"#f4f8fc", border:"1px solid #c8daea",
    color:"#0f1e2e", fontSize:13, outline:"none",
  };

  const phaseMappingPanel = detCols.length > 0 && (
    <div style={{ background:"#f8fafc", border:"1px solid #dde8f0", borderRadius:12, overflow:"hidden", marginTop:14 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", borderBottom:"1px solid #dde8f0" }}>
        <div>
          <span style={{ fontWeight:700, fontSize:13, color:"#0f1e2e" }}>Phase Mapping</span>
          <span style={{ fontSize:11, color:"#94a3b8", marginLeft:8 }}>auto-detected · adjust if needed</span>
        </div>
        <button onClick={()=>setMappingOpen(o=>!o)} style={{ background:"none", border:"none", color:"#64748b", cursor:"pointer", fontSize:12 }}>
          {mappingOpen ? "▲ Collapse" : "▼ Expand"}
        </button>
      </div>
      {mappingOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3">
          {detCols.map(det=>(
            <div key={det} className="flex items-center gap-2">
              <span style={{ fontSize:11, fontFamily:"monospace", color:"#64748b", width:80, flexShrink:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }} title={det}>{det}</span>
              <select value={detToPhase[det]??""} onChange={e=>setDetToPhase(p=>({...p,[det]:e.target.value}))} style={{...inputSx,padding:"6px 8px",fontSize:12,flex:1}}>
                <option value="">Unassigned</option>
                {allPhases.map(ph=><option key={ph} value={ph}>Phase {ph}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background:"linear-gradient(160deg,#e8f4fd,#f0f6fb 50%,#edf3f8)" }}>

      {/* ── FILTER DRAWER BACKDROP ───────────────────────────────── */}
      {filterOpen && (
        <div
          onClick={()=>setFilterOpen(false)}
          style={{ position:"fixed", inset:0, background:"rgba(15,30,46,.25)", zIndex:40, backdropFilter:"blur(2px)" }}
        />
      )}

      {/* ── FILTER DRAWER ────────────────────────────────────────── */}
      <aside
        style={{
          position:"fixed", top:0, left:0, height:"100vh", width:300, zIndex:50,
          background:"#fff", borderRight:"1px solid #e8f0f8",
          boxShadow: filterOpen ? "4px 0 40px rgba(0,0,0,.12)" : "none",
          transform: filterOpen ? "translateX(0)" : "translateX(-100%)",
          transition:"transform .25s cubic-bezier(.4,0,.2,1)",
          overflowY:"auto", display:"flex", flexDirection:"column",
        }}
      >
        {/* Drawer header */}
        <div style={{ padding:"18px 20px 16px", borderBottom:"1px solid #f0f6fb", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:8, background:"linear-gradient(135deg,#0284c7,#059669)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15 }}>📊</div>
            <div>
              <div style={{ fontSize:13, fontWeight:800, color:"#0f1e2e" }}>Traffic ZIP</div>
              <div style={{ fontSize:11, color:"#0284c7", fontWeight:600 }}>Analytics Platform</div>
            </div>
          </div>
          <button
            onClick={()=>setFilterOpen(false)}
            style={{ background:"none", border:"none", cursor:"pointer", padding:6, borderRadius:8, color:"#94a3b8", fontSize:18, lineHeight:1 }}
            aria-label="Close filters"
          >✕</button>
        </div>

        <div style={{ padding:"20px", flex:1 }}>
          {result ? (
            <>
              {/* Active filter badge */}
              {hasActiveFilters && (
                <div style={{ marginBottom:16, padding:"8px 12px", background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:9, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:12, color:"#1e40af", fontWeight:600 }}>Filters active</span>
                  <button onClick={()=>setFilters({date:"All",dayType:"All",phase:"All",search:""})} style={{ background:"none", border:"none", color:"#3b82f6", fontSize:12, cursor:"pointer", fontWeight:600 }}>Clear all ✕</button>
                </div>
              )}

              {/* Filter section */}
              <p style={{ fontSize:10, fontWeight:700, letterSpacing:.7, textTransform:"uppercase" as const, color:"#94a3b8", margin:"0 0 14px" }}>Chart Filters</p>

              <label style={{ fontSize:11, fontWeight:600, color:"#64748b", display:"block", marginBottom:6 }}>📅 Date</label>
              <select value={filters.date} onChange={e=>setFilter("date",e.target.value)} style={inputSx}>
                <option value="All">All Dates</option>
                {uniqueDates.map(d=><option key={d} value={d}>{d}</option>)}
              </select>

              <label style={{ fontSize:11, fontWeight:600, color:"#64748b", display:"block", margin:"14px 0 6px" }}>📆 Day Type</label>
              <select value={filters.dayType} onChange={e=>setFilter("dayType",e.target.value)} style={inputSx}>
                <option value="All">All Days</option>
                <option value="Weekday">Weekday (Mon–Thu)</option>
                <option value="Weekend">Weekend (Fri–Sun)</option>
              </select>

              <label style={{ fontSize:11, fontWeight:600, color:"#64748b", display:"block", margin:"14px 0 6px" }}>🔀 Phase</label>
              <select value={filters.phase} onChange={e=>setFilter("phase",e.target.value)} style={inputSx}>
                <option value="All">All Phases</option>
                {result.phaseCols.map(p=><option key={p} value={p}>{p}</option>)}
              </select>

              <label style={{ fontSize:11, fontWeight:600, color:"#64748b", display:"block", margin:"14px 0 6px" }}>🔍 Search Master Data</label>
              <input value={filters.search} onChange={e=>setFilter("search",e.target.value)} placeholder="Date, hour, day…" style={inputSx} />

              {/* Divider */}
              <div style={{ height:1, background:"#e8f0f8", margin:"24px 0 20px" }} />

              {/* Exports */}
              <p style={{ fontSize:10, fontWeight:700, letterSpacing:.7, textTransform:"uppercase" as const, color:"#94a3b8", margin:"0 0 12px" }}>Exports</p>
              <button onClick={()=>downloadBlob(result.masterCsv,"master_file_hourly.csv","text/csv")}
                style={{ width:"100%", marginBottom:8, padding:"10px 14px", borderRadius:10, border:"1px solid #d1e3f0", background:"#f4f8fc", color:"#0f1e2e", fontSize:13, cursor:"pointer", textAlign:"left" as const, display:"flex", alignItems:"center", gap:8, fontWeight:500 }}>
                <span>⬇</span> Download Master CSV
              </button>
              <button onClick={()=>downloadExcel(result)}
                style={{ width:"100%", padding:"10px 14px", borderRadius:10, border:"1px solid #d1e3f0", background:"#f4f8fc", color:"#0f1e2e", fontSize:13, cursor:"pointer", textAlign:"left" as const, display:"flex", alignItems:"center", gap:8, fontWeight:500 }}>
                <span>⬇</span> Download Insights Excel
              </button>
            </>
          ) : (
            /* No data state */
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", textAlign:"center", padding:"32px 0" }}>
              <div style={{ fontSize:36, marginBottom:16 }}>📊</div>
              <h3 style={{ margin:"0 0 8px", fontSize:15, fontWeight:700, color:"#0f1e2e" }}>No data loaded yet</h3>
              <p style={{ margin:0, fontSize:13, color:"#64748b", lineHeight:1.7 }}>
                Upload your traffic CSV files or a ZIP folder, then click{" "}
                <strong style={{ color:"#0284c7" }}>Process & Generate Dashboard</strong>{" "}
                to unlock filters, charts, and export options.
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* ── TOPBAR ───────────────────────────────────────────────── */}
      <header style={{
        position:"sticky", top:0, zIndex:30,
        background:"rgba(255,255,255,.88)", backdropFilter:"blur(14px)",
        borderBottom:"1px solid #e8f0f8",
        padding:"0 20px", height:58,
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
      }}>
        {/* Left: filter toggle + title */}
        <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
          <button
            onClick={()=>setFilterOpen(o=>!o)}
            aria-label="Toggle filters"
            style={{
              display:"flex", alignItems:"center", gap:7, flexShrink:0,
              padding:"7px 13px", borderRadius:9,
              border:`1px solid ${filterOpen || hasActiveFilters ? "#2563eb" : "#d1e3f0"}`,
              background: filterOpen ? "#2563eb" : hasActiveFilters ? "#eff6ff" : "#fff",
              color: filterOpen ? "#fff" : hasActiveFilters ? "#1d4ed8" : "#374151",
              fontSize:13, fontWeight:600, cursor:"pointer",
              transition:".15s background, .15s border-color, .15s color",
            }}
          >
            <BarsIcon size={14} color={filterOpen ? "#fff" : hasActiveFilters ? "#1d4ed8" : "#374151"} />
            Filters
            {hasActiveFilters && !filterOpen && (
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#2563eb", flexShrink:0 }} />
            )}
          </button>

          <div style={{ minWidth:0 }}>
            <h1 style={{ margin:0, fontSize:16, fontWeight:800, color:"#0f1e2e", letterSpacing:-.3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              Traffic Count Analytics
            </h1>
            {result && (
              <p style={{ margin:0, fontSize:11, color:"#94a3b8", lineHeight:1 }}>
                {result.rows.length.toLocaleString()} records loaded
              </p>
            )}
          </div>
        </div>

        {/* Right: status pills */}
        {result && (
          <div style={{ display:"flex", gap:8, flexShrink:0 }}>
            <span style={{ padding:"5px 11px", borderRadius:999, background:"#ecfdf5", border:"1px solid #a7f3d0", color:"#065f46", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>● Live</span>
            <span className="hidden sm:inline" style={{ padding:"5px 11px", borderRadius:999, background:"#eff6ff", border:"1px solid #bfdbfe", color:"#1e40af", fontSize:12, fontWeight:600, whiteSpace:"nowrap" }}>Data Ready</span>
          </div>
        )}
      </header>

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <main className="p-4 md:p-6 pb-16 mx-auto" style={{ maxWidth:1400 }}>

        {/* ── ONBOARDING: no data yet ──────────────────────────────── */}
        {!result && (
          <div className="flex flex-col items-center justify-center py-10 md:py-16">

            <div style={{ textAlign:"center", marginBottom:28, maxWidth:460 }}>
              <div style={{ width:56, height:56, borderRadius:16, background:"linear-gradient(135deg,#0284c7,#059669)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, margin:"0 auto 14px" }}>📊</div>
              <h2 style={{ margin:"0 0 10px", fontSize:22, fontWeight:800, color:"#0f1e2e", letterSpacing:-.4 }}>Analyse Your Traffic Data</h2>
              <p style={{ margin:0, color:"#64748b", fontSize:14, lineHeight:1.75 }}>
                Upload CSV files or a ZIP folder of detector count data to generate KPI summaries, phase analysis, and interactive charts instantly.
              </p>
            </div>

            <div className="w-full" style={{ maxWidth:520, background:"#fff", borderRadius:22, padding:26, boxShadow:"0 4px 40px rgba(0,0,0,.09)", border:"1px solid #e8f0f8" }}>
              <input id="file-input" type="file" multiple accept=".csv,.zip" className="hidden" onChange={e=>handleFiles(e.target.files)} />

              <UploadZone
                files={files} dragging={dragging} detectingCols={detectingCols}
                onDrop={handleDrop}
                onDragOver={e=>{e.preventDefault();setDragging(true);}}
                onDragLeave={()=>setDragging(false)}
                onClick={()=>document.getElementById("file-input")?.click()}
              />

              {phaseMappingPanel}

              {detectError && (
                <div style={{ marginTop:12, padding:11, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:9, color:"#b91c1c", fontSize:13 }}>
                  {detectError}
                </div>
              )}

              <button
                onClick={processFiles}
                disabled={!files.length || loading || detectingCols}
                style={{
                  width:"100%", marginTop:16, padding:"13px", borderRadius:12, border:"none",
                  background:(!files.length||loading||detectingCols)?"#e8f0f8":"linear-gradient(135deg,#0284c7,#059669)",
                  color:(!files.length||loading||detectingCols)?"#9ab4c8":"#fff",
                  fontWeight:700, fontSize:15, cursor:(!files.length||loading||detectingCols)?"not-allowed":"pointer", letterSpacing:-.2,
                }}
              >
                {loading ? "Processing…" : "Process & Generate Dashboard →"}
              </button>

              {error && (
                <div style={{ marginTop:12, padding:11, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:9, color:"#b91c1c", fontSize:13 }}>
                  {error}
                </div>
              )}

              <p style={{ margin:"12px 0 0", fontSize:12, color:"#94a3b8", textAlign:"center" }}>
                Expects a StartTime column and DET/VS/PB detector columns in each CSV.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-5 w-full" style={{ maxWidth:520 }}>
              {[
                { n:"1", label:"Extract",    d:"Read CSV files from upload or ZIP." },
                { n:"2", label:"Master Data",d:"Aggregate and standardise hourly rows." },
                { n:"3", label:"Insights",   d:"Populate KPIs, charts, and exports." },
              ].map(s=>(
                <div key={s.n} style={{ background:"#fff", border:"1px solid #e8f0f8", borderRadius:13, padding:"11px 13px", boxShadow:"0 1px 6px rgba(0,0,0,.04)" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:"#0284c7", marginBottom:3 }}>Step {s.n} · {s.label}</div>
                  <div style={{ fontSize:12, color:"#64748b", lineHeight:1.5 }}>{s.d}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── POST-PROCESS DASHBOARD ───────────────────────────────── */}
        {result && (
          <>
            {/* Collapsible re-process panel */}
            <div style={{ marginBottom:16 }}>
              <button
                onClick={()=>setReprocessOpen(o=>!o)}
                style={{
                  width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
                  padding:"11px 16px", borderRadius: reprocessOpen ? "12px 12px 0 0" : 12,
                  border:"1px solid #dde8f0", background:"#fff",
                  boxShadow:"0 1px 4px rgba(0,0,0,.05)", cursor:"pointer",
                }}
              >
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:16 }}>⬆</span>
                  <span style={{ fontSize:13, fontWeight:700, color:"#0f1e2e" }}>Upload / Re-process</span>
                  {files.length > 0 && (
                    <span style={{ fontSize:12, color:"#0284c7", fontWeight:500 }}>
                      {files.length} file{files.length !== 1 ? "s" : ""} selected
                    </span>
                  )}
                </div>
                <span style={{ fontSize:12, color:"#94a3b8" }}>{reprocessOpen ? "▲ Collapse" : "▼ Expand"}</span>
              </button>

              {reprocessOpen && (
                <div style={{ background:"#fff", border:"1px solid #dde8f0", borderTop:"none", borderRadius:"0 0 12px 12px", padding:"16px 20px 20px", boxShadow:"0 2px 8px rgba(0,0,0,.05)" }}>
                  <input id="file-input" type="file" multiple accept=".csv,.zip" className="hidden" onChange={e=>handleFiles(e.target.files)} />
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    <div>
                      <UploadZone
                        files={files} dragging={dragging} detectingCols={detectingCols}
                        onDrop={handleDrop}
                        onDragOver={e=>{e.preventDefault();setDragging(true);}}
                        onDragLeave={()=>setDragging(false)}
                        onClick={()=>document.getElementById("file-input")?.click()}
                      />
                      {detectError && <div style={{ marginTop:10, padding:10, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:9, color:"#b91c1c", fontSize:13 }}>{detectError}</div>}
                    </div>
                    <div>
                      {phaseMappingPanel}
                      <button
                        onClick={processFiles} disabled={!files.length||loading||detectingCols}
                        style={{ width:"100%", marginTop:12, padding:"11px", borderRadius:11, border:"none", background:(!files.length||loading||detectingCols)?"#e8f0f8":"linear-gradient(135deg,#0284c7,#059669)", color:(!files.length||loading||detectingCols)?"#9ab4c8":"#fff", fontWeight:700, fontSize:14, cursor:(!files.length||loading||detectingCols)?"not-allowed":"pointer" }}
                      >
                        {loading ? "Processing…" : "Regenerate Dashboard"}
                      </button>
                      {error && <div style={{ marginTop:10, padding:10, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:9, color:"#b91c1c", fontSize:13 }}>{error}</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* KPI Cards */}
            <div ref={dashboardRef} className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
              {charts && [
                { label:"Total Traffic",     v:Math.round(charts.kpis.totalTraffic).toLocaleString(), tag:"Selected phases", col:"#2563eb" },
                { label:"Avg Daily Traffic", v:Math.round(charts.kpis.avgDaily).toLocaleString(),    tag:`${charts.kpis.days} days`,   col:"#7c3aed" },
                { label:"Peak Hour Value",   v:Math.round(charts.kpis.peakValue).toLocaleString(),   tag:charts.kpis.peakLabel,        col:"#d97706" },
                { label:"Weekday Avg Daily", v:Math.round(charts.kpis.wdAvg).toLocaleString(),       tag:"Mon – Thu",                   col:"#2563eb" },
                { label:"Weekend Avg Daily", v:Math.round(charts.kpis.weAvg).toLocaleString(),       tag:"Fri – Sun",                   col:"#0891b2" },
              ].map(k=>(
                <div key={k.label} style={{
                  background:"#fff", borderRadius:13, padding:"14px 16px",
                  borderTop:`3px solid ${k.col}`, borderRight:"1px solid #e8f0f8",
                  borderBottom:"1px solid #e8f0f8", borderLeft:"1px solid #e8f0f8",
                  boxShadow:"0 1px 6px rgba(0,0,0,.04)",
                }}>
                  <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase" as const, letterSpacing:.5 }}>{k.label}</div>
                  <div style={{ fontSize:22, fontWeight:800, margin:"6px 0 3px", color:"#0f1e2e", letterSpacing:-.5 }}>{k.v}</div>
                  <div style={{ fontSize:11, color:k.col, fontWeight:600 }}>{k.tag}</div>
                </div>
              ))}
            </div>

            {/* Charts */}
            {charts && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <ChartCard title="Hourly Traffic Distribution" subtitle="Aggregated volume by hour of day" wide accent="#8b5cf6" height={270}>
                  <ResponsiveContainer width="100%" height={270}>
                    <LineChart data={charts.phaseHourly}>
                      <CartesianGrid stroke={AGRID} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{...ATICK,fontSize:9}} interval={2} />
                      <YAxis tick={ATICK} tickFormatter={fmt} />
                      <Tooltip {...TT} formatter={(v:number)=>v.toLocaleString()} />
                      <Legend wrapperStyle={{fontSize:12,color:"#64748b"}} iconType="circle" iconSize={9} />
                      {result.phaseCols.map((col,i)=>(
                        <Line key={col} type="monotone" dataKey={col} stroke={PALETTE[i%PALETTE.length]} dot={{r:2}} strokeWidth={2} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                  title="Daily Traffic Trend"
                  subtitle="Total volume by survey date"
                  accent="#2563eb"
                  badge={(() => {
                    const months = [...new Set(charts.daily.map(d => d.date.slice(0,7)))];
                    return months.map(m => new Date(+m.slice(0,4), +m.slice(5,7)-1, 1).toLocaleString("en-US",{month:"short",year:"numeric"})).join(" – ");
                  })()}
                >
                  <div style={{ overflowX:"auto", overflowY:"hidden" }}>
                    <div style={{ width: Math.max(420, charts.daily.length * 54), height:270 }}>
                      <LineChart width={Math.max(420, charts.daily.length * 54)} height={270} data={charts.daily}>
                        <CartesianGrid stroke={AGRID} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={ATICK} interval={0} />
                        <YAxis tick={ATICK} tickFormatter={fmt} width={46} />
                        <Tooltip {...TT} formatter={(v:number)=>v.toLocaleString()} labelFormatter={(l,p)=>p[0]?.payload?.date ?? l} />
                        <Line type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2.5} dot={{r:3,fill:"#2563eb",strokeWidth:0}} activeDot={{r:5}} />
                      </LineChart>
                    </div>
                  </div>
                </ChartCard>

                <ChartCard title="Phase Contribution" subtitle="Share of total traffic by phase" accent="#f59e0b" height={270}>
                  <ResponsiveContainer width="100%" height={270}>
                    <PieChart>
                      <Pie data={charts.phaseContrib} dataKey="value" nameKey="name" innerRadius="50%" outerRadius="75%" paddingAngle={3}>
                        {charts.phaseContrib.map((_,i)=><Cell key={i} fill={PALETTE[i%PALETTE.length]} />)}
                      </Pie>
                      <Tooltip {...TT} formatter={(v:number)=>v.toLocaleString()} />
                      <Legend wrapperStyle={{fontSize:12,color:"#64748b"}} iconType="circle" iconSize={9} />
                    </PieChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Day of Week Comparison" subtitle="Total volume by weekday" accent="#f59e0b" height={270}>
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={charts.dow}>
                      <CartesianGrid stroke={AGRID} strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={ATICK} />
                      <YAxis tick={ATICK} tickFormatter={fmt} />
                      <Tooltip {...TT} formatter={(v:number)=>v.toLocaleString()} />
                      <Bar dataKey="total" fill="#f59e0b" radius={[6,6,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Time Band Analysis" subtitle="Traffic volume by time of day" accent="#0891b2" height={270}>
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={charts.bands}>
                      <CartesianGrid stroke={AGRID} strokeDasharray="3 3" />
                      <XAxis dataKey="band" tick={ATICK} />
                      <YAxis tick={ATICK} tickFormatter={fmt} />
                      <Tooltip {...TT} formatter={(v:number)=>v.toLocaleString()} />
                      <Bar dataKey="total" radius={[8,8,0,0]}>
                        {charts.bands.map((b,i)=><Cell key={i} fill={b.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Top 10 Peak Hours" subtitle="Highest single-hour observations" accent="#ef4444" height={270}>
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={charts.peakHours} layout="vertical">
                      <CartesianGrid stroke={AGRID} strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={ATICK} tickFormatter={fmt} />
                      <YAxis type="category" dataKey="label" tick={{...ATICK,fontSize:10}} width={85} />
                      <Tooltip {...TT} formatter={(v:number)=>v.toLocaleString()} />
                      <Bar dataKey="total" fill="#ef4444" radius={[0,6,6,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Weekday vs Weekend" subtitle="Average hourly traffic by day type" accent="#059669" height={270}>
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={charts.dayTypeChart} barCategoryGap="40%">
                      <CartesianGrid stroke={AGRID} strokeDasharray="3 3" />
                      <XAxis dataKey="type" tick={ATICK} />
                      <YAxis tick={ATICK} tickFormatter={fmt} />
                      <Tooltip {...TT} formatter={(v:number)=>v.toLocaleString()} />
                      <Bar dataKey="avgHourly" radius={[10,10,0,0]}>
                        <Cell fill="#2563eb" /><Cell fill="#10b981" />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Traffic Heatmap" subtitle="Volume by day of week and hour — darker = higher" wide accent="#0284c7">
                  <HeatmapGrid heatMap={charts.heatMap} max={charts.heatMax} />
                </ChartCard>

                <ChartCard title="Auto Insights" subtitle="Observations derived from the loaded dataset" wide accent="#7c3aed">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
                    {charts.insights.map((insight,i)=>{
                      const colon = insight.indexOf(":");
                      return (
                        <div key={i} style={{ background:"#f8f9ff", border:"1px solid #dde8f8", borderRadius:11, padding:"14px 15px" }}>
                          <div style={{ fontSize:11, fontWeight:700, color:"#4f46e5", marginBottom:5, textTransform:"uppercase" as const, letterSpacing:.4 }}>{insight.slice(0,colon)}</div>
                          <div style={{ fontSize:13, color:"#374151", lineHeight:1.65 }}>{insight.slice(colon+1).trim()}</div>
                        </div>
                      );
                    })}
                  </div>
                </ChartCard>

                <ChartCard title="Master Data Preview" subtitle={`${tableRows.length.toLocaleString()} of ${result.rows.length.toLocaleString()} rows shown${hasActiveFilters ? " · filters active" : ""}`} wide accent="#64748b">
                  <div style={{ overflowY:"auto", maxHeight:290, borderRadius:10, border:"1px solid #e8f0f8" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", minWidth:680, fontSize:12 }}>
                      <thead>
                        <tr>
                          {masterCols.map(col=>(
                            <th key={col} style={{ position:"sticky", top:0, background:"#f8fafc", color:"#64748b", textAlign:"left", padding:"9px 14px", borderBottom:"1px solid #e8f0f8", fontWeight:600, whiteSpace:"nowrap", fontSize:11, letterSpacing:.2 }}>
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((row,i)=>(
                          <tr key={i} style={{ background:i%2===0?"#fff":"#fafcff", borderBottom:"1px solid #f1f5f9" }}>
                            {masterCols.map(col=>(
                              <td key={col} style={{ padding:"8px 14px", color:row[col]==="DNF"?"#c0d0e0":"#0f1e2e", fontStyle:row[col]==="DNF"?"italic":"normal", whiteSpace:"nowrap" }}>
                                {row[col]??"-"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ChartCard>

              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
