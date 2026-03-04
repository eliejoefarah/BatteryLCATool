import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database.types'

export type Project = Database['public']['Tables']['project']['Row']

async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('project')
    .select('*')
    .eq('archived', false)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  })
}
