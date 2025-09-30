"use client";

import React, { useMemo, useState } from "react";
// UI (shadcn) & Icons
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Download, Info, LineChart as LineChartIcon, BarChart3 } from "lucide-react";

// ---- tiny helpers to avoid any ----
type Numeric = number | string;
function toNumber(v: Numeric): number {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

// Charts
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

// Data export
import * as XLSX from "xlsx";

/**
 * Product Production Analytics Dashboard — Investor Demo
 * Horizon: 3 years (36 months, 30-day months assumed for modeling simplicity)
 * Inputs: Monthly Budget, CPI, Retention points (D1, D7, D14, D30, D90, D180, D360), ARPDAU
 * Outputs: Installs per cohort/month, fitted daily retention curve D1–D1080, LTV (gross/net), Revenue, Margin, ROAS checkpoints, forecasts.
 * Styling: Premium clean layout with gold accents.
 */

// ------------------------------
// Helper types
// ------------------------------
const RET_KEYS = ["D1", "D7", "D14", "D30", "D90", "D180", "D360"] as const;
type AnchorKey = typeof RET_KEYS[number];

type RetentionAnchors = {
  D1: number;
  D7: number;
  D14: number;
  D30: number;
  D90: number;
  D180: number;
  D360: number;
};

type Inputs = {
  monthlyBudget: number;
  cpi: number;
  arpdaus: number;
  anchors: RetentionAnchors;
};

// ------------------------------
// Constants
// ------------------------------
const GOLD = "#D4AF37";
const HORIZON_MONTHS = 36;
const DAYS_PER_MONTH = 30;
const HORIZON_DAYS = HORIZON_MONTHS * DAYS_PER_MONTH; // 1080
const NET_FACTOR = 0.7;

const ROAS_CHECKPOINTS = [7, 30, 90, 180, 360, 720, 1080];

// ------------------------------
// Utilities
// ------------------------------
function pctToDec(x: number) {
  if (x <= 1) return x;
  return x / 100;
}

function formatUSD(x: number) {
  return x.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatPct(x: number) {
  return (x * 100).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%";
}

/** Fit a smooth exponential (log-linear) curve through retention anchors and extend to D1080. */
function fitRetentionCurve(anchors: RetentionAnchors): number[] {
  const pts: Record<number, number> = {
    1: pctToDec(anchors.D1),
    7: pctToDec(anchors.D7),
    14: pctToDec(anchors.D14),
    30: pctToDec(anchors.D30),
    90: pctToDec(anchors.D90),
    180: pctToDec(anchors.D180),
    360: pctToDec(anchors.D360),
  };

  // Ensure monotonic non-increasing
  const keys = Object.keys(pts)
    .map(Number)
    .sort((a, b) => a - b);
  for (let i = 1; i < keys.length; i++) {
    const kPrev = keys[i - 1];
    const k = keys[i];
    pts[k] = Math.min(pts[k], pts[kPrev]);
  }

  // Build daily curve from D1..D1080; D0 = 1
  const curve: number[] = new Array(HORIZON_DAYS + 1).fill(0);
  curve[0] = 1;

  // Piecewise exponential between anchors
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const ya = pts[a];
    const yb = pts[b];
    for (let t = a; t <= b; t++) {
      const ratio = (t - a) / (b - a);
      const y = ya * Math.pow(yb / Math.max(ya, 1e-9), ratio);
      curve[t] = Math.max(0, Math.min(1, y));
    }
  }

  // Extend beyond last anchor using last segment decay
  const lastA = keys[keys.length - 2];
  const lastB = keys[keys.length - 1];
  const ya = pts[lastA];
  const yb = pts[lastB];
  const dailyDecay = Math.pow((yb || 1e-9) / Math.max(ya, 1e-9), 1 / (lastB - lastA));
  for (let t = lastB + 1; t <= HORIZON_DAYS; t++) {
    curve[t] = curve[t - 1] * dailyDecay;
  }

  // Non-increasing & >= 0
  for (let t = 1; t <= HORIZON_DAYS; t++) {
    curve[t] = Math.max(0, Math.min(curve[t], curve[t - 1]));
  }

  return curve;
}

// Compute per-cohort daily revenue and aggregate to monthly buckets across calendar time.
function computeModel(inputs: Inputs) {
  const installsPerCohort = inputs.monthlyBudget > 0 && inputs.cpi > 0 ? inputs.monthlyBudget / inputs.cpi : 0;
  const retention = fitRetentionCurve(inputs.anchors);

  const dailyGross = retention.map((r) => installsPerCohort * r * inputs.arpdaus);
  const dailyNet = dailyGross.map((g) => g * NET_FACTOR);

  const grossLTV = dailyGross.reduce((a, b) => a + b, 0) / (installsPerCohort || 1);
  const netLTV = grossLTV * NET_FACTOR;

  const cumNet = dailyNet.reduce<number[]>((acc, v, i) => {
    acc[i] = (acc[i - 1] || 0) + v;
    return acc;
  }, []);
  const roasByDay: Record<number, number> = {};
  for (const d of ROAS_CHECKPOINTS) {
    const spend = inputs.monthlyBudget;
    roasByDay[d] = spend > 0 ? cumNet[Math.min(d, cumNet.length - 1)] / spend : 0;
  }

  // Aggregate across calendar months for 36 cohorts
  const months = new Array(HORIZON_MONTHS).fill(0).map((_, i) => i);
  const monthlyRevenueGross = new Array(HORIZON_MONTHS).fill(0);
  const monthlyRevenueNet = new Array(HORIZON_MONTHS).fill(0);
  const monthlyUASpend = new Array(HORIZON_MONTHS).fill(0);

  months.forEach((cohort) => {
    monthlyUASpend[cohort] += inputs.monthlyBudget;
    for (let t = 0; t < HORIZON_DAYS; t++) {
      const m = Math.floor((cohort * DAYS_PER_MONTH + t) / DAYS_PER_MONTH);
      if (m >= 0 && m < HORIZON_MONTHS) {
        monthlyRevenueGross[m] += dailyGross[t];
        monthlyRevenueNet[m] += dailyNet[t];
      } else if (m >= HORIZON_MONTHS) {
        break;
      }
    }
  });

  const monthlyRevenueNetCum = monthlyRevenueNet.reduce<number[]>((acc, v, i) => {
    acc[i] = (acc[i - 1] || 0) + v;
    return acc;
  }, []);

  const monthlyMargin = monthlyRevenueNet.map((net, i) => net - monthlyUASpend[i]);
  const monthlyMarginCum = monthlyMargin.reduce<number[]>((acc, v, i) => {
    acc[i] = (acc[i - 1] || 0) + v;
    return acc;
  }, []);

  return {
    installsPerCohort,
    retention,
    dailyGross,
    dailyNet,
    grossLTV,
    netLTV,
    roasByDay,
    monthlyRevenueGross,
    monthlyRevenueNet,
    monthlyRevenueNetCum,
    monthlyUASpend,
    monthlyMargin,
    monthlyMarginCum,
  };
}

// Build chart rows
function buildRetentionChartData(ret: number[]): Array<{ day: number; retention: number }> {
  return ret.map((v, i) => ({ day: i, retention: Math.max(0, v) }));
}

function buildMonthlyChartData(
  values: number[],
  label: string
): Array<{ month: number } & Record<string, number>> {
  return values.map((v, i) => ({ month: i + 1, [label]: v }));
}

function buildDualMonthlyChartData(
  a: number[],
  aLabel: string,
  b: number[],
  bLabel: string
): Array<{ month: number } & Record<string, number>> {
  return a.map((v, i) => ({ month: i + 1, [aLabel]: v, [bLabel]: b[i] ?? 0 }));
}

// Data export helpers
function downloadCSV(filename: string, rows: Array<Record<string, string | number>>) {
  const header = Object.keys(rows[0] || {});
  const csv = [header.join(","), ...rows.map((r) => header.map((h) => r[h]).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadXLSX(
  filename: string,
  sheets: Record<string, Array<Record<string, string | number>>>
) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

// ------------------------------
// Main Component
// ------------------------------
export default function Dashboard() {
  // Default demo inputs
  const [inputs, setInputs] = useState<Inputs>({
    monthlyBudget: 250000,
    cpi: 4.0,
    arpdaus: 0.25,
    anchors: { D1: 35, D7: 12, D14: 8, D30: 5, D90: 3, D180: 2.2, D360: 1.5 },
  });

  const model = useMemo(() => computeModel(inputs), [inputs]);

  // Build export datasets
  const retentionData = useMemo(() => buildRetentionChartData(model.retention), [model.retention]);
  const monthlyRevenueNC = useMemo(
    () => buildMonthlyChartData(model.monthlyRevenueNet, "NetRevenue"),
    [model.monthlyRevenueNet]
  );
  const monthlyRevenueC = useMemo(
    () => buildMonthlyChartData(model.monthlyRevenueNetCum, "CumulativeNetRevenue"),
    [model.monthlyRevenueNetCum]
  );
  const monthlyMarginNC = useMemo(
    () => buildMonthlyChartData(model.monthlyMargin, "Margin"),
    [model.monthlyMargin]
  );

  const roasRows: Array<{ Day: number; ROAS: number }> = ROAS_CHECKPOINTS.map((d) => ({
    Day: d,
    ROAS: model.roasByDay[d],
  }));

  const downloadAll = () => {
    const sheets: Record<string, Array<Record<string, string | number>>> = {
      Inputs: [
        { Metric: "Monthly Budget", Value: inputs.monthlyBudget },
        { Metric: "CPI", Value: inputs.cpi },
        { Metric: "ARPDAU", Value: inputs.arpdaus },
        ...Object.entries(inputs.anchors).map(([k, v]) => ({ Metric: k, Value: v })),
      ],
      RetentionCurve: retentionData.map((r) => ({ Day: r.day, Retention: r.retention })),
      MonthlyRevenueNet: monthlyRevenueNC.map((r) => ({ Month: r.month, NetRevenue: r.NetRevenue })),
      MonthlyRevenueNetCumulative: monthlyRevenueC.map((r) => ({
        Month: r.month,
        CumulativeNetRevenue: r.CumulativeNetRevenue,
      })),
      MonthlyMargin: monthlyMarginNC.map((r) => ({ Month: r.month, Margin: r.Margin })),
      ROAS: roasRows.map((r) => ({ Day: r.Day, ROAS: r.ROAS })),
    };
    downloadXLSX("game_analytics_dashboard.xlsx", sheets);
  };

  // ------------------------------
  // Render
  // ------------------------------
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl" style={{ background: GOLD }} />
            <h1 className="text-2xl md:text-3xl font-extrabold leading-none tracking-tight">
              <span className="bg-gradient-to-r from-[#FBE08B] via-[#D4AF37] to-[#9C7C1B] bg-clip-text text-transparent drop-shadow-[0_1px_10px_rgba(212,175,55,0.25)]">
                Product Production Analytics
              </span>
              <span className="ml-2 text-neutral-300 font-semibold">— 3-Year Forecast</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={downloadAll}
              className="border-0 shadow hover:shadow-lg transition-all duration-200"
              style={{
                background: "linear-gradient(180deg,#FBE08B 0%,#D4AF37 60%,#9C7C1B 100%)",
                color: "#111",
              }}
            >
              <Download className="mr-2 h-4 w-4" /> Export XLSX
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl gap-6 px-6 py-6">
        <Tabs defaultValue="dashboard" className="w-full">
          {/* === TABS: white bar, grey active, contrasting text === */}
          <TabsList className="grid w-full grid-cols-3 rounded-xl bg-white p-1 shadow">
            <TabsTrigger
              value="dashboard"
              className="rounded-lg text-neutral-700 data-[state=active]:bg-neutral-200 data-[state=active]:text-neutral-900"
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger
              value="formulas"
              className="rounded-lg text-neutral-700 data-[state=active]:bg-neutral-200 data-[state=active]:text-neutral-900"
            >
              Formulas &amp; Assumptions
            </TabsTrigger>
            <TabsTrigger
              value="download"
              className="rounded-lg text-neutral-700 data-[state=active]:bg-neutral-200 data-[state=active]:text-neutral-900"
            >
              Download Data
            </TabsTrigger>
          </TabsList>

          {/* DASHBOARD */}
          <TabsContent value="dashboard" className="space-y-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Inputs Card */}
              <Card className="lg:col-span-1 border-neutral-800 bg-neutral-900/60 hover:border-[#D4AF37]/40 transition-colors duration-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <Info className="h-5 w-5" /> Inputs
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-neutral-300">
                      Monthly Budget (UA) <span className="text-neutral-500">(USD)</span>
                    </Label>
                    <Input
                      type="number"
                      value={inputs.monthlyBudget}
                      onChange={(e) => setInputs({ ...inputs, monthlyBudget: Number(e.target.value) })}
                      className="bg-neutral-800/80 border-neutral-700 text-white placeholder-neutral-400 focus-visible:ring-0 focus-visible:border-neutral-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-neutral-300">
                        CPI <span className="text-neutral-500">(USD)</span>
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={inputs.cpi}
                        onChange={(e) => setInputs({ ...inputs, cpi: Number(e.target.value) })}
                        className="bg-neutral-800/80 border-neutral-700 text-white placeholder-neutral-400 focus-visible:ring-0 focus-visible:border-neutral-500"
                      />
                    </div>
                    <div>
                      <Label className="text-neutral-300">
                        ARPDAU <span className="text-neutral-500">(USD)</span>
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={inputs.arpdaus}
                        onChange={(e) => setInputs({ ...inputs, arpdaus: Number(e.target.value) })}
                        className="bg-neutral-800/80 border-neutral-700 text-white placeholder-neutral-400 focus-visible:ring-0 focus-visible:border-neutral-500"
                      />
                    </div>
                  </div>

                  <Separator className="my-2 bg-neutral-800" />

                  <div className="grid grid-cols-3 gap-4">
                    {RET_KEYS.map((k: AnchorKey) => (
                      <div key={k}>
                        <Label className="text-neutral-300">{k} Retention (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={inputs.anchors[k]}
                          onChange={(e) =>
                            setInputs((prev) => ({
                              ...prev,
                              anchors: { ...prev.anchors, [k]: Number(e.target.value) } as RetentionAnchors,
                            }))
                          }
                          className="bg-neutral-800/80 border-neutral-700 text-white placeholder-neutral-400 focus-visible:ring-0 focus-visible:border-neutral-500"
                        />
                      </div>
                    ))}
                  </div>

                  {/* KPIs */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { label: "Installs / month", value: Math.round(model.installsPerCohort).toLocaleString() },
                      { label: "Gross LTV", value: formatUSD(model.grossLTV) },
                      { label: "Net LTV (30% off)", value: formatUSD(model.netLTV) },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className="rounded-xl border border-neutral-800 bg-neutral-950/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                      >
                        <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-400">{s.label}</div>
                        <div className="mt-1 text-xl md:text-2xl font-bold tabular-nums tracking-tight text-neutral-100">
                          {s.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Retention Curve */}
              <Card className="lg:col-span-2 border-neutral-800 bg-neutral-900/60 hover:border-[#D4AF37]/40 transition-colors duration-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <LineChartIcon className="h-5 w-5" /> Retention Curve (D0–D1080)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer>
                      <LineChart data={retentionData} margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                        <XAxis dataKey="day" stroke="#aaa" tick={{ fill: "#aaa" }} />
                        <YAxis stroke="#aaa" tickFormatter={(v) => formatPct(v)} tick={{ fill: "#aaa" }} />
                        <Tooltip
                          formatter={(v: number) => formatPct(v)}
                          labelFormatter={(l: number) => `Day ${l}`}
                          contentStyle={{ background: "#131313", border: "1px solid #333" }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="retention" stroke={GOLD} dot={false} strokeWidth={2} name="Daily Retention" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Revenue & Margin */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="border-neutral-800 bg-neutral-900/60 hover:border-[#D4AF37]/40 transition-colors duration-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <BarChart3 className="h-5 w-5" /> Revenue (Net) — Monthly
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer>
                      <BarChart
                        data={buildDualMonthlyChartData(
                          model.monthlyRevenueNet,
                          "Net",
                          model.monthlyRevenueNetCum,
                          "CumulativeNet"
                        )}
                        margin={{ left: 10, right: 20, top: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                        <XAxis dataKey="month" stroke="#aaa" tick={{ fill: "#aaa" }} />
                        <YAxis stroke="#aaa" tickFormatter={(v) => formatUSD(v)} tick={{ fill: "#aaa" }} />
                        <Tooltip
                          formatter={(v: number) => formatUSD(v)}
                          labelFormatter={(l: number) => `Month ${l}`}
                          contentStyle={{ background: "#131313", border: "1px solid #333" }}
                        />
                        <Legend />
                        <Bar dataKey="Net" name="Net Revenue" fill={GOLD} />
                        <Bar dataKey="CumulativeNet" name="Cumulative Net" fill="#888888" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-neutral-800 bg-neutral-900/60 hover:border-[#D4AF37]/40 transition-colors duration-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <BarChart3 className="h-5 w-5" /> Margin after UA — Monthly
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer>
                      <BarChart
                        data={buildDualMonthlyChartData(
                          model.monthlyMargin,
                          "Margin",
                          model.monthlyMarginCum,
                          "CumulativeMargin"
                        )}
                        margin={{ left: 10, right: 20, top: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                        <XAxis dataKey="month" stroke="#aaa" tick={{ fill: "#aaa" }} />
                        <YAxis stroke="#aaa" tickFormatter={(v) => formatUSD(v)} tick={{ fill: "#aaa" }} />
                        <Tooltip
                          formatter={(v: number) => formatUSD(v)}
                          labelFormatter={(l: number) => `Month ${l}`}
                          contentStyle={{ background: "#131313", border: "1px solid #333" }}
                        />
                        <Legend />
                        <Bar dataKey="Margin" name="Margin (Net - UA)" fill={GOLD} />
                        <Bar dataKey="CumulativeMargin" name="Cumulative Margin" fill="#888888" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ROAS */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="border-neutral-800 bg-neutral-900/60 hover:border-[#D4AF37]/40 transition-colors duration-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <LineChartIcon className="h-5 w-5" /> Cohort ROAS over Time
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer>
                      <LineChart
                        data={ROAS_CHECKPOINTS.map((d) => ({ day: d, roas: model.roasByDay[d] }))}
                        margin={{ left: 10, right: 20, top: 10, bottom: 10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                        {/* === White ticks/axes/legend/tooltip for ROAS chart === */}
                        <XAxis dataKey="day" stroke="#fff" tick={{ fill: "#fff" }} />
                        <YAxis stroke="#fff" tickFormatter={(v) => formatPct(v)} tick={{ fill: "#fff" }} />
                        <Tooltip
                          formatter={(v: number) => formatPct(v)}
                          labelFormatter={(l: number) => `Day ${l}`}
                          contentStyle={{ background: "#0f0f0f", border: "1px solid #2f2f2f", color: "#fff" }}
                        />
                        <Legend wrapperStyle={{ color: "#fff" }} />
                        <Line type="monotone" dataKey="roas" name="ROAS" stroke={GOLD} strokeWidth={2.5} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-neutral-800 bg-neutral-900/60 hover:border-[#D4AF37]/40 transition-colors duration-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">ROAS Checkpoints</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-xl border border-neutral-800">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-950">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-white">Day</th>
                          <th className="px-3 py-2 text-right font-medium text-white">ROAS (%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ROAS_CHECKPOINTS.map((d, i) => (
                          <tr key={d} className={i % 2 ? "bg-neutral-900/40" : "bg-neutral-900/20"}>
                            <td className="px-3 py-2 text-neutral-100">D{d}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-neutral-100">
                              {formatPct(model.roasByDay[d])}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* FORMULAS & ASSUMPTIONS */}
          <TabsContent value="formulas">
            <Card className="border-neutral-800 bg-neutral-900/60 hover:border-[#D4AF37]/40 transition-colors duration-200">
              <CardHeader>
                <CardTitle className="text-white">Formulas &amp; Assumptions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm leading-6 text-neutral-300">
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="font-semibold" style={{ color: GOLD }}>
                    Cohort &amp; Horizon
                  </div>
                  <ul className="ml-5 list-disc">
                    <li>Horizon: 36 months (3 years), modeled as 30-day months (1080 days total).</li>
                    <li>New install cohort starts each month with constant UA budget.</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="font-semibold" style={{ color: GOLD }}>Installs</div>
                  <p>Installs per month (per cohort) = <b>Budget ÷ CPI</b>.</p>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="font-semibold" style={{ color: GOLD }}>Retention Curve</div>
                  <ul className="ml-5 list-disc">
                    <li>Inputs: D1, D7, D14, D30, D90, D180, D360 (as % or decimal).</li>
                    <li>Fitting: piecewise exponential (log-linear) between anchors; beyond D360, extend with last segment daily decay.</li>
                    <li>We set D0 = 100% for cohort baseline; the curve is constrained to be non-increasing.</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="font-semibold" style={{ color: GOLD }}>Revenue</div>
                  <ul className="ml-5 list-disc">
                    <li>Daily Gross Revenue (per cohort day <i>t</i>): <b>Installs × Retention(t) × ARPDAU</b>.</li>
                    <li>Gross LTV: <b>Σ Daily Retention × ARPDAU</b>.</li>
                    <li>Net LTV &amp; Revenue: <b>Gross × 0.7</b> (deduct 30% platform fee).</li>
                    <li>Revenue over time: sum all active cohorts by calendar month.</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="font-semibold" style={{ color: GOLD }}>Margin after UA</div>
                  <p>Monthly Margin = <b>Net Revenue − UA Spend</b> (UA spend equals the month’s budget for the cohort starting in that month).</p>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="font-semibold" style={{ color: GOLD }}>ROAS</div>
                  <ul className="ml-5 list-disc">
                    <li>At checkpoints D7/30/90/180/360/720/1080: <b>(Cohort Net Revenue up to day) ÷ UA Spend</b>.</li>
                    <li>Reported as a percentage.</li>
                  </ul>
                </div>
                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="font-semibold" style={{ color: GOLD }}>Notes</div>
                  <ul className="ml-5 list-disc">
                    <li>30-day months used for aggregation consistency across cohorts.</li>
                    <li>All inputs are user-editable; charts update instantly.</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DOWNLOAD TAB */}
          <TabsContent value="download">
            <Card className="border-neutral-800 bg-neutral-900/60 hover:border-[#D4AF37]/40 transition-colors duration-200">
              <CardHeader>
                <CardTitle className="text-white">Download Data</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-neutral-300">
                <p className="leading-6">
                  Use the gold button in the header to export <b>all inputs and outputs</b> as a single <b>.xlsx</b> workbook. You can also
                  export individual tables below as <b>.csv</b> for quick reuse in spreadsheets or BI tools.
                </p>

                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => downloadCSV("retention_curve.csv", retentionData)}
                    className="border-0 shadow hover:shadow-lg transition-all duration-200"
                    style={{ background: "linear-gradient(180deg,#FBE08B 0%,#D4AF37 60%,#9C7C1B 100%)", color: "#111" }}
                  >
                    Retention CSV
                  </Button>
                  <Button
                    onClick={() => downloadCSV("monthly_revenue_net.csv", monthlyRevenueNC)}
                    className="border-0 shadow hover:shadow-lg transition-all duration-200"
                    style={{ background: "linear-gradient(180deg,#FBE08B 0%,#D4AF37 60%,#9C7C1B 100%)", color: "#111" }}
                  >
                    Monthly Net Revenue CSV
                  </Button>
                  <Button
                    onClick={() => downloadCSV("monthly_margin.csv", monthlyMarginNC)}
                    className="border-0 shadow hover:shadow-lg transition-all duration-200"
                    style={{ background: "linear-gradient(180deg,#FBE08B 0%,#D4AF37 60%,#9C7C1B 100%)", color: "#111" }}
                  >
                    Monthly Margin CSV
                  </Button>
                  <Button
                    onClick={() => downloadCSV("roas_checkpoints.csv", roasRows)}
                    className="border-0 shadow hover:shadow-lg transition-all duration-200"
                    style={{ background: "linear-gradient(180deg,#FBE08B 0%,#D4AF37 60%,#9C7C1B 100%)", color: "#111" }}
                  >
                    ROAS CSV
                  </Button>
                </div>

                <Separator className="my-2 bg-neutral-800" />

                <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
                  <div className="font-semibold" style={{ color: GOLD }}>
                    Tips
                  </div>
                  <ul className="ml-5 list-disc">
                    <li>After export, open in Excel/Sheets and adjust formatting as needed.</li>
                    <li>Retention percentages can be pasted directly; decimals are accepted.</li>
                    <li>To adapt for weekly aggregation, change <code>DAYS_PER_MONTH</code> and rebuild aggregation logic.</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <footer className="border-t border-neutral-800 py-6 text-center text-xs text-neutral-400">
        <div className="mx-auto max-w-7xl px-6">
          Built for investor demos • Premium layout • Gold accents • Cohort-based modeling
        </div>
      </footer>
    </div>
  );
}
