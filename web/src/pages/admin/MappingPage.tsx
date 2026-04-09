import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, ChevronRight, Link2, Loader2 } from 'lucide-react'
import TopBar from '../../components/TopBar'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { cn } from '../../lib/utils'
import { useRevisionMappingStatus, type FlowMappingGroup } from '../../hooks/useBwMapping'
import { FlowMappingDialog } from '../../components/admin/FlowMappingDialog'

type Filter = 'all' | 'pending' | 'mapped'

export default function MappingPage() {
  const { revisionId } = useParams<{
    projectId: string
    modelId: string
    revisionId: string
  }>()

  const { data, isLoading, error } = useRevisionMappingStatus(revisionId)

  const [filter, setFilter] = useState<Filter>('all')
  const [selectedFlow, setSelectedFlow] = useState<FlowMappingGroup | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const filteredFlows = useMemo(() => {
    if (!data) return []
    if (filter === 'pending') return data.flows.filter((f) => f.mapping_status !== 'mapped')
    if (filter === 'mapped') return data.flows.filter((f) => f.mapping_status === 'mapped')
    return data.flows
  }, [data, filter])

  const progressPct =
    data && data.total_input_flows > 0
      ? Math.round((data.mapped_flows / data.total_input_flows) * 100)
      : 0

  function openDialog(flow: FlowMappingGroup) {
    setSelectedFlow(flow)
    setDialogOpen(true)
  }

  const filterCounts: Record<Filter, number> = {
    all: data?.total_input_flows ?? 0,
    pending: data?.pending_flows ?? 0,
    mapped: data?.mapped_flows ?? 0,
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 border-b bg-white px-6 py-2 text-xs text-slate-500">
        <Link to="/admin" className="hover:text-slate-800">Admin</Link>
        <ChevronRight className="h-3 w-3" />
        <Link to="/admin/projects" className="hover:text-slate-800">Projects</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-slate-700">Flow Mapping</span>
      </div>

      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-4">

          {/* Header + progress summary */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Flow Mapping</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Map foreground input flows to Brightway background activities.
              </p>
            </div>
            {data && (
              <div className="text-right shrink-0">
                <p className="text-sm font-medium text-slate-700">
                  {data.mapped_flows} / {data.total_input_flows} mapped
                </p>
                <p className="text-xs text-slate-400">{progressPct}% complete</p>
                {data.ready_for_export && (
                  <p className="text-xs text-green-600 font-medium mt-0.5">✓ Ready for export</p>
                )}
              </div>
            )}
          </div>

          {/* Progress bar */}
          {data && (
            <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  data.ready_for_export ? 'bg-green-500' : 'bg-amber-400',
                )}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          {/* Filter pills */}
          <div className="flex gap-1.5">
            {(['all', 'pending', 'mapped'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors',
                  filter === f
                    ? 'bg-slate-800 text-white'
                    : 'border bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {f} ({filterCounts[f]})
              </button>
            ))}
          </div>

          {/* Loading skeletons */}
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          )}

          {/* Loading spinner (inline) */}
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading flows…
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Failed to load flows: {(error as Error).message}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && filteredFlows.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center">
              <Link2 className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                {filter === 'all'
                  ? 'No input flows found for this revision.'
                  : `No ${filter} flows.`}
              </p>
            </div>
          )}

          {/* Flow table */}
          {!isLoading && !error && filteredFlows.length > 0 && (
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-semibold text-slate-600">Flow Name</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Unit</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 text-center">
                      Exchanges
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Mapped To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFlows.map((flow, i) => {
                    const isMapped = flow.mapping_status === 'mapped'
                    return (
                      <TableRow
                        key={`${flow.raw_name ?? ''}-${flow.unit ?? ''}-${i}`}
                        className="cursor-pointer hover:bg-slate-50 transition-colors"
                        onClick={() => openDialog(flow)}
                      >
                        <TableCell className="max-w-[240px]">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {flow.raw_name ?? '—'}
                          </p>
                          {flow.also_mapped_in_other_revisions && (
                            <p className="text-[10px] text-slate-400">
                              Also mapped in other revisions
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {flow.unit ?? '—'}
                        </TableCell>
                        <TableCell className="text-center text-sm text-slate-600">
                          {flow.exchange_count}
                        </TableCell>
                        <TableCell>
                          {isMapped ? (
                            <Badge
                              variant="outline"
                              className="border-green-200 bg-green-50 text-green-700 text-xs gap-1"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Mapped
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-amber-200 bg-amber-50 text-amber-700 text-xs"
                            >
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          {flow.mapping ? (
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="truncate text-xs font-medium text-slate-700">
                                {flow.mapping.confirmed_activity_name}
                              </span>
                              {flow.mapping.confirmed_location && (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 px-1.5 py-0 text-[10px] h-4 font-normal"
                                >
                                  {flow.mapping.confirmed_location}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

        </div>
      </main>

      {/* Mapping dialog — only mounted when a flow is selected */}
      {selectedFlow && (
        <FlowMappingDialog
          flow={selectedFlow}
          revisionId={revisionId!}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </div>
  )
}
