import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSession } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonteCarloFlowResult {
  flow_name: string | null
  unit: string | null
  direction: string
  mean: number
  std: number
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
  histogram: { bin_edges: number[]; counts: number[] }
}

export interface MonteCarloSensitivityRow {
  parameter_name: string
  flow_name: string | null
  direction: string
  spearman_rho: number
  p_value: number
}

export interface MonteCarloRunSummary {
  run_id: string
  revision_id: string
  n_runs: number
  status: string
  created_at: string
  completed_at: string | null
  failed_runs: number | null
}

export interface MonteCarloRunResponse extends MonteCarloRunSummary {
  flows: MonteCarloFlowResult[]
  sensitivity: MonteCarloSensitivityRow[]
}

export interface ValidatedRevisionRow {
  revision_id: string
  revision_name: string | null
  model_name: string
  project_name: string
  status: string
  frozen_at: string | null
  created_at: string
  created_by_email: string
  last_validation_status: string | null
}

// ---------------------------------------------------------------------------
// Shared fetch helper (mirrors useBwMapping.ts)
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await getSession()
  if (!session) throw new Error('Not authenticated')

  const baseUrl = import.meta.env.VITE_RAILWAY_FASTAPI_URL as string
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(init.headers ?? {}),
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = (body as { detail?: string }).detail
    throw Object.assign(
      new Error(detail ?? `Request failed (${res.status})`),
      { status: res.status },
    )
  }

  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// 1. useValidatedRevisions
// ---------------------------------------------------------------------------

export function useValidatedRevisions() {
  return useQuery<ValidatedRevisionRow[]>({
    queryKey: ['montecarlo', 'validated-revisions'],
    queryFn: () =>
      apiFetch<ValidatedRevisionRow[]>('/api/v1/montecarlo/validated-revisions'),
  })
}

// ---------------------------------------------------------------------------
// 2. useRevisionMonteCarloRuns  (lazy — only fires when enabled=true)
// ---------------------------------------------------------------------------

export function useRevisionMonteCarloRuns(
  revisionId: string | undefined,
  enabled: boolean,
) {
  return useQuery<MonteCarloRunSummary[]>({
    queryKey: ['montecarlo', 'runs', revisionId],
    queryFn: () =>
      apiFetch<MonteCarloRunSummary[]>(`/api/v1/montecarlo/${revisionId}/runs`),
    enabled: !!revisionId && enabled,
  })
}

// ---------------------------------------------------------------------------
// 3. useMonteCarloRun
// ---------------------------------------------------------------------------

export function useMonteCarloRun(runId: string | undefined) {
  return useQuery<MonteCarloRunResponse>({
    queryKey: ['montecarlo', 'run', runId],
    queryFn: () =>
      apiFetch<MonteCarloRunResponse>(`/api/v1/montecarlo/run/${runId}`),
    enabled: !!runId,
  })
}

// ---------------------------------------------------------------------------
// 4. useTriggerMonteCarlo
// ---------------------------------------------------------------------------

interface TriggerPayload {
  revisionId: string
  nRuns: number
}

export function useTriggerMonteCarlo() {
  const queryClient = useQueryClient()

  return useMutation<MonteCarloRunResponse, Error, TriggerPayload>({
    mutationFn: ({ revisionId, nRuns }) =>
      apiFetch<MonteCarloRunResponse>(
        `/api/v1/montecarlo/${revisionId}?n_runs=${nRuns}`,
        { method: 'POST' },
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['montecarlo', 'runs', data.revision_id],
      })
      queryClient.setQueryData(
        ['montecarlo', 'run', data.run_id],
        data,
      )
    },
  })
}

// ---------------------------------------------------------------------------
// 5. useDeleteMonteCarloRun
// ---------------------------------------------------------------------------

interface DeletePayload {
  runId: string
  revisionId: string
}

export function useDeleteMonteCarloRun() {
  const queryClient = useQueryClient()

  return useMutation<void, Error, DeletePayload>({
    mutationFn: ({ runId }) =>
      apiFetch<void>(`/api/v1/montecarlo/run/${runId}`, { method: 'DELETE' }),
    onSuccess: (_data, { runId, revisionId }) => {
      queryClient.removeQueries({ queryKey: ['montecarlo', 'run', runId] })
      queryClient.invalidateQueries({
        queryKey: ['montecarlo', 'runs', revisionId],
      })
    },
  })
}
