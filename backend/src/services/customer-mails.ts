// ============================================================
// THƯ TỰ ĐỘNG GỬI KHÁCH — bảng phân vai anh Trung duyệt 19/09/2026
//
//   Sự kiện                     Gửi từ      Trả lời về
//   Khách đăng ký mới           noreply     support@   (+ báo HQ)
//   Đăng ký 1 ngày chưa nối gian noreply    support@   (worker onboarding-reminder)
//   Mật khẩu vừa được đổi       noreply     support@
//   Kích hoạt / gia hạn gói     billing     billing@
//   Hóa đơn điện tử đã phát hành billing    billing@   (kèm PDF — hq-auto-invoice.ts)
//   Sắp hết hạn (7 ngày, 1 ngày) billing    billing@   (worker subscription-reminder)
//
// File này chỉ lo NỘI DUNG + hàm gửi an toàn. Mọi hàm send* đều fire-and-forget:
// chưa cấu hình SMTP, khách không có email (nhân viên "chủ/nhânviên"), hay SMTP
// lỗi đều KHÔNG được làm gãy đăng ký / đổi mật khẩu / ghi nhận thanh toán.
// Các hàm *Html là hàm thuần để test. Chuỗi do khách nhập (họ tên) luôn qua
// escapeHtml trước khi chèn vào thư.
// ============================================================

import { BUSINESS_TZ_OFFSET_MS } from "../lib/date-range";
import { isMailerConfigured, sendMail, type MailAttachment, type MailRole } from "../lib/mailer";
import { mailHq } from "./hq-mail";

