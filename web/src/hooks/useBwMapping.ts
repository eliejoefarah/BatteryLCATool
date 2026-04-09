import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutateFunction } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getSession } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BwCatalogRow {
  id: string
  activity_name: string
  reference_product: string | null
  location: string | null
  unit: string | null
  category: string | null
  ecoinvent_version: string
  system_model: string
  similarity_score: number
}

export interface BwSearchResult {
  results: BwCatalogRow[]
  total_in_catalog: number
  catalog_seeded: boolean
}

export interface BwMappingSelection {
  confirmed_activity_name: string | null
  confirmed_reference_product: string | null
  confirmed_location: string | null
  confirmed_unit: string | null
  confirmed_ecoinvent_version: string | null
  confirmed_system_model: string | null
  mapping_notes: string | null
  confirmed_at: string
}

export interface FlowMappingGroup {
  raw_name: string | null
  unit: string | null
  direction: string
  exchange_count: number
  mapping_status: string
  mapping: BwMappingSelection | null
  also_mapped_in_other_revisions: boolean
}

export interface RevisionMappingStatus {
  revision_id: string
  total_input_flows: number
  mapped_flows: number
  skipped_flows: number
  pending_flows: number
  ready_for_export: boolean
  flows: FlowMappingGroup[]
}

export interface RevisionMappingSummary {
  revision_id: string
  total_input_flows: number
  mapped_flows: number
  skipped_flows: number
  pending_flows: number
  ready_for_export: boolean
}

export interface SkipFlowPayload {
  revision_id: string
  raw_name: string
  unit?: string | null
  direction?: string | null
  scope?: 'all' | 'revision'
}

export interface ConfirmMappingPayload {
  revision_id: string
  raw_name: string
  unit?: string | null
  direction?: string | null
  catalog_id?: string
  manual_override?: {
    activity_name: string
    reference_product?: string | null
    location?: string | null
    unit?: string | null
    ecoinvent_version?: string | null
    system_model?: string | null
  }
  mapping_notes?: string | null
  scope?: 'all' | 'revision'
}

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
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
// 1. useRevisionMappingStatus
// ---------------------------------------------------------------------------

export function useRevisionMappingStatus(revisionId: string | undefined) {
  return useQuery<RevisionMappingStatus>({
    queryKey: ['bw-mapping', 'revision', revisionId],
    queryFn: () =>
      apiFetch<RevisionMappingStatus>(`/api/v1/bw-mapping/revision/${revisionId}`),
    enabled: !!revisionId,
  })
}

// ---------------------------------------------------------------------------
// 2. useBwSearch (with 300 ms debounce)
// ---------------------------------------------------------------------------

export function useBwSearch(
  query: string,
  options?: { version?: string; model?: string },
) {
  const [debouncedQuery, setDebouncedQuery] = useState(query)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(id)
  }, [query])

  const params = useMemo(() => {
    const p = new URLSearchParams({ q: debouncedQuery })
    if (options?.version) p.set('version', options.version)
    if (options?.model) p.set('model', options.model)
    return p.toString()
  }, [debouncedQuery, options?.version, options?.model])

  return useQuery<BwSearchResult>({
    queryKey: ['bw-search', debouncedQuery, options],
    queryFn: () => apiFetch<BwSearchResult>(`/api/v1/bw-search?${params}`),
    enabled: debouncedQuery.length >= 2,
  })
}

// ---------------------------------------------------------------------------
// 3. useConfirmMapping
// ---------------------------------------------------------------------------

interface ConfirmMappingResponse {
  exchanges_updated: number
  scope: string
  mapping: BwMappingSelection
}

export function useConfirmMapping() {
  const queryClient = useQueryClient()

  return useMutation<ConfirmMappingResponse, Error, ConfirmMappingPayload>({
    mutationFn: (payload) =>
      apiFetch<ConfirmMappingResponse>('/api/v1/bw-mapping/confirm', {
        method: 'POST',
        body: JSON.stringify({ scope: 'all', ...payload }),
      }),
    onSuccess: (data) => {
      const msg =
        data.scope === 'revision'
          ? 'Mapped for this revision only'
          : 'Mapped for all revisions'
      toast.success(msg)
      queryClient.invalidateQueries({ queryKey: ['bw-mapping', 'revision'] })
      queryClient.invalidateQueries({ queryKey: ['validation'] })
    },
  })
}

