import { useMemo } from "react";
import type { DeviationTimeline } from "@workspace/api-client-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDate, fmtNum, toUtcTs } from "./format";

type Pt = { t: number; planned: number | null; actual: number | null; deviation: number | null; kind: string };

const PLAN = "#61A9BD";
const ACT = "#1F74AD";
const LIVE = "#E98E2E";

export function TimelineChart({ timeline }: { timeline: DeviationTimeline }) {
  const { reports, live } = useMemo(() => {
    const reports: Pt[] = [];
    const live: Pt[] = [];
    for (const p of timeline.points ?? []) {
      const row: Pt = { t: toUtcTs(p.date), planned: p.plannedProgress ?? null, actual: p.actualProgress ?? null, deviation: p.deviation ?? null, kind: p.kind };
      (p.kind === "live" ? live : reports).push(row);
    }
    reports.sort((a, b) => a.t - b.t);
    return { reports, live };
  }, [timeline]);

  if (reports.length + live.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">لا توجد تقارير محفوظة أو قراءة حية لرسم المسار بعد.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs font-semibold">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed" style={{ borderColor: PLAN }} />المخطط (تقارير)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5" style={{ background: ACT }} />الفعلي (تقارير)</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rotate-45" style={{ background: LIVE }} />القراءة الحية الآن</span>
      </div>
      <div className="h-[260px] w-full sm:h-[320px]" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 10, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} allowDuplicatedCategory={false}
              tickFormatter={(v: number) => fmtDate(new Date(v).toISOString(), false)} fontSize={11}
              tick={{ fill: "hsl(var(--muted-foreground))" }} />
            <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} fontSize={11} width={44} tick={{ fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              labelFormatter={(v) => fmtDate(new Date(Number(v)).toISOString())}
              formatter={(v, name) => [v == null ? "—" : `${fmtNum(Number(v))}%`, String(name)]}
              contentStyle={{ direction: "rtl", textAlign: "right", background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }}
            />
            <Line data={reports} dataKey="planned" name="المخطط (تقرير)" stroke={PLAN} strokeDasharray="5 4" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls={false} />
            <Line data={reports} dataKey="actual" name="الفعلي (تقرير)" stroke={ACT} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} connectNulls={false} />
            {live.length > 0 && (
              <Line data={live} dataKey="actual" name="الفعلي (حي)" stroke={LIVE} strokeWidth={0} isAnimationActive={false} connectNulls={false}
                dot={{ r: 6, fill: LIVE, stroke: "hsl(var(--card))", strokeWidth: 2 }} />
            )}
            {live.length > 0 && (
              <Line data={live} dataKey="planned" name="المخطط (حي)" stroke={LIVE} strokeWidth={0} isAnimationActive={false} connectNulls={false}
                dot={{ r: 4, fill: "hsl(var(--card))", stroke: LIVE, strokeWidth: 2 }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        النقاط من التقارير المحفوظة؛ الفجوات تعني قيماً غير متاحة ولا تُوصل. القراءة الحية تظهر منفصلة حتى لو وافقت تاريخ تقرير. التواريخ بتوقيت UTC.
      </p>
    </div>
  );
}
