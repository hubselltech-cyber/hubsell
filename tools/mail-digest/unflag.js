// Bo co (\Flagged) cac thu dang gan co trong Hop thu den Zoho = danh dau "viec da xong" de digest thoi nhac.
// Chay:  node unflag.js --dry   -> chi liet ke, KHONG bo co
//        node unflag.js         -> liet ke roi bo co tat ca
// Chi go co, khong xoa, khong chuyen thu muc, khong danh dau da doc.

import 'dotenv/config';
import { ImapFlow } from 'imapflow';

const DRY = process.argv.includes('--dry');
const clean = (s) => (s || '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');

const user = process.env.ZOHO_IMAP_USER;
const pass = clean(process.env.ZOHO_IMAP_PASS);
if (!user || !pass) { console.error('Chưa cấu hình ZOHO_IMAP_USER / _PASS trong .env'); process.exit(2); }

const client = new ImapFlow({ host: process.env.ZOHO_IMAP_HOST || 'imappro.zoho.com', port: 993, secure: true, auth: { user, pass }, logger: false });
await client.connect();
try {
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ flagged: true }, { uid: true });
    console.log(`Đang gắn cờ: ${uids.length} thư`);
    if (uids.length) {
      for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
        const env = msg.envelope || {};
        const d = env.date ? new Date(env.date).toISOString().slice(0, 16).replace('T', ' ') : '';
        console.log(`- uid ${msg.uid} · ${d} · ${env.subject || '(không tiêu đề)'}`);
      }
      if (!DRY) {
        await client.messageFlagsRemove(uids, ['\\Flagged'], { uid: true });
        const left = await client.search({ flagged: true }, { uid: true });
        console.log(`Đã bỏ cờ ${uids.length - left.length} thư, còn gắn cờ: ${left.length}`);
      }
    }
  } finally { lock.release(); }
} finally {
  await client.logout().catch(() => {});
}
