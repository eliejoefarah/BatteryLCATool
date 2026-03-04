import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type BatteryModel = Database['public']['Tables']['battery_model']['Row']

async function fetchBatteryModels(projectId: string): Promise<BatteryModel[]> {
  const { data, error } = await supabase
    .from('battery_model')
    .select('*')
    .eq('project_id', projectId)
    .order('name')
  if (error) throw error
  return data
}

export function useBatteryModels(projectId: string | undefined) {
  return useQuery({
    queryKey: ['battery-models', projectId],
    queryFn: () => fetchBatteryModels(projectId!),
    enabled: !!projectId,
  })
}
