import { useParams } from 'react-router-dom'
import AppLayout from '../../components/AppLayout'
import ProcessForm from '../../components/ProcessForm'
import ExchangeGrid from '../../components/ExchangeGrid'
import { useProcesses } from '../../hooks/useProcesses'

export default function ProcessPage() {
  const { revisionId, processId } = useParams<{
    revisionId: string
    processId: string
  }>()
  const { data: processes } = useProcesses(revisionId)
  const process = processes?.find((p) => p.process_id === processId)

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
        {revisionId && process && (
          <ProcessForm revisionId={revisionId} process={process} />
        )}
      </div>

      <div className="mt-6">
        {processId && revisionId ? (
          <ExchangeGrid processId={processId} revisionId={revisionId} />
        ) : null}
      </div>
    </AppLayout>
  )
}
