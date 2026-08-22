import { defineConfig } from 'astro/config'
import cloudflare from '@astrojs/cloudflare'
import react from '@astrojs/react'
import tailwind from '@astrojs/tailwind'

export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  vite: { server: { host: true } },
})

