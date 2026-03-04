import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type Region = Database['public']['Tables']['region_catalog']['Row']

async function fetchRegions(): Promise<Region[]> {
  const { data, error } = await supabase
    .from('region_catalog')
    .select('*')
    .order('name')
  if (error) throw error
  return data
}

export function useRegionCatalog() {
  return useQuery({
    queryKey: ['region-catalog'],
    queryFn: fetchRegions,
    staleTime: Infinity, // static reference data
  })
}
