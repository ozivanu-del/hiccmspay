import { z } from 'zod'

export const loginSchema = z.object({ email: z.email(), password: z.string().min(8).max(128) })
export const topupSchema = z.object({ studentId: z.string().min(1), amount: z.number().int().min(10_000).max(1_000_000) })
export const purchaseSchema = z.object({
  referenceId: z.string().min(8).max(100),
  cardToken: z.string().min(3).max(200),
  merchantId: z.string().min(1),
  deviceId: z.string().min(1).max(100),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(20) })).min(1).max(50),
})
export const productSchema = z.object({
  name: z.string().trim().min(2).max(100),
  categoryId: z.string().min(1).max(50),
  merchantId: z.string().min(1).max(50),
  price: z.number().int().min(500).max(1_000_000),
})
export const refundSchema = z.object({ transactionId: z.string().min(1), reason: z.string().min(5).max(500), referenceId: z.string().min(8).max(100) })
export const brandingSchema = z.object({
  appName: z.string().min(2).max(60), organizationName: z.string().min(2).max(100), tagline: z.string().min(2).max(160),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})
