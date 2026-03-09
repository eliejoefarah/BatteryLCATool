import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import { useRevisionExchangeCount, useRevisionParameterCount } from '../../hooks/useRevisionCounts'
import { cn } from '../../lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RevisionRow {
  revision_id: string
  revision_number: number
  label: string | null
  status: string | null
  created_at: string
  frozen_at: string | null
  model_id: string
  creator: { email: string; display_name: string | null } | null
  model: {
    name: string
    project_id: string
    project: { name: string; project_id: string } | null
  } | null
}

// ---------------------------------------------------------------------------
// Status badge styles
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  validated: 'bg-green-100 text-green-700',
  frozen: 'bg-blue-100 text-blue-700',
}

// ---------------------------------------------------------------------------
// Per-row component (hooks must be called at component level)
// ---------------------------------------------------------------------------

function GlobalRevisionRow({ row }: { row: RevisionRow }) {
  const navigate = useNavigate()
  const { data: exchangeCount } = useRevisionExchangeCount(row.revision_id)
  const { data: paramCount } = useRevisionParameterCount(row.revision_id)

  const projectId = row.model?.project?.project_id ?? ''
  const modelId = row.model_id
  const revisionId = row.revision_id
  const href = `/projects/${projectId}/models/${modelId}/revisions/${revisionId}`

  return (
    <div className="grid grid-cols-[1.5fr_1.5fr_1.5fr_1fr_0.7fr_1.5fr_0.7fr_0.7fr_1fr_auto] gap-3 border-b px-4 py-3 text-sm last:border-b-0 hover:bg-slate-50 items-center">
      {/* Project */}
      <span className="truncate font-medium text-slate-700">
        {row.model?.project?.name ?? '—'}
      </span>

      {/* Model */}
      <span className="truncate text-slate-600">{row.model?.name ?? '—'}</span>

      {/* Revision */}
      <span className="truncate text-slate-600">
        {row.label ?? `Rev ${row.revision_number}`}
      </span>

      {/* Status */}
      <span>
        {row.status ? (
          <Badge
            className={cn(
              'border-0 text-xs capitalize',
              STATUS_STYLES[row.status] ?? 'bg-slate-100 text-slate-600',
            )}
          >
            {row.status}
          </Badge>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </span>

      {/* Frozen */}
      <span className={row.frozen_at ? 'text-amber-600 font-medium' : 'text-slate-400'}>
        {row.frozen_at ? 'Yes' : '—'}
      </span>

      {/* Creator */}
      <span className="truncate text-slate-500">
        {row.creator
          ? (row.creator.display_name ?? row.creator.email)
          : '—'}
      </span>

      {/* Exchanges */}
      <span className="text-slate-500">
        {exchangeCount !== undefined ? exchangeCount : '—'}
      </span>

      {/* Params */}
      <span className="text-slate-500">
        {paramCount !== undefined ? paramCount : '—'}
      </span>

      {/* Created */}
      <span className="text-slate-400 text-xs">
        {new Date(row.created_at).toLocaleDateString()}
      </span>

      {/* View button */}
      <button
        onClick={() => navigate(href)}
        title="View revision"
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 hover:text-slate-800"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GlobalDataView() {
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'global'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('battery_model_revision')
        .select(`
          revision_id,
          revision_number,
          label,
          status,
          created_at,
          frozen_at,
          created_by,
          model_id,
          creator:app_user!created_by(email, display_name),
          model:battery_model!model_id(
            name,
            project_id,
            project:project!project_id(name, project_id)
          )
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as RevisionRow[]
    },
  })

  const filtered =
    !data
      ? []
      : statusFilter === 'all'
      ? data
      : data.filter((r) => r.status === statusFilter)

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 border-b bg-white px-6 py-2 text-xs text-slate-500">
        <Link to="/admin" className="hover:text-slate-800">
          Admin
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="font-medium text-slate-700">Global Data View</span>
      </div>

      <div className="flex-1 overflow-auto space-y-4 p-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Global Data View</h1>
          <p className="mt-1 text-sm text-slate-500">All revisions across all projects.</p>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">Status:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="validated">Validated</SelectItem>
              <SelectItem value="frozen">Frozen</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-lg border bg-white">
          {/* Table header */}
          <div className="grid grid-cols-[1.5fr_1.5fr_1.5fr_1fr_0.7fr_1.5fr_0.7fr_0.7fr_1fr_auto] gap-3 border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400">
            <span>Project</span>
            <span>Model</span>
            <span>Revision</span>
            <span>Status</span>
            <span>Frozen</span>
            <span>Creator</span>
            <span>Exchanges</span>
            <span>Params</span>
            <span>Created</span>
            <span></span>
          </div>

          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400 italic">
              No revisions found.
            </p>
          ) : (
            filtered.map((row) => (
              <GlobalRevisionRow key={row.revision_id} row={row} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
