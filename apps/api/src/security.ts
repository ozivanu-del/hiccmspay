import { timingSafeEqual } from 'node:crypto'

const encoder = new TextEncoder()

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

async function derivePassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: 100_000 }, key, 256)
  return hex(bits)
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer)
  return { hash: await derivePassword(password, salt), salt }
}

export async function verifyPassword(password: string, saltHex: string, expectedHex: string): Promise<boolean> {
  const expectedHash = await crypto.subtle.digest('SHA-256', encoder.encode(expectedHex))
  const actualHash = await crypto.subtle.digest('SHA-256', encoder.encode(await derivePassword(password, saltHex)))
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash))
}

export async function verifyHmac(payload: string, providedHex: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const actual = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const providedHash = await crypto.subtle.digest('SHA-256', encoder.encode(providedHex.toLowerCase()))
  const actualHash = await crypto.subtle.digest('SHA-256', encoder.encode(hex(actual)))
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(providedHash))
}
