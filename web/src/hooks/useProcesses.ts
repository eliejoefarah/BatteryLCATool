import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type Process = Database['public']['Tables']['process_instance']['Row']

async function fetchProcesses(revisionId: string): Promise<Process[]> {
  const { data, error } = await supabase
    .from('process_instance')
    .select('*')
    .eq('revision_id', revisionId)
    .order('name')
  if (error) throw error
  return data
}

export function useProcesses(revisionId: string | undefined) {
  return useQuery({
    queryKey: ['processes', revisionId],
    queryFn: () => fetchProcesses(revisionId!),
    enabled: !!revisionId,
  })
}
