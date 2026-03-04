import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type Unit = Database['public']['Tables']['unit_catalog']['Row']

async function fetchUnits(): Promise<Unit[]> {
  const { data, error } = await supabase
    .from('unit_catalog')
    .select('*')
    .order('symbol')
  if (error) throw error
  return data
}

export function useUnitCatalog() {
  return useQuery({
    queryKey: ['unit-catalog'],
    queryFn: fetchUnits,
    staleTime: Infinity,
  })
}
