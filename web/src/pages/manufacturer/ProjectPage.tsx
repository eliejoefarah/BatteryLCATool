import { useNavigate, useParams } from 'react-router-dom'
import { BatteryFull, GitBranch, ChevronRight } from 'lucide-react'
import AppLayout from '../../components/AppLayout'
import NewModelDialog from '../../components/NewModelDialog'
import { useProject } from '../../hooks/useProject'
import { useBatteryModels, type BatteryModel } from '../../hooks/useBatteryModels'
import { useRevisions } from '../../hooks/useRevision'
import { Badge } from '../../components/ui/badge'
import { cn } from '../../lib/utils'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  frozen: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

function ModelCard({
  model,
  projectId,
}: {
  model: BatteryModel
  projectId: string
}) {
  const navigate = useNavigate()
  const { data: revisions } = useRevisions(model.model_id)
  const activeRevision = revisions?.find((r) => r.is_active)
  const latestRevision = revisions?.[0]
  const targetRevision = activeRevision ?? latestRevision

  function handleClick() {
    if (targetRevision) {
      navigate(
        `/projects/${projectId}/models/${model.model_id}/revisions/${targetRevision.revision_id}`,
      )
    } else {
      navigate(`/projects/${projectId}/models/${model.model_id}`)
    }
  }

  return (
    <button
      onClick={handleClick}
      className="group flex w-full flex-col gap-3 rounded-xl border bg-white p-5 text-left shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-slate-200">
            <BatteryFull className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-slate-900">{model.name}</p>
            {model.chemistry && (
              <p className="text-xs text-slate-400">{model.chemistry}</p>
            )}
          </div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </div>

      {model.functional_unit && (
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-600">FU:</span>{' '}
          {model.functional_unit}
        </p>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <GitBranch className="h-3.5 w-3.5" />
          {revisions === undefined ? (
            <span className="text-slate-300">Loading…</span>
          ) : revisions.length === 0 ? (
            <span className="italic text-slate-400">No revisions</span>
          ) : (
            <span>
              {revisions.length} revision{revisions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {targetRevision && (
          <Badge
            className={cn(
              'border-0 text-xs',
              STATUS_STYLES[targetRevision.status] ??
                'bg-slate-100 text-slate-600',
            )}
          >
            {targetRevision.label ?? `Rev ${targetRevision.revision_number}`}
            {' · '}
            <span className="capitalize">{targetRevision.status}</span>
          </Badge>
        )}
      </div>
    </button>
  )
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: project } = useProject(projectId)
  const { data: models } = useBatteryModels(projectId)

  return (
    <AppLayout>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {project?.name ?? '…'}
          </h1>
          {project?.description && (
            <p className="mt-1 text-sm text-slate-500">{project.description}</p>
          )}
        </div>
        {projectId && <NewModelDialog projectId={projectId} />}
      </div>

      <div className="mt-6">
        {!models ? null : models.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            No models yet. Click <strong>New Model</strong> to get started.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((m) => (
              <ModelCard key={m.model_id} model={m} projectId={projectId!} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
