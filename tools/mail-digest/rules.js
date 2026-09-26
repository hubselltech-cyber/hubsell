// Bang uu tien cho ban tom tat thu hang ngay cua Hubsell.
// Sua o day khi them san / doi tac moi. Thu tu kiem tra: tu tren xuong, khop cai nao truoc thi lay.
//
// Muc uu tien:
//   P0  Ha tang can xu ly ngay  (Render, Supabase, MISA, Zoho, Vercel, payOS bao loi / het han / vuot han muc)
//   P1  San & chinh sach        (Shopee, Lazada, TikTok, Apple, Google Play, MISA: duyet app, doi API, chinh sach)
//   P1  Khach hang              (support@, billing@ -> nguoi that hoi)
//   P2  Phap ly & nha nuoc      (DVC, dang ky kinh doanh, Cuc SHTT, Bo Cong Thuong, D&B)
//   P2  Hoa don nha cung cap    (Stripe/Render, Zoho Books, Supabase invoice)
//   P3  He thong Hubsell        (thu [Hubsell] app tu gui)
//   P4  Ban tin / khac          (chi dem, khong liet ke chi tiet)
//   SKIP                        (DMARC report, thu tu chinh minh gui test)

const INFRA_DOMAINS = ['render.com', 'supabase.com', 'supabase.io', 'zohoaccounts.com', 'zohostore.com', 'zoho.com', 'vercel.com', 'payos.vn', 'misa.vn', 'hostinger.com', 'matbao.net', 'matbao.vn', 'matbao.com'];
const INFRA_ALERT_WORDS = ['action required', 'failed', 'failure', 'exceeded', 'restriction', 'invalid payment', 'bandwidth', 'quota', 'suspend', 'expired', 'expiring', 'expire', 'security', 'vulnerab', 'incident', 'outage', 'down', 'verification', 'verify', 'cảnh báo', 'lỗi', 'hết hạn', 'gia hạn', 'tạm ngưng'];

const MARKET_DOMAINS = ['shopee', 'lazada', 'tiktok', 'byteintl.com', 'tiktokshop', 'apple.com', 'google.com', 'android.com', 'misa.vn'];
const MARKET_POLICY_WORDS = ['policy', 'chính sách', 'deprecat', 'sunset', 'retire', 'review', 'approved', 'rejected', 'reject', 'duyệt', 'từ chối', 'api', 'app', 'isv', 'partner', 'developer', 'update', 'change', 'thay đổi', 'compliance', 'terms', 'điều khoản', 'ticket', 'enquiry', 'reply', 'phản hồi', 'verification', 'xác minh', 'account'];
const NEWSLETTER_WORDS = ['weekly update', 'newsletter', 'digest', 'webinar', 'promo', 'khuyến mãi', 'tips', 'what\'s new', 'new in ', 'introducing', 'unsubscribe'];

const LEGAL_DOMAINS = ['gov.vn', 'dichvucong', 'dangkyquamang', 'dangkykinhdoanh', 'ipvietnam', 'moit', 'dnb.com', 'crif', 'bocongthuong', 'dvctt'];
const INVOICE_WORDS = ['invoice', 'receipt', 'hóa đơn', 'biên lai', 'biên nhận', 'payment received', 'thanh toán thành công', 'subscription'];
const INVOICE_DOMAINS = ['stripe.com', 'payments@zohocorp.com', 'billing@', 'invoice@'];

const MARKETING_SENDERS = ['ads-service.tiktok.com', 'hello@render.com', 'dx@render.com', 'james.ho@zohocorp.com', 'marketing@', 'newsletter@', 'news@', 'noreply@medium.com'];

function has(text, words) {
  const t = text.toLowerCase();
  return words.some((w) => t.includes(w));
}

/**
 * @param {object} m  { from, to, cc, subject, folder, account }
 * @returns {{ level: 'P0'|'P1'|'P2'|'P3'|'P4'|'SKIP', group: string }}
 */
