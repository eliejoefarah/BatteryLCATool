import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface MappingRevision {
  revision_id: string
  revision_number: number
  label: string | null
  status: string
  project_id: string
  project_name: string
  model_id: string
  model_name: string
}

async function fetchMappingRevisions(): Promise<MappingRevision[]> {
  // Fetch revisions with status unmapped or validated (passed validation, possibly with warnings)
  const { data: revisions, error } = await supabase
    .from('battery_model_revision')
    .select(`
      revision_id,
      revision_number,
      label,
      status,
      battery_model!inner (
        model_id,
        name,
        project!inner (
          project_id,
          name
        )
      )
    `)
    .in('status', ['unmapped', 'validated'])
    .order('revision_number', { ascending: false })

  if (error) throw error

  return (revisions ?? []).map((r) => {
    const model = r.battery_model as {
      model_id: string
      name: string
      project: { project_id: string; name: string }
    }
    return {
      revision_id: r.revision_id,
      revision_number: r.revision_number,
      label: r.label,
      status: r.status,
      project_id: model.project.project_id,
      project_name: model.project.name,
      model_id: model.model_id,
      model_name: model.name,
    }
  })
}

export function useMappingRevisions() {
  return useQuery({
    queryKey: ['mapping-revisions'],
    queryFn: fetchMappingRevisions,
  })
}
