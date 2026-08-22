export type UserRow = { id: string; email: string; name: string; password_hash: string; password_salt: string; role: string; parent_id: string | null }
export type CardWalletRow = { card_id: string; card_number: string; card_status: string; student_id: string; nis: string; student_name: string; photo: string | null; class: string; wallet_id: string; balance: number }
export type ProductRow = { id: string; name: string; price: number; merchant_id: string; category: string; status: string }
export type TopupRow = { id: string; parent_id: string; student_id: string; amount: number; payment_reference: string; provider: string; status: string; created_at: string; paid_at: string | null; synced_at: string | null }
export type TransactionRow = { id: string; reference_id: string; student_id: string; wallet_id: string; amount: number; type: string; direction: string; status: string; merchant_id: string | null; created_at: string }

export function placeholders(count: number): string { return Array.from({ length: count }, () => '?').join(',') }
export function createId(prefix: string): string { return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}` }
export function safeJson(value: unknown): string { return JSON.stringify(value) }