// ---------------------------------------------------------------------------
// 4. useUnmapFlow
// ---------------------------------------------------------------------------

interface UnmapPayload {
  raw_name: string
  unit?: string | null
  direction?: string | null
}

interface UnmapResponse {
  exchanges_updated: number
}

export function useUnmapFlow() {
  const queryClient = useQueryClient()

  return useMutation<UnmapResponse, Error, UnmapPayload>({
    mutationFn: (payload) =>
      apiFetch<UnmapResponse>('/api/v1/bw-mapping/confirm', {
        method: 'DELETE',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bw-mapping', 'revision'] })
      queryClient.invalidateQueries({ queryKey: ['validation'] })
    },
  })
}

// ---------------------------------------------------------------------------
// 5. useBwSuggest (optional — gracefully unavailable when 503)
// ---------------------------------------------------------------------------

interface BwSuggestPayload {
  raw_name: string
  unit?: string | null
  direction?: string | null
  revision_id?: string
}

interface BwSuggestResponse {
  results: BwCatalogRow[]
  suggested_queries?: string[]
}

interface UseBwSuggestReturn {
  mutate: UseMutateFunction<BwSuggestResponse, Error & { status?: number }, BwSuggestPayload>
  isPending: boolean
  isUnavailable: boolean
}

export function useBwSuggest(): UseBwSuggestReturn {
  const [isUnavailable, setIsUnavailable] = useState(false)

  const { mutate, isPending } = useMutation<BwSuggestResponse, Error & { status?: number }, BwSuggestPayload>({
    mutationFn: (payload) =>
      apiFetch<BwSuggestResponse>('/api/v1/bw-suggest', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onError: (err) => {
      if ((err as { status?: number }).status === 503) {
        setIsUnavailable(true)
        return  // suppress toast — 503 means AI key not configured
      }
      toast.error(err.message ?? 'AI suggestion failed')
    },
  })

  return { mutate, isPending, isUnavailable }
}

// ---------------------------------------------------------------------------
// 6. useSkipFlow
// ---------------------------------------------------------------------------

interface SkipResponse {
  exchanges_updated: number
  scope: string
}

export function useSkipFlow() {
  const queryClient = useQueryClient()

  return useMutation<SkipResponse, Error, SkipFlowPayload>({
    mutationFn: (payload) =>
      apiFetch<SkipResponse>('/api/v1/bw-mapping/skip', {
        method: 'POST',
        body: JSON.stringify({ scope: 'all', ...payload }),
      }),
    onSuccess: () => {
      toast.success('Flow skipped — will export as-is')
      queryClient.invalidateQueries({ queryKey: ['bw-mapping', 'revision'] })
      queryClient.invalidateQueries({ queryKey: ['bw-mapping', 'bulk-summary'] })
      queryClient.invalidateQueries({ queryKey: ['validation'] })
    },
  })
}

// ---------------------------------------------------------------------------
// 7. useUnskipFlow
// ---------------------------------------------------------------------------

export function useUnskipFlow() {
  const queryClient = useQueryClient()

  return useMutation<UnmapResponse, Error, UnmapPayload>({
    mutationFn: (payload) =>
      apiFetch<UnmapResponse>('/api/v1/bw-mapping/skip', {
        method: 'DELETE',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success('Skip removed — flow is pending again')
      queryClient.invalidateQueries({ queryKey: ['bw-mapping', 'revision'] })
      queryClient.invalidateQueries({ queryKey: ['bw-mapping', 'bulk-summary'] })
    },
  })
}

// ---------------------------------------------------------------------------
// 8. useBulkMappingSummary
// ---------------------------------------------------------------------------

export function useBulkMappingSummary(revisionIds: string[]) {
  const joined = revisionIds.join(',')

  return useQuery<RevisionMappingSummary[]>({
    queryKey: ['bw-mapping', 'bulk-summary', joined],
    queryFn: () =>
      apiFetch<RevisionMappingSummary[]>(
        `/api/v1/bw-mapping/bulk-summary?revision_ids=${encodeURIComponent(joined)}`,
      ),
    enabled: revisionIds.length > 0,
  })
}
