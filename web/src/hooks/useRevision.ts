import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type Revision = Database['public']['Tables']['battery_model_revision']['Row']

async function fetchRevisions(modelId: string): Promise<Revision[]> {
  const { data, error } = await supabase
    .from('battery_model_revision')
    .select('*')
    .eq('model_id', modelId)
    .order('revision_number', { ascending: false })
  if (error) throw error
  return data
}

export function useRevisions(modelId: string | undefined) {
  return useQuery({
    queryKey: ['revisions', modelId],
    queryFn: () => fetchRevisions(modelId!),
    enabled: !!modelId,
  })
}
