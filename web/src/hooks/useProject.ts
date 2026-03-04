import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type Project = Database['public']['Tables']['project']['Row']

async function fetchProject(projectId: string): Promise<Project> {
  const { data, error } = await supabase
    .from('project')
    .select('*')
    .eq('project_id', projectId)
    .single()
  if (error) throw error
  return data
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchProject(projectId!),
    enabled: !!projectId,
  })
}
