import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type ValidationIssue =
  Database['public']['Tables']['validation_issue']['Row']

async function fetchValidationIssues(
  revisionId: string,
  processId: string,
): Promise<ValidationIssue[]> {
  // Get latest validation run for this revision
  const { data: run } = await supabase
    .from('validation_run')
    .select('validation_id')
    .eq('revision_id', revisionId)
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run) return []

  const { data, error } = await supabase
    .from('validation_issue')
    .select('*')
    .eq('validation_id', run.validation_id)
    .eq('process_id', processId)

  if (error) throw error
  return data ?? []
}

export function useValidationIssues(
  revisionId: string | undefined,
  processId: string | undefined,
) {
  return useQuery({
    queryKey: ['validation-issues', revisionId, processId],
    queryFn: () => fetchValidationIssues(revisionId!, processId!),
    enabled: !!revisionId && !!processId,
  })
}
