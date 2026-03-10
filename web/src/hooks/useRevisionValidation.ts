import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type ValidationRun =
  Database['public']['Tables']['validation_run']['Row']
export type ValidationIssue =
  Database['public']['Tables']['validation_issue']['Row']

export interface RevisionValidationHistory {
  runs: ValidationRun[]
  issuesByRunId: Record<string, ValidationIssue[]>
}

async function fetchRevisionValidation(
  revisionId: string,
): Promise<RevisionValidationHistory> {
  const { data: runs, error: runsError } = await supabase
    .from('validation_run')
    .select('*')
    .eq('revision_id', revisionId)
    .order('run_at', { ascending: false })

  if (runsError) throw runsError
  if (!runs || runs.length === 0) return { runs: [], issuesByRunId: {} }

  const runIds = runs.map((r) => r.validation_id)
  const { data: issues, error: issuesError } = await supabase
    .from('validation_issue')
    .select('*')
    .in('validation_id', runIds)

  if (issuesError) throw issuesError

  const issuesByRunId: Record<string, ValidationIssue[]> = {}
  for (const run of runs) issuesByRunId[run.validation_id] = []
  for (const issue of issues ?? []) {
    issuesByRunId[issue.validation_id]?.push(issue)
  }

  return { runs, issuesByRunId }
}

export function useRevisionValidation(
  revisionId: string | undefined,
  poll = true,
) {
  return useQuery({
    queryKey: ['revision-validation', revisionId],
    queryFn: () => fetchRevisionValidation(revisionId!),
    enabled: !!revisionId,
    refetchInterval: poll ? 10_000 : false,
  })
}
