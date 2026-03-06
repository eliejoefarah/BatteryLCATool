import { useQuery } from '@tanstack/react-query'
import { CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Badge } from './ui/badge'

async function fetchLatestRun(revisionId: string) {
  const { data, error } = await supabase
    .from('validation_run')
    .select('status, issue_count, run_at')
    .eq('revision_id', revisionId)
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

interface Props {
  revisionId: string
}

export default function ValidationBadge({ revisionId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['validation-run', revisionId],
    queryFn: () => fetchLatestRun(revisionId),
    refetchInterval: 10_000,
  })

  if (isLoading) {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading
      </Badge>
    )
  }

  if (!data) {
    return (
      <Badge variant="outline" className="gap-1 text-xs text-slate-400">
        Not validated
      </Badge>
    )
  }

  const s = data.status.toLowerCase()
  const count = data.issue_count

  if (s === 'running' || s === 'pending') {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Running
      </Badge>
    )
  }

  // 'pass' or legacy 'completed' with no issues
  if (s === 'pass' || (s === 'completed' && count === 0)) {
    return (
      <Badge className="gap-1 border-0 bg-green-100 text-xs text-green-800 hover:bg-green-100">
        <CheckCircle className="h-3 w-3" />
        Pass
      </Badge>
    )
  }

  if (s === 'warning') {
    return (
      <Badge className="gap-1 border-0 bg-amber-100 text-xs text-amber-800 hover:bg-amber-100">
        <AlertTriangle className="h-3 w-3" />
        {count > 0 ? `${count} warning${count !== 1 ? 's' : ''}` : 'Warning'}
      </Badge>
    )
  }

  // 'fail', legacy 'completed' with issues, 'failed' (exception path), or unknown
  return (
    <Badge className="gap-1 border-0 bg-red-100 text-xs text-red-800 hover:bg-red-100">
      <XCircle className="h-3 w-3" />
      {count > 0 ? `${count} error${count !== 1 ? 's' : ''}` : 'Failed'}
    </Badge>
  )
}
