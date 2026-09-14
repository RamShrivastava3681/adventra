import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import { fmtCompact, fmtFull, CardError } from "./cards";

type Mode = "daily" | "weekly" | "monthly";

/**
 * Cash Position: Actual vs Projected.
 * Actual = period opening cash (solid). Projected = period closing cash (dashed).
 * Both come from the existing cash-flow forecast endpoint — no invented data.
 */
export function CashPositionCard({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<Mode>("daily");

  const forecastQ = useQuery({
    queryKey: ["cmd-cash-chart", mode],
    queryFn: () => api.cashFlow.forecast.get(mode, "with_commitments"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const data = useMemo(() => {
    const periods = forecastQ.data?.periods ?? [];
    return periods.slice(0, mode === "daily" ? 30 : 13).map((p: any, i: number) => ({
      i,
      name:
        p?.label?.split(" (")[0] ?? String(p?.startDate ?? p?.start_date ?? `P${i + 1}`).slice(5),
      actual: Number(p?.openingCash ?? p?.opening_cash ?? 0),
      projected: Number(p?.closingCash ?? p?.closing_cash ?? 0),
    }));
  }, [forecastQ.data, mode]);

  const buffer = Number(forecastQ.data?.minimumCashBuffer ?? 0);
  const shortage = forecastQ.data?.shortageRisk;
  const belowBuffer = data.some((d: any) => d.projected < buffer && buffer > 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-[var(--color-chart-1)]" /> Actual
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-sem-attention" />{" "}
            Projected
          </span>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-border text-[11px] font-semibold">
          {(["daily", "weekly", "monthly"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`px-2.5 py-1.5 transition-colors ${
                mode === m
                  ? "bg-primary-soft text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {m === "daily" ? "30D" : m === "weekly" ? "13W" : "6M"}
            </button>
          ))}
        </div>
      </div>

      {forecastQ.isLoading ? (
        <div
          className="h-64 animate-pulse rounded-xl bg-muted/40"
          aria-label="Loading cash chart"
        />
      ) : forecastQ.isError || data.length === 0 ? (
        <CardError
          title="Cash forecast unavailable"
          message="Projected cash data is not currently available."
          onRetry={() => forecastQ.refetch()}
        />
      ) : (
        <>
          {belowBuffer && (
            <p role="alert" className="mb-2 text-xs font-medium text-sem-attention">
              Projected cash falls below the configured minimum buffer
              {shortage ? ` — deficit expected around ${shortage.shortageDate ?? ""}` : ""}. See
              Cash Command Centre for detail.
            </p>
          )}
          <div className={compact ? "h-64" : "h-72"}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => fmtCompact(v)}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-border-strong)" }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                  formatter={(v: any, name: string) => [
                    fmtFull(Number(v)),
                    name === "actual" ? "Actual" : "Projected",
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                {buffer > 0 && (
                  <ReferenceLine
                    y={buffer}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    strokeWidth={1.25}
                    label={{
                      value: `Buffer ${fmtCompact(buffer)}`,
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: "#ef4444",
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual"
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 3.5 }}
                />
                <Line
                  type="monotone"
                  dataKey="projected"
                  name="Projected"
                  stroke="var(--sem-attention)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  activeDot={{ r: 3.5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
