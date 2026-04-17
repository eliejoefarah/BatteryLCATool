import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileDown, Loader2, PackageOpen, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Skeleton } from '../../components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import { useBulkMappingSummary } from '../../hooks/useBwMapping'
import { triggerDownload, useTriggerExport } from '../../hooks/useExport'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportableRevision {
  revision_id: string
  revision_number: number
  label: string | null
  status: string
  project_id: string
  project_name: string
  model_id: string
  model_name: string
}

interface LatestExportJob {
  revision_id: string
  export_id: string
  completed_at: string
  partner_responsible: string | null
  file_size_bytes: number | null
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

async function fetchExportableRevisions(): Promise<ExportableRevision[]> {
  const { data, error } = await supabase
    .from('battery_model_revision')
    .select(`
      revision_id,
      revision_number,
      label,
      status,
      battery_model!inner (
        model_id,
        name,
        project!inner (
          project_id,
          name
        )
      )
    `)
    .in('status', ['frozen', 'mapped'])
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((r) => {
    const model = r.battery_model as {
      model_id: string
      name: string
      project: { project_id: string; name: string }
    }
    return {
      revision_id: r.revision_id,
      revision_number: r.revision_number,
      label: r.label,
      status: r.status,
      project_id: model.project.project_id,
      project_name: model.project.name,
      model_id: model.model_id,
      model_name: model.name,
    }
  })
}

async function fetchLatestExportJobs(
  revisionIds: string[],
): Promise<LatestExportJob[]> {
  if (revisionIds.length === 0) return []

  const { data, error } = await supabase
    .from('export_job')
    .select('revision_id, export_id, completed_at, partner_responsible, file_size_bytes')
    .in('revision_id', revisionIds)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })

  if (error) throw error

  // Keep only the most recent completed job per revision
  const seen = new Set<string>()
  const result: LatestExportJob[] = []
  for (const row of data ?? []) {
    if (!seen.has(row.revision_id)) {
      seen.add(row.revision_id)
      result.push({
        revision_id: row.revision_id,
        export_id: row.export_id,
        completed_at: row.completed_at!,
        partner_responsible: row.partner_responsible ?? null,
        file_size_bytes: row.file_size_bytes ?? null,
      })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Export Dialog
// ---------------------------------------------------------------------------

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  revision: ExportableRevision
  defaultPartner?: string
}

function ExportDialog({ open, onOpenChange, revision, defaultPartner }: ExportDialogProps) {
  const [partner, setPartner] = useState(defaultPartner ?? '')
  const triggerExport = useTriggerExport()

  function handleSubmit() {
    if (!partner.trim()) {
      toast.error('Partner responsible is required.')
      return
    }
    triggerExport.mutate(
      { revisionId: revision.revision_id, partner_responsible: partner.trim(), force: true },
      {
        onSuccess: () => {
          toast.success('Export complete — download started.')
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error(err.message ?? 'Export failed.')
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Revision</DialogTitle>
          <DialogDescription>
            Generating a VUB LCI template for{' '}
            <span className="font-medium text-slate-700">
              {revision.label ?? `Rev ${revision.revision_number}`}
            </span>{' '}
            — {revision.model_name}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="partner-input">
              Partner responsible <span className="text-red-500">*</span>
            </Label>
            <Input
              id="partner-input"
              placeholder="e.g. Acme Battery GmbH"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              disabled={triggerExport.isPending}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={triggerExport.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={triggerExport.isPending || !partner.trim()}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {triggerExport.isPending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                Export &amp; Download
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Table row (needs its own state for dialog)
// ---------------------------------------------------------------------------

interface ExportRowProps {
  revision: ExportableRevision
  mappedFlows: number
  totalFlows: number
  skippedFlows: number
  readyForExport: boolean
  latestJob: LatestExportJob | undefined
}

function ExportRow({
  revision,
  mappedFlows,
  totalFlows,
  skippedFlows,
  readyForExport,
  latestJob,
}: ExportRowProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  const hasExported = !!latestJob

  function handleDownload() {
    if (!latestJob?.download_url) {
      toast.error('No download URL available. Try re-exporting.')
      return
    }
    triggerDownload(latestJob.download_url, `export_${revision.revision_id}.xlsx`)
    toast.success('Download started.')
  }

  return (
    <>
      <TableRow className="hover:bg-slate-50">
        {/* Project */}
        <TableCell className="max-w-[140px] truncate text-sm font-medium text-slate-800">
          {revision.project_name}
        </TableCell>

        {/* Model */}
        <TableCell className="max-w-[140px] truncate text-sm text-slate-600">
          {revision.model_name}
        </TableCell>

        {/* Revision */}
        <TableCell>
          <Badge variant="outline" className="font-mono text-xs text-slate-600">
            #{revision.revision_number}
            {revision.label ? ` · ${revision.label}` : ''}
          </Badge>
        </TableCell>

        {/* Status */}
        <TableCell>
          <Badge
            variant="outline"
            className={cn(
              'text-xs',
              revision.status === 'mapped'
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-blue-200 bg-blue-50 text-blue-700',
            )}
          >
            {revision.status === 'mapped' ? 'Mapped' : 'Frozen'}
          </Badge>
        </TableCell>

        {/* Flows mapped */}
        <TableCell className="text-sm text-slate-600">
          {totalFlows === 0 ? (
            <span className="text-slate-400">—</span>
          ) : (
            <span>
              {mappedFlows}{' '}
              <span className="text-slate-400">/ {totalFlows}</span>
            </span>
          )}
        </TableCell>

        {/* Skipped */}
        <TableCell>
          {skippedFlows > 0 ? (
            <span className="text-xs font-medium text-amber-600">{skippedFlows}</span>
          ) : (
            <span className="text-xs text-slate-400">0</span>
          )}
        </TableCell>

        {/* Last exported */}
        <TableCell className="text-sm">
          {latestJob ? (
            <span className="text-slate-600">{fmtRelative(latestJob.completed_at)}</span>
          ) : (
            <span className="text-slate-400 italic">Never</span>
          )}
        </TableCell>

        {/* Actions */}
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-2">
            {hasExported ? (
              <>
                {/* Re-export — regenerates from scratch */}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => setDialogOpen(true)}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Re-export
                </Button>
                {/* Download — uses the existing signed URL */}
                <Button
                  size="sm"
                  className="text-xs bg-green-600 text-white hover:bg-green-700"
                  onClick={handleDownload}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Download
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="text-xs bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => setDialogOpen(true)}
                disabled={!readyForExport}
                title={
                  !readyForExport
                    ? 'Complete flow mapping before exporting'
                    : undefined
                }
              >
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                Export
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      <ExportDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        revision={revision}
        defaultPartner={latestJob?.partner_responsible ?? ''}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExportPage() {
  const {
    data: revisions,
    isLoading: revisionsLoading,
    error: revisionsError,
    refetch,
  } = useQuery({
    queryKey: ['exportable-revisions'],
    queryFn: fetchExportableRevisions,
  })

  const revisionIds = revisions?.map((r) => r.revision_id) ?? []

  const { data: summaries } = useBulkMappingSummary(revisionIds)

  const { data: latestJobs } = useQuery({
    queryKey: ['export-latest-jobs', revisionIds.join(',')],
    queryFn: () => fetchLatestExportJobs(revisionIds),
    enabled: revisionIds.length > 0,
  })

  const summaryByRevId = Object.fromEntries(
    (summaries ?? []).map((s) => [s.revision_id, s]),
  )
  const latestJobByRevId = Object.fromEntries(
    (latestJobs ?? []).map((j) => [j.revision_id, j]),
  )

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar adminBreadcrumb={[{ label: 'Export', to: '/admin/export' }]} />

      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Export</h1>
              <p className="mt-1 text-sm text-slate-500">
                Export fully-mapped revisions as VUB LCI templates.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => refetch()}
              disabled={revisionsLoading}
            >
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', revisionsLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div>

          {/* Loading skeletons */}
          {revisionsLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          )}

          {/* Error */}
          {revisionsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Failed to load revisions: {(revisionsError as Error).message}
            </div>
          )}

          {/* Empty state */}
          {!revisionsLoading && !revisionsError && revisions?.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
              <PackageOpen className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                No revisions ready for export
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Revisions appear here once all input flows have been mapped or
                marked as skipped (status: mapped).
              </p>
            </div>
          )}

          {/* Table */}
          {!revisionsLoading && !revisionsError && revisions && revisions.length > 0 && (
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-semibold text-slate-600">Project</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Model</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Revision</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Status</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Flows mapped</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Skipped</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-600">Last exported</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-slate-600">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revisions.map((rev) => {
                    const summary = summaryByRevId[rev.revision_id]
                    const total = summary?.total_input_flows ?? 0
                    const mapped = summary?.mapped_flows ?? 0
                    const skipped = summary?.skipped_flows ?? 0
                    const ready = summary?.ready_for_export ?? false

                    return (
                      <ExportRow
                        key={rev.revision_id}
                        revision={rev}
                        totalFlows={total}
                        mappedFlows={mapped + skipped}
                        skippedFlows={skipped}
                        readyForExport={ready}
                        latestJob={latestJobByRevId[rev.revision_id]}
                      />
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
