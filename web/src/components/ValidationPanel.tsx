import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { useAuthStore } from '../store/auth'
import { useRevisionValidation } from '../hooks/useRevisionValidation'
import type { ValidationIssue } from '../hooks/useRevisionValidation'
import type { Process } from '../hooks/useProcesses'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion'
import { Button } from './ui/button'

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

type Severity = 'error' | 'warning' | 'info'

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info']

const SEVERITY_CONFIG: Record<
  Severity,
  {
    label: string
    Icon: React.ElementType
    triggerClass: string
    badgeClass: string
    rowClass: string
    codeClass: string
  }
> = {
  error: {
    label: 'Errors',
    Icon: XCircle,
    triggerClass: 'text-red-600',
    badgeClass: 'bg-red-100 text-red-700',
    rowClass: 'border-red-100 bg-red-50/40',
    codeClass: 'text-red-700',
  },
  warning: {
    label: 'Warnings',
    Icon: AlertTriangle,
    triggerClass: 'text-amber-600',
    badgeClass: 'bg-amber-100 text-amber-700',
    rowClass: 'border-amber-100 bg-amber-50/40',
    codeClass: 'text-amber-700',
  },
  info: {
    label: 'Info',
    Icon: Info,
    triggerClass: 'text-blue-600',
    badgeClass: 'bg-blue-100 text-blue-700',
    rowClass: 'border-blue-100 bg-blue-50/40',
    codeClass: 'text-blue-700',
  },
}

// ---------------------------------------------------------------------------
// IssueRow
// ---------------------------------------------------------------------------

function IssueRow({
  issue,
  processPath,
}: {
  issue: ValidationIssue
  processPath: string | null
}) {
  const navigate = useNavigate()
  const cfg = SEVERITY_CONFIG[issue.severity as Severity] ?? SEVERITY_CONFIG.info

  function handleJump() {
    if (!processPath) return
    navigate(processPath, {
      state: issue.exchange_id
        ? { highlightExchangeId: issue.exchange_id }
        : undefined,
    })
  }

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-xs ${cfg.rowClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <code className={`font-mono font-semibold ${cfg.codeClass}`}>
              {issue.code}
            </code>
          </div>
          <p className="mt-1 text-slate-600 leading-snug">{issue.message}</p>
          {issue.suggestion && (
            <p className="mt-1 text-slate-400 italic">{issue.suggestion}</p>
          )}
        </div>
        {processPath && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-xs text-slate-500 hover:text-slate-800"
            onClick={handleJump}
          >
            Jump to
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ValidationPanel
// ---------------------------------------------------------------------------

interface Props {
  revisionId: string
  projectId: string
  modelId: string
  processes: Process[]
}

export default function ValidationPanel({
  revisionId,
  projectId,
  modelId,
  processes,
}: Props) {
  const [triggering, setTriggering] = useState(false)
  const role = useAuthStore((s) => s.role)
  const canValidate = role === 'manufacturer'
  const { data, isLoading, refetch } = useRevisionValidation(revisionId, true)

  const run = data?.run ?? null
  const issues = data?.issues ?? []
  const isRunning = run?.status === 'running'

  async function handleRunValidation() {
    setTriggering(true)
    try {
      const { error } = await supabase.functions.invoke('trigger_validation', {
        body: { revision_id: revisionId },
      })
      if (error) throw error
      await refetch()
      queryClient.invalidateQueries({ queryKey: ['revision-validation', revisionId] })
      // Invalidate revision list so status badge (draft/validated) updates immediately
      queryClient.invalidateQueries({ queryKey: ['revisions', modelId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation failed')
    } finally {
      setTriggering(false)
    }
  }

  // Build a map from process_id → full URL path
  const processPathMap = new Map<string, string>(
    processes.map((p) => [
      p.process_id,
      `/projects/${projectId}/models/${modelId}/revisions/${revisionId}/processes/${p.process_id}`,
    ]),
  )

  // Group issues by severity
  const grouped = new Map<Severity, ValidationIssue[]>()
  for (const sev of SEVERITY_ORDER) grouped.set(sev, [])
  for (const issue of issues) {
    const sev = (issue.severity as Severity) in SEVERITY_CONFIG
      ? (issue.severity as Severity)
      : 'info'
    grouped.get(sev)!.push(issue)
  }

  // Default open: error and warning groups that have items
  const defaultOpen = SEVERITY_ORDER.filter(
    (s) => (grouped.get(s)?.length ?? 0) > 0,
  ).slice(0, 2)

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-slate-700">Validation</h2>
          {run && (
            <p className="mt-0.5 text-xs text-slate-400">
              {isRunning ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Running…
                </span>
              ) : (
                <>
                  Last run:{' '}
                  {new Date(run.run_at).toLocaleString(undefined, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {run.status === 'failed' && (
                    <span className="ml-1 text-red-500">· failed</span>
                  )}
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Summary badges */}
          {!isLoading && issues.length > 0 && (
            <div className="flex items-center gap-1.5">
              {SEVERITY_ORDER.map((sev) => {
                const count = grouped.get(sev)?.length ?? 0
                if (!count) return null
                const cfg = SEVERITY_CONFIG[sev]
                return (
                  <span
                    key={sev}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badgeClass}`}
                  >
                    <cfg.Icon className="h-3 w-3" />
                    {count}
                  </span>
                )
              })}
            </div>
          )}
          {canValidate && (
            <Button
              size="sm"
              variant="outline"
              disabled={triggering || isRunning}
              onClick={handleRunValidation}
            >
              {triggering || isRunning ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              {triggering ? 'Running…' : 'Run Validation'}
            </Button>
          )}
        </div>
      </div>

      {/* Empty / loading states */}
      {isLoading && (
        <p className="text-xs text-slate-400">Loading…</p>
      )}

      {!isLoading && !run && (
        <div className="rounded-lg border border-dashed border-slate-300 px-5 py-6 text-center">
          <p className="text-sm text-slate-500">No validation run yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Click <strong>Run Validation</strong> to check this revision.
          </p>
        </div>
      )}

      {!isLoading && run && issues.length === 0 && !isRunning && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
          <p className="text-sm text-green-700">No issues found</p>
        </div>
      )}

      {/* Accordion groups */}
      {!isLoading && issues.length > 0 && (
        <Accordion
          type="multiple"
          defaultValue={defaultOpen}
          className="space-y-2"
        >
          {SEVERITY_ORDER.map((sev) => {
            const group = grouped.get(sev) ?? []
            if (!group.length) return null
            const cfg = SEVERITY_CONFIG[sev]

            return (
              <AccordionItem
                key={sev}
                value={sev}
                className="rounded-lg border bg-white overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline">
                  <span className={`flex items-center gap-2 font-medium ${cfg.triggerClass}`}>
                    <cfg.Icon className="h-4 w-4" />
                    {cfg.label}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.badgeClass}`}
                    >
                      {group.length}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-2">
                    {group.map((issue) => (
                      <IssueRow
                        key={issue.issue_id}
                        issue={issue}
                        processPath={
                          issue.process_id
                            ? processPathMap.get(issue.process_id) ?? null
                            : null
                        }
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </div>
  )
}
