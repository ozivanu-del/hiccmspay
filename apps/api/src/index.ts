import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv, AuthPayload, Role } from './types'
import { AppError, fail, ok } from './http'
import { verifyHmac, verifyPassword } from './security'
import { brandingSchema, loginSchema, productSchema, purchaseSchema, refundSchema, topupSchema } from './schemas'
import { createId, placeholders, safeJson, type CardWalletRow, type ProductRow, type TopupRow, type TransactionRow, type UserRow } from './db'
import { paymentProvider } from './payment'

const app = new Hono<AppEnv>()
const authPayloadSchema = z.object({
  sub: z.string(), email: z.string(), name: z.string(), role: z.enum(['SUPER_ADMIN', 'ADMIN', 'CASHIER', 'TREASURER', 'PARENT']),
  parentId: z.string().optional(), exp: z.number(),
})

function envSecret(env: Env, name: string): string | undefined {
  const value: unknown = Reflect.get(env, name)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function authSecret(env: Env): string {
  const secret = envSecret(env, 'AUTH_SECRET')
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET minimal 32 karakter belum dikonfigurasi')
  return secret
}

function invalid(c: Context, message: string) {
  return c.json({ success: false as const, error: { code: 'VALIDATION_ERROR', message } }, 422)
}

function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header('CF-Connecting-IP') ?? null
}

