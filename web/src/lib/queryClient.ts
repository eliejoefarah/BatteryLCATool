import { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
    mutations: {
      onError: (error) => {
        toast.error(error instanceof Error ? error.message : 'An unexpected error occurred')
      },
    },
  },
})

// Global query error handler — only fires once auth is established.
// Pre-auth failures (race on login) are expected and resolve on their own.
queryClient.getQueryCache().config.onError = (error) => {
  // Lazy import to avoid circular dep; getState() is synchronous
  import('../store/auth').then(({ useAuthStore }) => {
    if (!useAuthStore.getState().user) return
    toast.error(error instanceof Error ? error.message : 'Failed to load data')
  })
}
