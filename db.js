'use strict';
const crypto = require('crypto');
let pg = null;
try { pg = require('pg'); } catch (_) {}

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const enabled = !!(DATABASE_URL && pg);
let pool = null;
let ready = false;

function q(sql, params=[]) {
  if (!pool) return Promise.reject(new Error('PostgreSQL belum dikonfigurasi.'));
  return pool.query(sql, params);
}

async function init() {
  if (!enabled) return { enabled:false, ready:false, reason: pg ? 'DATABASE_URL belum diset' : 'dependency pg belum tersedia' };
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: Number(process.env.BLOCKHOST_DB_POOL_MAX || 5), idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined });
  await q(`CREATE TABLE IF NOT EXISTS bh_meta (key text primary key, value text not null);
CREATE TABLE IF NOT EXISTS bh_users (email text primary key, user_data jsonb not null, updated_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS bh_billing_accounts (email text primary key, wallet numeric(14,2) not null default 0, auto_renew boolean not null default false, updated_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS bh_invoices (id text primary key, email text not null, tier text, price text, amount numeric(14,2), status text not null default 'confirmed', invoice_date timestamptz not null default now(), meta jsonb not null default '{}'::jsonb);
CREATE INDEX IF NOT EXISTS bh_invoices_email_idx ON bh_invoices(email);
CREATE TABLE IF NOT EXISTS bh_security_events (id text primary key, email text not null, event text not null, meta jsonb not null default '{}'::jsonb, event_time timestamptz not null default now());
CREATE INDEX IF NOT EXISTS bh_security_email_idx ON bh_security_events(email,event_time desc);
CREATE TABLE IF NOT EXISTS bh_api_tokens (id text primary key, email text not null, label text not null, token_hash text not null unique, scopes jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), last_used_at timestamptz);
CREATE INDEX IF NOT EXISTS bh_api_tokens_email_idx ON bh_api_tokens(email);
CREATE TABLE IF NOT EXISTS bh_servers (id text primary key, email text not null, name text not null, node_id text, tier text, status text, resources jsonb not null default '{}'::jsonb, port integer, expires_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), meta jsonb not null default '{}'::jsonb);
CREATE INDEX IF NOT EXISTS bh_servers_email_idx ON bh_servers(email);
CREATE TABLE IF NOT EXISTS bh_provisioning_jobs (id text primary key, server_id text, email text not null, node_id text, status text not null, idempotency_key text unique, request jsonb not null default '{}'::jsonb, result jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE INDEX IF NOT EXISTS bh_jobs_status_idx ON bh_provisioning_jobs(status);
CREATE TABLE IF NOT EXISTS bh_referrals (email text primary key, code text unique not null, count integer not null default 0, credit numeric(14,2) not null default 0, updated_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS bh_referral_claims (claimant_email text primary key, owner_email text not null, claimed_at timestamptz not null default now());
CREATE TABLE IF NOT EXISTS bh_tickets (id text primary key, email text not null, subject text not null, message text not null, priority text not null, status text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), meta jsonb not null default '{}'::jsonb);
CREATE INDEX IF NOT EXISTS bh_tickets_email_idx ON bh_tickets(email,created_at desc);
CREATE TABLE IF NOT EXISTS bh_notifications (id text primary key, email text not null, title text not null, message text not null, read boolean not null default false, created_at timestamptz not null default now());
CREATE INDEX IF NOT EXISTS bh_notifications_email_idx ON bh_notifications(email,created_at desc);`);
  ready = true;
  await q(`INSERT INTO bh_meta(key,value) VALUES('schema_version','5.6.0') ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  return { enabled:true, ready:true };
}

function status() { return { enabled, ready, configured: !!DATABASE_URL }; }
async function close(){ if(pool) await pool.end(); pool=null; ready=false; }

async function upsertUsers(users){ if(!ready)return; for(const [email,u] of Object.entries(users||{})) await q(`INSERT INTO bh_users(email,user_data,updated_at) VALUES($1,$2,now()) ON CONFLICT(email) DO UPDATE SET user_data=excluded.user_data,updated_at=now()`,[email,u]); }
async function restoreUsers(){ if(!ready)return null; const r=await q(`SELECT email,user_data FROM bh_users`); if(!r.rows.length)return null; const out={}; for(const row of r.rows) out[row.email]=row.user_data; return out; }
async function mirrorBilling(email, b) {
  if(!ready) return; await q(`INSERT INTO bh_billing_accounts(email,wallet,auto_renew,updated_at) VALUES($1,$2,$3,now()) ON CONFLICT(email) DO UPDATE SET wallet=excluded.wallet,auto_renew=excluded.auto_renew,updated_at=now()`, [email, Number(b.wallet||0), !!b.autoRenew]);
  for (const inv of (b.invoices||[])) await q(`INSERT INTO bh_invoices(id,email,tier,price,amount,status,invoice_date,meta) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),$8) ON CONFLICT(id) DO NOTHING`, [String(inv.invoiceId||inv.id||crypto.randomBytes(8).toString('hex')),email,inv.tier||null,inv.price||null,Number(inv.amount||0),inv.status||'confirmed',Number(inv.date||Date.now()),inv]);
}
async function securityEvent(e){ if(!ready)return; await q(`INSERT INTO bh_security_events(id,email,event,meta,event_time) VALUES($1,$2,$3,$4,to_timestamp($5/1000.0)) ON CONFLICT(id) DO NOTHING`, [e.id,e.email,e.event,e.meta||{},Number(e.time||Date.now())]); }
async function apiToken(t){ if(!ready)return; await q(`INSERT INTO bh_api_tokens(id,email,label,token_hash,scopes,created_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0)) ON CONFLICT(id) DO UPDATE SET label=excluded.label,scopes=excluded.scopes,last_used_at=coalesce(bh_api_tokens.last_used_at,excluded.last_used_at)`, [t.id,t.email,t.label,t.hash,t.scopes||[],Number(t.createdAt||Date.now())]); }
async function deleteApiToken(id,email){ if(!ready)return; await q(`DELETE FROM bh_api_tokens WHERE id=$1 AND email=$2`,[id,email]); }
async function server(s){ if(!ready)return; await q(`INSERT INTO bh_servers(id,email,name,node_id,tier,status,resources,port,expires_at,created_at,updated_at,meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10/1000.0),to_timestamp($11/1000.0),$12) ON CONFLICT(id) DO UPDATE SET status=excluded.status,resources=excluded.resources,port=excluded.port,expires_at=excluded.expires_at,updated_at=excluded.updated_at,meta=excluded.meta`, [s.id,s.email,s.name,s.nodeId||null,s.tier||null,s.status||'provisioning',s.resources||{},s.port||null,s.expiresAt?new Date(s.expiresAt):null,Number(s.createdAt||Date.now()),Number(s.updatedAt||Date.now()),s]); }
async function job(j){ if(!ready)return; await q(`INSERT INTO bh_provisioning_jobs(id,server_id,email,node_id,status,idempotency_key,request,result,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),to_timestamp($10/1000.0)) ON CONFLICT(id) DO UPDATE SET status=excluded.status,result=excluded.result,updated_at=excluded.updated_at`, [j.id,j.serverId||null,j.email,j.nodeId||null,j.status,j.idempotencyKey||null,j.request||{},j.result||{},Number(j.createdAt||Date.now()),Number(j.updatedAt||Date.now())]); }
async function referral(r){ if(!ready)return; await q(`INSERT INTO bh_referrals(email,code,count,credit,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(email) DO UPDATE SET code=excluded.code,count=excluded.count,credit=excluded.credit,updated_at=now()`,[r.email,r.code,Number(r.count||0),Number(r.credit||0)]); }
async function claim(c){ if(!ready)return; await q(`INSERT INTO bh_referral_claims(claimant_email,owner_email,claimed_at) VALUES($1,$2,to_timestamp($3/1000.0)) ON CONFLICT(claimant_email) DO NOTHING`,[c.claimantEmail,c.ownerEmail,Number(c.claimedAt||Date.now())]); }
async function ticket(t){ if(!ready)return; await q(`INSERT INTO bh_tickets(id,email,subject,message,priority,status,created_at,updated_at,meta) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),to_timestamp($8/1000.0),$9) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,meta=excluded.meta`,[t.id,t.email,t.subject,t.message,t.priority,t.status,Number(t.createdAt||Date.now()),Number(t.updatedAt||Date.now()),t]); }

async function paymentTransaction(t){ if(!ready)return; await q(`INSERT INTO bh_payment_transactions(id,invoice_id,email,provider,order_id,amount,currency,status,provider_status,payment_url,raw,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12/1000.0),to_timestamp($13/1000.0)) ON CONFLICT(id) DO UPDATE SET status=excluded.status,provider_status=excluded.provider_status,payment_url=excluded.payment_url,raw=excluded.raw,updated_at=now()`, [t.id,t.invoiceId,t.email,t.provider,t.orderId,Number(t.amount||0),t.currency||'IDR',t.status,t.providerStatus||null,t.paymentUrl||null,t.raw||{},Number(t.createdAt||Date.now()),Number(t.updatedAt||Date.now())]); }
async function paymentEvent(e){ if(!ready)return; await q(`INSERT INTO bh_payment_events(id,invoice_id,order_id,provider,event_type,signature,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0)) ON CONFLICT(id) DO NOTHING`, [e.id,e.invoiceId||null,e.orderId||null,e.provider,e.eventType,e.signature||null,e.payload||{},Number(e.createdAt||Date.now())]); }
async function paymentIdempotency(key,invoiceId){ if(!ready)return true; const r=await q(`INSERT INTO bh_payment_idempotency(key,invoice_id) VALUES($1,$2) ON CONFLICT(key) DO NOTHING RETURNING key`,[key,invoiceId]); return r.rowCount===1; }

async function notification(n){ if(!ready)return; await q(`INSERT INTO bh_notifications(id,email,title,message,read,created_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6/1000.0)) ON CONFLICT(id) DO UPDATE SET read=excluded.read`,[n.id,n.email,n.title,n.message,!!n.read,Number(n.createdAt||Date.now())]); }
async function migrateJson(dataDir){
  if(!ready) return {ok:false,skipped:true};
  const read=(name,f)=>{try{return JSON.parse(require('fs').readFileSync(require('path').join(dataDir,name),'utf8'));}catch(_){return f;}};
  let migrated={billing:0,security:0,apiTokens:0,servers:0,referrals:0,tickets:0,notifications:0};
  const billing=read('v5-billing.json',{}); for(const [email,b] of Object.entries(billing)){await mirrorBilling(email,b);migrated.billing++;}
  for(const e of read('v5-security.json',[])) {await securityEvent(e);migrated.security++;}
  for(const t of read('v5-api-tokens.json',[])) {await apiToken(t);migrated.apiTokens++;}
  for(const s of read('v5-servers.json',[])) {await server(s);migrated.servers++;}
  const refs=read('v4-referrals.json',{}); for(const [email,r] of Object.entries(refs)){await referral({email,...r});migrated.referrals++;}
  for(const t of read('v4-tickets.json',[])){await ticket(t);migrated.tickets++;}
  for(const n of read('v4-notifications.json',[])){await notification(n);migrated.notifications++;}
  await q(`INSERT INTO bh_meta(key,value) VALUES('last_json_migration',now()::text) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  return {ok:true,migrated};
}

module.exports={init,status,close,upsertUsers,restoreUsers,mirrorBilling,securityEvent,apiToken,deleteApiToken,server,job,referral,claim,ticket,notification,paymentTransaction,paymentEvent,paymentIdempotency,migrateJson};
