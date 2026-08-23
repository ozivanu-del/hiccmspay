import type { Context } from 'hono'
import type { AppEnv, ApiErrorCode } from './types'

export const ok = <T>(c: Context<AppEnv>, data: T, message = 'Success', status: 200 | 201 = 200) =>
  c.json({ success: true as const, data, message }, status)

export const fail = (c: Context<AppEnv>, code: ApiErrorCode, message: string, status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503 = 400) =>
  c.json({ success: false as const, error: { code, message }, requestId: c.get('requestId') }, status)

export class AppError extends Error {
  constructor(public readonly code: ApiErrorCode, message: string, public readonly status: 400 | 401 | 403 | 404 | 409 | 422 = 400) {
    super(message)
  }
}
