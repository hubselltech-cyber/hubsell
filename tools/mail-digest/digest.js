// Tom tat thu moi tu Zoho + Gmail qua IMAP, xep theo muc uu tien.
// Chay:  node digest.js            -> in ban tom tat, cap nhat moc (state.json)
//        node digest.js --dry      -> in nhung KHONG cap nhat moc
//        node digest.js --since 7  -> nhin lai 7 ngay, bo qua moc
//        node digest.js --account zoho|gmail
//        node digest.js --json     -> in JSON thay vi markdown
// Khong tai thu ve may: chi doc envelope + toi da BODY_CHARS ky tu noi dung. Thu van nam tren may chu.

import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, LEVEL_ORDER, LEVEL_TITLE } from './rules.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(HERE, 'state.json');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const DRY = flag('--dry');
const AS_JSON = flag('--json');
const SINCE_DAYS = opt('--since') ? Number(opt('--since')) : null;
const ONLY = opt('--account');
const BODY_CHARS = Number(process.env.BODY_CHARS || 400);
const FIRST_LOOKBACK = Number(process.env.FIRST_RUN_LOOKBACK_DAYS || 3);
const MAX_SOURCE_BYTES = 60_000;
const PENDING_MAX = Number(process.env.PENDING_MAX || 20);

const clean = (s) => (s || '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');
const split = (s) => (s || '').split('|').map((x) => x.trim()).filter(Boolean);

const ACCOUNTS = [
  {
    key: 'zoho', label: 'Zoho dev@hubsell.vn',
    host: process.env.ZOHO_IMAP_HOST || 'imappro.zoho.com',
    user: process.env.ZOHO_IMAP_USER, pass: clean(process.env.ZOHO_IMAP_PASS),
    folders: split(process.env.ZOHO_FOLDERS || 'INBOX'),
    countOnly: split(process.env.ZOHO_COUNT_ONLY_FOLDERS),
  },
  {
    key: 'gmail', label: 'Gmail hubselltech@gmail.com',
    host: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
    user: process.env.GMAIL_IMAP_USER, pass: clean(process.env.GMAIL_IMAP_PASS),
    folders: split(process.env.GMAIL_FOLDERS || 'INBOX'),
    countOnly: [],
  },
].filter((a) => !ONLY || a.key === ONLY);

function loadState() {
  try { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}; } catch { return {}; }
}
function saveState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

function addr(list) {
  if (!list || !list.length) return '';
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}
function oneLine(s, n) {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
}
function fmtDate(d) {
  if (!d) return '';
  const x = new Date(d);
  const p = (v) => String(v).padStart(2, '0');
  return `${p(x.getDate())}/${p(x.getMonth() + 1)} ${p(x.getHours())}:${p(x.getMinutes())}`;
}

