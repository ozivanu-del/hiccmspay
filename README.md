# PRJ SmartPay

Digital wallet dan cashless payment untuk Pondok Raudhatul Jannah. Phase 1 menyediakan demo end-to-end yang benar-benar memproses ledger: parent membuat top-up, payment divalidasi, event disinkronkan, kasir memindai kartu, dan saldo berubah hanya melalui business logic server.

> Status: **Phase 1 demo telah aktif di Cloudflare**. Payment gateway dan local PostgreSQL masih disimulasikan sesuai batas Phase 1; deployment publik ini belum ditujukan untuk transaksi uang nyata.

## Deployment aktif

- Aplikasi: `https://prj-smartpay-web.ilhamstory78.workers.dev`
- API: `https://prj-smartpay-api.ilhamstory78.workers.dev`
- Database: Cloudflare D1 `prj-smartpay-db` (region APAC)

Worker menggunakan secret Cloudflare untuk autentikasi dan webhook, CORS dibatasi ke origin aplikasi di atas, dan cookie sesi production memakai `HttpOnly`, `Secure`, serta `SameSite=None` karena frontend dan API berada pada hostname Workers terpisah.

## Audit repository awal

Repo target `ozivanu-del/hiccmspay` masih kosong. Referensi HIC-CMS yang tersedia menggunakan monorepo, Hono pada Cloudflare Workers, D1 migrations, Astro, React dashboard, settings, auth middleware, dan theme engine. Pola yang direuse:

- monorepo `apps/*` dan API-first;
- Hono + typed bindings + D1 migration;
- Astro + React untuk UI interaktif;
- settings/branding sebagai konfigurasi tunggal;
- route middleware untuk autentikasi dan otorisasi;
- Cloudflare-native config melalui `wrangler.jsonc`.

Project dibuat terisolasi agar tidak membawa perubahan lokal dari worktree HIC-CMS sumber.

## Arsitektur Phase 1

```text
Astro + React PWA                   Hono Worker
Admin / Parent / Cashier    HTTPS  REST API + RBAC
Treasurer / Public shell   ──────► idempotency + validation
                                      │
                                      ▼
                                Cloudflare D1
                       wallet materialized balance
                       immutable local/cloud ledger
                       audit + demo sync queue
```

Top-up demo mempertahankan batas cloud/local secara logis:

```text
PENDING_PAYMENT → payment valid → CLOUD ledger/PENDING_SYNC
                 → simulate sync → LOCAL ledger + wallet credit → SYNCED
```

Purchase diproses dalam satu D1 batch. Trigger database menolak saldo negatif sehingga kegagalan membatalkan seluruh batch. `reference_id` unik menjamin retry tidak mendebit ulang.

## Struktur utama

```text
apps/
  api/                    Hono Cloudflare Worker
    migrations/0001...    schema dan seed demo
    src/                   API, security, payment adapter, schemas
    test/                  Workers runtime + D1 integration test
    wrangler.jsonc
  web/                    Astro + React + Tailwind PWA
    src/ui/                role-aware application UI
    public/sw.js           app-shell cache dan offline fallback
    wrangler.jsonc
docs/
  phase-2-roadmap.md
```

## Yang sudah bekerja

- login dan RBAC untuk Super Admin, Admin, Kasir, Bendahara, Parent;
- configuration-driven branding dan manifest PWA dinamis;
- 300 santri, 20 parent, 300 wallet, 300 kartu, 50 produk, 5 kantin;
- pencarian santri dan tampilan wallet/card;
- QR scanner berbasis kamera dengan fallback Card ID;
- server-calculated cart dan atomic purchase;
- ledger immutable, materialized balance, audit log, idempotency;
- parent-child ownership selalu diverifikasi server;
- demo top-up, payment success, cloud ledger, sync queue, local ledger;
- refund terotorisasi sebagai transaksi CREDIT baru;
- dashboard, transaction history, system health, mobile bottom navigation;
- PWA installability dan cache UI; saldo tidak pernah disimpan sebagai source of truth di browser.

## Database migration

`apps/api/migrations/0001_phase1.sql` membuat:

`users`, `roles`, `permissions`, `role_permissions`, `students`, `parents`, `parent_students`, `cards`, `wallets`, `wallet_ledger`, `transactions`, `transaction_items`, `merchants`, `products`, `product_categories`, `topups`, `payments`, `refunds`, `settlements`, `devices`, `sync_queue`, `sync_logs`, `audit_logs`, `app_settings`, dan `branding_settings`.

Ledger dan transaksi memiliki trigger anti-update/anti-delete. Uang disimpan sebagai integer Rupiah, bukan floating point.

## API utama

| Method | Endpoint | Fungsi |
|---|---|---|
| POST | `/api/auth/login` | Login dan HttpOnly session cookie |
| POST | `/api/auth/logout` | Logout + audit |
| GET | `/api/me` | Current session |
| GET | `/api/dashboard` | Ringkasan operasional |
| GET | `/api/students` | Search/pagination santri |
| GET | `/api/students/:id` | Detail dengan ownership check |
| GET | `/api/cards/:token` | Resolusi QR/Card ID |
| GET | `/api/wallets/:studentId` | Saldo materialized |
| GET | `/api/products` | Produk aktif per merchant |
| GET | `/api/transactions` | Riwayat + item summary |
| POST | `/api/transactions` | Atomic idempotent purchase |
| POST | `/api/topups` | Membuat top-up parent |
| POST | `/api/topups/:id/simulate-payment` | Payment demo tervalidasi |
| POST | `/api/topups/:id/simulate-sync` | Kredit ledger lokal demo |
| POST | `/api/webhooks/payment` | HMAC-verified payment webhook |
| POST | `/api/refunds` | Refund terotorisasi |
| GET/PATCH | `/api/settings` / `/api/settings/branding` | Settings dan branding |
| GET | `/api/audit-logs`, `/api/sync`, `/api/health` | Audit, sync, health |

