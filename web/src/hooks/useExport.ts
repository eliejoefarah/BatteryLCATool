import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getSession } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportJob {
  export_job_id: string
  status: string
  partner_responsible: string | null
  completed_at: string | null
  file_size_bytes: number | null
  download_url: string | null
}

export interface ExportResponse {
  export_job_id: string
  download_url: string
  already_existed: boolean
}

export interface TriggerExportPayload {
  revisionId: string
  partner_responsible: string
}

// ---------------------------------------------------------------------------
// Shared fetch helper (mirrors useBwMapping.ts pattern)
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
// Browser download trigger
// ---------------------------------------------------------------------------

export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ---------------------------------------------------------------------------
// 1. useRevisionExportJobs
// ---------------------------------------------------------------------------

export function useRevisionExportJobs(revisionId: string | undefined) {
  return useQuery<ExportJob[]>({
    queryKey: ['export-jobs', revisionId],
    queryFn: () => apiFetch<ExportJob[]>(`/api/v1/export/${revisionId}`),
    enabled: !!revisionId,
  })
}

// ---------------------------------------------------------------------------
// 2. useTriggerExport
// ---------------------------------------------------------------------------

export function useTriggerExport() {
  const queryClient = useQueryClient()

  return useMutation<ExportResponse, Error, TriggerExportPayload>({
    mutationFn: ({ revisionId, partner_responsible }) =>
      apiFetch<ExportResponse>(`/api/v1/export/${revisionId}`, {
        method: 'POST',
        body: JSON.stringify({ partner_responsible }),
      }),
    onSuccess: (data, variables) => {
      const filename = `export_${variables.revisionId}.xlsx`
      if (data.already_existed) {
        toast.success('Using existing export — downloading…')
      } else {
        toast.success('Export generated — downloading…')
      }
      triggerDownload(data.download_url, filename)
      queryClient.invalidateQueries({ queryKey: ['export-jobs', variables.revisionId] })
    },
    onError: (err) => {
      toast.error(err.message ?? 'Export failed')
    },
  })
}