function auditStatement(c: import('hono').Context<AppEnv>, action: string, entity: string, entityId: string | null, before: unknown, after: unknown): D1PreparedStatement {
  const actor = c.get('jwtPayload')
  return c.env.DB.prepare(`INSERT INTO audit_logs (id, actor_id, actor_name, action, entity, entity_id, old_value, new_value, device, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    createId('AUD'), actor?.sub ?? null, actor?.name ?? 'SYSTEM', action, entity, entityId,
    before === undefined ? null : safeJson(before), after === undefined ? null : safeJson(after),
    c.req.header('User-Agent')?.slice(0, 250) ?? null, clientIp(c),
  )
}

app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID())
  await next()
  c.header('X-Request-Id', c.get('requestId'))
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('X-Frame-Options', 'DENY')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
})

app.use('*', async (c, next) => {
  const origin = c.req.header('Origin')
  const allowed = !origin || origin === c.env.ALLOWED_ORIGIN
  if (c.req.method === 'OPTIONS') {
    if (!allowed) return new Response(null, { status: 403 })
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': origin ?? c.env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key, X-Payment-Signature',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    } })
  }
  await next()
  if (allowed && origin) {
    c.header('Access-Control-Allow-Origin', origin)
    c.header('Access-Control-Allow-Credentials', 'true')
    c.header('Vary', 'Origin')
  }
})

const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === '/api/webhooks/payment') {
    await next()
    return
  }
  const token = getCookie(c, 'prj_session')
  if (!token) return fail(c, 'UNAUTHORIZED', 'Silakan login terlebih dahulu', 401)
  try {
    const decoded = await verify(token, authSecret(c.env), 'HS256')
    const parsed = authPayloadSchema.safeParse(decoded)
    if (!parsed.success) return fail(c, 'UNAUTHORIZED', 'Sesi tidak valid', 401)
    c.set('jwtPayload', parsed.data)
    await next()
  } catch {
    return fail(c, 'UNAUTHORIZED', 'Sesi telah berakhir, silakan login kembali', 401)
  }
}

const roles = (...allowed: Role[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!allowed.includes(c.get('jwtPayload').role)) return fail(c, 'FORBIDDEN', 'Anda tidak memiliki izin untuk tindakan ini', 403)
  await next()
}

async function parentOwnsStudent(db: D1Database, parentId: string | undefined, studentId: string): Promise<boolean> {
  if (!parentId) return false
  const row = await db.prepare('SELECT 1 AS found FROM parent_students WHERE parent_id = ? AND student_id = ?').bind(parentId, studentId).first<{ found: number }>()
  return row?.found === 1
}

app.get('/', (c) => ok(c, { name: 'PRJ SmartPay API', version: '0.1.0' }))

app.get('/api/health', async (c) => {
  const started = Date.now()
  await c.env.DB.prepare('SELECT 1').first()
  const pending = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'PENDING'").first<{ count: number }>()
  const failed = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM sync_queue WHERE status = 'FAILED'").first<{ count: number }>()
  const last = await c.env.DB.prepare("SELECT processed_at FROM sync_queue WHERE status = 'PROCESSED' ORDER BY processed_at DESC LIMIT 1").first<{ processed_at: string }>()
  return ok(c, { cloudflareApi: 'ONLINE', d1: 'CONNECTED', localServer: 'DEMO_MODE', postgres: 'PHASE_2', pendingSync: pending?.count ?? 0, failedSync: failed?.count ?? 0, lastSync: last?.processed_at ?? null, latencyMs: Date.now() - started })
})

app.get('/api/branding', async (c) => {
  const row = await c.env.DB.prepare(`SELECT app_name AS appName, organization_name AS organizationName, tagline,
    logo_url AS logoUrl, favicon_url AS faviconUrl, primary_color AS primaryColor, secondary_color AS secondaryColor
    FROM branding_settings WHERE id = 1`).first()
  return ok(c, row)
})

app.post('/api/auth/login', zValidator('json', loginSchema, (result, c) => {
  if (!result.success) return invalid(c, 'Email atau password tidak valid')
}), async (c) => {
  const { email, password } = c.req.valid('json')
  const user = await c.env.DB.prepare(`SELECT u.id, u.email, u.name, u.password_hash, u.password_salt, r.name AS role, u.parent_id
    FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ? COLLATE NOCASE AND u.status = 'ACTIVE'`).bind(email).first<UserRow>()
  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) return fail(c, 'UNAUTHORIZED', 'Email atau password salah', 401)
  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60
  const payload: AuthPayload = { sub: user.id, email: user.email, name: user.name, role: authPayloadSchema.shape.role.parse(user.role), ...(user.parent_id ? { parentId: user.parent_id } : {}), exp }
  const token = await sign(payload, authSecret(c.env), 'HS256')
  const isProduction = envSecret(c.env, 'ENVIRONMENT') === 'production'
  setCookie(c, 'prj_session', token, { httpOnly: true, secure: isProduction, sameSite: isProduction ? 'None' : 'Lax', maxAge: 8 * 60 * 60, path: '/' })
  await c.env.DB.prepare(`INSERT INTO audit_logs (id, actor_id, actor_name, action, entity, entity_id, device, ip) VALUES (?, ?, ?, 'LOGIN', 'AUTH', ?, ?, ?)`)
    .bind(createId('AUD'), user.id, user.name, user.id, c.req.header('User-Agent')?.slice(0, 250) ?? null, clientIp(c)).run()
  return ok(c, { user: { id: user.id, email: user.email, name: user.name, role: user.role, parentId: user.parent_id } }, 'Login berhasil')
})

app.post('/api/auth/logout', requireAuth, async (c) => {
  await auditStatement(c, 'LOGOUT', 'AUTH', c.get('jwtPayload').sub, undefined, undefined).run()
  deleteCookie(c, 'prj_session', { path: '/' })
  return ok(c, null, 'Logout berhasil')
})

app.use('/api/*', requireAuth)

app.get('/api/me', (c) => ok(c, c.get('jwtPayload')))

app.get('/api/dashboard', roles('SUPER_ADMIN', 'ADMIN', 'TREASURER'), async (c) => {
  const [students, balance, todayTransactions, todaySpend, todayTopup, recent, merchants] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM students WHERE status = 'ACTIVE'").first<{ value: number }>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(balance), 0) AS value FROM wallets').first<{ value: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS value FROM transactions WHERE date(created_at) = date('now')").first<{ value: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM transactions WHERE type = 'PURCHASE' AND date(created_at) = date('now')").first<{ value: number }>(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) AS value FROM topups WHERE status IN ('PAID','PENDING_SYNC','SYNCED') AND date(paid_at) = date('now')").first<{ value: number }>(),
    c.env.DB.prepare(`WITH RECURSIVE days(day) AS (SELECT date('now','-6 days') UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < date('now'))
      SELECT day, COALESCE(COUNT(t.id),0) AS transactions, COALESCE(SUM(CASE WHEN t.type='PURCHASE' THEN t.amount ELSE 0 END),0) AS spending
      FROM days LEFT JOIN transactions t ON date(t.created_at)=day GROUP BY day ORDER BY day`).all(),
    c.env.DB.prepare(`SELECT m.name, COALESCE(SUM(t.amount),0) AS amount FROM merchants m LEFT JOIN transactions t ON t.merchant_id=m.id AND t.type='PURCHASE' GROUP BY m.id ORDER BY amount DESC`).all(),
  ])
  return ok(c, { totals: { students: students?.value ?? 0, circulatingBalance: balance?.value ?? 0, transactionsToday: todayTransactions?.value ?? 0, spendingToday: todaySpend?.value ?? 0, topupsToday: todayTopup?.value ?? 0 }, sevenDays: recent.results, byMerchant: merchants.results })
})

app.get('/api/students', roles('SUPER_ADMIN', 'ADMIN', 'TREASURER'), async (c) => {
  const search = (c.req.query('search') ?? '').trim()
  const status = c.req.query('status') ?? 'ACTIVE'
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1)
  const limit = Math.min(100, Math.max(10, Number.parseInt(c.req.query('limit') ?? '25', 10) || 25))
  const pattern = `%${search}%`
  const rows = await c.env.DB.prepare(`SELECT s.id, s.nis, s.name, s.photo, s.class, s.room, s.generation, s.status, w.id AS walletId, w.balance,
    ca.id AS cardId, ca.card_number AS cardNumber, ca.status AS cardStatus FROM students s JOIN wallets w ON w.student_id=s.id
    LEFT JOIN cards ca ON ca.student_id=s.id AND ca.status='ACTIVE' WHERE s.status = ? AND (s.name LIKE ? OR s.nis LIKE ?) ORDER BY s.name LIMIT ? OFFSET ?`)
    .bind(status, pattern, pattern, limit, (page - 1) * limit).all()
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS value FROM students WHERE status = ? AND (name LIKE ? OR nis LIKE ?)').bind(status, pattern, pattern).first<{ value: number }>()
  return ok(c, { items: rows.results, page, limit, total: count?.value ?? 0 })
})

app.get('/api/students/:id', async (c) => {
  const user = c.get('jwtPayload')
  if (user.role === 'PARENT' && !(await parentOwnsStudent(c.env.DB, user.parentId, c.req.param('id')))) return fail(c, 'FORBIDDEN', 'Santri tidak terhubung dengan akun Anda', 403)
  const student = await c.env.DB.prepare(`SELECT s.*, w.id AS walletId, w.balance, ca.card_number AS cardNumber, ca.qr_token AS cardToken, ca.status AS cardStatus
    FROM students s JOIN wallets w ON w.student_id=s.id LEFT JOIN cards ca ON ca.student_id=s.id AND ca.status='ACTIVE' WHERE s.id=?`).bind(c.req.param('id')).first()
  if (!student) return fail(c, 'CARD_NOT_FOUND', 'Data santri tidak ditemukan', 404)
  return ok(c, student)
})

app.get('/api/parents', roles('SUPER_ADMIN', 'ADMIN', 'TREASURER'), async (c) => {
  const search = (c.req.query('search') ?? '').trim()
  const limit = Math.min(100, Math.max(10, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50))
  const pattern = `%${search}%`
  const [rows, summary] = await Promise.all([
    c.env.DB.prepare(`SELECT p.id,p.name,p.phone,p.status,u.email,u.status AS accountStatus,
      COUNT(DISTINCT ps.student_id) AS childCount,COALESCE(SUM(w.balance),0) AS totalBalance,
      GROUP_CONCAT(s.id || '|' || s.name || '|' || s.class,';;') AS childSummary
      FROM parents p LEFT JOIN users u ON u.parent_id=p.id LEFT JOIN parent_students ps ON ps.parent_id=p.id
      LEFT JOIN students s ON s.id=ps.student_id LEFT JOIN wallets w ON w.student_id=s.id
      WHERE p.name LIKE ? OR COALESCE(p.phone,'') LIKE ? OR COALESCE(u.email,'') LIKE ?
      GROUP BY p.id,u.id ORDER BY p.name LIMIT ?`).bind(pattern, pattern, pattern, limit).all<{
        id: string; name: string; phone: string | null; status: string; email: string | null; accountStatus: string | null
        childCount: number; totalBalance: number; childSummary: string | null
      }>(),
    c.env.DB.prepare(`SELECT COUNT(DISTINCT p.id) AS totalParents,
      COUNT(DISTINCT CASE WHEN u.status='ACTIVE' THEN u.id END) AS activeAccounts,
      COUNT(DISTINCT ps.student_id) AS linkedStudents,COALESCE(SUM(w.balance),0) AS managedBalance
      FROM parents p LEFT JOIN users u ON u.parent_id=p.id LEFT JOIN parent_students ps ON ps.parent_id=p.id
      LEFT JOIN wallets w ON w.student_id=ps.student_id`).first(),
  ])
  return ok(c, {
    summary,
    items: rows.results.map((row) => ({
      ...row,
      children: row.childSummary ? row.childSummary.split(';;').map((child) => {
        const [id, name, studentClass] = child.split('|')
        return { id, name, class: studentClass }
      }) : [],
      childSummary: undefined,
    })),
  })
})

app.get('/api/wallets', roles('SUPER_ADMIN', 'ADMIN', 'TREASURER'), async (c) => {
  const search = (c.req.query('search') ?? '').trim()
  const limit = Math.min(100, Math.max(10, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50))
  const pattern = `%${search}%`
  const [rows, summary] = await Promise.all([
    c.env.DB.prepare(`SELECT w.id,w.student_id AS studentId,w.balance,w.version,w.updated_at AS updatedAt,
      s.nis,s.name AS studentName,s.class,s.room,ca.card_number AS cardNumber,COALESCE(ca.status,'UNASSIGNED') AS cardStatus,
      COALESCE((SELECT SUM(wl.amount) FROM wallet_ledger wl WHERE wl.wallet_id=w.id AND wl.direction='CREDIT' AND wl.scope='LOCAL'),0) AS totalCredit,
      COALESCE((SELECT SUM(wl.amount) FROM wallet_ledger wl WHERE wl.wallet_id=w.id AND wl.direction='DEBIT' AND wl.scope='LOCAL'),0) AS totalDebit,
      (SELECT MAX(wl.created_at) FROM wallet_ledger wl WHERE wl.wallet_id=w.id) AS lastActivity
      FROM wallets w JOIN students s ON s.id=w.student_id
      LEFT JOIN cards ca ON ca.student_id=s.id AND ca.status='ACTIVE'
      WHERE s.name LIKE ? OR s.nis LIKE ? OR w.id LIKE ? OR COALESCE(ca.card_number,'') LIKE ?
      ORDER BY w.balance DESC,s.name LIMIT ?`).bind(pattern, pattern, pattern, pattern, limit).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS totalWallets,COALESCE(SUM(balance),0) AS totalBalance,
      SUM(CASE WHEN balance < 20000 THEN 1 ELSE 0 END) AS lowBalance,
      (SELECT COUNT(*) FROM cards WHERE status='ACTIVE') AS activeCards FROM wallets`).first(),
  ])
  return ok(c, { summary, items: rows.results })
})