export function classify(m) {
  const from = (m.from || '').toLowerCase();
  const subject = (m.subject || '').toLowerCase();
  const to = `${m.to || ''} ${m.cc || ''}`.toLowerCase();
  const folder = (m.folder || '').toLowerCase();
  const fs = `${from} ${subject}`;

  // Bo qua
  if (from.includes('dmarc')) return { level: 'SKIP', group: 'DMARC' };
  if (folder === 'dmarc') return { level: 'SKIP', group: 'DMARC' };

  // Thu app Hubsell tu gui cho HQ
  if (subject.includes('[hubsell]') && (from.includes('@hubsell.') || from.includes('hubselltech@gmail.com'))) {
    return { level: 'P3', group: 'Hệ thống Hubsell' };
  }

  // Thong bao van hanh cua san (khach noi app, ticket tu dong dong) -> P3, khong phai chinh sach
  if (subject.includes('new subscription on tiktok partner center')) return { level: 'P3', group: 'Sàn: khách nối app (TikTok Partner Center)' };

  // Google Accounts: canh bao bao mat -> P1, con lai (YouTube, goi y) -> P4
  if (from.includes('accounts.google.com')) {
    if (has(subject, ['bảo mật', 'security', 'đăng nhập', 'sign-in', 'mật khẩu', 'password'])) return { level: 'P1', group: 'Bảo mật tài khoản Google' };
    return { level: 'P4', group: 'Khác' };
  }

  // Thu bi doi (gui khong toi) -> can biet ngay
  if (from.includes('mailer-daemon') || from.includes('postmaster') || subject.includes('undelivered') || subject.includes('delivery status notification')) {
    return { level: 'P1', group: 'Thư bị dội (gửi không tới)' };
  }

  // Phap ly & nha nuoc & D&B: xet TRUOC thu muc, vi ho hay gui toi support@
  if (has(from, LEGAL_DOMAINS) || has(subject, ['hồ sơ', 'đăng ký doanh nghiệp', 'nhãn hiệu', 'd-u-n-s', 'duns', 'bộ công thương', 'giấy chứng nhận', 'dịch vụ công'])) {
    return { level: 'P2', group: 'Pháp lý & nhà nước' };
  }

  // San & doi tac gui toi support@ cung xet truoc
  const marketHit = has(from, MARKET_DOMAINS.filter((d) => d !== 'google.com'));
  const isCustomerFolder = folder === 'hỗ trợ' || folder === 'thanh toán' || to.includes('support@hubsell') || to.includes('billing@hubsell');
  if (isCustomerFolder && !marketHit && !has(from, INFRA_DOMAINS) && !has(from, MARKETING_SENDERS)) {
    if (folder === 'thanh toán' || to.includes('billing@hubsell')) return { level: 'P1', group: 'Khách hàng về tiền (billing@)' };
    return { level: 'P1', group: 'Khách hàng hỏi (support@)' };
  }

  // Marketing ro rang -> P4
  if (has(from, MARKETING_SENDERS) || folder === 'bản tin') return { level: 'P4', group: 'Bản tin' };

  // Ha tang: canh bao -> P0, con lai -> P4 (thong bao thuong)
  if (has(from, INFRA_DOMAINS) && !has(from, MARKET_DOMAINS.filter((d) => d !== 'misa.vn'))) {
    if (has(subject, INVOICE_WORDS) || has(from, INVOICE_DOMAINS)) return { level: 'P2', group: 'Hóa đơn nhà cung cấp' };
    if (from.includes('misa.vn')) {
      if (has(subject, INFRA_ALERT_WORDS)) return { level: 'P0', group: 'Hạ tầng cần xử lý' };
      return { level: 'P1', group: 'Sàn & đối tác: MISA' };
    }
    if (has(subject, INFRA_ALERT_WORDS)) return { level: 'P0', group: 'Hạ tầng cần xử lý' };
    if (has(subject, NEWSLETTER_WORDS)) return { level: 'P4', group: 'Bản tin' };
    return { level: 'P4', group: 'Hạ tầng: thông báo thường' };
  }

  // Hoa don
  if (has(from, INVOICE_DOMAINS) || (has(subject, INVOICE_WORDS) && !has(from, MARKET_DOMAINS))) {
    return { level: 'P2', group: 'Hóa đơn nhà cung cấp' };
  }

  // San & doi tac
  if (has(from, MARKET_DOMAINS)) {
    if (has(subject, NEWSLETTER_WORDS) && !has(subject, ['policy', 'chính sách', 'deprecat', 'api'])) return { level: 'P4', group: 'Bản tin' };
    const name = from.includes('shopee') ? 'Shopee'
      : from.includes('lazada') ? 'Lazada'
      : (from.includes('tiktok') || from.includes('byteintl')) ? 'TikTok'
      : from.includes('apple') ? 'Apple'
      : (from.includes('google') || from.includes('android')) ? 'Google'
      : 'MISA';
    if (has(subject, MARKET_POLICY_WORDS)) return { level: 'P1', group: `Sàn & chính sách: ${name}` };
    return { level: 'P1', group: `Sàn & đối tác: ${name}` };
  }

  // Thu nguoi that khong thuoc nhom nao -> P1 de khong bo sot
  if (!from.includes('noreply') && !from.includes('no-reply') && !from.includes('notification') && !from.includes('donotreply')) {
    return { level: 'P1', group: 'Người gửi khác (cần xem)' };
  }

  return { level: 'P4', group: 'Khác' };
}

export const LEVEL_ORDER = ['P0', 'P1', 'P2', 'P3', 'P4'];
export const LEVEL_TITLE = {
  P0: 'P0 · Hạ tầng cần xử lý ngay',
  P1: 'P1 · Sàn, chính sách, khách hàng',
  P2: 'P2 · Pháp lý & hóa đơn',
  P3: 'P3 · Hệ thống Hubsell',
  P4: 'P4 · Bản tin / thông báo thường (chỉ đếm)',
};
