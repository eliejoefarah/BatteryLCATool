import { useNavigate } from 'react-router-dom'
import { Link2, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react'
import TopBar from '../../components/TopBar'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { useMappingRevisions } from '../../hooks/useMappingRevisions'

export default function FlowMappingPage() {
  const navigate = useNavigate()
  const { data: revisions, isLoading } = useMappingRevisions()

  function mappingHref(projectId: string, modelId: string, revisionId: string) {
    return `/admin/projects/${projectId}/models/${modelId}/revisions/${revisionId}/mapping`
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar />

      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Flow Mapping</h1>
            <p className="mt-1 text-sm text-slate-500">
              Revisions that have passed validation (with or without warnings) and are ready
              for ecoinvent flow mapping.
            </p>
          </div>

          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading revisions…
            </div>
          )}

          {!isLoading && (!revisions || revisions.length === 0) && (
            <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
              <Link2 className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No revisions ready for mapping</p>
              <p className="mt-1 text-xs text-slate-400">
                Revisions appear here once they pass validation.
              </p>
            </div>
          )}

          {!isLoading && revisions && revisions.length > 0 && (
            <div className="space-y-3">
              {revisions.map((rev) => {
                const isMapped = rev.status === 'validated'
                const revLabel = rev.label ?? `Rev ${rev.revision_number}`
                return (
                  <div
                    key={rev.revision_id}
                    className="flex items-center justify-between gap-4 rounded-xl border bg-white px-5 py-4 shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-800 truncate">{revLabel}</p>
                        <Badge
                          variant="outline"
                          className={
                            isMapped
                              ? 'border-green-200 bg-green-50 text-green-700 text-xs'
                              : 'border-amber-200 bg-amber-50 text-amber-700 text-xs'
                          }
                        >
                          {isMapped ? 'Mapped' : 'Unmapped'}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400 truncate">
                        {rev.project_name} · {rev.model_name}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant={isMapped ? 'outline' : 'default'}
                      className={
                        isMapped
                          ? 'shrink-0 text-xs'
                          : 'shrink-0 bg-amber-500 text-xs text-white hover:bg-amber-600'
                      }
                      onClick={() =>
                        navigate(mappingHref(rev.project_id, rev.model_id, rev.revision_id))
                      }
                    >
                      {isMapped ? (
                        <>
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          Review Mappings
                        </>
                      ) : (
                        <>
                          <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                          Begin Mapping
                        </>
                      )}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