app.get('/api/wallets/:studentId/ledger', async (c) => {
  const user = c.get('jwtPayload')
  const studentId = c.req.param('studentId')
  if (user.role === 'PARENT' && !(await parentOwnsStudent(c.env.DB, user.parentId, studentId))) return fail(c, 'FORBIDDEN', 'Wallet tidak terhubung dengan akun Anda', 403)
  const [wallet, ledger, totals] = await Promise.all([
    c.env.DB.prepare(`SELECT w.id,w.student_id AS studentId,w.balance,w.version,w.updated_at AS updatedAt,
      s.nis,s.name AS studentName,s.class,s.room,ca.card_number AS cardNumber,COALESCE(ca.status,'UNASSIGNED') AS cardStatus
      FROM wallets w JOIN students s ON s.id=w.student_id LEFT JOIN cards ca ON ca.student_id=s.id AND ca.status='ACTIVE'
      WHERE s.id=?`).bind(studentId).first(),
    c.env.DB.prepare(`SELECT id,reference_id AS referenceId,amount,type,direction,status,source,scope,created_at AS createdAt
      FROM wallet_ledger WHERE student_id=? ORDER BY created_at DESC LIMIT 30`).bind(studentId).all(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' AND scope='LOCAL' THEN amount ELSE 0 END),0) AS totalCredit,
      COALESCE(SUM(CASE WHEN direction='DEBIT' AND scope='LOCAL' THEN amount ELSE 0 END),0) AS totalDebit,
      COUNT(CASE WHEN scope='LOCAL' THEN 1 END) AS ledgerEntries FROM wallet_ledger WHERE student_id=?`).bind(studentId).first(),
  ])
  if (!wallet) return fail(c, 'CARD_NOT_FOUND', 'Wallet tidak ditemukan', 404)
  return ok(c, { wallet, totals, ledger: ledger.results })
})

app.get('/api/cards/:token', roles('SUPER_ADMIN', 'ADMIN', 'CASHIER'), async (c) => {
  const card = await c.env.DB.prepare(`SELECT ca.id AS card_id, ca.card_number, ca.status AS card_status, s.id AS student_id, s.nis, s.name AS student_name,
    s.photo, s.class, w.id AS wallet_id, w.balance FROM cards ca JOIN students s ON s.id=ca.student_id JOIN wallets w ON w.student_id=s.id
    WHERE ca.qr_token=? OR ca.card_number=?`).bind(c.req.param('token'), c.req.param('token')).first<CardWalletRow>()
  if (!card) return fail(c, 'CARD_NOT_FOUND', 'Kartu tidak ditemukan', 404)
  if (card.card_status !== 'ACTIVE') return fail(c, 'CARD_BLOCKED', `Kartu berstatus ${card.card_status}`, 409)
  return ok(c, card)
})

app.get('/api/wallets/:studentId', async (c) => {
  const user = c.get('jwtPayload')
  if (user.role === 'PARENT' && !(await parentOwnsStudent(c.env.DB, user.parentId, c.req.param('studentId')))) return fail(c, 'FORBIDDEN', 'Wallet tidak terhubung dengan akun Anda', 403)
  const wallet = await c.env.DB.prepare('SELECT id, student_id AS studentId, balance, version, updated_at AS updatedAt FROM wallets WHERE student_id=?').bind(c.req.param('studentId')).first()
  if (!wallet) return fail(c, 'CARD_NOT_FOUND', 'Wallet tidak ditemukan', 404)
  return ok(c, wallet)
})

app.get('/api/merchants', async (c) => ok(c, (await c.env.DB.prepare("SELECT id,name,location,status FROM merchants WHERE status='ACTIVE' ORDER BY name").all()).results))
app.get('/api/product-categories', async (c) => ok(c, (await c.env.DB.prepare('SELECT id,name FROM product_categories ORDER BY name').all()).results))
app.get('/api/products', async (c) => {
  const merchantId = c.req.query('merchantId')
  const query = `SELECT p.id,p.name,p.price,p.merchant_id,c.name AS category,p.status FROM products p JOIN product_categories c ON c.id=p.category_id WHERE p.status='ACTIVE'${merchantId ? ' AND p.merchant_id=?' : ''} ORDER BY c.name,p.name`
  const result = merchantId ? await c.env.DB.prepare(query).bind(merchantId).all<ProductRow>() : await c.env.DB.prepare(query).all<ProductRow>()
  return ok(c, result.results)
})

app.post('/api/products', roles('SUPER_ADMIN', 'ADMIN', 'CASHIER'), zValidator('json', productSchema, (result, c) => {
  if (!result.success) return invalid(c, 'Nama, kategori, kantin, atau harga produk tidak valid')
}), async (c) => {
  const input = c.req.valid('json')
  const [merchant, category, duplicate] = await Promise.all([
    c.env.DB.prepare("SELECT id,name FROM merchants WHERE id=? AND status='ACTIVE'").bind(input.merchantId).first<{ id: string; name: string }>(),
    c.env.DB.prepare('SELECT id,name FROM product_categories WHERE id=?').bind(input.categoryId).first<{ id: string; name: string }>(),
    c.env.DB.prepare("SELECT id FROM products WHERE merchant_id=? AND name=? COLLATE NOCASE AND status='ACTIVE'").bind(input.merchantId, input.name).first<{ id: string }>(),
  ])
  if (!merchant) return fail(c, 'VALIDATION_ERROR', 'Kantin tidak ditemukan atau tidak aktif', 422)
  if (!category) return fail(c, 'VALIDATION_ERROR', 'Kategori produk tidak ditemukan', 422)
  if (duplicate) return fail(c, 'VALIDATION_ERROR', 'Produk dengan nama tersebut sudah ada di kantin ini', 409)
  const productId = createId('PROD')
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO products (id,name,category_id,price,merchant_id,status) VALUES (?,?,?,?,?,'ACTIVE')")
      .bind(productId, input.name, input.categoryId, input.price, input.merchantId),
    auditStatement(c, 'PRODUCT_CREATED', 'PRODUCT', productId, undefined, { name: input.name, price: input.price, merchantId: input.merchantId, categoryId: input.categoryId }),
  ])
  return ok(c, { id: productId, name: input.name, price: input.price, merchant_id: input.merchantId, category: category.name, merchantName: merchant.name, status: 'ACTIVE' }, 'Produk berhasil ditambahkan', 201)
})

app.get('/api/parent/children', roles('PARENT'), async (c) => {
  const rows = await c.env.DB.prepare(`SELECT s.id,s.nis,s.name,s.photo,s.class,s.room,w.balance,ca.card_number AS cardNumber
    FROM parent_students ps JOIN students s ON s.id=ps.student_id JOIN wallets w ON w.student_id=s.id LEFT JOIN cards ca ON ca.student_id=s.id AND ca.status='ACTIVE'
    WHERE ps.parent_id=? ORDER BY s.name`).bind(c.get('jwtPayload').parentId).all()
  return ok(c, rows.results)
})

app.get('/api/topups', roles('SUPER_ADMIN', 'ADMIN', 'TREASURER'), async (c) => {
  const status = (c.req.query('status') ?? '').trim()
  const [rows, summary] = await Promise.all([
    (status
      ? c.env.DB.prepare(`SELECT t.id,t.payment_reference AS paymentReference,t.amount,t.provider,t.status,t.created_at AS createdAt,t.paid_at AS paidAt,t.synced_at AS syncedAt,
          p.name AS parentName,s.name AS studentName,s.nis,pay.status AS paymentStatus
          FROM topups t JOIN parents p ON p.id=t.parent_id JOIN students s ON s.id=t.student_id LEFT JOIN payments pay ON pay.topup_id=t.id
          WHERE t.status=? ORDER BY t.created_at DESC LIMIT 100`).bind(status)
      : c.env.DB.prepare(`SELECT t.id,t.payment_reference AS paymentReference,t.amount,t.provider,t.status,t.created_at AS createdAt,t.paid_at AS paidAt,t.synced_at AS syncedAt,
          p.name AS parentName,s.name AS studentName,s.nis,pay.status AS paymentStatus
          FROM topups t JOIN parents p ON p.id=t.parent_id JOIN students s ON s.id=t.student_id LEFT JOIN payments pay ON pay.topup_id=t.id
          ORDER BY t.created_at DESC LIMIT 100`)).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS totalTopups,
      COALESCE(SUM(CASE WHEN status='SYNCED' THEN amount ELSE 0 END),0) AS syncedAmount,
      SUM(CASE WHEN status='PENDING_PAYMENT' THEN 1 ELSE 0 END) AS pendingPayment,
      SUM(CASE WHEN status='PENDING_SYNC' THEN 1 ELSE 0 END) AS pendingSync FROM topups`).first(),
  ])
  return ok(c, { summary, items: rows.results })
})