Respons sukses dan gagal menggunakan envelope konsisten `{ success, data/message }` atau `{ success, error: { code, message } }`.

## Routes UI

- Public: `/`, `/login`
- Parent: `/parent/dashboard`, `/parent/topup`, `/parent/transactions`
- Admin: `/admin`, `/admin/students`, `/admin/parents`, `/admin/cards`, `/admin/wallets`, `/admin/transactions`, `/admin/topups`, `/admin/products`, `/admin/merchants`, `/admin/audit-logs`, `/admin/system-health`, `/admin/settings/branding`
- Cashier: `/cashier`, `/cashier/history`
- Treasurer: `/treasurer`, `/treasurer/topups`, `/treasurer/settlements`, `/treasurer/reconciliation`

Routes yang belum menjadi bagian demo inti menampilkan fondasi modul dan akan dirinci pada iterasi berikutnya.

## Menjalankan lokal

Prasyarat: Node.js 22+, Corepack, dan Git.

```bash
corepack enable
pnpm install
copy .env.example apps\web\.env
copy .env.example apps\api\.dev.vars
pnpm --filter @prj/api db:migrate:local
pnpm dev
```

Sesuaikan `apps/api/.dev.vars` agar memiliki `AUTH_SECRET` minimal 32 karakter. Buka:

- UI: `http://localhost:4321`
- API: `http://localhost:8787`
- QR demo Andi: `PRJ-ANDI-001`

## Akun demo

Password semua akun development: `Demo123!`

| Role | Email |
|---|---|
| Super Admin | `admin@prj.demo` |
| Admin | `operator@prj.demo` |
| Kasir | `kasir@prj.demo` |
| Bendahara | `bendahara@prj.demo` |
| Orang Tua | `parent@prj.demo` |

Jangan deploy akun demo pada production tanpa menonaktifkan/mengganti kredensial.

## Skenario presentasi

1. Login Super Admin dan buka **Branding**. Ubah `PRJ SmartPay` menjadi `PRJ Wallet`; title, sidebar, login berikutnya, dan manifest berubah dari konfigurasi.
2. Login Parent. Andi memiliki saldo Rp75.000.
3. Top-up Rp100.000, klik **Simulate Payment Success**. Saldo tetap Rp75.000 dan status `PENDING_SYNC`.
4. Klik **Simulate Sync**. Saldo menjadi Rp175.000.
5. Login Kasir, cari `PRJ-ANDI-001`, pilih Nasi Goreng Rp10.000 dan Es Teh Rp5.000, lalu bayar.
6. Saldo menjadi Rp160.000. Parent melihat item Nasi Goreng dan Es Teh pada riwayat.

Test integrasi mengotomasi skenario yang sama dan mengulang request purchase untuk membuktikan saldo tidak terdebit dua kali.

## Quality gates

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Build API menjalankan `wrangler deploy --dry-run`. Test API berjalan di Workers runtime terbaru dengan D1 binding dan migration resmi.

## Deployment Cloudflare

Pastikan `wrangler whoami` menunjukkan akun yang benar terlebih dahulu.

```bash
pnpm --filter @prj/api cf-typegen
pnpm --filter @prj/api deploy
pnpm --filter @prj/api db:migrate:remote
pnpm --filter @prj/api exec wrangler secret put AUTH_SECRET
pnpm --filter @prj/api exec wrangler secret put PAYMENT_SECRET
```

Set `ALLOWED_ORIGIN` ke origin frontend production dan `ENVIRONMENT=production` di `apps/api/wrangler.jsonc`, generate types kembali, lalu build frontend dengan `PUBLIC_API_URL` menunjuk URL API:

```bash
pnpm --filter @prj/web build
pnpm --filter @prj/web deploy
```

Konfigurasi mengaktifkan `nodejs_compat`, structured error logging, Workers observability, generated bindings, dan automatic D1 provisioning. Secret hanya dimasukkan melalui prompt Wrangler, tidak melalui source/config.

## Environment variables

Lihat `.env.example`. Wajib Phase 1: `PUBLIC_API_URL`, `AUTH_SECRET`, `DEMO_MODE`, dan `ALLOWED_ORIGIN`. Placeholder Phase 2/3: `DATABASE_URL`, `LOCAL_SERVER_URL`, `SYNC_API_KEY`, kredensial Cloudflare, dan payment provider.

## Batas demo dan risiko yang harus ditutup sebelum production

- `DemoProvider` dan tombol simulasi wajib dimatikan (`DEMO_MODE=false`).
- Kredensial demo harus dihapus dan password onboarding/reset ditambahkan.
- Tambahkan rate limiting/Turnstile pada login dan payment-facing endpoint.
- Tambahkan CSRF token jika frontend/API tidak berada dalam same-site domain.
- Lakukan threat model, pentest, backup/restore drill, dan review akses bendahara.
- Phase 1 memakai satu D1 untuk merepresentasikan cloud dan local scope; PostgreSQL fisik dan sync agent masuk Phase 2.
- Provider webhook production perlu adapter dan signature rules spesifik provider terpilih.
- Modul CRUD/import/export lengkap, settlement, rekonsiliasi operasional, dan laporan rinci masih perlu iterasi UI/API.

## Roadmap

Lihat [Phase 2–3 roadmap](docs/phase-2-roadmap.md) untuk local wallet server, PostgreSQL, sync agent, Cloudflare Queue, conflict handling, payment gateway, settlement, dan rekonsiliasi.
