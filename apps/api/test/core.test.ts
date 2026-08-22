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

  it('runs the complete parent top-up, sync, cashier purchase flow exactly once', async () => {
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
})
