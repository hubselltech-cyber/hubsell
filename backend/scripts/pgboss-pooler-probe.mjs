// ============================================================
// BÀI THỬ pg-boss 12.35.1 — giai đoạn 2 kiến trúc quy mô (01/10/2026).
// Chạy được với Postgres trực tiếp lẫn bộ gộp kết nối Supabase (cổng 5432 chế độ
// phiên, cổng 6543 chế độ giao dịch).
//
// Mọi thứ nằm trong MỘT schema riêng (mặc định pgboss_probe), xong thì DROP.
// Không đụng bảng nào của schema public.
//
// pg-boss CHƯA nằm trong package.json của backend, nên chép tệp này sang một thư
// mục tạm đã cài pg-boss rồi chạy ở đó:
//   mkdir -p /tmp/p && cd /tmp/p && npm init -y && npm i pg-boss@12.35.1
//   cp <backend>/scripts/pgboss-pooler-probe.mjs .
//   node pgboss-pooler-probe.mjs --label session --prisma <backend> --ascii
//   node pgboss-pooler-probe.mjs --label transaction --port 6543 --prisma <backend> --ascii
//
// Chuỗi kết nối: PROBE_URL → DATABASE_URL trong <backend>/.env → DATABASE_URL của
// môi trường (Render).
//
// Cờ: --schema <tên>  --max <số kết nối mỗi instance>  --n <số việc bài tải>
//     --prisma <thư mục backend>  --port <cổng>  --kill (thử cắt kết nối)
//     --idle <giây>  --skip T12,T18  --ascii  --keep  --json <tệp ghi kết quả>
// ============================================================

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import pg from 'pg'
import { PgBoss, getConstructionPlans, fromPrisma } from 'pg-boss'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}

const LABEL = String(flag('label', 'local'))
const SCHEMA = String(flag('schema', 'pgboss_probe'))
const MAX = Number(flag('max', 2))
const N = Number(flag('n', 1000))
const BACKEND_DIR = flag('prisma', null)
const DO_KILL = flag('kill', false) === true
const IDLE_SEC = Number(flag('idle', 0))
const KEEP = flag('keep', false) === true
const JSON_OUT = flag('json', null)
// --ascii: mỗi bài một dòng ngắn không dấu (Render Web Shell hiện sai chữ có dấu).
const ASCII = flag('ascii', false) === true
const asciiLine = (x) => JSON.stringify(x).replace(/[^ -~]/g, '?').replace(/"/g, '')

function readEnvUrl () {
  if (process.env.PROBE_URL) return process.env.PROBE_URL
  const envFile = BACKEND_DIR ? path.join(String(BACKEND_DIR), '.env') : null
  if (envFile && fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)/m)
    if (m) return m[1]
  }
  // Trên Render không có tệp .env — lấy thẳng biến môi trường của dịch vụ.
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  throw new Error('Thiếu PROBE_URL / DATABASE_URL')
}

const PORT = flag('port', null)
const RAW_URL = (() => {
  const u = new URL(readEnvUrl())
  if (PORT) u.port = String(PORT)
  return u.toString()
})()

/** Chuỗi kết nối cho `pg`: bỏ tham số riêng của Prisma, tự xử lý TLS. */
function pgConfig (applicationName, max) {
  const u = new URL(RAW_URL)
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname)
  for (const k of ['schema', 'connection_limit', 'pool_timeout', 'statement_cache_size', 'pgbouncer', 'sslmode']) {
    u.searchParams.delete(k)
  }
  return {
    connectionString: u.toString(),
    // Chứng chỉ của bộ gộp Supabase do CA riêng ký — giống Prisma với sslmode=require:
    // mã hóa đường truyền, không kiểm chuỗi chứng chỉ.
    ssl: local ? undefined : { rejectUnauthorized: false },
    application_name: applicationName,
    max
  }
}

