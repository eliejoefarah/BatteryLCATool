import { useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, GitBranch } from 'lucide-react'
import AppLayout from '../../components/AppLayout'
import NewRevisionDialog from '../../components/NewRevisionDialog'
import { useBatteryModels } from '../../hooks/useBatteryModels'
import { useRevisions, type Revision } from '../../hooks/useRevision'
import { Badge } from '../../components/ui/badge'
import { cn } from '../../lib/utils'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  frozen: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

function RevisionCard({
  revision,
  projectId,
  modelId,
  index,
  total,
}: {
  revision: Revision
  projectId: string
  modelId: string
  index: number
  total: number
}) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() =>
        navigate(
          `/projects/${projectId}/models/${modelId}/revisions/${revision.revision_id}`,
        )
      }
      className="group flex w-full flex-col gap-3 rounded-xl border bg-white p-5 text-left shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-slate-200">
            <GitBranch className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-slate-900">
              {revision.label ?? `Rev ${revision.revision_number}`}
            </p>
            <p className="text-xs text-slate-400">
              Revision {revision.revision_number} of {total}
            </p>
          </div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </div>

      {revision.notes && (
        <p className="text-xs text-slate-500 line-clamp-2">{revision.notes}</p>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-xs text-slate-400">
          {index === 0 ? (
            <span className="font-medium text-slate-600">Latest</span>
          ) : (
            `#${revision.revision_number}`
          )}
        </span>
        <Badge
          className={cn(
            'border-0 text-xs capitalize',
            STATUS_STYLES[revision.status] ?? 'bg-slate-100 text-slate-600',
          )}
        >
          {revision.status}
          {revision.is_active && (
            <span className="ml-1 text-slate-400">· active</span>
          )}
        </Badge>
      </div>
    </button>
  )
}

export default function ModelPage() {
  const { projectId, modelId } = useParams<{
    projectId: string
    modelId: string
  }>()
  const { data: models } = useBatteryModels(projectId)
  const { data: revisions } = useRevisions(modelId)
  const model = models?.find((m) => m.model_id === modelId)

  return (
    <AppLayout>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {model?.name ?? '…'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {model?.chemistry && <span>{model.chemistry} · </span>}
            {model?.functional_unit}
          </p>
        </div>
        {modelId && <NewRevisionDialog modelId={modelId} />}
      </div>

      <div className="mt-6">
        {!revisions ? null : revisions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            No revisions yet. Click <strong>New Revision</strong> to create one.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {revisions.map((r, i) => (
              <RevisionCard
                key={r.revision_id}
                revision={r}
                projectId={projectId!}
                modelId={modelId!}
                index={i}
                total={revisions.length}
              />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
