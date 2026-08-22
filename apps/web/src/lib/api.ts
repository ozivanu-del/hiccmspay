const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8787'

type ApiSuccess<T> = { success: true; data: T; message: string }
type ApiFailure = { success: false; error: { code: string; message: string }; requestId?: string }

export class ApiError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) { super(message) }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init, credentials: 'include',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  const body = await response.json() as ApiSuccess<T> | ApiFailure
  if (!response.ok || !body.success) {
    const failure = body as ApiFailure
    throw new ApiError(failure.error?.message ?? 'Permintaan gagal', failure.error?.code ?? 'UNKNOWN', response.status)
  }
  return body.data
}

export const rupiah = (amount: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)
export const shortDate = (date: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${date.replace(' ', 'T')}Z`))

