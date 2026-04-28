import { useState, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X, Download, Loader2, BarChart2, ChevronDown, ChevronUp, ArrowRight } from 'lucide-react'
import TopBar from '../../components/TopBar'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { useMonteCarloRun } from '../../hooks/useMonteCarlo'
import type { MonteCarloFlowResult, MonteCarloSensitivityRow } from '../../hooks/useMonteCarlo'
import { getSession } from '../../lib/supabase'

// ---------------------------------------------------------------------------
// Inline SVG histogram  (recharts is not in package.json)
// ---------------------------------------------------------------------------

function fmtBin(v: number): string {
  const abs = Math.abs(v)
  if (abs === 0) return '0'
  if (abs >= 1) return v.toFixed(2)
  if (abs >= 0.01) return v.toFixed(3)
  if (abs >= 0.001) return v.toFixed(4)
  if (abs >= 0.0001) return v.toFixed(5)
  return v.toExponential(2)
}

function SvgHistogram({ flow }: { flow: MonteCarloFlowResult }) {
  const { bin_edges, counts } = flow.histogram
  if (!counts.length || bin_edges.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        No histogram data
      </div>
    )
  }

  const W = 500
  const H = 260
  const PAD = { top: 12, right: 16, bottom: 44, left: 48 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const maxCount = Math.max(...counts, 1)
  const barW = innerW / counts.length

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * maxCount))
  const yScale = (v: number) => innerH - (v / maxCount) * innerH

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={`Histogram for ${flow.flow_name}`}
    >
      <g transform={`translate(${PAD.left},${PAD.top})`}>
        {yTicks.map((tick) => {
          const y = yScale(tick)
          return (
            <g key={tick}>
              <line x1={0} y1={y} x2={innerW} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={-6} y={y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
                {tick}
              </text>
            </g>
          )
        })}

        {counts.map((count, i) => {
          const barH = (count / maxCount) * innerH
          const mid =
            ((bin_edges[i] ?? 0) + (bin_edges[i + 1] ?? bin_edges[i] ?? 0)) / 2
          return (
            <g key={i}>
              <rect
                x={i * barW + 1}
                y={innerH - barH}
                width={Math.max(barW - 2, 1)}
                height={barH}
                fill="hsl(142.1 76.2% 36.3%)"
                rx={1}
              >
                <title>
                  [{fmtBin(bin_edges[i] ?? 0)}, {fmtBin(bin_edges[i + 1] ?? 0)}): {count}
                </title>
              </rect>
              {i % Math.ceil(counts.length / 6) === 0 && (
                <text
                  x={i * barW + barW / 2}
                  y={innerH + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#94a3b8"
                >
                  {fmtBin(mid)}
                </text>
              )}
            </g>
          )
        })}

        <line x1={0} y1={0} x2={0} y2={innerH} stroke="#cbd5e1" strokeWidth={1} />
        <line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke="#cbd5e1" strokeWidth={1} />

        <text
          x={-innerH / 2}
          y={-34}
          textAnchor="middle"
          fontSize={10}
          fill="#64748b"
          transform="rotate(-90)"
        >
          Frequency
        </text>
        <text
          x={innerW / 2}
          y={innerH + 36}
          textAnchor="middle"
          fontSize={10}
          fill="#64748b"
        >
          {flow.unit ?? ''}
        </text>
      </g>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Percentile table — enhanced with CV% and P95−P5
// ---------------------------------------------------------------------------

function fmt(value: number, unit: string | null): string {
  const sig = value.toPrecision(4)
  return unit ? `${sig} ${unit}` : sig
}

function PercentileTable({ flow }: { flow: MonteCarloFlowResult }) {
  const cvPct = flow.cv_pct
  const rangeP5P95 = flow.range_p5_p95
  const rows: [string, string][] = [
    ['Mean', fmt(flow.mean, flow.unit)],
    ['Std Dev', fmt(flow.std, flow.unit)],
    ['CV%', cvPct != null ? `${cvPct.toFixed(1)}%` : '—'],
    ['P5', fmt(flow.p5, flow.unit)],
    ['P25', fmt(flow.p25, flow.unit)],
    ['P50 (Median)', fmt(flow.p50, flow.unit)],
    ['P75', fmt(flow.p75, flow.unit)],
    ['P95', fmt(flow.p95, flow.unit)],
    ['P95 − P5', fmt(rangeP5P95, flow.unit)],
  ]
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead className="text-xs font-semibold text-slate-600">Statistic</TableHead>
          <TableHead className="text-xs font-semibold text-slate-600 text-right">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(([label, value]) => (
          <TableRow key={label}>
            <TableCell className="text-sm text-slate-600">{label}</TableCell>
            <TableCell className="text-sm font-mono text-right text-slate-800">
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ---------------------------------------------------------------------------
// Sensitivity table
// ---------------------------------------------------------------------------

function fmtPValue(p: number): string {
  return p < 0.001 ? '< 0.001' : p.toFixed(3)
}

function SensitivityTable({
  rows,
}: {
  rows: MonteCarloSensitivityRow[]
}) {
  if (!rows.length) {
    return (
      <p className="py-4 text-center text-sm text-slate-400">
        No parameters with |ρ| &gt; 0.1 for this flow.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead className="text-xs font-semibold text-slate-600">Parameter</TableHead>
          <TableHead className="text-xs font-semibold text-slate-600">Direction</TableHead>
          <TableHead className="text-xs font-semibold text-slate-600 text-right">
            Spearman ρ
          </TableHead>
          <TableHead className="text-xs font-semibold text-slate-600 text-right">p-value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.parameter_name}-${row.direction}`}>
            <TableCell className="text-sm font-medium text-slate-800">
              {row.parameter_name}
            </TableCell>
            <TableCell className="text-xs text-slate-400 capitalize">{row.direction}</TableCell>
            <TableCell
              className={[
                'text-sm font-mono text-right',
                row.spearman_rho >= 0 ? 'text-green-600' : 'text-red-600',
              ].join(' ')}
            >
              {row.spearman_rho >= 0 ? '+' : ''}
              {row.spearman_rho.toFixed(4)}
            </TableCell>
            <TableCell className="text-sm font-mono text-right text-slate-500">
              {fmtPValue(row.p_value)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ---------------------------------------------------------------------------
// Summary view — Key findings cards
// ---------------------------------------------------------------------------

function fmtAuto(v: number): string {
  const abs = Math.abs(v)
  if (abs === 0) return '0'
  if (abs >= 1000) return v.toExponential(2)
  if (abs >= 1) return v.toPrecision(4)
  if (abs >= 0.01) return v.toPrecision(3)
  return v.toExponential(2)
}

function KeyFindingsCards({
  flows,
  sensitivity,
}: {
  flows: MonteCarloFlowResult[]
  sensitivity: MonteCarloSensitivityRow[]
}) {
  const mostUncertain = useMemo(
    () =>
      [...flows]
        .filter((f) => f.std > 0)
        .sort((a, b) => (b.cv_pct ?? 0) - (a.cv_pct ?? 0))[0] ?? null,
    [flows],
  )

  const topDriver = useMemo(
    () =>
      sensitivity.length > 0
        ? [...sensitivity].sort(
            (a, b) => Math.abs(b.spearman_rho) - Math.abs(a.spearman_rho),
          )[0]
        : null,
    [sensitivity],
  )

  const zeroVarianceCount = useMemo(() => flows.filter((f) => f.std === 0).length, [flows])

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Most Uncertain Flow
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {mostUncertain ? (
            <>
              <p className="text-sm font-semibold text-slate-800 truncate">
                {mostUncertain.flow_name ?? '(unnamed)'}
              </p>
              <p className="text-2xl font-bold text-amber-600 mt-1">
                {mostUncertain.cv_pct != null ? `${mostUncertain.cv_pct.toFixed(1)}%` : '—'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Coefficient of variation</p>
            </>
          ) : (
            <p className="text-sm text-slate-400">No uncertain flows</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Primary Driver
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {topDriver ? (
            <>
              <p className="text-sm font-semibold text-slate-800 truncate">
                {topDriver.parameter_name}
              </p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">→ {topDriver.flow_name}</p>
              <p
                className={[
                  'text-2xl font-bold mt-1',
                  topDriver.spearman_rho >= 0 ? 'text-green-600' : 'text-red-600',
                ].join(' ')}
              >
                ρ = {topDriver.spearman_rho >= 0 ? '+' : ''}
                {topDriver.spearman_rho.toFixed(2)}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-400">No sensitivity data</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            Zero-Variance Flows
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-2xl font-bold text-slate-700">{zeroVarianceCount}</p>
          <p className="text-xs text-slate-400 mt-1">
            {zeroVarianceCount === 1 ? 'flow references' : 'flows reference'} no uncertain
            parameters
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary view — Uncertainty ranking table
// ---------------------------------------------------------------------------

function UncertaintyRankingTable({
  flows,
  onNavigateToFlow,
}: {
  flows: MonteCarloFlowResult[]
  onNavigateToFlow: (flowName: string, direction: string) => void
}) {
  const [showZeroVariance, setShowZeroVariance] = useState(false)

  const sorted = useMemo(
    () =>
      [...flows].sort((a, b) => {
        const av = a.cv_pct ?? -Infinity
        const bv = b.cv_pct ?? -Infinity
        return bv - av
      }),
    [flows],
  )

  const uncertain = sorted.filter((f) => f.std > 0)
  const zeroVar = sorted.filter((f) => f.std === 0)
  const displayed = showZeroVariance ? sorted : uncertain

  const maxRange = useMemo(
    () => Math.max(...uncertain.map((f) => f.range_p5_p95), 1e-10),
    [uncertain],
  )

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b">
        <p className="text-sm font-medium text-slate-700">Uncertainty Ranking</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Sorted by CV% descending · zero-variance flows hidden by default
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="text-xs font-semibold text-slate-600">Flow</TableHead>
              <TableHead className="text-xs font-semibold text-slate-600">Unit</TableHead>
              <TableHead className="text-xs font-semibold text-slate-600">Dir</TableHead>
              <TableHead className="text-xs font-semibold text-slate-600 text-right">Mean</TableHead>
              <TableHead className="text-xs font-semibold text-slate-600 text-right">
                Std Dev
              </TableHead>
              <TableHead className="text-xs font-semibold text-slate-600 text-right">CV%</TableHead>
              <TableHead className="text-xs font-semibold text-slate-600">P5→P95</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map((f, i) => {
              const range = f.range_p5_p95
              const barPct = maxRange > 0 ? Math.min((range / maxRange) * 100, 100) : 0
              return (
                <TableRow key={`${f.flow_name}-${f.direction}-${i}`}>
                  <TableCell className="text-sm font-medium text-slate-800 max-w-[180px] truncate">
                    {f.flow_name ?? '(unnamed)'}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">{f.unit}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        f.direction === 'input'
                          ? 'border-blue-200 bg-blue-50 text-blue-700 text-xs'
                          : 'border-green-200 bg-green-50 text-green-700 text-xs'
                      }
                    >
                      {f.direction === 'input' ? 'in' : 'out'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono text-right text-slate-700">
                    {fmtAuto(f.mean)}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-right text-slate-700">
                    {fmtAuto(f.std)}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-right font-semibold text-slate-800">
                    {f.cv_pct != null ? `${f.cv_pct.toFixed(1)}%` : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="w-24 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-slate-400 hover:text-slate-700"
                      onClick={() => onNavigateToFlow(f.flow_name ?? '', f.direction)}
                      aria-label={`View detail for ${f.flow_name}`}
                    >
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {zeroVar.length > 0 && (
        <div className="px-4 py-2 border-t">
          <button
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
            onClick={() => setShowZeroVariance((v) => !v)}
          >
            {showZeroVariance ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {showZeroVariance
              ? 'Hide zero-variance flows'
              : `Show ${zeroVar.length} zero-variance flow${zeroVar.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary view — Sensitivity heatmap
// ---------------------------------------------------------------------------

function SensitivityHeatmap({
  flows,
  sensitivity,
}: {
  flows: MonteCarloFlowResult[]
  sensitivity: MonteCarloSensitivityRow[]
}) {
  const uncertainFlows = useMemo(() => flows.filter((f) => f.std > 0), [flows])

  const params = useMemo(() => {
    const set = new Set<string>()
    sensitivity.forEach((s) => {
      if (Math.abs(s.spearman_rho) > 0.1) set.add(s.parameter_name)
    })
    return Array.from(set)
  }, [sensitivity])

  const lookup = useMemo(() => {
    const map = new Map<string, number>()
    sensitivity.forEach((s) => {
      map.set(`${s.parameter_name}|${s.flow_name}|${s.direction}`, s.spearman_rho)
    })
    return map
  }, [sensitivity])

  function cellBg(rho: number | undefined): string {
    if (rho === undefined || rho === 0) return 'white'
    const abs = Math.min(Math.abs(rho), 1)
    const l = Math.round(100 - abs * 60)
    return rho > 0 ? `hsl(142, 70%, ${l}%)` : `hsl(0, 70%, ${l}%)`
  }

  if (params.length === 0 || uncertainFlows.length === 0) {
    return (
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium text-slate-700">Sensitivity Heatmap</p>
        </div>
        <p className="py-6 text-center text-sm text-slate-400">
          No sensitivity data available for heatmap.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b">
        <p className="text-sm font-medium text-slate-700">Sensitivity Heatmap</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Parameters × uncertain flows · green = positive ρ, red = negative ρ · hover for exact
          value
        </p>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="text-left pr-4 pb-1 text-slate-500 font-medium min-w-[150px] align-bottom">
                Parameter
              </th>
              {uncertainFlows.map((f, i) => (
                <th key={i} className="pb-1 px-0.5 align-bottom">
                  <div
                    className="text-slate-500 font-medium overflow-hidden"
                    style={{
                      writingMode: 'vertical-lr',
                      transform: 'rotate(180deg)',
                      maxHeight: 76,
                      fontSize: 10,
                      lineHeight: 1.2,
                    }}
                    title={`${f.flow_name ?? ''} (${f.direction})`}
                  >
                    {(f.flow_name ?? '').length > 14
                      ? (f.flow_name ?? '').slice(0, 14) + '…'
                      : f.flow_name}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {params.map((param) => (
              <tr key={param}>
                <td
                  className="pr-4 py-0.5 text-slate-700 font-medium"
                  style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={param}
                >
                  {param.length > 22 ? param.slice(0, 22) + '…' : param}
                </td>
                {uncertainFlows.map((f, i) => {
                  const rho = lookup.get(`${param}|${f.flow_name}|${f.direction}`)
                  return (
                    <td
                      key={i}
                      style={{
                        width: 28,
                        height: 24,
                        backgroundColor: cellBg(rho),
                        border: '1px solid #f1f5f9',
                        cursor: 'default',
                      }}
                      title={rho !== undefined ? `ρ = ${rho.toFixed(4)}` : 'ρ = —'}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary view — Top parameter drivers (SVG horizontal bar chart)
// ---------------------------------------------------------------------------

function TopDriversChart({ sensitivity }: { sensitivity: MonteCarloSensitivityRow[] }) {
  const drivers = useMemo(() => {
    const map = new Map<string, { maxRho: number; dominantRho: number; flowName: string | null }>()
    sensitivity.forEach((s) => {
      const abs = Math.abs(s.spearman_rho)
      const cur = map.get(s.parameter_name)
      if (!cur || abs > cur.maxRho) {
        map.set(s.parameter_name, {
          maxRho: abs,
          dominantRho: s.spearman_rho,
          flowName: s.flow_name,
        })
      }
    })
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.maxRho - a.maxRho)
  }, [sensitivity])

  if (drivers.length === 0) {
    return (
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium text-slate-700">Top Parameter Drivers</p>
        </div>
        <p className="py-6 text-center text-sm text-slate-400">No parameter drivers found.</p>
      </div>
    )
  }

  const BAR_H = 22
  const BAR_GAP = 8
  const LABEL_W = 160
  const BAR_AREA_W = 260
  const VALUE_W = 48
  const W = LABEL_W + BAR_AREA_W + VALUE_W
  const H = drivers.length * (BAR_H + BAR_GAP) + 8

  const maxRho = Math.max(...drivers.map((d) => d.maxRho), 1e-10)

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b">
        <p className="text-sm font-medium text-slate-700">Top Parameter Drivers</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Max |ρ| across all flows · green = dominant positive correlation, red = negative
        </p>
      </div>
      <div className="p-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ maxWidth: W, minWidth: Math.min(W, 320) }}
          role="img"
          aria-label="Top parameter drivers bar chart"
        >
          {drivers.map((d, i) => {
            const y = i * (BAR_H + BAR_GAP)
            const barW = (d.maxRho / maxRho) * BAR_AREA_W
            const isPos = d.dominantRho >= 0
            const fill = isPos ? 'hsl(142, 70%, 40%)' : 'hsl(0, 70%, 50%)'
            const label = d.name.length > 24 ? d.name.slice(0, 24) + '…' : d.name
            return (
              <g key={d.name}>
                <text
                  x={LABEL_W - 6}
                  y={y + BAR_H / 2 + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="#475569"
                >
                  {label}
                </text>
                <rect x={LABEL_W} y={y} width={barW} height={BAR_H} fill={fill} rx={2}>
                  <title>
                    {d.name}: max |ρ| = {d.maxRho.toFixed(4)} (flow: {d.flowName})
                  </title>
                </rect>
                <text
                  x={LABEL_W + barW + 4}
                  y={y + BAR_H / 2 + 4}
                  fontSize={10}
                  fill="#475569"
                >
                  {d.maxRho.toFixed(3)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MonteCarloResultPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const { data: run, isLoading, error } = useMonteCarloRun(runId)

  const [mode, setMode] = useState<'summary' | 'detail'>('summary')
  const [selectedFlowName, setSelectedFlowName] = useState<string | null>(null)
  const [selectedFlowDirection, setSelectedFlowDirection] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const flows = useMemo(() => run?.flows ?? [], [run])

  const activeFlow = useMemo(() => {
    if (selectedFlowName) {
      return (
        flows.find(
          (f) =>
            f.flow_name === selectedFlowName &&
            (selectedFlowDirection == null || f.direction === selectedFlowDirection),
        ) ??
        flows[0] ??
        null
      )
    }
    return flows[0] ?? null
  }, [flows, selectedFlowName, selectedFlowDirection])

  const activeFlowName = activeFlow?.flow_name ?? null

  const sensitivityForFlow = (run?.sensitivity ?? []).filter(
    (s) => s.flow_name === activeFlow?.flow_name && s.direction === activeFlow?.direction,
  )

  function handleNavigateToFlow(flowName: string, direction: string) {
    setSelectedFlowName(flowName)
    setSelectedFlowDirection(direction)
    setMode('detail')
  }

  // ── Export handler ──────────────────────────────────────────────────────
  async function handleExport() {
    if (!runId) return
    setExporting(true)
    try {
      const session = await getSession()
      if (!session) throw new Error('Not authenticated')

      const baseUrl = import.meta.env.VITE_RAILWAY_FASTAPI_URL as string
      const res = await fetch(`${baseUrl}/api/v1/montecarlo/run/${runId}/export`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { detail?: string }).detail ?? `Export failed (${res.status})`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `montecarlo_${runId}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed', err)
    } finally {
      setExporting(false)
    }
  }

  // ── Loading state ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-screen flex-col bg-slate-50">
        <TopBar
          adminBreadcrumb={[
            { label: 'Monte Carlo', to: '/admin/montecarlo' },
            { label: 'Run', to: '' },
          ]}
        />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-5xl space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-80" />
            <Skeleton className="h-10 w-full" />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Skeleton className="h-72 w-full rounded-xl" />
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        </main>
      </div>
    )
  }

  // ── Fetch error ─────────────────────────────────────────────────────────
  if (error || !run) {
    return (
      <div className="flex h-screen flex-col bg-slate-50">
        <TopBar
          adminBreadcrumb={[
            { label: 'Monte Carlo', to: '/admin/montecarlo' },
            { label: 'Error', to: '' },
          ]}
        />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-5xl">
            <Alert variant="destructive">
              <AlertTitle>Failed to load run</AlertTitle>
              <AlertDescription>
                {(error as Error | null)?.message ?? 'Unknown error'}
              </AlertDescription>
            </Alert>
          </div>
        </main>
      </div>
    )
  }

  const runDate = new Date(run.created_at).toLocaleString()

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar
        adminBreadcrumb={[
          { label: 'Monte Carlo', to: '/admin/montecarlo' },
          { label: `Run ${new Date(run.created_at).toLocaleDateString()}`, to: '' },
        ]}
      />

      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">

          {/* Header row */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-slate-400" />
                <h1 className="text-xl font-semibold text-slate-800">Monte Carlo Results</h1>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                <span>{run.n_runs.toLocaleString()} runs</span>
                <span>·</span>
                <span>{runDate}</span>
                {run.failed_runs !== null && run.failed_runs > 0 && (
                  <>
                    <span>·</span>
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs">
                      {run.failed_runs} failed runs
                    </Badge>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exporting || run.status !== 'completed'}
                className="gap-1.5"
              >
                {exporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Export xlsx
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate('/admin/montecarlo')}
                aria-label="Back to Monte Carlo"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Failed run alert */}
          {run.status === 'failed' && (
            <Alert variant="destructive">
              <AlertTitle>Run failed</AlertTitle>
              <AlertDescription>
                {(run as { error_message?: string }).error_message ?? 'An error occurred during the run.'}
              </AlertDescription>
            </Alert>
          )}

          {/* Results — two-mode interface */}
          {run.status === 'completed' && flows.length > 0 && (
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as 'summary' | 'detail')}
            >
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="detail">Flow Detail</TabsTrigger>
              </TabsList>

              {/* ── Summary tab ── */}
              <TabsContent value="summary">
                <div className="space-y-6 mt-4">
                  <KeyFindingsCards flows={flows} sensitivity={run.sensitivity ?? []} />
                  <UncertaintyRankingTable
                    flows={flows}
                    onNavigateToFlow={handleNavigateToFlow}
                  />
                  <SensitivityHeatmap flows={flows} sensitivity={run.sensitivity ?? []} />
                  <TopDriversChart sensitivity={run.sensitivity ?? []} />
                </div>
              </TabsContent>

              {/* ── Flow Detail tab ── */}
              <TabsContent value="detail">
                <div className="space-y-6 mt-4">
                  {/* Flow selector tabs */}
                  <Tabs
                    value={activeFlowName ?? undefined}
                    onValueChange={(v) => {
                      setSelectedFlowName(v)
                      setSelectedFlowDirection(null)
                    }}
                  >
                    <TabsList className="flex-wrap h-auto gap-1">
                      {flows.map((f) => (
                        <TabsTrigger
                          key={`${f.flow_name ?? ''}-${f.direction}`}
                          value={f.flow_name ?? ''}
                          className="text-xs"
                        >
                          {f.flow_name ?? '(unnamed)'}
                          {f.direction === 'input' && (
                            <span className="ml-1 text-slate-400">↓</span>
                          )}
                          {f.direction === 'output' && (
                            <span className="ml-1 text-slate-400">↑</span>
                          )}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>

                  {/* Histogram + percentile table */}
                  {activeFlow && (
                    <>
                      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <div className="rounded-xl border bg-white p-4 shadow-sm">
                          <p className="mb-3 text-sm font-medium text-slate-700">Distribution</p>
                          <SvgHistogram flow={activeFlow} />
                        </div>

                        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                          <div className="px-4 py-3 border-b">
                            <p className="text-sm font-medium text-slate-700">Statistics</p>
                          </div>
                          <PercentileTable flow={activeFlow} />
                        </div>
                      </div>

                      {/* Sensitivity table */}
                      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b">
                          <p className="text-sm font-medium text-slate-700">
                            Sensitivity Analysis — top contributing parameters
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Spearman rank correlation · parameters with |ρ| &gt; 0.1
                          </p>
                        </div>
                        <SensitivityTable rows={sensitivityForFlow} />
                      </div>
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}

          {run.status === 'completed' && flows.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
              <p className="text-sm text-slate-400">
                No flows found in this revision — no results to display.
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
