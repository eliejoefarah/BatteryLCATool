import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X, Download, Loader2, BarChart2 } from 'lucide-react'
import TopBar from '../../components/TopBar'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { useMonteCarloRun } from '../../hooks/useMonteCarlo'
import type { MonteCarloFlowResult, MonteCarloSensitivityRow } from '../../hooks/useMonteCarlo'
import { getSession } from '../../lib/supabase'

// ---------------------------------------------------------------------------
// Inline SVG histogram  (recharts is not in package.json)
// ---------------------------------------------------------------------------

function fmtBin(v: number, maxMid: number): string {
  const absMax = Math.abs(maxMid)
  if (absMax >= 0.01) return v.toFixed(2)
  if (absMax >= 0.0001) return v.toFixed(4)
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

  const maxMid = Math.max(
    ...counts.map((_, i) =>
      Math.abs(((bin_edges[i] ?? 0) + (bin_edges[i + 1] ?? bin_edges[i] ?? 0)) / 2),
    ),
    0,
  )

  // Y-axis ticks (4 steps)
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
        {/* Y gridlines + ticks */}
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

        {/* Bars */}
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
                  [{fmtBin(bin_edges[i] ?? 0, maxMid)}, {fmtBin(bin_edges[i + 1] ?? 0, maxMid)}): {count}
                </title>
              </rect>
              {/* X-axis label — every ~5th bar to avoid crowding */}
              {i % Math.ceil(counts.length / 6) === 0 && (
                <text
                  x={i * barW + barW / 2}
                  y={innerH + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#94a3b8"
                >
                  {fmtBin(mid, maxMid)}
                </text>
              )}
            </g>
          )
        })}

        {/* Axes */}
        <line x1={0} y1={0} x2={0} y2={innerH} stroke="#cbd5e1" strokeWidth={1} />
        <line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke="#cbd5e1" strokeWidth={1} />

        {/* Axis labels */}
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
// Percentile table
// ---------------------------------------------------------------------------

function fmt(value: number, unit: string | null): string {
  const sig = value.toPrecision(4)
  return unit ? `${sig} ${unit}` : sig
}

function PercentileTable({ flow }: { flow: MonteCarloFlowResult }) {
  const rows: [string, number][] = [
    ['Mean', flow.mean],
    ['Std Dev', flow.std],
    ['P5', flow.p5],
    ['P25', flow.p25],
    ['P50 (Median)', flow.p50],
    ['P75', flow.p75],
    ['P95', flow.p95],
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
              {fmt(value, flow.unit)}
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
          <TableHead className="text-xs font-semibold text-slate-600 text-right">
            Spearman ρ
          </TableHead>
          <TableHead className="text-xs font-semibold text-slate-600 text-right">p-value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.parameter_name}>
            <TableCell className="text-sm font-medium text-slate-800">
              {row.parameter_name}
            </TableCell>
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
// Main page
// ---------------------------------------------------------------------------

export default function MonteCarloResultPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const { data: run, isLoading, error } = useMonteCarloRun(runId)

  const [selectedFlowName, setSelectedFlowName] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const flows = run?.flows ?? []
  const activeFlowName = selectedFlowName ?? flows[0]?.flow_name ?? null
  const activeFlow = flows.find((f) => f.flow_name === activeFlowName) ?? flows[0] ?? null

  const sensitivityForFlow = (run?.sensitivity ?? []).filter(
    (s) => s.flow_name === activeFlowName,
  )

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
      // toast not imported here — use alert fallback; parent toast is in the hook
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

          {/* Results */}
          {run.status === 'completed' && flows.length > 0 && (
            <>
              {/* Flow tabs */}
              <Tabs
                value={activeFlowName ?? undefined}
                onValueChange={(v) => setSelectedFlowName(v)}
              >
                <TabsList className="flex-wrap h-auto gap-1">
                  {flows.map((f) => (
                    <TabsTrigger
                      key={f.flow_name ?? ''}
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
                    {/* Histogram */}
                    <div className="rounded-xl border bg-white p-4 shadow-sm">
                      <p className="mb-3 text-sm font-medium text-slate-700">Distribution</p>
                      <SvgHistogram flow={activeFlow} />
                    </div>

                    {/* Percentile table */}
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
            </>
          )}

          {run.status === 'completed' && flows.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
              <p className="text-sm text-slate-400">
                No elementary flows found in this revision — no results to display.
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
