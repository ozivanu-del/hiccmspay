import type { APIRoute } from 'astro'

export const GET: APIRoute = async () => {
  let appName = 'PRJ SmartPay'
  try {
    const base = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8787'
    const response = await fetch(`${base}/api/branding`)
    if (response.ok) {
      const body = await response.json() as { data?: { appName?: string } }
      appName = body.data?.appName ?? appName
    }
  } catch { /* Offline-safe default. */ }
  return new Response(JSON.stringify({ name: appName, short_name: appName, start_url: '/', display: 'standalone', background_color: '#f4f7f6', theme_color: '#0f766e', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }] }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' } })
}

