import { useParams } from 'react-router-dom'
import AppLayout from '../../components/AppLayout'
import ProcessForm from '../../components/ProcessForm'
import ExchangeGrid from '../../components/ExchangeGrid'
import { useProcesses } from '../../hooks/useProcesses'
import { useRevisions } from '../../hooks/useRevision'
import { useAuthStore } from '../../store/auth'

export default function ProcessPage() {
  const { modelId, revisionId, processId } = useParams<{
    modelId: string
    revisionId: string
    processId: string
  }>()
  const user = useAuthStore((s) => s.user)
  const role = useAuthStore((s) => s.role)
  const { data: processes } = useProcesses(revisionId)
  const { data: revisions } = useRevisions(modelId)
  const process = processes?.find((p) => p.process_id === processId)
  const revision = revisions?.find((r) => r.revision_id === revisionId)

  const canEdit = role !== 'admin' && (!!user && revision?.created_by === user.id)

  return (
    <AppLayout>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {process?.name ?? '…'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {process?.location && <span>{process.location} · </span>}
            {process?.stage && (
              <span className="capitalize">
                {process.stage.replace('_', ' ')}
              </span>
            )}
            {process?.production_amount != null && (
              <span>
                {' '}
                · {process.production_amount} {process.unit ?? ''}
              </span>
            )}
          </p>
        </div>
        {canEdit && revisionId && process && (
          <ProcessForm revisionId={revisionId} process={process} />
        )}
      </div>

      {!canEdit && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          This revision was created by another team member — viewing in read-only mode.
        </div>
      )}

      <div className="mt-6">
        {processId && revisionId ? (
          <ExchangeGrid processId={processId} revisionId={revisionId} readOnly={!canEdit} />
        ) : null}
      </div>
    </AppLayout>
  )
}
