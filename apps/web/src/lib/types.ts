export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'CASHIER' | 'TREASURER' | 'PARENT'
export type User = { sub: string; email: string; name: string; role: Role; parentId?: string }
export type Branding = { appName: string; organizationName: string; tagline: string; logoUrl?: string; primaryColor: string; secondaryColor: string }
export type Child = { id: string; nis: string; name: string; photo?: string; class: string; room: string; balance: number; cardNumber: string }
export type Product = { id: string; name: string; price: number; merchant_id: string; category: string }
export type Merchant = { id: string; name: string; location: string }
export type Card = { card_id: string; card_number: string; card_status: string; student_id: string; nis: string; student_name: string; photo?: string; class: string; wallet_id: string; balance: number }
export type Transaction = { id: string; reference_id: string; student_id: string; studentName?: string; amount: number; type: string; direction: 'CREDIT' | 'DEBIT'; status: string; merchantName?: string; itemSummary?: string; created_at: string }