app.get('/api/transactions', async (c) => {
  const user = c.get('jwtPayload')
  const studentId = c.req.query('studentId')
  if (user.role === 'PARENT') {
    if (!studentId || !(await parentOwnsStudent(c.env.DB, user.parentId, studentId))) return fail(c, 'FORBIDDEN', 'Pilih anak yang terhubung dengan akun Anda', 403)
  }
  const rows = studentId
    ? await c.env.DB.prepare(`SELECT t.*,m.name AS merchantName,GROUP_CONCAT(ti.product_name || CASE WHEN ti.quantity>1 THEN ' ×' || ti.quantity ELSE '' END,' · ') AS itemSummary
      FROM transactions t LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN transaction_items ti ON ti.transaction_id=t.id WHERE t.student_id=? GROUP BY t.id ORDER BY t.created_at DESC LIMIT 100`).bind(studentId).all()
    : await c.env.DB.prepare(`SELECT t.*,s.name AS studentName,m.name AS merchantName,GROUP_CONCAT(ti.product_name || CASE WHEN ti.quantity>1 THEN ' ×' || ti.quantity ELSE '' END,' · ') AS itemSummary
      FROM transactions t JOIN students s ON s.id=t.student_id LEFT JOIN merchants m ON m.id=t.merchant_id LEFT JOIN transaction_items ti ON ti.transaction_id=t.id GROUP BY t.id ORDER BY t.created_at DESC LIMIT 100`).all()
  return ok(c, rows.results)
})

