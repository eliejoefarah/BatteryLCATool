import React from 'react'
import ReactDOM from 'react-dom/client'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { QueryClientProvider } from '@tanstack/react-query'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import App from './App'
import { queryClient } from './lib/queryClient'
import { initAuthListener } from './store/auth'
import './index.css'

ModuleRegistry.registerModules([AllCommunityModule])

initAuthListener()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
)
