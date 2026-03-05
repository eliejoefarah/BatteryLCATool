import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type ValidationRun =
  Database['public']['Tables']['validation_run']['Row']
export type ValidationIssue =
  Database['public']['Tables']['validation_issue']['Row']

export interface RevisionValidation {
  run: ValidationRun | null
  issues: ValidationIssue[]
}

async function fetchRevisionValidation(
  revisionId: string,
): Promise<RevisionValidation> {
  const { data: run } = await supabase
    .from('validation_run')
    .select('*')
    .eq('revision_id', revisionId)
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run) return { run: null, issues: [] }

  const { data: issues, error } = await supabase
    .from('validation_issue')
    .select('*')
    .eq('validation_id', run.validation_id)

  if (error) throw error
  return { run, issues: issues ?? [] }
}

export function useRevisionValidation(
  revisionId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['revision-validation', revisionId],
    queryFn: () => fetchRevisionValidation(revisionId!),
    enabled: !!revisionId && enabled,
    refetchInterval: enabled ? 10_000 : false,
  })
}
