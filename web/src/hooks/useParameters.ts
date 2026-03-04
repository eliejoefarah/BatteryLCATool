import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type Parameter = Database['public']['Tables']['model_parameter']['Row']

async function fetchParameters(revisionId: string): Promise<Parameter[]> {
  const { data, error } = await supabase
    .from('model_parameter')
    .select('*')
    .eq('revision_id', revisionId)
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export function useParameters(revisionId: string | undefined) {
  return useQuery({
    queryKey: ['parameters', revisionId],
    queryFn: () => fetchParameters(revisionId!),
    enabled: !!revisionId,
  })
}

export function useParameterNames(revisionId: string | undefined): string[] {
  const { data = [] } = useParameters(revisionId)
  return data.map((p) => p.name)
}

/** Call this after any parameter mutation to keep counts in sync */
export function invalidateParameters(queryClient: ReturnType<typeof useQueryClient>, revisionId: string) {
  queryClient.invalidateQueries({ queryKey: ['parameters', revisionId] })
  queryClient.invalidateQueries({ queryKey: ['parameter-count', revisionId] })
}
