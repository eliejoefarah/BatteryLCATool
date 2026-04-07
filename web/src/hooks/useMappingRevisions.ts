import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface MappingRevision {
  revision_id: string
  revision_number: number
  label: string | null
  status: string
  created_at: string
  project_id: string
  project_name: string
  model_id: string
  model_name: string
  // latest validation run
  last_run_at: string | null
  last_run_status: string | null  // 'pass' | 'warning' | 'fail'
  last_issue_count: number | null
}

async function fetchMappingRevisions(): Promise<MappingRevision[]> {
  // Fetch revisions awaiting mapping (unmapped) or already mapped (validated)
  const { data: revisions, error } = await supabase
    .from('battery_model_revision')
    .select(`
      revision_id,
      revision_number,
      label,
      status,
      created_at,
      battery_model!inner (
        model_id,
        name,
        project!inner (
          project_id,
          name
        )
      ),
      validation_run (
        run_at,
        status,
        issue_count
      )
    `)
    .in('status', ['unmapped', 'validated'])
    .order('created_at', { ascending: false })

  if (error) throw error

  return (revisions ?? []).map((r) => {
    const model = r.battery_model as {
      model_id: string
      name: string
      project: { project_id: string; name: string }
    }

    // Pick the latest validation run
    const runs = (r.validation_run ?? []) as {
      run_at: string
      status: string
      issue_count: number
    }[]
    const latestRun = runs.length > 0
      ? runs.reduce((a, b) => (a.run_at > b.run_at ? a : b))
      : null

    return {
      revision_id: r.revision_id,
      revision_number: r.revision_number,
      label: r.label,
      status: r.status,
      created_at: r.created_at,
      project_id: model.project.project_id,
      project_name: model.project.name,
      model_id: model.model_id,
      model_name: model.name,
      last_run_at: latestRun?.run_at ?? null,
      last_run_status: latestRun?.status ?? null,
      last_issue_count: latestRun?.issue_count ?? null,
    }
  })
}

export function useMappingRevisions() {
  return useQuery({
    queryKey: ['mapping-revisions'],
    queryFn: fetchMappingRevisions,
  })
}