app.post('/api/transactions', roles('SUPER_ADMIN', 'ADMIN', 'CASHIER'), zValidator('json', purchaseSchema, (result, c) => {
  if (!result.success) return invalid(c, 'Data transaksi tidak valid')
}), async (c) => {
  const input = c.req.valid('json')
  const duplicate = await c.env.DB.prepare('SELECT id,amount FROM transactions WHERE reference_id=?').bind(input.referenceId).first()
  if (duplicate) return ok(c, { ...duplicate, idempotent: true }, 'ALREADY_PROCESSED')
  const card = await c.env.DB.prepare(`SELECT ca.id AS card_id,ca.card_number,ca.status AS card_status,s.id AS student_id,s.nis,s.name AS student_name,s.photo,s.class,w.id AS wallet_id,w.balance
    FROM cards ca JOIN students s ON s.id=ca.student_id JOIN wallets w ON w.student_id=s.id WHERE ca.qr_token=? OR ca.card_number=?`).bind(input.cardToken, input.cardToken).first<CardWalletRow>()
  if (!card) return fail(c, 'CARD_NOT_FOUND', 'Kartu tidak ditemukan', 404)
  if (card.card_status !== 'ACTIVE') return fail(c, 'CARD_BLOCKED', 'Kartu tidak aktif', 409)
  const ids = [...new Set(input.items.map((item) => item.productId))]
  const products = await c.env.DB.prepare(`SELECT p.id,p.name,p.price,p.merchant_id,c.name AS category,p.status FROM products p JOIN product_categories c ON c.id=p.category_id WHERE p.id IN (${placeholders(ids.length)}) AND p.status='ACTIVE'`).bind(...ids).all<ProductRow>()
  const byId = new Map(products.results.map((product) => [product.id, product]))
  const items = input.items.map((item) => {
    const product = byId.get(item.productId)
    if (!product || product.merchant_id !== input.merchantId) throw new AppError('PRODUCT_NOT_FOUND', 'Produk tidak tersedia di kantin ini', 404)
    return { ...item, name: product.name, unitPrice: product.price, subtotal: product.price * item.quantity }
  })
  const total = items.reduce((sum, item) => sum + item.subtotal, 0)
  if (card.balance < total) return fail(c, 'INSUFFICIENT_BALANCE', 'Saldo tidak mencukupi', 409)
  const limitRows = await c.env.DB.prepare("SELECT key,value FROM app_settings WHERE key IN ('limits_enabled','transaction_limit','daily_spending_limit')").all<{ key: string; value: string }>()
  const settings = Object.fromEntries(limitRows.results.map((row) => [row.key, row.value]))
  if (settings.limits_enabled === 'true') {
    if (total > Number(settings.transaction_limit)) return fail(c, 'TRANSACTION_LIMIT_EXCEEDED', 'Nominal melebihi batas per transaksi', 409)
    const spent = await c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS value FROM transactions WHERE student_id=? AND type='PURCHASE' AND date(created_at)=date('now')").bind(card.student_id).first<{ value: number }>()
    if ((spent?.value ?? 0) + total > Number(settings.daily_spending_limit)) return fail(c, 'TRANSACTION_LIMIT_EXCEEDED', 'Batas belanja harian telah tercapai', 409)
  }
  const transactionId = createId('TX')
  const ledgerId = createId('LED')
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare("UPDATE wallets SET balance=balance-?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(total, card.wallet_id),
    c.env.DB.prepare(`INSERT INTO transactions (id,reference_id,student_id,wallet_id,amount,type,direction,status,source,merchant_id,cashier_id,device_id,metadata)
      VALUES (?,?,?,?,?,'PURCHASE','DEBIT','COMPLETED','LOCAL_POS',?,?,?,?)`).bind(transactionId, input.referenceId, card.student_id, card.wallet_id, total, input.merchantId, c.get('jwtPayload').sub, input.deviceId, safeJson({ itemCount: items.length })),
    ...items.map((item) => c.env.DB.prepare('INSERT INTO transaction_items (id,transaction_id,product_id,product_name,quantity,unit_price,subtotal) VALUES (?,?,?,?,?,?,?)')
      .bind(createId('ITEM'), transactionId, item.productId, item.name, item.quantity, item.unitPrice, item.subtotal)),
    c.env.DB.prepare(`INSERT INTO wallet_ledger (id,transaction_id,reference_id,student_id,wallet_id,amount,type,direction,status,source,scope,metadata)
      VALUES (?,?,?,?,?,?,'PURCHASE','DEBIT','COMPLETED','LOCAL_POS','LOCAL',?)`).bind(ledgerId, transactionId, input.referenceId, card.student_id, card.wallet_id, total, safeJson({ merchantId: input.merchantId })),
    auditStatement(c, 'PURCHASE', 'TRANSACTION', transactionId, undefined, { referenceId: input.referenceId, amount: total, studentId: card.student_id }),
  ]
  try { await c.env.DB.batch(statements) } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('INSUFFICIENT_BALANCE')) return fail(c, 'INSUFFICIENT_BALANCE', 'Saldo berubah dan kini tidak mencukupi', 409)
    if (message.includes('UNIQUE')) return ok(c, { referenceId: input.referenceId, idempotent: true }, 'ALREADY_PROCESSED')
    throw error
  }
  return ok(c, { id: transactionId, referenceId: input.referenceId, student: { id: card.student_id, name: card.student_name }, amount: total, balanceBefore: card.balance, balanceAfter: card.balance - total, items }, 'TRANSAKSI BERHASIL', 201)
})

