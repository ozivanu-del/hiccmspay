export type PaymentRequest = { topupId: string; reference: string; amount: number }
export type PaymentSession = { provider: string; providerReference: string; checkoutUrl: string | null }

export interface PaymentProvider {
  readonly name: string
  createPayment(request: PaymentRequest): Promise<PaymentSession>
}

export class DemoPaymentProvider implements PaymentProvider {
  readonly name = 'demo'

  async createPayment(request: PaymentRequest): Promise<PaymentSession> {
    return Promise.resolve({ provider: this.name, providerReference: `DEMO-${request.reference}`, checkoutUrl: null })
  }
}

export function paymentProvider(name: string): PaymentProvider {
  if (name === 'demo') return new DemoPaymentProvider()
  throw new Error(`Payment provider ${name} belum dikonfigurasi`)
}

