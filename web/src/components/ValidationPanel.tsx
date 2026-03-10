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
import { useState } from 'react'

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
// Run status config
// ---------------------------------------------------------------------------

function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'pass':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
    case 'warning':
      return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
    case 'fail':
    case 'failed':
      return <XCircle className="h-4 w-4 shrink-0 text-red-500" />
    case 'running':
      return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" />
    default:
      return <Info className="h-4 w-4 shrink-0 text-slate-400" />
  }
}

function runStatusLabel(status: string): string {
  switch (status) {
    case 'pass':    return 'Passed'
    case 'warning': return 'Warnings'
    case 'fail':    return 'Failed'
    case 'failed':  return 'Error'
    case 'running': return 'Running…'
    default:        return status
  }
}

function runStatusTextClass(status: string): string {
  switch (status) {
    case 'pass':    return 'text-green-700'
    case 'warning': return 'text-amber-700'
    case 'fail':
    case 'failed':  return 'text-red-700'
    default:        return 'text-slate-500'
  }
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
    <div className={`rounded-lg border px-3 py-2.5 text-xs ${cfg.rowClass}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <code className={`font-mono font-semibold ${cfg.codeClass}`}>
            {issue.code}
          </code>
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
// RunIssues — issues for a single run, grouped by severity
// ---------------------------------------------------------------------------

function RunIssues({
  issues,
  processPathMap,
  runId,
}: {
  issues: ValidationIssue[]
  processPathMap: Map<string, string>
  runId: string
}) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
        <p className="text-sm text-green-700">No issues found</p>
      </div>
    )
  }

  const grouped = new Map<Severity, ValidationIssue[]>()
  for (const sev of SEVERITY_ORDER) grouped.set(sev, [])
  for (const issue of issues) {
    const sev =
      (issue.severity as Severity) in SEVERITY_CONFIG
        ? (issue.severity as Severity)
        : 'info'
    grouped.get(sev)!.push(issue)
  }

  const defaultOpen = SEVERITY_ORDER.filter(
    (s) => (grouped.get(s)?.length ?? 0) > 0,
  ).slice(0, 2)

  return (
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
            key={`${runId}-${sev}`}
            value={sev}
            className="rounded-lg border bg-white overflow-hidden"
          >
            <AccordionTrigger className="px-4 py-3 text-sm hover:no-underline">
              <span className={`flex items-center gap-2 font-medium ${cfg.triggerClass}`}>
                <cfg.Icon className="h-4 w-4" />
                {cfg.label}
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.badgeClass}`}>
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
                        ? (processPathMap.get(issue.process_id) ?? null)
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
  )
}

// ---------------------------------------------------------------------------
// RunTriggerBadges — compact issue count badges shown in the run header
// ---------------------------------------------------------------------------

function RunTriggerBadges({ issues }: { issues: ValidationIssue[] }) {
  const counts: Partial<Record<Severity, number>> = {}
  for (const issue of issues) {
    const sev =
      (issue.severity as Severity) in SEVERITY_CONFIG
        ? (issue.severity as Severity)
        : 'info'
    counts[sev] = (counts[sev] ?? 0) + 1
  }

  return (
    <div className="flex items-center gap-1.5">
      {SEVERITY_ORDER.map((sev) => {
        const count = counts[sev]
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
  canValidate: boolean
}

export default function ValidationPanel({
  revisionId,
  projectId,
  modelId,
  processes,
  canValidate,
}: Props) {
  const [triggering, setTriggering] = useState(false)
  const { data, isLoading, refetch } = useRevisionValidation(revisionId, true)

  const runs = data?.runs ?? []
  const issuesByRunId = data?.issuesByRunId ?? {}
  const latestRun = runs[0] ?? null
  const isRunning = latestRun?.status === 'running'

  async function handleRunValidation() {
    setTriggering(true)
    try {
      const { error } = await supabase.functions.invoke('trigger_validation', {
        body: { revision_id: revisionId },
      })
      if (error) throw error
      await refetch()
      queryClient.invalidateQueries({ queryKey: ['revision-validation', revisionId] })
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

  // Open the most recent run by default
  const defaultOpen = latestRun ? [latestRun.validation_id] : []

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-slate-700">Validation</h2>
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

      {/* Loading */}
      {isLoading && (
        <p className="text-xs text-slate-400">Loading…</p>
      )}

      {/* No runs yet */}
      {!isLoading && runs.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 px-5 py-6 text-center">
          <p className="text-sm text-slate-500">No validation run yet</p>
          <p className="mt-1 text-xs text-slate-400">
            Click <strong>Run Validation</strong> to check this revision.
          </p>
        </div>
      )}

      {/* Runs list */}
      {!isLoading && runs.length > 0 && (
        <Accordion
          type="multiple"
          defaultValue={defaultOpen}
          className="space-y-2"
        >
          {runs.map((run, idx) => {
            const runIssues = issuesByRunId[run.validation_id] ?? []
            return (
              <AccordionItem
                key={run.validation_id}
                value={run.validation_id}
                className="rounded-lg border bg-white overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <RunStatusIcon status={run.status} />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${runStatusTextClass(run.status)}`}>
                          {runStatusLabel(run.status)}
                        </span>
                        {idx === 0 && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            Latest
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {new Date(run.run_at).toLocaleString(undefined, {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </p>
                    </div>
                    {runIssues.length > 0 && (
                      <RunTriggerBadges issues={runIssues} />
                    )}
                    {run.status === 'pass' && runIssues.length === 0 && (
                      <span className="text-xs text-green-600">No issues</span>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <RunIssues
                    issues={runIssues}
                    processPathMap={processPathMap}
                    runId={run.validation_id}
                  />
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      )}
    </div>
  )
}
