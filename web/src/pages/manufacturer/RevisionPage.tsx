import { useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Cpu, MapPin, UploadCloud } from 'lucide-react'
import AppLayout from '../../components/AppLayout'
import ProcessForm from '../../components/ProcessForm'
import ImportRevisionButton from '../../components/ImportRevisionButton'
import { useRevisions } from '../../hooks/useRevision'
import { useBatteryModels } from '../../hooks/useBatteryModels'
import { useProcesses, type Process } from '../../hooks/useProcesses'
import { useRevisionExchangeCount, useRevisionParameterCount } from '../../hooks/useRevisionCounts'
import ParameterEditor from '../../components/ParameterEditor'
import ValidationPanel from '../../components/ValidationPanel'
import { Badge } from '../../components/ui/badge'
import { cn } from '../../lib/utils'

const STAGE_STYLES: Record<string, string> = {
  manufacturing: 'bg-blue-100 text-blue-700',
  use: 'bg-green-100 text-green-700',
  end_of_life: 'bg-amber-100 text-amber-700',
}

function ProcessCard({
  process,
  projectId,
  modelId,
  revisionId,
}: {
  process: Process
  projectId: string
  modelId: string
  revisionId: string
}) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() =>
        navigate(
          `/projects/${projectId}/models/${modelId}/revisions/${revisionId}/processes/${process.process_id}`,
        )
      }
      className="group flex w-full flex-col gap-3 rounded-xl border bg-white p-5 text-left shadow-sm transition-all hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-slate-200">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-slate-900">{process.name}</p>
            {process.location && (
              <p className="flex items-center gap-1 text-xs text-slate-400">
                <MapPin className="h-3 w-3" />
                {process.location}
              </p>
            )}
          </div>
        </div>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </div>

      {process.production_amount != null && (
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-600">Production:</span>{' '}
          {process.production_amount} {process.unit ?? ''}
        </p>
      )}

      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-xs text-slate-400">
          {process.comment
            ? process.comment.slice(0, 60) +
              (process.comment.length > 60 ? '…' : '')
            : <span className="italic">No comment</span>}
        </span>
        {process.stage && (
          <Badge
            className={cn(
              'border-0 text-xs capitalize',
              STAGE_STYLES[process.stage] ?? 'bg-slate-100 text-slate-600',
            )}
          >
            {process.stage.replace('_', ' ')}
          </Badge>
        )}
      </div>
    </button>
  )
}

export default function RevisionPage() {
  const { projectId, modelId, revisionId } = useParams<{
    projectId: string
    modelId: string
    revisionId: string
  }>()
  const { data: models } = useBatteryModels(projectId)
  const { data: revisions } = useRevisions(modelId)
  const { data: processes } = useProcesses(revisionId)
  const { data: exchangeCount } = useRevisionExchangeCount(revisionId)
  const { data: parameterCount } = useRevisionParameterCount(revisionId)

  const model = models?.find((m) => m.model_id === modelId)
  const revision = revisions?.find((r) => r.revision_id === revisionId)

  return (
    <AppLayout>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {revision?.label ??
              (revision ? `Rev ${revision.revision_number}` : '…')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{model?.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="text-xs capitalize text-slate-500"
          >
            {revision?.status ?? '—'}
          </Badge>
        </div>
      </div>

      {/* Summary stats */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        {[
          { label: 'Processes', value: processes?.length ?? 0 },
          { label: 'Exchanges', value: exchangeCount ?? '—' },
          { label: 'Parameters', value: parameterCount ?? '—' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border bg-white px-4 py-3 text-center"
          >
            <p className="text-2xl font-semibold text-slate-800">{s.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Processes section */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-700">Processes</h2>
        <div className="flex items-center gap-2">
          {revisionId && modelId && (
            <ImportRevisionButton revisionId={revisionId} modelId={modelId} />
          )}
          {revisionId && <ProcessForm revisionId={revisionId} />}
        </div>
      </div>

      <div className="mt-4">
        {!processes ? null : processes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center">
            <UploadCloud className="mx-auto mb-3 h-8 w-8 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">
              No processes yet
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Click <strong>Import xlsx</strong> to bulk-import all processes from
              a spreadsheet, or <strong>New Process</strong> to add one
              manually.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {processes.map((p) => (
              <ProcessCard
                key={p.process_id}
                process={p}
                projectId={projectId!}
                modelId={modelId!}
                revisionId={revisionId!}
              />
            ))}
          </div>
        )}
      </div>

      {/* Parameters section */}
      <div className="mt-10">
        <div className="mb-1 h-px bg-slate-100" />
        <div className="mt-6">
          {revisionId && <ParameterEditor revisionId={revisionId} />}
        </div>
      </div>

      {/* Validation section */}
      <div className="mt-10">
        <div className="mb-1 h-px bg-slate-100" />
        <div className="mt-6">
          {revisionId && projectId && modelId && (
            <ValidationPanel
              revisionId={revisionId}
              projectId={projectId}
              modelId={modelId}
              processes={processes ?? []}
            />
          )}
        </div>
      </div>
    </AppLayout>
  )
}