const results = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pct = (arr, p) => {
  if (arr.length === 0) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

// --skip T12,T18: bỏ bài (vd bài cần Prisma khi máy chạy thử thiếu bộ nhớ).
const SKIP = new Set(String(flag('skip', '')).split(',').map((x) => x.trim()).filter(Boolean))

async function test (id, title, fn) {
  if (SKIP.has(id)) {
    results.push({ id, title, status: 'SKIP', ms: 0, detail: { skip: '--skip' } })
    console.log(`SKIP ${id} --skip`)
    return
  }
  const t0 = Date.now()
  try {
    const detail = await fn()
    const ms = Date.now() - t0
    const skipped = detail && detail.skip
    results.push({ id, title, status: skipped ? 'SKIP' : 'PASS', ms, detail })
    const tag = skipped ? 'SKIP' : 'PASS'
    console.log(ASCII
      ? `${tag} ${id} ${ms}ms ${asciiLine(detail ?? {})}`
      : `${tag} ${id} ${title} (${ms} ms) ${JSON.stringify(detail ?? {})}`)
  } catch (err) {
    const ms = Date.now() - t0
    results.push({ id, title, status: 'FAIL', ms, error: String(err?.message ?? err) })
    console.log(ASCII
      ? `FAIL ${id} ${ms}ms ${asciiLine(String(err?.message ?? err).replace(/\s+/g, ' ').slice(0, 300))}`
      : `FAIL ${id} ${title} (${ms} ms) ${String(err?.stack ?? err).split('\n').slice(0, 4).join(' | ')}`)
  }
}

function expect (cond, message) {
  if (!cond) throw new Error(message)
}

const events = { error: [], warning: [] }
function newBoss (name, extra = {}) {
  const boss = new PgBoss({
    ...pgConfig(`${SCHEMA}_${name}`, MAX),
    schema: SCHEMA,
    migrate: false,
    createSchema: false,
    schedule: false,
    ...extra
  })
  boss.on('error', (e) => events.error.push(`${name}: ${e.message}`))
  boss.on('warning', (w) => events.warning.push(`${name}: ${w.message}`))
  return boss
}

async function waitFor (cond, timeoutMs, stepMs = 50) {
  const end = Date.now() + timeoutMs
  for (;;) {
    if (await cond()) return true
    if (Date.now() > end) return false
    await sleep(stepMs)
  }
}

const admin = new pg.Client(pgConfig(`${SCHEMA}_admin`, 1))
admin.on('error', (e) => events.error.push(`admin: ${e.message}`))

async function main () {
  await admin.connect()
  const info = (await admin.query(
    `select version() as version, current_user as usr,
            (select rolsuper from pg_roles where rolname = current_user) as super,
            current_setting('max_connections') as max_connections,
            inet_server_port() as server_port`
  )).rows[0]
  const u = new URL(RAW_URL)
  const host = ['localhost', '127.0.0.1'].includes(u.hostname) ? u.hostname : u.hostname.replace(/^[^.]+/, '***')
  console.log(`# ${LABEL} | ${host}:${u.port || 5432} | ${info.version.split(',')[0]} | node ${process.version} | super=${info.super} | max_connections=${info.max_connections} | max=${MAX} n=${N}`)

  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)

  // ---------- Cài đặt ----------
  await test('T01', 'migrate:false trên schema chưa cài thì start() phải từ chối', async () => {
    const boss = newBoss('t01')
    let rejected = null
    try { await boss.start() } catch (e) { rejected = e.message }
    await boss.stop({ graceful: false }).catch(() => {})
    expect(rejected, 'start() không báo lỗi dù schema chưa có')
    return { rejected: rejected.slice(0, 120) }
  })

  await test('T02', 'cài schema bằng SQL xuất ra (như một migration chạy tay) + bật RLS', async () => {
    const sql = getConstructionPlans(SCHEMA)
    await admin.query(sql)
    const tables = (await admin.query(
      `select c.relname, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relkind in ('r','p') order by 1`, [SCHEMA]
    )).rows
    for (const t of tables) {
      await admin.query(`ALTER TABLE ${SCHEMA}."${t.relname}" ENABLE ROW LEVEL SECURITY`)
    }
    return { sqlBytes: sql.length, tables: tables.map((t) => t.relname) }
  })

  const a = newBoss('a')
  const b = newBoss('b')

  await test('T03', 'start() với migrate:false sau khi cài tay; không lệch schema', async () => {
    await a.start()
    await b.start()
    const version = await a.schemaVersion()
    const drift = await a.detectSchemaDrift()
    const bam = await a.getBamStatus()
    expect(drift.ok, `lệch schema: ${JSON.stringify(drift).slice(0, 300)}`)
    return { version, driftOk: drift.ok, bam }
  })

  const Q = {
    basic: 'probe.basic',
    retry: 'probe.retry',
    dlq: 'probe.dlq',
    lease: 'probe.lease',
    merge: 'probe.merge',
    fifo: 'probe.fifo',
    group: 'probe.group',
    load: 'probe.load',
    tx: 'probe.tx',
    notify: 'probe.notify',
    kill: 'probe.kill'
  }

  await test('T04', 'createQueue không sinh bảng mới (không DDL lúc chạy)', async () => {
    const count = async () => Number((await admin.query(
      `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1`, [SCHEMA]
    )).rows[0].count)
    const before = await count()
    await a.createQueue(Q.dlq)
    await a.createQueue(Q.basic)
    await a.createQueue(Q.retry, { retryLimit: 2, retryDelay: 1, retryBackoff: true, deadLetter: Q.dlq })
    await a.createQueue(Q.lease, { expireInSeconds: 1, retryLimit: 3 })
    await a.createQueue(Q.merge, { policy: 'stately' })
    await a.createQueue(Q.fifo, { policy: 'key_strict_fifo' })
    await a.createQueue(Q.group)
    await a.createQueue(Q.load)
    await a.createQueue(Q.tx)
    await a.createQueue(Q.notify, { notify: true })
    await a.createQueue(Q.kill)
    const after = await count()
    expect(before === after, `số đối tượng trong schema đổi ${before} -> ${after}`)
    return { objects: after, queues: (await a.getQueues()).length }
  })

  // ---------- Hành vi cơ bản ----------
  await test('T05', 'gửi -> xử lý, đo độ trễ với nhịp hỏi 0,5 giây', async () => {
    const seen = new Map()
    await b.work(Q.basic, { pollingIntervalSeconds: 0.5 }, async ([job]) => { seen.set(job.id, Date.now()) })
    const lat = []
    for (let i = 0; i < 12; i++) {
      const t0 = Date.now()
      const id = await a.send(Q.basic, { i })
      const ok = await waitFor(() => seen.has(id), 5000, 10)
      expect(ok, `việc ${i} không được xử lý trong 5 giây`)
      lat.push(seen.get(id) - t0)
      await sleep(137)
    }
    await b.offWork(Q.basic)
    return { p50: pct(lat, 50), p95: pct(lat, 95), max: Math.max(...lat) }
  })

  await test('T06', 'lỗi -> thử lại có giãn cách -> hết lượt sang hàng đợi lỗi', async () => {
    const attempts = []
    await b.work(Q.retry, { pollingIntervalSeconds: 0.5 }, async ([job]) => {
      attempts.push({ retryCount: job.retryCount, at: Date.now() })
      throw new Error('lỗi cố ý')
    })
    const id = await a.send(Q.retry, { order: 'X1' })
    const ok = await waitFor(async () => (await a.findJobs(Q.dlq)).length > 0, 20000, 250)
    await b.offWork(Q.retry)
    expect(ok, `không thấy việc ở hàng đợi lỗi sau 20 giây (đã thử ${attempts.length} lần)`)
    const [src] = await a.findJobs(Q.retry, { id })
    const [dead] = await a.findJobs(Q.dlq)
    return {
      attempts: attempts.length,
      gapsMs: attempts.slice(1).map((x, i) => x.at - attempts[i].at),
      sourceState: src?.state,
      deadData: dead?.data,
      deadSource: dead?.sourceName
    }
  })

  await test('T07', 'việc bị bỏ dở (tiến trình chết) được trả lại theo hạn giữ', async () => {
    await a.send(Q.lease, { n: 1 })
    const [first] = await a.fetch(Q.lease)
    expect(first, 'không lấy được việc')
    await sleep(2500)
    await a.supervise(Q.lease)
    let second = null
    await waitFor(async () => { [second] = await b.fetch(Q.lease); return !!second }, 8000, 300)
    expect(second, 'việc không quay lại hàng chờ sau khi quá hạn giữ')
    // Người giữ cũ báo xong muộn: không được ghi đè lượt mới.
    await a.complete(Q.lease, { id: first.id, retryCount: first.retryCount })
    const [mid] = await a.findJobs(Q.lease, { id: first.id })
    await b.complete(Q.lease, { id: second.id, retryCount: second.retryCount })
    const [end] = await a.findJobs(Q.lease, { id: first.id })
    expect(mid.state === 'active', `người giữ cũ đã ghi đè lượt mới: ${mid.state}`)
    return { sameJob: first.id === second.id, retryCount: second.retryCount, afterStaleComplete: mid.state, final: end.state }
  })

  await test('T08', 'gộp việc theo khóa (đẩy tồn): 1 chờ + 1 đang chạy mỗi khóa, sửa được việc đang chờ', async () => {
    const key = 'channel1:SKU-A'
    const id1 = await a.send(Q.merge, { v: 1 }, { singletonKey: key })
    const id2 = await a.send(Q.merge, { v: 2 }, { singletonKey: key })
    const other = await a.send(Q.merge, { v: 1 }, { singletonKey: 'channel1:SKU-B' })
    const up = await a.upsert(Q.merge, { v: 3 }, { singletonKey: key })
    const [running] = await a.fetch(Q.merge)
    const id3 = await a.send(Q.merge, { v: 4 }, { singletonKey: key })
    const id4 = await a.send(Q.merge, { v: 5 }, { singletonKey: key })
    const jobs = await a.findJobs(Q.merge, { key })
    expect(id1 && !id2, `việc thứ hai cùng khóa lẽ ra bị từ chối (id2=${id2})`)
    expect(other, 'khóa khác bị chặn nhầm')
    return {
      secondRejected: id2 === null,
      upsert: { updated: up.updated, inserted: up.inserted },
      fetchedData: running?.data,
      whileActive: { thirdAccepted: !!id3, fourthRejected: id4 === null },
      states: jobs.map((j) => j.state).sort()
    }
  })

  await test('T09', 'đúng thứ tự theo khóa (theo đơn) khi 2 instance chạy song song', async () => {
    const KEYS = 20; const PER = 10
    const active = new Map(); const last = new Map()
    let overlap = 0; let outOfOrder = 0; let done = 0; let maxParallel = 0; let parallel = 0
    const handler = async ([job]) => {
      const { key, seq } = job.data
      if (active.get(key)) overlap++
      active.set(key, true)
      parallel++; maxParallel = Math.max(maxParallel, parallel)
      if ((last.get(key) ?? -1) !== seq - 1) outOfOrder++
      await sleep(5 + Math.random() * 15)
      last.set(key, seq)
      active.set(key, false)
      parallel--; done++
    }
    for (let seq = 0; seq < PER; seq++) {
      await a.insert(Q.fifo, Array.from({ length: KEYS }, (_, k) => ({ data: { key: `order-${k}`, seq }, singletonKey: `order-${k}` })))
    }
    const t0 = Date.now()
    await a.work(Q.fifo, { pollingIntervalSeconds: 0.5, localConcurrency: 4 }, handler)
    await b.work(Q.fifo, { pollingIntervalSeconds: 0.5, localConcurrency: 4 }, handler)
    const ok = await waitFor(() => done >= KEYS * PER, 60000, 100)
    const ms = Date.now() - t0
    await a.offWork(Q.fifo); await b.offWork(Q.fifo)
    expect(ok, `mới xong ${done}/${KEYS * PER} sau 60 giây`)
    expect(overlap === 0 && outOfOrder === 0, `chồng ${overlap}, sai thứ tự ${outOfOrder}`)
    return { jobs: done, overlap, outOfOrder, maxParallel, ms, perSec: Math.round(done / (ms / 1000)) }
  })

  await test('T09b', 'thứ tự theo khóa, lấy theo lô 10 + chạy liền khi lô đầy', async () => {
    const KEYS = 100; const PER = 10
    const active = new Map(); const last = new Map()
    let overlap = 0; let outOfOrder = 0; let done = 0
    const one = async (job) => {
      const { key, seq } = job.data
      if (active.get(key)) overlap++
      active.set(key, true)
      if ((last.get(key) ?? -1) !== seq - 1) outOfOrder++
      await sleep(5 + Math.random() * 15)
      last.set(key, seq); active.set(key, false); done++
    }
    const handler = async (jobs) => { await Promise.all(jobs.map(one)) }
    for (let seq = 0; seq < PER; seq++) {
      await a.insert(Q.fifo, Array.from({ length: KEYS }, (_, k) => ({ data: { key: `o-${k}`, seq }, singletonKey: `o-${k}` })))
    }
    const t0 = Date.now()
    const opts = { pollingIntervalSeconds: 0.5, localConcurrency: 4, batchSize: 10, burstWhenBatchFull: true }
    await a.work(Q.fifo, opts, handler)
    await b.work(Q.fifo, opts, handler)
    const ok = await waitFor(() => done >= KEYS * PER, 90000, 100)
    const ms = Date.now() - t0
    await a.offWork(Q.fifo); await b.offWork(Q.fifo)
    expect(ok, `mới xong ${done}/${KEYS * PER} sau 90 giây`)
    expect(overlap === 0 && outOfOrder === 0, `chồng ${overlap}, sai thứ tự ${outOfOrder}`)
    return { jobs: done, overlap, outOfOrder, ms, perSec: Math.round(done / (ms / 1000)) }
  })

  await test('T10', 'trần số việc chạy cùng lúc theo nhóm (theo gian) trên mọi instance', async () => {
    const SHOPS = 6; const PER = 10
    const active = new Map(); let violation = 0; let done = 0; let maxParallel = 0; let parallel = 0
    const handler = async ([job]) => {
      const g = job.data.s
      const n = (active.get(g) ?? 0) + 1
      active.set(g, n)
      if (n > 1) violation++
      parallel++; maxParallel = Math.max(maxParallel, parallel)
      await sleep(20 + Math.random() * 20)
      active.set(g, active.get(g) - 1)
      parallel--; done++
    }
    const jobs = []
    for (let s = 0; s < SHOPS; s++) for (let i = 0; i < PER; i++) jobs.push({ data: { s, i }, group: { id: `shop-${s}` } })
    await a.insert(Q.group, jobs)
    const t0 = Date.now()
    await a.work(Q.group, { pollingIntervalSeconds: 0.5, localConcurrency: 4, groupConcurrency: 1 }, handler)
    await b.work(Q.group, { pollingIntervalSeconds: 0.5, localConcurrency: 4, groupConcurrency: 1 }, handler)
    const ok = await waitFor(() => done >= SHOPS * PER, 60000, 100)
    const ms = Date.now() - t0
    await a.offWork(Q.group); await b.offWork(Q.group)
    expect(ok, `mới xong ${done}/${SHOPS * PER} sau 60 giây`)
    return { jobs: done, violation, strict: violation === 0, maxParallel, ms }
  })

  // ---------- Tải ----------
  await test('T11', `tải: ${N} việc, 2 instance, mỗi việc xử lý đúng một lần`, async () => {
    const seen = new Map(); let done = 0
    const handler = async (jobs) => { for (const j of jobs) { seen.set(j.id, (seen.get(j.id) ?? 0) + 1); done++ } }
    const t0 = Date.now()
    for (let i = 0; i < N; i += 500) {
      await a.insert(Q.load, Array.from({ length: Math.min(500, N - i) }, (_, k) => ({ data: { i: i + k, pad: 'x'.repeat(300) } })))
    }
    const insertMs = Date.now() - t0
    const t1 = Date.now()
    const opts = { pollingIntervalSeconds: 0.5, batchSize: 20, localConcurrency: 4, burstWhenBatchFull: true }
    await a.work(Q.load, opts, handler)
    await b.work(Q.load, opts, handler)
    const ok = await waitFor(() => seen.size >= N, 120000, 50)
    const workMs = Date.now() - t1
    await sleep(1500)
    await a.offWork(Q.load); await b.offWork(Q.load)
    const dup = [...seen.values()].filter((c) => c > 1).length
    expect(ok, `mới xong ${seen.size}/${N}`)
    expect(dup === 0, `${dup} việc bị xử lý hai lần`)
    return {
      insertMs, insertPerSec: Math.round(N / (insertMs / 1000)),
      workMs, workPerSec: Math.round(N / (workMs / 1000)), duplicates: dup, handled: done
    }
  })

  // ---------- Prisma: xếp việc chung giao dịch ----------
  await test('T12', 'Prisma: xếp việc + báo xong nằm chung giao dịch với dữ liệu nghiệp vụ', async () => {
    if (!BACKEND_DIR) return { skip: 'không truyền --prisma' }
    const req = createRequire(path.join(String(BACKEND_DIR), 'package.json'))
    const { PrismaClient } = req('@prisma/client')
    const pu = new URL(RAW_URL)
    pu.searchParams.set('connection_limit', '2')
    if (PORT && String(PORT) === '6543') pu.searchParams.set('pgbouncer', 'true')
    const prisma = new PrismaClient({ datasourceUrl: pu.toString(), log: ['error'] })
    try {
      await prisma.$executeRawUnsafe(`CREATE TABLE ${SCHEMA}.biz (id text primary key, note text)`)
      // 1) rollback: cả dòng nghiệp vụ lẫn việc đều biến mất
      let rolledId = null
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${SCHEMA}.biz VALUES ('r1','rollback')`)
        rolledId = await a.send(Q.tx, { order: 'R1', nested: { at: new Date().toISOString(), qty: 3 } }, { db: fromPrisma(tx) })
        throw new Error('ROLLBACK_ON_PURPOSE')
      }).catch((e) => { if (!String(e.message).includes('ROLLBACK_ON_PURPOSE')) throw e })
      const afterRollback = await a.findJobs(Q.tx, { id: rolledId })
      const bizRollback = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS c FROM ${SCHEMA}.biz`)

      // 2) commit: đủ kiểu tham số (khóa gộp, hẹn giờ, nhóm) + ghi theo lô
      let sentId = null; let batchIds = null
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${SCHEMA}.biz VALUES ('c1','commit')`)
        const db = fromPrisma(tx)
        sentId = await a.send(Q.tx, { order: 'C1', items: [{ sku: 'A', qty: 2 }], vi: 'đơn hàng ₫' },
          { db, singletonKey: 'k1', startAfter: 1, group: { id: 'shop-1' }, priority: 5, retryLimit: 4 })
        batchIds = await a.insert(Q.tx, [{ data: { n: 1 } }, { data: { n: 2 }, startAfter: new Date(Date.now() + 500) }], { db })
      })
      const [sent] = await a.findJobs(Q.tx, { id: sentId })
      const inQueue = (await a.findJobs(Q.tx)).length
      expect(afterRollback.length === 0, 'việc vẫn còn sau khi rollback')
      expect(bizRollback[0].c === 0, 'dòng nghiệp vụ vẫn còn sau khi rollback')
      expect(inQueue === 3, `lẽ ra có 3 việc sau commit, thấy ${inQueue}`)
      expect(sent && sent.data.vi === 'đơn hàng ₫' && sent.data.items[0].qty === 2, 'dữ liệu việc sai sau khi commit')

      // 3) báo xong chung giao dịch với ghi nghiệp vụ
      await sleep(1600)
      const fetched = await a.fetch(Q.tx, { batchSize: 10 })
      const target = fetched.find((j) => j.id === sentId)
      expect(target, 'không lấy lại được việc vừa commit')
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${SCHEMA}.biz VALUES ('done-rb','x')`)
        await a.complete(Q.tx, { id: target.id, retryCount: target.retryCount }, null, { db: fromPrisma(tx) })
        throw new Error('ROLLBACK_ON_PURPOSE')
      }).catch((e) => { if (!String(e.message).includes('ROLLBACK_ON_PURPOSE')) throw e })
      const [stillActive] = await a.findJobs(Q.tx, { id: sentId })
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${SCHEMA}.biz VALUES ('done','x')`)
        await a.complete(Q.tx, { id: target.id, retryCount: target.retryCount }, null, { db: fromPrisma(tx) })
      })
      const [completed] = await a.findJobs(Q.tx, { id: sentId })
      expect(stillActive.state === 'active', `rollback mà việc đã ${stillActive.state}`)
      expect(completed.state === 'completed', `commit mà việc còn ${completed.state}`)
      for (const j of fetched) if (j.id !== sentId) await a.complete(Q.tx, j.id)
      return {
        rollback: { job: afterRollback.length, biz: bizRollback[0].c },
        commit: { state: sent.state, priority: sent.priority, group: sent.groupId ?? null, jobsInQueue: inQueue },
        completeInTx: { afterRollback: stillActive.state, afterCommit: completed.state }
      }
    } finally {
      await prisma.$disconnect()
    }
  })

  // Đã thử riêng (t18.mjs): pg-boss chạy HẲN trên kết nối Prisma thì start() hỏng ở câu
  // to_regclass (Prisma không đọc được kiểu regclass); instance chưa start() thì không gửi được.
  // Nên vai web = instance có pool riêng 1 kết nối, tắt giám sát; việc gửi đi qua giao dịch Prisma.
  await test('T18', 'vai web: pool riêng 1 kết nối, tắt giám sát; gửi qua giao dịch Prisma; lúc nghỉ trả hết kết nối', async () => {
    if (!BACKEND_DIR) return { skip: 'không truyền --prisma' }
    const req = createRequire(path.join(String(BACKEND_DIR), 'package.json'))
    const { PrismaClient } = req('@prisma/client')
    const pu = new URL(RAW_URL)
    pu.searchParams.set('connection_limit', '2')
    if (PORT && String(PORT) === '6543') pu.searchParams.set('pgbouncer', 'true')
    const prisma = new PrismaClient({ datasourceUrl: pu.toString(), log: ['error'] })
    const w = newBoss('web', { max: 1, supervise: false })
    try {
      await w.start()
      const lat = []
      for (let i = 0; i < 30; i++) {
        const t0 = Date.now()
        await prisma.$transaction(async (tx) => { await w.send(Q.tx, { i }, { db: fromPrisma(tx) }) })
        lat.push(Date.now() - t0)
      }
      const cached = await prisma.$queryRawUnsafe('select count(*)::int as n, coalesce(sum(length(statement)),0)::int as chars from pg_prepared_statements')
      await sleep(12500)
      const idlePool = w.getDb().pool?.totalCount ?? null
      const fetched = await a.fetch(Q.tx, { batchSize: 100 })
      await a.complete(Q.tx, fetched.map((j) => j.id))
      await w.stop({ graceful: true, timeout: 5000 })
      expect(fetched.length === 30, `gửi 30 việc, lấy lại được ${fetched.length}`)
      return { sent: 30, txSendP50: pct(lat, 50), txSendP95: pct(lat, 95), poolAfterIdle12s: idlePool, prismaStatementsOnConnection: cached[0] }
    } finally {
      await prisma.$disconnect()
    }
  })

  // ---------- Kết nối ----------
  await test('T13', 'số kết nối pg-boss giữ (lúc nghỉ) và câu lệnh chuẩn bị sẵn còn treo', async () => {
    const rows = (await admin.query(
      `select application_name, count(*)::int as n from pg_stat_activity
       where application_name like $1 group by 1 order by 1`, [`${SCHEMA}_%`]
    )).rows
    const poolA = a.getDb().pool
    const prepared = (await a.getDb().executeSql('select count(*)::int as n from pg_prepared_statements')).rows[0].n
    return {
      byName: Object.fromEntries(rows.map((r) => [r.application_name.replace(`${SCHEMA}_`, ''), r.n])),
      poolA: poolA ? { total: poolA.totalCount, idle: poolA.idleCount } : null,
      preparedOnBossConnection: prepared
    }
  })

  await test('T14', 'kết nối bị cắt giữa chừng: pg-boss tự nối lại, việc vẫn chạy', async () => {
    if (!DO_KILL) return { skip: 'không truyền --kill' }
    let handled = 0
    await b.work(Q.kill, { pollingIntervalSeconds: 0.5 }, async () => { handled++ })
    const victims = (await admin.query(
      `select pid from pg_stat_activity where application_name in ($1, $2) and pid <> pg_backend_pid()`,
      [`${SCHEMA}_a`, `${SCHEMA}_b`]
    )).rows
    if (victims.length === 0 || victims.length > MAX * 2 + 2) {
      await b.offWork(Q.kill)
      return { skip: `không nhận diện chắc kết nối của bài thử (thấy ${victims.length})` }
    }
    const errorsBefore = events.error.length
    for (const v of victims) await admin.query('select pg_terminate_backend($1)', [v.pid])
    await sleep(300)
    let sendError = null
    for (let i = 0; i < 5; i++) {
      try { await a.send(Q.kill, { i }) } catch (e) { sendError = e.message; await sleep(300); i-- }
      if (sendError && i < -5) break
    }
    const ok = await waitFor(() => handled >= 5, 15000, 100)
    await b.offWork(Q.kill)
    expect(ok, `sau khi cắt kết nối chỉ xử lý được ${handled}/5 việc`)
    return { killed: victims.length, handled, firstSendError: sendError, errorEvents: events.error.length - errorsBefore }
  })

  await test('T15', 'LISTEN/NOTIFY: đánh thức ngay khi có việc (nhịp hỏi đặt 10 giây)', async () => {
    const c = newBoss('c', { useListenNotify: true })
    const warnBefore = events.warning.length
    await c.start()
    const seen = new Map()
    await c.work(Q.notify, { pollingIntervalSeconds: 10, notifyPollingIntervalSeconds: 10 }, async ([job]) => { seen.set(job.id, Date.now()) })
    await sleep(1200)
    const lat = []
    for (let i = 0; i < 8; i++) {
      const t0 = Date.now()
      const id = await a.send(Q.notify, { i })
      const ok = await waitFor(() => seen.has(id), 12000, 10)
      lat.push(ok ? seen.get(id) - t0 : null)
      await sleep(211)
    }
    await c.stop({ graceful: true, timeout: 5000 })
    const got = lat.filter((x) => x !== null)
    return {
      p50: pct(got, 50), max: got.length ? Math.max(...got) : null, missed: lat.length - got.length,
      works: got.length === lat.length && pct(got, 50) < 1500,
      warnings: events.warning.slice(warnBefore).map((w) => w.slice(0, 140))
    }
  })

  if (IDLE_SEC > 0) {
    await test('T16', `nghỉ ${IDLE_SEC} giây rồi gửi tiếp (bộ gộp có cắt kết nối nhàn rỗi không)`, async () => {
      const seen = new Set()
      await b.work(Q.basic, { pollingIntervalSeconds: 2 }, async ([job]) => { seen.add(job.id) })
      const errorsBefore = events.error.length
      await sleep(IDLE_SEC * 1000)
      const t0 = Date.now()
      const id = await a.send(Q.basic, { afterIdle: true })
      const ok = await waitFor(() => seen.has(id), 10000, 20)
      await b.offWork(Q.basic)
      expect(ok, 'việc gửi sau khi nghỉ không được xử lý')
      return { latencyMs: Date.now() - t0, errorEvents: events.error.length - errorsBefore }
    })
  }

  await test('T17', 'dừng êm (SIGTERM lúc deploy)', async () => {
    const t0 = Date.now()
    await a.stop({ graceful: true, timeout: 10000 })
    await b.stop({ graceful: true, timeout: 10000 })
    return { stopMs: Date.now() - t0 }
  })

  if (!KEEP) await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`)
  const left = (await admin.query('select count(*)::int as n from pg_namespace where nspname = $1', [SCHEMA])).rows[0].n
  await admin.end()

  const summary = {
    label: LABEL,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    skip: results.filter((r) => r.status === 'SKIP').length,
    schemaLeft: left,
    errorEvents: events.error.slice(0, 20),
    warningEvents: events.warning.slice(0, 20)
  }
  console.log(`# TONG KET ${ASCII ? asciiLine(summary) : JSON.stringify(summary)}`)
  if (JSON_OUT) fs.writeFileSync(String(JSON_OUT), JSON.stringify({ info, summary, results }, null, 2))
  process.exit(summary.fail > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error('PROBE CRASH', err)
  try { if (!KEEP) await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`) } catch {}
  process.exit(2)
})
