import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../src/index'

describe('PRJ SmartPay API', () => {
  it('reports a healthy D1 database', async () => {
    const response = await worker.fetch(new Request('http://example.com/api/health'), env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { d1: 'CONNECTED' } })
  })

  it('seeds exactly 300 students and Andi at Rp75.000', async () => {
    const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM students').first<{ count: number }>()
    const andi = await env.DB.prepare("SELECT balance FROM wallets WHERE student_id='STU000001'").first<{ balance: number }>()
    expect(count?.count).toBe(300)
    expect(andi?.balance).toBe(75_000)
  })

  it('rejects an invalid login without leaking details', async () => {
    const response = await worker.fetch(new Request('http://example.com/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@prj.demo', password: 'wrong-pass' }),
    }), env)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } })
  })

  it('serves operational parent, wallet, ledger, and deposit demo modules', async () => {
    const login = await worker.fetch(new Request('http://example.com/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@prj.demo', password: 'Demo123!' }),
    }), env)
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''

    const parents = await worker.fetch(new Request('http://example.com/api/parents', { headers: { Cookie: cookie } }), env)
    const parentsBody = await parents.json<{ success: boolean; data: { summary: { totalParents: number; activeAccounts: number; linkedStudents: number }; items: Array<{ id: string }> } }>()
    expect(parentsBody).toMatchObject({ success: true, data: { summary: { totalParents: 20, activeAccounts: 1, linkedStudents: 21 } } })
    expect(parentsBody.data.items).toContainEqual(expect.objectContaining({ id: 'PARENT001' }))

    const wallets = await worker.fetch(new Request('http://example.com/api/wallets?search=Andi', { headers: { Cookie: cookie } }), env)
    await expect(wallets.json()).resolves.toMatchObject({
      success: true,
      data: { summary: { totalWallets: 300, activeCards: 300 }, items: [{ studentId: 'STU000001', balance: 75_000, totalCredit: 75_000 }] },
    })

    const ledger = await worker.fetch(new Request('http://example.com/api/wallets/STU000001/ledger', { headers: { Cookie: cookie } }), env)
    await expect(ledger.json()).resolves.toMatchObject({
      success: true,
      data: { wallet: { studentName: 'Andi Pratama', balance: 75_000 }, totals: { totalCredit: 75_000, totalDebit: 0, ledgerEntries: 1 } },
    })

    const topups = await worker.fetch(new Request('http://example.com/api/topups', { headers: { Cookie: cookie } }), env)
    await expect(topups.json()).resolves.toMatchObject({
      success: true,
      data: { summary: { totalTopups: 3, syncedAmount: 100_000, pendingPayment: 1, pendingSync: 1 } },
    })
  })

  it('allows an admin to add a catalog product with audit trail', async () => {
    const login = await worker.fetch(new Request('http://example.com/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'operator@prj.demo', password: 'Demo123!' }),
    }), env)
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
    const payload = { name: 'Jus Alpukat Demo', categoryId: 'CAT_DRINK', merchantId: 'MER003', price: 12_500 }

    const created = await worker.fetch(new Request('http://example.com/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload),
    }), env)
    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject({ success: true, data: { name: payload.name, price: payload.price, merchant_id: payload.merchantId, category: 'Minuman' } })

    const catalog = await worker.fetch(new Request('http://example.com/api/products?merchantId=MER003', { headers: { Cookie: cookie } }), env)
    expect(await catalog.text()).toContain('Jus Alpukat Demo')
    const audit = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='PRODUCT_CREATED' AND actor_id='USR_OPERATOR'").first<{ count: number }>()
    expect(audit?.count).toBe(1)

    const duplicate = await worker.fetch(new Request('http://example.com/api/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload),
    }), env)
    expect(duplicate.status).toBe(409)
  })

  it.skip('runs the legacy payment-gateway demo flow', async () => {
    const login = async (email: string) => {
      const response = await worker.fetch(new Request('http://example.com/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Demo123!' }),
      }), env)
      expect(response.status).toBe(200)
      const cookie = response.headers.get('set-cookie')?.split(';')[0]
      expect(cookie).toBeTruthy()
      return cookie ?? ''
    }
    const parentCookie = await login('parent@prj.demo')
    const topupResponse = await worker.fetch(new Request('http://example.com/api/topups', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: parentCookie, 'Idempotency-Key': 'TEST-TOPUP-ANDI-100K' },
      body: JSON.stringify({ studentId: 'STU000001', amount: 100_000 }),
    }), env)
    expect(topupResponse.status).toBe(201)
    const topup = await env.DB.prepare("SELECT id FROM topups WHERE payment_reference='TEST-TOPUP-ANDI-100K'").first<{ id: string }>()
    expect(topup?.id).toBeTruthy()

    const paid = await worker.fetch(new Request(`http://example.com/api/topups/${topup?.id ?? ''}/simulate-payment`, { method: 'POST', headers: { Cookie: parentCookie } }), env)
    await expect(paid.json()).resolves.toMatchObject({ success: true, data: { status: 'PENDING_SYNC' } })
    const beforeSync = await env.DB.prepare("SELECT balance FROM wallets WHERE student_id='STU000001'").first<{ balance: number }>()
    expect(beforeSync?.balance).toBe(75_000)

    const synced = await worker.fetch(new Request(`http://example.com/api/topups/${topup?.id ?? ''}/simulate-sync`, { method: 'POST', headers: { Cookie: parentCookie } }), env)
    await expect(synced.json()).resolves.toMatchObject({ success: true, data: { status: 'SYNCED', balanceAfter: 175_000 } })

    const cashierCookie = await login('kasir@prj.demo')
    const purchase = new Request('http://example.com/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cashierCookie },
      body: JSON.stringify({ referenceId: 'TX-TEST-K03-000001', cardToken: 'PRJ-ANDI-001', merchantId: 'MER003', deviceId: 'TEST-POS', items: [{ productId: 'PROD001', quantity: 1 }, { productId: 'PROD002', quantity: 1 }] }),
    })
    const purchased = await worker.fetch(purchase, env)
    await expect(purchased.json()).resolves.toMatchObject({ success: true, data: { amount: 15_000, balanceAfter: 160_000 } })

    const duplicate = await worker.fetch(new Request('http://example.com/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cashierCookie },
      body: JSON.stringify({ referenceId: 'TX-TEST-K03-000001', cardToken: 'PRJ-ANDI-001', merchantId: 'MER003', deviceId: 'TEST-POS', items: [{ productId: 'PROD001', quantity: 1 }, { productId: 'PROD002', quantity: 1 }] }),
    }), env)
    await expect(duplicate.json()).resolves.toMatchObject({ message: 'ALREADY_PROCESSED' })
    const finalWallet = await env.DB.prepare("SELECT balance FROM wallets WHERE student_id='STU000001'").first<{ balance: number }>()
    expect(finalWallet?.balance).toBe(160_000)
    const ledgerCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM wallet_ledger WHERE reference_id='TX-TEST-K03-000001'").first<{ count: number }>()
    expect(ledgerCount?.count).toBe(1)
    const parentHistory = await worker.fetch(new Request('http://example.com/api/transactions?studentId=STU000001', { headers: { Cookie: parentCookie } }), env)
    const parentHistoryText = await parentHistory.text()
    expect(parentHistoryText).toContain('"reference_id":"TX-TEST-K03-000001"')
    expect(parentHistoryText).toContain('"itemSummary":"Nasi Goreng · Es Teh"')
  })

  it('runs cash deposit and one-time-scan cashier charge without payment gateway', async () => {
    const login = async (email: string) => {
      const response = await worker.fetch(new Request('http://example.com/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Demo123!' }),
      }), env)
      expect(response.status).toBe(200)
      return response.headers.get('set-cookie')?.split(';')[0] ?? ''
    }
    const parentCookie = await login('parent@prj.demo')
    const pendingGateway = await worker.fetch(new Request('http://example.com/api/topups', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
      body: JSON.stringify({ studentId: 'STU000001', amount: 100_000 }),
    }), env)
    expect(pendingGateway.status).toBe(503)

    const treasurerCookie = await login('bendahara@prj.demo')
    const deposited = await worker.fetch(new Request('http://example.com/api/cash-deposits', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: treasurerCookie, 'Idempotency-Key': 'CASH-TEST-ANDI-100K' },
      body: JSON.stringify({ studentId: 'STU000001', amount: 100_000, note: 'Setoran tes' }),
    }), env)
    expect(deposited.status).toBe(201)
    await expect(deposited.json()).resolves.toMatchObject({ success: true, data: { amount: 100_000, balanceAfter: 175_000 } })

    const cashierCookie = await login('kasir@prj.demo')
    const scanned = await worker.fetch(new Request('http://example.com/api/cards/PRJ-ANDI-001', { headers: { Cookie: cashierCookie } }), env)
    const scanBody = await scanned.json<{ data: { scanSessionId: string } }>()
    expect(scanBody.data.scanSessionId).toBeTruthy()
    const purchased = await worker.fetch(new Request('http://example.com/api/cashier/charge', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cashierCookie },
      body: JSON.stringify({ referenceId: 'TX-AMOUNT-K03-000001', scanSessionId: scanBody.data.scanSessionId, cardToken: 'PRJ-ANDI-001', merchantId: 'MER003', deviceId: 'TEST-POS', amount: 15_000 }),
    }), env)
    await expect(purchased.json()).resolves.toMatchObject({ success: true, data: { amount: 15_000, balanceAfter: 160_000 } })

    const reusedScan = await worker.fetch(new Request('http://example.com/api/cashier/charge', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cashierCookie },
      body: JSON.stringify({ referenceId: 'TX-AMOUNT-K03-000002', scanSessionId: scanBody.data.scanSessionId, cardToken: 'PRJ-ANDI-001', merchantId: 'MER003', deviceId: 'TEST-POS', amount: 15_000 }),
    }), env)
    expect(reusedScan.status).toBe(409)
    await expect(reusedScan.json()).resolves.toMatchObject({ success: false, error: { code: 'SCAN_REQUIRED' } })
    const finalWallet = await env.DB.prepare("SELECT balance FROM wallets WHERE student_id='STU000001'").first<{ balance: number }>()
    expect(finalWallet?.balance).toBe(160_000)
    const parentHistory = await worker.fetch(new Request('http://example.com/api/transactions?studentId=STU000001', { headers: { Cookie: parentCookie } }), env)
    const historyText = await parentHistory.text()
    expect(historyText).toContain('TX-AMOUNT-K03-000001')
    expect(historyText).toContain('CASH_DEPOSIT')
  })

  it('creates students with zero-balance wallets and reuses parents by normalized phone', async () => {
    const login = await worker.fetch(new Request('http://example.com/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operator@prj.demo', password: 'Demo123!' }),
    }), env)
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
    const createStudent = (nis: string, name: string, parentName: string, parentPhone: string) => worker.fetch(new Request('http://example.com/api/students', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ nis, name, class: '2', educationLevel: 'MTs', generation: 2026, parentName, parentPhone, relationship: 'AYAH' }),
    }), env)

    const first = await createStudent('TEST-NIS-001', 'Ahmad Test', 'Bapak Test', '+62 812-3456-7890')
    expect(first.status).toBe(201)
    await expect(first.json()).resolves.toMatchObject({
      success: true,
      data: { nis: 'TEST-NIS-001', balance: 0, cardNumber: 'PRJ-TEST-NIS-001', parent: { name: 'Bapak Test' } },
    })
    const second = await createStudent('TEST-NIS-002', 'Fatimah Test', 'Nama Tidak Menduplikasi', '081234567890')
    expect(second.status).toBe(201)

    const parent = await env.DB.prepare("SELECT id,name FROM parents WHERE phone_normalized='081234567890'").first<{ id: string; name: string }>()
    const parentCount = await env.DB.prepare("SELECT COUNT(*) AS count FROM parents WHERE phone_normalized='081234567890'").first<{ count: number }>()
    const linkedCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM parent_students WHERE parent_id=?').bind(parent?.id).first<{ count: number }>()
    const wallets = await env.DB.prepare("SELECT COUNT(*) AS count FROM wallets WHERE student_id IN (SELECT id FROM students WHERE nis IN ('TEST-NIS-001','TEST-NIS-002')) AND balance=0").first<{ count: number }>()
    expect(parent?.name).toBe('Bapak Test')
    expect(parentCount?.count).toBe(1)
    expect(linkedCount?.count).toBe(2)
    expect(wallets?.count).toBe(2)
  })

  it('allows only the authenticated Super Admin to change their own password', async () => {
    const login = await worker.fetch(new Request('http://example.com/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@prj.demo', password: 'Demo123!' }),
    }), env)
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''

    const wrongCurrent = await worker.fetch(new Request('http://example.com/api/me/password', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword: 'Wrong123!', newPassword: 'PrivatePass-2026!' }),
    }), env)
    expect(wrongCurrent.status).toBe(401)

    const changed = await worker.fetch(new Request('http://example.com/api/me/password', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ currentPassword: 'Demo123!', newPassword: 'PrivatePass-2026!' }),
    }), env)
    expect(changed.status).toBe(200)
    expect(changed.headers.get('set-cookie')).toContain('prj_session=')

    const oldLogin = await worker.fetch(new Request('http://example.com/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@prj.demo', password: 'Demo123!' }),
    }), env)
    expect(oldLogin.status).toBe(401)
    const newLogin = await worker.fetch(new Request('http://example.com/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@prj.demo', password: 'PrivatePass-2026!' }),
    }), env)
    expect(newLogin.status).toBe(200)
    const audit = await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='PASSWORD_CHANGED' AND actor_id='USR_ADMIN'").first<{ count: number }>()
    expect(audit?.count).toBe(1)
  })
})
