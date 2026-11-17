// Bo co (\Flagged) cac thu dang treo trong Hop thu den Zoho theo nguoi gui.
// Chay:  node unflag.js --from render.com            -> chi liet ke (khong doi gi)
//        node unflag.js --from render.com --apply    -> bo co that
// Chi go co, khong xoa, khong chuyen thu muc, khong danh dau da doc.

import 'dotenv/config';
import { ImapFlow } from 'imapflow';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const FROM = (opt('--from') || '').toLowerCase();
const SKIP = (opt('--skip-subject') || '').toLowerCase(); // giu co cho thu co tieu de chua chuoi nay
const APPLY = args.includes('--apply');
if (!FROM) { console.error('Thieu --from <ten mien hoac dia chi nguoi gui>'); process.exit(1); }

const clean = (s) => (s || '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');
const client = new ImapFlow({
  host: process.env.ZOHO_IMAP_HOST || 'imappro.zoho.com', port: 993, secure: true,
  auth: { user: process.env.ZOHO_IMAP_USER, pass: clean(process.env.ZOHO_IMAP_PASS) }, logger: false,
});

await client.connect();
const lock = await client.getMailboxLock('INBOX');
try {
  const uids = await client.search({ flagged: true }, { uid: true });
  const hit = [];
  if (uids.length) {
    for await (const msg of client.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
      const from = (msg.envelope?.from || []).map((a) => a.address || '').join(',').toLowerCase();
      const subj = (msg.envelope?.subject || '').toLowerCase();
      const match = from.includes(FROM) && !(SKIP && subj.includes(SKIP));
      console.log(`${match ? '[x]' : '[ ]'} uid ${msg.uid} · ${new Date(msg.envelope?.date).toISOString().slice(0, 16)} · ${from} · ${msg.envelope?.subject}`);
      if (match) hit.push(msg.uid);
    }
  }
  console.log(`\nDang gan co: ${uids.length} · khop "${FROM}": ${hit.length}`);
  if (APPLY && hit.length) {
    await client.messageFlagsRemove(hit, ['\\Flagged'], { uid: true });
    const left = await client.search({ flagged: true }, { uid: true });
    console.log(`Da bo co ${hit.length} thu. Con gan co: ${left.length}`);
  } else if (!APPLY) {
    console.log('Chay thu, chua doi gi. Them --apply de bo co.');
  }
} finally {
  lock.release();
  await client.logout().catch(() => {});
}
