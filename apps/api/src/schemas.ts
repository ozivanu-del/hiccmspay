import { z } from 'zod'

export const loginSchema = z.object({ email: z.email(), password: z.string().min(8).max(128) })
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(12).max(128),
}).refine(({ currentPassword, newPassword }) => currentPassword !== newPassword, {
  message: 'Password baru harus berbeda dari password lama', path: ['newPassword'],
})
export const topupSchema = z.object({ studentId: z.string().min(1), amount: z.number().int().min(10_000).max(1_000_000) })
export const purchaseSchema = z.object({
  referenceId: z.string().min(8).max(100),
  cardToken: z.string().min(3).max(200),
  merchantId: z.string().min(1),
  deviceId: z.string().min(1).max(100),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(20) })).min(1).max(50),
})
export const cashierChargeSchema = z.object({
  referenceId: z.string().min(8).max(100),
  scanSessionId: z.string().min(8).max(100),
  cardToken: z.string().min(3).max(200),
  merchantId: z.string().min(1).max(50),
  deviceId: z.string().min(1).max(100),
  amount: z.number().int().min(500).max(1_000_000),
})
export const cashDepositSchema = z.object({
  studentId: z.string().min(1).max(50),
  amount: z.number().int().min(10_000).max(5_000_000),
  note: z.string().trim().max(200).optional(),
})
export const studentPromotionSchema = z.object({
  nextClass: z.string().trim().min(1).max(30),
  nextEducationLevel: z.string().trim().min(2).max(50),
})
export const studentCreateSchema = z.object({
  nis: z.string().trim().min(4).max(30).regex(/^[A-Za-z0-9._/-]+$/, 'NIS hanya boleh berisi huruf, angka, titik, garis miring, garis bawah, atau tanda hubung'),
  name: z.string().trim().min(2).max(100),
  class: z.string().trim().min(1).max(30),
  educationLevel: z.string().trim().min(2).max(50),
  generation: z.number().int().min(2000).max(2100),
  parentName: z.string().trim().min(2).max(100),
  parentPhone: z.string().trim().min(8).max(30),
  relationship: z.enum(['AYAH', 'IBU', 'WALI']).default('WALI'),
  cardNumber: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9._/-]+$/).optional(),
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