app.post('/api/topups', roles('PARENT'), zValidator('json', topupSchema, (result, c) => {
  if (!result.success) return invalid(c, 'Nominal top-up harus Rp10.000–Rp1.000.000')
}), async (c) => {
  const input = c.req.valid('json')
  const user = c.get('jwtPayload')
  if (!(await parentOwnsStudent(c.env.DB, user.parentId, input.studentId))) return fail(c, 'FORBIDDEN', 'Anda hanya dapat mengisi saldo anak yang terhubung', 403)
  const idempotencyKey = c.req.header('Idempotency-Key')
  if (idempotencyKey) {
    const existing = await c.env.DB.prepare('SELECT * FROM topups WHERE payment_reference=?').bind(idempotencyKey).first<TopupRow>()
    if (existing) return ok(c, existing, 'ALREADY_PROCESSED')
  }
  const topupId = createId('TOPUP')
  const reference = idempotencyKey ?? createId('PRJ-TOPUP')
  const provider = paymentProvider('demo')
  const session = await provider.createPayment({ topupId, reference, amount: input.amount })
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO topups (id,parent_id,student_id,amount,payment_reference,provider,status) VALUES (?,?,?,?,?,?,'PENDING_PAYMENT')`).bind(topupId, user.parentId, input.studentId, input.amount, reference, provider.name),
    c.env.DB.prepare(`INSERT INTO payments (id,topup_id,provider,provider_reference,amount,status) VALUES (?,?,?,?,?,'PENDING')`).bind(createId('PAY'), topupId, provider.name, session.providerReference, input.amount),
    auditStatement(c, 'TOPUP_CREATED', 'TOPUP', topupId, undefined, { studentId: input.studentId, amount: input.amount }),
  ])
  return ok(c, { id: topupId, paymentReference: reference, provider: provider.name, checkoutUrl: session.checkoutUrl, status: 'PENDING_PAYMENT', amount: input.amount }, 'Top-up dibuat', 201)
})

app.get('/api/topups/:id', async (c) => {
  const topup = await c.env.DB.prepare('SELECT * FROM topups WHERE id=?').bind(c.req.param('id')).first<TopupRow>()
  if (!topup) return fail(c, 'TOPUP_NOT_FOUND', 'Top-up tidak ditemukan', 404)
  const user = c.get('jwtPayload')
  if (user.role === 'PARENT' && topup.parent_id !== user.parentId) return fail(c, 'FORBIDDEN', 'Top-up bukan milik akun Anda', 403)
  return ok(c, topup)
})

async function markTopupPaid(c: import('hono').Context<AppEnv>, topup: TopupRow, providerReference: string): Promise<{ eventId: string }> {
  if (topup.status !== 'PENDING_PAYMENT') throw new AppError('PAYMENT_ALREADY_PROCESSED', 'Pembayaran sudah diproses', 409)
  const eventId = createId('SYNC')
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE topups SET status='PENDING_SYNC',paid_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING_PAYMENT'").bind(topup.id),
    c.env.DB.prepare("UPDATE payments SET status='PAID',provider_reference=?,paid_at=CURRENT_TIMESTAMP WHERE topup_id=? AND status='PENDING'").bind(providerReference, topup.id),
    c.env.DB.prepare(`INSERT INTO wallet_ledger (id,reference_id,student_id,wallet_id,amount,type,direction,status,source,scope,metadata)
      SELECT ?,?,t.student_id,w.id,t.amount,'TOPUP','CREDIT','PENDING_SYNC','ONLINE_PAYMENT','CLOUD',? FROM topups t JOIN wallets w ON w.student_id=t.student_id WHERE t.id=?`)
      .bind(createId('LED-CLOUD'), `CLOUD-${topup.payment_reference}`, safeJson({ topupId: topup.id }), topup.id),
    c.env.DB.prepare("INSERT INTO sync_queue (id,event_type,reference_id,payload,status) VALUES (?,'TOPUP',?,?,'PENDING')").bind(eventId, topup.payment_reference, safeJson({ topupId: topup.id, studentId: topup.student_id, amount: topup.amount })),
    auditStatement(c, 'PAYMENT_CONFIRMED', 'TOPUP', topup.id, { status: topup.status }, { status: 'PENDING_SYNC', amount: topup.amount }),
  ])
  return { eventId }
}

app.post('/api/topups/:id/simulate-payment', roles('PARENT', 'SUPER_ADMIN', 'TREASURER'), async (c) => {
  if (c.env.DEMO_MODE !== 'true') return fail(c, 'FORBIDDEN', 'Simulasi payment hanya tersedia pada demo mode', 403)
  const topup = await c.env.DB.prepare('SELECT * FROM topups WHERE id=?').bind(c.req.param('id')).first<TopupRow>()
  if (!topup) return fail(c, 'TOPUP_NOT_FOUND', 'Top-up tidak ditemukan', 404)
  const user = c.get('jwtPayload')
  if (user.role === 'PARENT' && topup.parent_id !== user.parentId) return fail(c, 'FORBIDDEN', 'Top-up bukan milik akun Anda', 403)
  if (topup.status !== 'PENDING_PAYMENT') return ok(c, topup, 'ALREADY_PROCESSED')
  const result = await markTopupPaid(c, topup, `DEMO-PAID-${topup.payment_reference}`)
  return ok(c, { id: topup.id, status: 'PENDING_SYNC', ...result }, 'Pembayaran demo berhasil')
})

app.post('/api/topups/:id/simulate-sync', roles('PARENT', 'SUPER_ADMIN', 'TREASURER'), async (c) => {
  if (c.env.DEMO_MODE !== 'true') return fail(c, 'FORBIDDEN', 'Simulasi sync hanya tersedia pada demo mode', 403)
  const topup = await c.env.DB.prepare('SELECT * FROM topups WHERE id=?').bind(c.req.param('id')).first<TopupRow>()
  if (!topup) return fail(c, 'TOPUP_NOT_FOUND', 'Top-up tidak ditemukan', 404)
  const user = c.get('jwtPayload')
  if (user.role === 'PARENT' && topup.parent_id !== user.parentId) return fail(c, 'FORBIDDEN', 'Top-up bukan milik akun Anda', 403)
  if (topup.status === 'SYNCED') return ok(c, topup, 'ALREADY_PROCESSED')
  if (topup.status !== 'PENDING_SYNC') return fail(c, 'SYNC_FAILED', 'Pembayaran belum tervalidasi', 409)
  const transactionId = createId('TX-TOPUP')
  const reference = `LOCAL-${topup.payment_reference}`
  const wallet = await c.env.DB.prepare('SELECT id,balance FROM wallets WHERE student_id=?').bind(topup.student_id).first<{ id: string; balance: number }>()
  if (!wallet) return fail(c, 'SYNC_FAILED', 'Wallet lokal tidak ditemukan', 409)
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE wallets SET balance=balance+?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(topup.amount, wallet.id),
      c.env.DB.prepare(`INSERT INTO transactions (id,reference_id,student_id,wallet_id,amount,type,direction,status,source,synced_at,metadata)
        VALUES (?,?,?,?,?,'TOPUP','CREDIT','COMPLETED','CLOUD_SYNC',CURRENT_TIMESTAMP,?)`).bind(transactionId, reference, topup.student_id, wallet.id, topup.amount, safeJson({ topupId: topup.id })),
      c.env.DB.prepare(`INSERT INTO wallet_ledger (id,transaction_id,reference_id,student_id,wallet_id,amount,type,direction,status,source,scope,synced_at,metadata)
        VALUES (?,?,?,?,?,?,'TOPUP','CREDIT','COMPLETED','CLOUD_SYNC','LOCAL',CURRENT_TIMESTAMP,?)`).bind(createId('LED-LOCAL'), transactionId, reference, topup.student_id, wallet.id, topup.amount, safeJson({ topupId: topup.id })),
      c.env.DB.prepare("UPDATE topups SET status='SYNCED',synced_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING_SYNC'").bind(topup.id),
      c.env.DB.prepare("UPDATE sync_queue SET status='PROCESSED',attempt_count=attempt_count+1,processed_at=CURRENT_TIMESTAMP WHERE reference_id=? AND status='PENDING'").bind(topup.payment_reference),
      auditStatement(c, 'SYNC_COMPLETED', 'TOPUP', topup.id, { status: 'PENDING_SYNC' }, { status: 'SYNCED', amount: topup.amount }),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('UNIQUE')) return ok(c, { id: topup.id, status: 'SYNCED', idempotent: true }, 'ALREADY_PROCESSED')
    throw error
  }
  return ok(c, { id: topup.id, status: 'SYNCED', balanceBefore: wallet.balance, balanceAfter: wallet.balance + topup.amount }, 'Sinkronisasi demo berhasil')
})

app.post('/api/webhooks/payment', async (c) => {
  const raw = await c.req.text()
  if (raw.length > 64_000) return fail(c, 'VALIDATION_ERROR', 'Payload webhook terlalu besar', 422)
  const secret = envSecret(c.env, 'PAYMENT_SECRET')
  const signature = c.req.header('X-Payment-Signature') ?? ''
  if (!secret || !(await verifyHmac(raw, signature, secret))) return fail(c, 'UNAUTHORIZED', 'Signature webhook tidak valid', 401)
  let payload: unknown
  try { payload = JSON.parse(raw) } catch { return fail(c, 'VALIDATION_ERROR', 'Payload webhook bukan JSON valid', 422) }
  const parsed = z.object({ paymentReference: z.string(), providerReference: z.string(), amount: z.number().int().positive(), status: z.literal('PAID') }).safeParse(payload)
  if (!parsed.success) return fail(c, 'VALIDATION_ERROR', 'Payload webhook tidak valid', 422)
  const topup = await c.env.DB.prepare('SELECT * FROM topups WHERE payment_reference=?').bind(parsed.data.paymentReference).first<TopupRow>()
  if (!topup) return fail(c, 'TOPUP_NOT_FOUND', 'Top-up tidak ditemukan', 404)
  if (topup.amount !== parsed.data.amount) return fail(c, 'PAYMENT_FAILED', 'Nominal pembayaran tidak sesuai', 409)
  if (topup.status !== 'PENDING_PAYMENT') return ok(c, { id: topup.id, status: topup.status }, 'ALREADY_PROCESSED')
  await markTopupPaid(c, topup, parsed.data.providerReference)
  return ok(c, { id: topup.id, status: 'PENDING_SYNC' }, 'Webhook diproses')
})

app.post('/api/refunds', roles('SUPER_ADMIN', 'TREASURER'), zValidator('json', refundSchema, (result, c) => {
  if (!result.success) return invalid(c, 'Data refund tidak valid')
}), async (c) => {
  const input = c.req.valid('json')
  const original = await c.env.DB.prepare("SELECT * FROM transactions WHERE id=? AND type='PURCHASE' AND status='COMPLETED'").bind(input.transactionId).first<TransactionRow>()
  if (!original) return fail(c, 'PRODUCT_NOT_FOUND', 'Transaksi pembelian tidak ditemukan', 404)
  const existing = await c.env.DB.prepare('SELECT id FROM refunds WHERE transaction_id=?').bind(original.id).first()
  if (existing) return fail(c, 'TRANSACTION_DUPLICATE', 'Transaksi ini sudah direfund', 409)
  const refundId = createId('REFUND')
  const transactionId = createId('TX-REFUND')
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE wallets SET balance=balance+?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(original.amount, original.wallet_id),
    c.env.DB.prepare(`INSERT INTO transactions (id,reference_id,student_id,wallet_id,amount,type,direction,status,source,metadata) VALUES (?,?,?,?,?,'REFUND','CREDIT','COMPLETED','ADMIN_REFUND',?)`)
      .bind(transactionId, input.referenceId, original.student_id, original.wallet_id, original.amount, safeJson({ originalTransactionId: original.id, reason: input.reason })),
    c.env.DB.prepare(`INSERT INTO wallet_ledger (id,transaction_id,reference_id,student_id,wallet_id,amount,type,direction,status,source,scope,metadata) VALUES (?,?,?,?,?,?,'REFUND','CREDIT','COMPLETED','ADMIN_REFUND','LOCAL',?)`)
      .bind(createId('LED'), transactionId, input.referenceId, original.student_id, original.wallet_id, original.amount, safeJson({ originalTransactionId: original.id })),
    c.env.DB.prepare('INSERT INTO refunds (id,transaction_id,reference_id,amount,reason,actor_id) VALUES (?,?,?,?,?,?)').bind(refundId, original.id, input.referenceId, original.amount, input.reason, c.get('jwtPayload').sub),
    auditStatement(c, 'REFUND', 'TRANSACTION', original.id, { amount: original.amount }, { refundId, amount: original.amount, reason: input.reason }),
  ])
  return ok(c, { id: refundId, transactionId, amount: original.amount }, 'Refund berhasil', 201)
})

app.get('/api/settings', roles('SUPER_ADMIN'), async (c) => {
  const [branding, settings] = await Promise.all([
    c.env.DB.prepare('SELECT app_name AS appName,organization_name AS organizationName,tagline,logo_url AS logoUrl,favicon_url AS faviconUrl,primary_color AS primaryColor,secondary_color AS secondaryColor FROM branding_settings WHERE id=1').first(),
    c.env.DB.prepare('SELECT key,value FROM app_settings WHERE is_secret=0 ORDER BY key').all<{ key: string; value: string }>(),
  ])
  return ok(c, { branding, settings: Object.fromEntries(settings.results.map((row) => [row.key, row.value])) })
})

app.patch('/api/settings/branding', roles('SUPER_ADMIN'), zValidator('json', brandingSchema, (result, c) => {
  if (!result.success) return invalid(c, 'Pengaturan branding tidak valid')
}), async (c) => {
  const input = c.req.valid('json')
  const before = await c.env.DB.prepare('SELECT * FROM branding_settings WHERE id=1').first()
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE branding_settings SET app_name=?,organization_name=?,tagline=?,primary_color=?,secondary_color=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
      .bind(input.appName, input.organizationName, input.tagline, input.primaryColor, input.secondaryColor),
    auditStatement(c, 'BRANDING_UPDATED', 'BRANDING', '1', before, input),
  ])
  return ok(c, input, 'Branding berhasil diperbarui')
})

app.get('/api/audit-logs', roles('SUPER_ADMIN'), async (c) => ok(c, (await c.env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all()).results))
app.get('/api/sync', roles('SUPER_ADMIN', 'TREASURER'), async (c) => ok(c, (await c.env.DB.prepare('SELECT * FROM sync_queue ORDER BY created_at DESC LIMIT 100').all()).results))

app.onError((error, c) => {
  if (error instanceof AppError) return fail(c, error.code, error.message, error.status)
  console.error(JSON.stringify({ message: 'request_failed', error: error instanceof Error ? error.message : String(error), path: c.req.path, requestId: c.get('requestId') }))
  return fail(c, 'INTERNAL_ERROR', 'Terjadi kesalahan pada server', 500)
})

app.notFound((c) => fail(c, 'VALIDATION_ERROR', 'Endpoint tidak ditemukan', 404))

export default { fetch: app.fetch } satisfies ExportedHandler<Env>
