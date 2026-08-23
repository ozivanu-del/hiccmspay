import type { JwtVariables } from 'hono/jwt'

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'CASHIER' | 'TREASURER' | 'PARENT'

export type AuthPayload = {
  sub: string
  email: string
  name: string
  role: Role
  parentId?: string
  exp: number
}

export type AppEnv = {
  Bindings: Env
  Variables: JwtVariables<AuthPayload> & { requestId: string }
}

export type ApiErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'CARD_NOT_FOUND'
  | 'CARD_BLOCKED'
  | 'SCAN_REQUIRED'
  | 'PRODUCT_NOT_FOUND'
  | 'TRANSACTION_DUPLICATE'
  | 'TOPUP_NOT_FOUND'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_ALREADY_PROCESSED'
  | 'PAYMENT_GATEWAY_PENDING'
  | 'SYNC_FAILED'
  | 'SYNC_DUPLICATE'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TRANSACTION_LIMIT_EXCEEDED'
  | 'OUTSIDE_OPERATING_HOURS'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
