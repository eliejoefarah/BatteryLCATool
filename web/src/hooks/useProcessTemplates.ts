import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type ProcessTemplate =
  Database['public']['Tables']['process_template']['Row']

async function fetchProcessTemplates(): Promise<ProcessTemplate[]> {
  const { data, error } = await supabase
    .from('process_template')
    .select('*')
    .order('stage')
  if (error) throw error
  return data
}

export function useProcessTemplates() {
  return useQuery({
    queryKey: ['process-templates'],
    queryFn: fetchProcessTemplates,
    staleTime: Infinity,
  })
}