async function readAccount(acc, state) {
  const out = { account: acc.key, label: acc.label, mails: [], counts: {}, errors: [], pending: [], pendingTotal: 0 };
  if (!acc.user || !acc.pass) { out.errors.push(`Chưa cấu hình ${acc.key.toUpperCase()}_IMAP_USER / _PASS trong .env`); return out; }

  const client = new ImapFlow({ host: acc.host, port: 993, secure: true, auth: { user: acc.user, pass: acc.pass }, logger: false });
  try {
    await client.connect();
  } catch (e) {
    out.errors.push(`Không đăng nhập được ${acc.label} (${acc.host}): ${e.message}`);
    return out;
  }

  const st = (state[acc.key] ||= {});
  const listed = await client.list();
  const byName = new Map(listed.map((b) => [b.path.toLowerCase(), b.path]));
  const resolve = (name) => byName.get(name.toLowerCase()) || name;

  try {
    // Thu muc chi dem
    for (const f of acc.countOnly) {
      const path = resolve(f);
      try {
        const s = await client.status(path, { messages: true, unseen: true });
        out.counts[f] = { total: s.messages, unseen: s.unseen };
      } catch (e) { out.errors.push(`Không đọc được thư mục ${f}: ${e.message}`); }
    }

    for (const f of acc.folders) {
      const path = resolve(f);
      let lock;
      try { lock = await client.getMailboxLock(path); } catch (e) { out.errors.push(`Không mở được thư mục ${f}: ${e.message}`); continue; }
      try {
        const mb = client.mailbox;
        const key = f;
        const prev = st[key];
        const sameGen = prev && prev.uidValidity === String(mb.uidValidity);

        let range;
        if (SINCE_DAYS) {
          range = { since: new Date(Date.now() - SINCE_DAYS * 86400e3) };
        } else if (sameGen && prev.lastUid) {
          range = { uid: `${prev.lastUid + 1}:*` };
        } else {
          range = { since: new Date(Date.now() - FIRST_LOOKBACK * 86400e3) };
        }

        let maxUid = sameGen ? prev.lastUid : 0;
        const uids = await client.search(range, { uid: true });
        // IMAP tra ve "lastUid:*" gom ca chinh lastUid neu no la thu cuoi -> loc lai
        const fresh = SINCE_DAYS ? uids : uids.filter((u) => !(sameGen && prev.lastUid && u <= prev.lastUid));
        for (const uid of fresh) if (uid > maxUid) maxUid = uid;

        if (fresh.length) {
          for await (const msg of client.fetch(fresh, { uid: true, envelope: true, flags: true, source: { maxBytes: MAX_SOURCE_BYTES } }, { uid: true })) {
            const env = msg.envelope || {};
            let text = '';
            try {
              const parsed = await simpleParser(msg.source);
              text = parsed.text || (parsed.html ? parsed.html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ') : '');
            } catch { /* bo qua loi parse */ }
            const rec = {
              account: acc.key, folder: f, uid: msg.uid,
              date: env.date, from: addr(env.from), to: addr(env.to), cc: addr(env.cc),
              subject: env.subject || '(không tiêu đề)',
              unread: !(msg.flags && msg.flags.has('\\Seen')),
              snippet: oneLine(text, BODY_CHARS),
            };
            Object.assign(rec, classify(rec));
            out.mails.push(rec);
          }
        }
        if (!DRY && !SINCE_DAYS) st[key] = { uidValidity: String(mb.uidValidity), lastUid: maxUid || (mb.uidNext ? mb.uidNext - 1 : 0) };
      } finally { lock.release(); }
    }
    // Thu con GAN CO trong Hop thu den = viec chua xong -> nhac lai moi ngay toi khi anh bo co / luu tru
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const uids = await client.search({ flagged: true }, { uid: true });
        const take = uids.slice(-PENDING_MAX);
        if (take.length) {
          for await (const msg of client.fetch(take, { uid: true, envelope: true }, { uid: true })) {
            const env = msg.envelope || {};
            const rec = { account: acc.key, folder: 'INBOX', uid: msg.uid, date: env.date, from: addr(env.from), subject: env.subject || '(không tiêu đề)' };
            Object.assign(rec, classify(rec));
            out.pending.push(rec);
          }
        }
        out.pendingTotal = uids.length;
      } finally { lock.release(); }
    } catch (e) { out.errors.push(`Không đọc được thư gắn cờ: ${e.message}`); }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

function render(results) {
  const all = results.flatMap((r) => r.mails);
  const lines = [];
  const today = new Date();
  lines.push(`# Tóm tắt thư ${fmtDate(today)}`);
  lines.push('');
  for (const r of results) {
    const n = r.mails.filter((m) => m.level !== 'SKIP').length;
    const c = Object.entries(r.counts).map(([k, v]) => `${k}: ${v.unseen} chưa đọc/${v.total}`).join(', ');
    lines.push(`- ${r.label}: ${n} thư mới${c ? ` · ${c}` : ''}`);
    for (const e of r.errors) lines.push(`  - ⚠️ ${e}`);
  }
  lines.push('');

  const pending = results.flatMap((r) => r.pending).sort((a, b) => new Date(a.date) - new Date(b.date));
  if (pending.length) {
    lines.push(`## ⏳ Còn treo · thư gắn cờ trong Hộp thư đến (${pending.length})`);
    lines.push('_Nhắc lại mỗi ngày tới khi anh xử lý xong rồi lưu trữ hoặc bỏ cờ._');
    for (const m of pending) {
      const age = Math.max(0, Math.floor((Date.now() - new Date(m.date)) / 86400e3));
      lines.push(`- **${m.subject}** — ${m.from} · ${fmtDate(m.date)} (${age} ngày) · ${m.account}`);
    }
    lines.push('');
  }

  for (const lv of LEVEL_ORDER) {
    const ms = all.filter((m) => m.level === lv).sort((a, b) => a.group.localeCompare(b.group, 'vi') || (new Date(b.date) - new Date(a.date)));
    if (!ms.length) continue;
    lines.push(`## ${LEVEL_TITLE[lv]} (${ms.length})`);
    if (lv === 'P4') {
      const byGroup = {};
      for (const m of ms) byGroup[m.group] = (byGroup[m.group] || 0) + 1;
      for (const [g, n] of Object.entries(byGroup)) lines.push(`- ${g}: ${n}`);
      lines.push('');
      continue;
    }
    let lastGroup = '';
    for (const m of ms) {
      if (m.group !== lastGroup) { lines.push(`### ${m.group}`); lastGroup = m.group; }
      lines.push(`- **${m.subject}** — ${m.from} · ${fmtDate(m.date)} · ${m.account}/${m.folder}${m.unread ? '' : ' · đã đọc'}`);
      if (m.snippet) lines.push(`  > ${m.snippet}`);
    }
    lines.push('');
  }
  const skipped = all.filter((m) => m.level === 'SKIP').length;
  if (skipped) lines.push(`_Bỏ qua ${skipped} thư (DMARC)._`);
  if (!all.length) lines.push('_Không có thư mới._');
  return lines.join('\n');
}

(async () => {
  const state = loadState();
  const results = [];
  for (const acc of ACCOUNTS) results.push(await readAccount(acc, state));
  if (!DRY && !SINCE_DAYS) saveState(state);
  if (AS_JSON) console.log(JSON.stringify(results, null, 2));
  else console.log(render(results));
  const hasErr = results.some((r) => r.errors.length);
  process.exit(hasErr ? 2 : 0);
})().catch((e) => { console.error('LỖI:', e.message); process.exit(1); });
