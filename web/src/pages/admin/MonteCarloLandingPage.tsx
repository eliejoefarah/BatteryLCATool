import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, BarChart2, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import TopBar from '../../components/TopBar'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover'
import { Skeleton } from '../../components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  useValidatedRevisions,
  useRevisionMonteCarloRuns,
  useTriggerMonteCarlo,
} from '../../hooks/useMonteCarlo'
import type { ValidatedRevisionRow, MonteCarloRunSummary } from '../../hooks/useMonteCarlo'

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

function ValidationBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400 text-xs">—</span>
  if (status === 'pass')
    return (
      <Badge variant="outline" className="w-fit border-green-200 bg-green-50 text-green-700 text-xs gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Pass
      </Badge>
    )
  if (status === 'warning')
    return (
      <Badge variant="outline" className="w-fit border-amber-200 bg-amber-50 text-amber-700 text-xs gap-1">
        <AlertTriangle className="h-3 w-3" />
        Warning
      </Badge>
    )
  return (
    <Badge variant="outline" className="w-fit border-red-200 bg-red-50 text-red-700 text-xs">
      Fail
    </Badge>
  )
}

function RevisionStatusBadge({ status }: { status: string }) {
  if (status === 'validated')
    return (
      <Badge className="border-0 bg-green-100 text-green-700 text-xs capitalize">
        validated
      </Badge>
    )
  if (status === 'frozen')
    return (
      <Badge className="border-0 bg-blue-100 text-blue-700 text-xs capitalize">
        frozen
      </Badge>
    )
  return (
    <Badge className="border-0 bg-slate-100 text-slate-600 text-xs capitalize">
      {status}
    </Badge>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'completed')
    return (
      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs">
        completed
      </Badge>
    )
  if (status === 'failed')
    return (
      <Badge variant="destructive" className="text-xs">
        failed
      </Badge>
    )
  return (
    <Badge variant="outline" className="border-slate-200 text-slate-500 text-xs">
      {status}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Expanded sub-table for a revision's previous runs
// ---------------------------------------------------------------------------

function RunsSubTable({
  revisionId,
  isExpanded,
}: {
  revisionId: string
  isExpanded: boolean
}) {
  const navigate = useNavigate()
  const { data: runs, isLoading } = useRevisionMonteCarloRuns(revisionId, isExpanded)

  if (!isExpanded) return null

  return (
    <TableRow className="bg-slate-50 hover:bg-slate-50">
      <TableCell colSpan={7} className="p-0">
        <div className="px-8 py-3">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full rounded" />
              ))}
            </div>
          ) : !runs?.length ? (
            <p className="py-2 text-sm italic text-slate-400">No previous runs for this revision.</p>
          ) : (
            <div className="rounded-lg border bg-white overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-semibold text-slate-500 h-8">Run</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 h-8">Date</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 h-8">N runs</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-500 h-8">Status</TableHead>
                    <TableHead className="h-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run: MonteCarloRunSummary, i: number) => (
                    <TableRow key={run.run_id} className="text-sm">
                      <TableCell className="text-slate-600 font-medium">#{i + 1}</TableCell>
                      <TableCell className="text-slate-500">
                        {new Date(run.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {run.n_runs.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <RunStatusBadge status={run.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        {run.status === 'completed' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => navigate(`/admin/montecarlo/${run.run_id}`)}
                          >
                            View
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// Generate popover for one revision row
// ---------------------------------------------------------------------------

function GeneratePopover({
  revision,
  isGenerating,
  onGenerate,
}: {
  revision: ValidatedRevisionRow
  isGenerating: boolean
  onGenerate: (revisionId: string, nRuns: number) => void
}) {
  const [nRuns, setNRuns] = useState(1000)
  const [open, setOpen] = useState(false)

  if (isGenerating) {
    return (
      <div className="flex items-center gap-2 text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Running…</span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          Generate New Run
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="end">
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">Configure run</p>
          <div className="space-y-1.5">
            <Label htmlFor={`nruns-${revision.revision_id}`} className="text-xs">
              Number of runs
            </Label>
            <Input
              id={`nruns-${revision.revision_id}`}
              type="number"
              min={1}
              max={10000}
              value={nRuns}
              onChange={(e) => setNRuns(Math.min(10000, Math.max(1, Number(e.target.value))))}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-slate-400">1 – 10,000</p>
          </div>
          <Button
            size="sm"
            className="w-full h-8 text-xs"
            onClick={() => {
              setOpen(false)
              onGenerate(revision.revision_id, nRuns)
            }}
          >
            Run
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MonteCarloLandingPage() {
  const navigate = useNavigate()
  const { data: revisions, isLoading, error } = useValidatedRevisions()
  const triggerMutation = useTriggerMonteCarlo()

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [generatingId, setGeneratingId] = useState<string | null>(null)

  function toggleExpanded(revisionId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(revisionId)) next.delete(revisionId)
      else next.add(revisionId)
      return next
    })
  }

  function handleGenerate(revisionId: string, nRuns: number) {
    setGeneratingId(revisionId)
    triggerMutation.mutate(
      { revisionId, nRuns },
      {
        onSuccess: (data) => {
          navigate(`/admin/montecarlo/${data.run_id}`)
        },
        onError: (err) => {
          setGeneratingId(null)
          const detail = (err as Error & { status?: number }).message
          toast.error(detail ?? 'Monte Carlo run failed')
        },
      },
    )
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar
        adminBreadcrumb={[{ label: 'Monte Carlo', to: '/admin/montecarlo' }]}
      />

      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-4">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-slate-400" />
                <h1 className="text-xl font-semibold text-slate-800">Monte Carlo Analysis</h1>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">
                Run uncertainty analyses on validated revisions.
              </p>
            </div>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Failed to load revisions: {(error as Error).message}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && !revisions?.length && (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
              <BarChart2 className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                No validated or frozen revisions found.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                A revision must be validated before running Monte Carlo analysis.
              </p>
            </div>
          )}

          {/* Main table */}
          {!isLoading && !error && !!revisions?.length && (
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-semibold text-slate-600">Project</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Model</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Revision</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Validation</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Created</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((rev) => {
                    const isExpanded = expandedIds.has(rev.revision_id)
                    const isGenerating = generatingId === rev.revision_id
                    const isDisabled = generatingId !== null && !isGenerating

                    return (
                      <>
                        <TableRow
                          key={rev.revision_id}
                          className={isDisabled ? 'opacity-50 pointer-events-none' : ''}
                        >
                          <TableCell className="text-sm font-medium text-slate-800">
                            {rev.project_name}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {rev.model_name}
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {rev.revision_name ?? new Date(rev.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <RevisionStatusBadge status={rev.status} />
                          </TableCell>
                          <TableCell>
                            <ValidationBadge status={rev.last_validation_status} />
                          </TableCell>
                          <TableCell className="text-sm text-slate-500">
                            {new Date(rev.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <GeneratePopover
                                revision={rev}
                                isGenerating={isGenerating}
                                onGenerate={handleGenerate}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs text-slate-500"
                                onClick={() => toggleExpanded(rev.revision_id)}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                                Previous Runs
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>

                        <RunsSubTable
                          key={`runs-${rev.revision_id}`}
                          revisionId={rev.revision_id}
                          isExpanded={isExpanded}
                        />
                      </>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}
