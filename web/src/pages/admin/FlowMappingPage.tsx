import { useNavigate } from 'react-router-dom'
import { Link2, ArrowRight, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'
import TopBar from '../../components/TopBar'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { useMappingRevisions } from '../../hooks/useMappingRevisions'

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function ValidationBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400 text-xs">—</span>
  if (status === 'pass')
    return (
      <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Pass
      </Badge>
    )
  if (status === 'warning')
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 text-xs gap-1">
        <AlertTriangle className="h-3 w-3" />
        Warnings
      </Badge>
    )
  return (
    <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-xs">
      Fail
    </Badge>
  )
}

export default function FlowMappingPage() {
  const navigate = useNavigate()
  const { data: revisions, isLoading, error } = useMappingRevisions()

  function mappingHref(projectId: string, modelId: string, revisionId: string) {
    return `/admin/projects/${projectId}/models/${modelId}/revisions/${revisionId}/mapping`
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />

      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Flow Mapping</h1>
            <p className="mt-1 text-sm text-slate-500">
              Revisions that passed validation (with or without warnings) and are ready for
              ecoinvent flow mapping.
            </p>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading revisions…
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Failed to load revisions: {(error as Error).message}
            </div>
          )}

          {!isLoading && !error && (!revisions || revisions.length === 0) && (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
              <Link2 className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No revisions ready for mapping</p>
              <p className="mt-1 text-xs text-slate-400">
                Revisions appear here once they pass validation (errors must be resolved first).
              </p>
            </div>
          )}

          {!isLoading && !error && revisions && revisions.length > 0 && (
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-semibold text-slate-600">Project</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Model</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Revision</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Mapping</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Last Validation</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 text-right">Issues</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Validated</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600 text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((rev) => {
                    const isMapped = rev.status === 'validated'
                    const revLabel = rev.label ?? `Rev ${rev.revision_number}`
                    const href = mappingHref(rev.project_id, rev.model_id, rev.revision_id)
                    return (
                      <TableRow key={rev.revision_id} className="hover:bg-slate-50">
                        <TableCell className="text-sm font-medium text-slate-800 max-w-[160px] truncate">
                          {rev.project_name}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 max-w-[160px] truncate">
                          {rev.model_name}
                        </TableCell>
                        <TableCell className="text-sm text-slate-700 font-mono">
                          {revLabel}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              isMapped
                                ? 'border-green-200 bg-green-50 text-green-700 text-xs gap-1'
                                : 'border-amber-200 bg-amber-50 text-amber-700 text-xs'
                            }
                          >
                            {isMapped ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                Mapped
                              </>
                            ) : (
                              'Unmapped'
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <ValidationBadge status={rev.last_run_status} />
                            <span className="text-xs text-slate-400">{fmtDate(rev.last_run_at)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm text-slate-600">
                          {rev.last_issue_count ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-400">
                          {fmtDate(rev.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {isMapped ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs"
                              onClick={() => navigate(href)}
                            >
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                              Double Check
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="text-xs bg-amber-500 text-white hover:bg-amber-600"
                              onClick={() => navigate(href)}
                            >
                              <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                              Begin Mapping
                            </Button>
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
    </div>
  )
}
