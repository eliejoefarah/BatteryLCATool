import { useNavigate } from 'react-router-dom'

export default function Unauthorized() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-4xl font-bold text-slate-800">403</h1>
      <p className="text-lg text-slate-600">You don&apos;t have permission to access this page.</p>
      <button
        onClick={() => navigate(-1)}
        className="rounded-md bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
      >
        Go back
      </button>
    </div>
  )
}
