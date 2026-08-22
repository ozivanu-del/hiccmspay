-- Operational examples for the hosted Phase 1 demo.
-- Each status represents a real point in the payment-to-wallet lifecycle.

INSERT INTO topups (id,parent_id,student_id,amount,payment_reference,provider,status,created_at)
VALUES ('TOPUP-DEMO-PENDING','PARENT002','STU000002',50000,'DEMO-PENDING-PAYMENT-001','demo','PENDING_PAYMENT',datetime('now','-45 minutes'));

INSERT INTO payments (id,topup_id,provider,provider_reference,amount,status,created_at)
VALUES ('PAY-DEMO-PENDING','TOPUP-DEMO-PENDING','demo','DEMO-CHECKOUT-001',50000,'PENDING',datetime('now','-45 minutes'));

INSERT INTO topups (id,parent_id,student_id,amount,payment_reference,provider,status,created_at,paid_at)
VALUES ('TOPUP-DEMO-PENDING-SYNC','PARENT003','STU000003',100000,'DEMO-PENDING-SYNC-001','demo','PENDING_SYNC',datetime('now','-35 minutes'),datetime('now','-30 minutes'));

INSERT INTO payments (id,topup_id,provider,provider_reference,amount,status,created_at,paid_at)
VALUES ('PAY-DEMO-PENDING-SYNC','TOPUP-DEMO-PENDING-SYNC','demo','DEMO-PAID-002',100000,'PAID',datetime('now','-35 minutes'),datetime('now','-30 minutes'));

INSERT INTO wallet_ledger (id,reference_id,student_id,wallet_id,amount,type,direction,status,source,scope,created_at,metadata)
VALUES ('LED-DEMO-CLOUD-PENDING','CLOUD-DEMO-PENDING-SYNC-001','STU000003','WAL000003',100000,'TOPUP','CREDIT','PENDING_SYNC','ONLINE_PAYMENT','CLOUD',datetime('now','-30 minutes'),'{"topupId":"TOPUP-DEMO-PENDING-SYNC"}');

INSERT INTO sync_queue (id,event_type,reference_id,payload,status,created_at)
VALUES ('SYNC-DEMO-PENDING','TOPUP','DEMO-PENDING-SYNC-001','{"topupId":"TOPUP-DEMO-PENDING-SYNC","studentId":"STU000003","amount":100000}','PENDING',datetime('now','-30 minutes'));

INSERT INTO topups (id,parent_id,student_id,amount,payment_reference,provider,status,created_at,paid_at,synced_at)
VALUES ('TOPUP-DEMO-SYNCED','PARENT001','STU000021',100000,'DEMO-SYNCED-001','demo','SYNCED',datetime('now','-25 minutes'),datetime('now','-20 minutes'),datetime('now','-15 minutes'));

INSERT INTO payments (id,topup_id,provider,provider_reference,amount,status,created_at,paid_at)
VALUES ('PAY-DEMO-SYNCED','TOPUP-DEMO-SYNCED','demo','DEMO-PAID-003',100000,'PAID',datetime('now','-25 minutes'),datetime('now','-20 minutes'));

INSERT INTO wallet_ledger (id,reference_id,student_id,wallet_id,amount,type,direction,status,source,scope,created_at,metadata)
VALUES ('LED-DEMO-CLOUD-SYNCED','CLOUD-DEMO-SYNCED-001','STU000021','WAL000021',100000,'TOPUP','CREDIT','PENDING_SYNC','ONLINE_PAYMENT','CLOUD',datetime('now','-20 minutes'),'{"topupId":"TOPUP-DEMO-SYNCED"}');

UPDATE wallets SET balance=balance+100000,version=version+1,updated_at=datetime('now','-15 minutes') WHERE id='WAL000021';

INSERT INTO transactions (id,reference_id,student_id,wallet_id,amount,type,direction,status,source,created_at,synced_at,metadata)
VALUES ('TX-DEMO-TOPUP-SYNCED','LOCAL-DEMO-SYNCED-001','STU000021','WAL000021',100000,'TOPUP','CREDIT','COMPLETED','CLOUD_SYNC',datetime('now','-15 minutes'),datetime('now','-15 minutes'),'{"topupId":"TOPUP-DEMO-SYNCED"}');

INSERT INTO wallet_ledger (id,transaction_id,reference_id,student_id,wallet_id,amount,type,direction,status,source,scope,created_at,synced_at,metadata)
VALUES ('LED-DEMO-LOCAL-SYNCED','TX-DEMO-TOPUP-SYNCED','LOCAL-DEMO-SYNCED-001','STU000021','WAL000021',100000,'TOPUP','CREDIT','COMPLETED','CLOUD_SYNC','LOCAL',datetime('now','-15 minutes'),datetime('now','-15 minutes'),'{"topupId":"TOPUP-DEMO-SYNCED"}');

INSERT INTO sync_queue (id,event_type,reference_id,payload,status,attempt_count,created_at,processed_at)
VALUES ('SYNC-DEMO-COMPLETED','TOPUP','DEMO-SYNCED-001','{"topupId":"TOPUP-DEMO-SYNCED","studentId":"STU000021","amount":100000}','PROCESSED',1,datetime('now','-20 minutes'),datetime('now','-15 minutes'));

INSERT INTO sync_logs (id,event_id,status,message,created_at)
VALUES ('SYNCLOG-DEMO-COMPLETED','SYNC-DEMO-COMPLETED','SUCCESS','Demo deposit tersinkron ke wallet lokal',datetime('now','-15 minutes'));

INSERT INTO audit_logs (id,actor_name,action,entity,entity_id,new_value,created_at)
VALUES ('AUD-DEMO-DEPOSIT','SYSTEM DEMO','DEMO_DEPOSIT_SEEDED','TOPUP','TOPUP-DEMO-SYNCED','{"amount":100000,"studentId":"STU000021"}',datetime('now','-15 minutes'));