const FRONTEND_URL = (process.env.APP_FRONTEND_URL ?? "http://localhost:3000").replace(/\/+$/, "");

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "dd/MM/yyyy" theo giờ Việt Nam. */
export function vnDateLabel(d: Date): string {
  const t = new Date(d.getTime() + BUSINESS_TZ_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

/** "HH:mm dd/MM/yyyy" theo giờ Việt Nam. */
export function vnDateTimeLabel(d: Date): string {
  const t = new Date(d.getTime() + BUSINESS_TZ_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCHours())}:${p(t.getUTCMinutes())} ${vnDateLabel(d)}`;
}

const money = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}₫`;

/** Khung thư chung — cùng dáng với thư Đặt lại mật khẩu (lib/mailer.ts). */
function shell(input: {
  heading: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
  footnote?: string;
}): string {
  const cta = input.cta
    ? `<p style="text-align:center;margin:24px 0">
      <a href="${input.cta.url}"
         style="background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">
        ${input.cta.label}
      </a>
    </p>`
    : "";
  const footnote = input.footnote
    ? `<p style="color:#888;font-size:13px">${input.footnote}</p>`
    : "";
  return `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 8px">${input.heading}</h2>
    ${input.bodyHtml}
    ${cta}
    ${footnote}
  </div>`;
}

const p = (html: string) => `<p style="color:#444">${html}</p>`;
const row = (label: string, value: string) =>
  `<tr><td style="color:#888;padding:4px 12px 4px 0;white-space:nowrap">${label}</td><td style="color:#222;padding:4px 0"><b>${value}</b></td></tr>`;

// ---------------- 1. Chào khách mới ----------------

export function welcomeEmailHtml(input: { fullName: string; trialDays: number | null }): string {
  const trial =
    input.trialDays && input.trialDays > 0
      ? p(`Tài khoản của bạn đang ở gói dùng thử <b>${input.trialDays} ngày</b>, đầy đủ tính năng.`)
      : "";
  return shell({
    heading: "Chào mừng bạn đến với Hubsell",
    bodyHtml: [
      p(`Xin chào ${escapeHtml(input.fullName)},`),
      p("Tài khoản Hubsell của bạn đã sẵn sàng."),
      trial,
      p("Ba bước để bắt đầu:"),
      `<ol style="color:#444;padding-left:20px;margin:0 0 12px">
        <li style="margin-bottom:6px"><b>Kết nối gian hàng</b> Shopee, TikTok Shop hoặc Lazada — đơn và sản phẩm tự về.</li>
        <li style="margin-bottom:6px"><b>Nhập giá vốn</b> cho sản phẩm để xem lãi / lỗ thật của từng đơn.</li>
        <li><b>Xử lý đơn tập trung</b>: chuẩn bị hàng, in vận đơn của mọi sàn ở một màn hình.</li>
      </ol>`,
    ].join("\n"),
    cta: { label: "Mở Hubsell", url: `${FRONTEND_URL}/channels` },
    footnote: "Cần hỗ trợ? Trả lời thẳng email này, đội ngũ Hubsell sẽ phản hồi bạn.",
  });
}

export function sendWelcomeMail(user: {
  id: string;
  email: string | null;
  fullName: string;
  source: "form" | "google";
  trialDays?: number | null;
}): void {
  void safeSend("welcome", user.email, {
    role: "noreply",
    subject: "Chào mừng bạn đến với Hubsell",
    html: welcomeEmailHtml({ fullName: user.fullName, trialDays: user.trialDays ?? null }),
  });
  void mailHq({
    subject: `[Hubsell] Khách mới: ${user.fullName}`,
    html: `<p>Vừa có tài khoản chủ shop mới${user.source === "google" ? " (đăng ký bằng Google)" : ""}.</p><p>Khách: ${escapeHtml(user.fullName)} (${escapeHtml(user.email ?? "—")})<br/>Mã: ${user.id}</p><p><a href="${FRONTEND_URL}/admin/customers">Xem ở HQ</a></p>`,
  });
}

// ---------------- 1b. Đăng ký 1 ngày mà chưa nối gian ----------------
// Anh Trung 09/10/2026: khách đăng ký bằng email không có SĐT nên không gọi
// được — thư này là kênh duy nhất chạm tới họ. Giọng kể chuyện, MỘT nút, câu
// cuối mời trả lời để biết họ vướng ở đâu (worker onboarding-reminder.ts).

export function connectReminderEmailHtml(input: { fullName: string }): string {
  return shell({
    heading: "Còn một bước nữa là biết tháng này lãi hay lỗ",
    bodyHtml: [
      p(`Xin chào ${escapeHtml(input.fullName)},`),
      p("Hôm qua bạn đã tạo tài khoản Hubsell. Nhưng chưa có gian hàng nào được nối, nên Hubsell chưa có đơn nào để tính cho bạn."),
      p("Nối gian hàng mất khoảng 2 phút: bạn đăng nhập sàn, bấm đồng ý, đơn tự chảy về. Từ lúc đó mỗi đơn về là biết ngay đơn đó lời hay lỗ sau phí sàn, phí ship, giá vốn."),
      p("Bạn không cần nhập gì bằng tay. Nối xong rồi cứ để đó, cuối tháng mở lên là có số."),
    ].join("\n"),
    cta: { label: "Nối gian hàng", url: `${FRONTEND_URL}/channels` },
    footnote:
      "Vướng ở bước nào, hay có điều gì chưa yên tâm? Trả lời thẳng email này, Hubsell đọc và trả lời từng thư.",
  });
}

export const CONNECT_REMINDER_SUBJECT = "Hubsell — Còn một bước nữa là biết tháng này lãi hay lỗ";

/** Trả về true khi đã gửi — worker dựa vào đây để giữ / nhả vé chống trùng. */
export async function sendConnectReminderMail(to: string, input: { fullName: string }): Promise<boolean> {
  return safeSend("connect-reminder", to, {
    role: "noreply",
    subject: CONNECT_REMINDER_SUBJECT,
    html: connectReminderEmailHtml(input),
  });
}

// ---------------- 2. Mật khẩu vừa được đổi ----------------

export function passwordChangedEmailHtml(input: { fullName: string; changedAt: Date }): string {
  return shell({
    heading: "Mật khẩu Hubsell vừa được đổi",
    bodyHtml: [
      p(`Xin chào ${escapeHtml(input.fullName)},`),
      p(`Mật khẩu tài khoản của bạn vừa được đổi lúc <b>${vnDateTimeLabel(input.changedAt)}</b> (giờ Việt Nam).`),
      p("Nếu chính bạn thực hiện, bạn không cần làm gì thêm."),
    ].join("\n"),
    cta: { label: "Không phải tôi — đặt lại mật khẩu", url: `${FRONTEND_URL}/login?mode=forgot` },
    footnote:
      "Nếu không phải bạn, hãy đặt lại mật khẩu ngay bằng nút trên rồi trả lời email này để Hubsell hỗ trợ kiểm tra tài khoản.",
  });
}

export function sendPasswordChangedMail(user: { email: string | null; fullName: string }): void {
  void safeSend("password-changed", user.email, {
    role: "noreply",
    subject: "Hubsell — Mật khẩu của bạn vừa được đổi",
    html: passwordChangedEmailHtml({ fullName: user.fullName, changedAt: new Date() }),
  });
}

// ---------------- 3. Kích hoạt / gia hạn gói ----------------

export interface PlanActivatedMailInput {
  fullName: string;
  planName: string;
  cycleLabel: string;
  amount: number;
  periodStart: Date;
  periodEnd: Date;
  /** Mã chứng từ PackagePayment — khách đọc cho Hubsell khi cần tra soát. */
  paymentId: string;
  /** Mã giao dịch ngân hàng / cổng (nếu có). */
  externalRef: string | null;
  methodLabel: string;
}

export function planActivatedEmailHtml(input: PlanActivatedMailInput): string {
  const paid = input.amount > 0;
  return shell({
    heading: `Gói ${escapeHtml(input.planName)} đã kích hoạt`,
    bodyHtml: [
      p(`Xin chào ${escapeHtml(input.fullName)},`),
      // HQ ghi nhận 0₫ (tặng kỳ, đổi gói không thu thêm) → không nói "thanh toán".
      p(paid ? "Hubsell đã ghi nhận thanh toán của bạn. Chi tiết:" : "Hubsell đã kích hoạt gói cho tài khoản của bạn. Chi tiết:"),
      `<table style="border-collapse:collapse;margin:0 0 12px">
        ${row("Gói", escapeHtml(input.planName))}
        ${row("Chu kỳ", input.cycleLabel)}
        ${paid ? row("Số tiền", money(input.amount)) : ""}
        ${paid ? row("Hình thức", input.methodLabel) : ""}
        ${row("Hiệu lực", `${vnDateLabel(input.periodStart)} – ${vnDateLabel(input.periodEnd)}`)}
        ${row("Mã chứng từ", input.paymentId)}
        ${input.externalRef ? row("Mã giao dịch", escapeHtml(input.externalRef)) : ""}
      </table>`,
    ].join("\n"),
    cta: { label: "Xem gói của tôi", url: `${FRONTEND_URL}/settings/plan` },
    footnote:
      "Cần hóa đơn hoặc thấy số liệu chưa đúng? Trả lời thẳng email này kèm mã chứng từ, bộ phận thanh toán của Hubsell sẽ xử lý.",
  });
}

export function sendPlanActivatedMail(to: string | null, input: PlanActivatedMailInput): void {
  void safeSend("plan-activated", to, {
    role: "billing",
    subject: `Hubsell — Gói ${input.planName} đã kích hoạt đến ${vnDateLabel(input.periodEnd)}`,
    html: planActivatedEmailHtml(input),
  });
}

// ---------------- 3b. Hóa đơn điện tử đã phát hành (kèm PDF) ----------------

export interface InvoiceIssuedMailInput {
  /** Tên người nhận thư (tên tài khoản) — KHÁC tên in trên hóa đơn (buyerName). */
  fullName: string;
  buyerName: string;
  buyerTaxCode: string | null;
  invoiceNo: string;
  /** Ký hiệu hóa đơn (VD "1C26THB") — khách cần khi tra cứu trên cổng CQT. */
  invoiceSeries: string | null;
  /** Mã tra cứu meInvoice (TransactionID) — tra bản gốc tại cổng meInvoice. */
  lookupCode: string | null;
  itemName: string;
  amount: number;
  /** Ngày phát hành / ngày thu tiền. */
  issuedAt: Date;
  /** Có PDF đính kèm hay không — không có thì thư chỉ hướng dẫn tra cứu. */
  hasPdf: boolean;
}

export const MEINVOICE_LOOKUP_URL = "https://www.meinvoice.vn/tra-cuu/";

export function invoiceIssuedSubject(input: { invoiceNo: string; itemName: string }): string {
  return `Hubsell — Hóa đơn điện tử số ${input.invoiceNo} (${input.itemName})`;
}

export function invoiceIssuedEmailHtml(input: InvoiceIssuedMailInput): string {
  return shell({
    heading: `Hóa đơn điện tử số ${escapeHtml(input.invoiceNo)}`,
    bodyHtml: [
      p(`Xin chào ${escapeHtml(input.fullName)},`),
      p(
        input.hasPdf
          ? "Hubsell đã phát hành hóa đơn điện tử cho khoản thanh toán của bạn. Bản thể hiện (PDF, đã ký số) đính kèm thư này."
          : "Hubsell đã phát hành hóa đơn điện tử cho khoản thanh toán của bạn. Bạn tra bản thể hiện bằng mã tra cứu bên dưới."
      ),
      `<table style="border-collapse:collapse;margin:0 0 12px">
        ${row("Số hóa đơn", escapeHtml(input.invoiceNo))}
        ${input.invoiceSeries ? row("Ký hiệu", escapeHtml(input.invoiceSeries)) : ""}
        ${row("Người mua", escapeHtml(input.buyerName))}
        ${input.buyerTaxCode ? row("Mã số thuế", escapeHtml(input.buyerTaxCode)) : ""}
        ${row("Nội dung", escapeHtml(input.itemName))}
        ${row("Tổng tiền", money(input.amount))}
        ${row("Ngày", vnDateLabel(input.issuedAt))}
        ${input.lookupCode ? row("Mã tra cứu", escapeHtml(input.lookupCode)) : ""}
      </table>`,
      input.lookupCode
        ? p(
            `Tra cứu bản gốc tại <a href="${MEINVOICE_LOOKUP_URL}" style="color:#555">${MEINVOICE_LOOKUP_URL}</a> bằng mã tra cứu ở trên.`
          )
        : "",
    ].join("\n"),
    cta: { label: "Xem gói của tôi", url: `${FRONTEND_URL}/settings/plan` },
    footnote:
      "Thông tin trên hóa đơn chưa đúng (tên đơn vị, mã số thuế, địa chỉ)? Trả lời thẳng email này trong 3 ngày để Hubsell lập hóa đơn điều chỉnh. Cập nhật thông tin xuất hóa đơn cho lần sau tại Cấu hình → Gói dịch vụ.",
  });
}

/** Trả về true khi đã gửi — luồng tự động dựa vào đây để ghi mốc gửi / lỗi. */
export async function sendInvoiceIssuedMail(
  to: string,
  input: InvoiceIssuedMailInput,
  attachments?: MailAttachment[]
): Promise<boolean> {
  return safeSend("invoice-issued", to, {
    role: "billing",
    subject: invoiceIssuedSubject(input),
    html: invoiceIssuedEmailHtml(input),
    attachments,
  });
}

// ---------------- 4. Sắp hết hạn ----------------

export interface RenewalReminderMailInput {
  fullName: string;
  planName: string;
  daysLeft: number;
  periodEnd: Date;
  isTrial: boolean;
}

export function renewalReminderSubject(input: RenewalReminderMailInput): string {
  const what = input.isTrial ? "Kỳ dùng thử" : `Gói ${input.planName}`;
  return input.daysLeft <= 1
    ? `Hubsell — ${what} hết hạn ngày mai (${vnDateLabel(input.periodEnd)})`
    : `Hubsell — ${what} còn ${input.daysLeft} ngày (hết hạn ${vnDateLabel(input.periodEnd)})`;
}

export function renewalReminderEmailHtml(input: RenewalReminderMailInput): string {
  const when = input.daysLeft <= 1 ? "<b>ngày mai</b>" : `sau <b>${input.daysLeft} ngày</b>`;
  const lead = input.isTrial
    ? `Kỳ dùng thử gói <b>${escapeHtml(input.planName)}</b> của bạn sẽ hết hạn ${when}, vào ngày <b>${vnDateLabel(input.periodEnd)}</b>.`
    : `Gói <b>${escapeHtml(input.planName)}</b> của bạn sẽ hết hạn ${when}, vào ngày <b>${vnDateLabel(input.periodEnd)}</b>.`;
  return shell({
    heading: input.isTrial ? "Kỳ dùng thử sắp hết hạn" : "Gói Hubsell sắp hết hạn",
    bodyHtml: [
      p(`Xin chào ${escapeHtml(input.fullName)},`),
      p(lead),
      p(
        input.isTrial
          ? "Chọn gói trước ngày này để việc đồng bộ đơn, tồn kho và báo cáo lãi / lỗ không bị gián đoạn. Dữ liệu của bạn vẫn được giữ nguyên."
          : "Gia hạn trước ngày này để việc đồng bộ đơn, tồn kho và báo cáo lãi / lỗ không bị gián đoạn. Gia hạn sớm không mất ngày: kỳ mới được nối tiếp từ cuối kỳ hiện tại."
      ),
    ].join("\n"),
    cta: { label: input.isTrial ? "Chọn gói" : "Gia hạn ngay", url: `${FRONTEND_URL}/settings/plan` },
    footnote: "Đã thanh toán rồi? Bỏ qua email này. Cần hỗ trợ về thanh toán, trả lời thẳng email này.",
  });
}

/** Trả về true khi đã gửi — worker dựa vào đây để giữ / nhả vé chống trùng. */
export async function sendRenewalReminderMail(
  to: string,
  input: RenewalReminderMailInput
): Promise<boolean> {
  return safeSend("renewal-reminder", to, {
    role: "billing",
    subject: renewalReminderSubject(input),
    html: renewalReminderEmailHtml(input),
  });
}

// ---------------- Tiện ích ----------------

async function safeSend(
  kind: string,
  to: string | null | undefined,
  message: { role: MailRole; subject: string; html: string; attachments?: MailAttachment[] }
): Promise<boolean> {
  try {
    if (!to || !isMailerConfigured()) return false;
    await sendMail({ to, ...message });
    return true;
  } catch (err) {
    console.error(`[Customer mail] ${kind} → ${to} lỗi:`, (err as Error).message);
    return false;
  }
}
