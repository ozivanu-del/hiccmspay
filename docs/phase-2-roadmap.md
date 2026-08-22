# Phase 2–3 Roadmap

## Phase 2 — Local Wallet Server dan Sync

1. Tambahkan `local/wallet-server` (Node.js, Hono, PostgreSQL, Docker) serta network-only binding.
2. Replikasi master santri, kartu, merchant, produk, dan limit ke PostgreSQL.
3. Implementasikan purchase transaction dengan `SELECT ... FOR UPDATE`, immutable ledger, unique idempotency key, dan satu SQL transaction.
4. Ganti demo `sync_queue` dengan Cloudflare Queue producer/consumer dan pull endpoint terautentikasi.
5. Sync agent melakukan pull → PostgreSQL transaction → ACK. Retry memakai exponential backoff; event duplicate menjadi no-op.
6. Local → cloud mengirim purchase/refund untuk reporting parent. Conflict ambigu diberi `REVIEW_REQUIRED`, tidak mengubah saldo otomatis.
7. Tambahkan Docker Compose untuk `wallet-server` dan PostgreSQL tanpa mengekspos port database ke internet.
8. Tambahkan health heartbeat, pending/failed sync, backup PostgreSQL, dan disaster-recovery runbook.

## Phase 3 — Payment, Settlement, Reconciliation

1. Pilih provider (Duitku/Midtrans/lainnya) setelah legal/merchant review pondok.
2. Implementasikan adapter provider tanpa mengubah wallet service.
3. Verifikasi signature, reference, amount, currency, merchant, dan terminal payment state pada webhook.
4. Tambahkan provider API reconciliation dan import bank settlement.
5. Bandingkan gross, fee, net, wallet credit, dan settlement. Selisih hanya ditandai untuk pemeriksaan.
6. Tambahkan refund provider yang selalu menghasilkan reversal/refund ledger, bukan mutasi transaksi lama.
7. Tambahkan notification outbox untuk payment success, low balance, dan purchase receipt.

## Production acceptance

- concurrency/load test terhadap wallet yang sama;
- forced retry dan duplicate delivery test untuk purchase, webhook, queue, ACK;
- offline 24 jam lalu catch-up sync test;
- restore backup serta rekonsiliasi ledger-to-balance otomatis;
- least-privilege Cloudflare token dan secret rotation;
- observability, alerting, SLO, dan incident runbook.

