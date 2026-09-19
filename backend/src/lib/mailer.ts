// ============================================================
// GỬI EMAIL HỆ THỐNG (nodemailer / SMTP)
//
// Dùng cho luồng Quên mật khẩu (và các thông báo sau này). Cấu hình qua env:
//   SMTP_HOST, SMTP_PORT (587 STARTTLS / 465 TLS), SMTP_USER, SMTP_PASS,
//   MAIL_FROM (mặc định "Hubsell <SMTP_USER>").
// Gmail cá nhân dùng được ngay với App Password (bật 2FA → App passwords).
// CHƯA cấu hình → isMailerConfigured() = false, route trả 503 nói rõ thiếu gì
// thay vì nuốt lỗi im lặng (đúng pattern Lazada/Shopee config).
// ============================================================

import nodemailer from "nodemailer";

export function isMailerConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
  );
}

function getTransport() {
  const port = Number(process.env.SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = TLS ngay; 587 = STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

/**
 * VAI NGƯỜI GỬI (anh Trung duyệt 19/09/2026) — khách nhìn địa chỉ gửi là biết
 * thư thuộc việc gì, và bấm Trả lời là về đúng hộp có người đọc:
 *   · noreply — thư tự động về tài khoản / bảo mật (chào khách mới, quên / đổi
 *     mật khẩu). Gửi từ MAIL_FROM_NOREPLY, Trả lời về MAIL_REPLY_TO_SUPPORT.
 *   · billing — mọi thư dính tới tiền (kích hoạt gói, nhắc gia hạn). Gửi từ
 *     MAIL_FROM_BILLING, Trả lời về chính địa chỉ đó (khách hay hỏi hóa đơn).
 *   · vắng mặt — thư nội bộ báo HQ, giữ MAIL_FROM như cũ.
 * Env vai chưa đặt → rơi về MAIL_FROM → `Hubsell <SMTP_USER>`: deploy code
 * trước, đổi SMTP sang Zoho sau, không có khoảng hở. Máy chủ SMTP phải cho tài
 * khoản đăng nhập gửi bằng các địa chỉ này (Zoho: bí danh của cùng hộp thư;
 * Gmail sẽ tự thay From bằng tài khoản đăng nhập — Reply-To vẫn giữ).
 */
export type MailRole = "noreply" | "billing";

const DEFAULT_SUPPORT_REPLY_TO = "support@hubsell.vn";
const DEFAULT_BILLING_REPLY_TO = "billing@hubsell.vn";

/** Người gửi + địa chỉ trả lời theo vai — hàm thuần (đọc env) để test. */
export function resolveSender(role?: MailRole): { from: string; replyTo?: string } {
  const fallback = process.env.MAIL_FROM ?? `Hubsell <${process.env.SMTP_USER}>`;
  if (role === "noreply") {
    return {
      from: process.env.MAIL_FROM_NOREPLY ?? fallback,
      replyTo: process.env.MAIL_REPLY_TO_SUPPORT ?? DEFAULT_SUPPORT_REPLY_TO,
    };
  }
  if (role === "billing") {
    return {
      from: process.env.MAIL_FROM_BILLING ?? fallback,
      replyTo: process.env.MAIL_REPLY_TO_BILLING ?? DEFAULT_BILLING_REPLY_TO,
    };
  }
  return { from: fallback };
}

/** Gửi một email HTML. Ném lỗi để tầng route quyết định cách phản hồi. */
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  role?: MailRole;
}): Promise<void> {
  if (!isMailerConfigured()) {
    throw new Error(
      "Chưa cấu hình SMTP (SMTP_HOST/SMTP_USER/SMTP_PASS) — không gửi được email"
    );
  }
  const { role, ...message } = opts;
  await getTransport().sendMail({ ...resolveSender(role), ...message });
}

/** Email đặt lại mật khẩu — nội dung tối giản, nút bấm + link dự phòng. */
export function resetPasswordEmailHtml(fullName: string, resetUrl: string): string {
  return `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="margin:0 0 8px">Đặt lại mật khẩu Hubsell</h2>
    <p style="color:#444">Xin chào ${fullName},</p>
    <p style="color:#444">
      Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.
      Bấm nút bên dưới trong vòng <b>30 phút</b> để tạo mật khẩu mới:
    </p>
    <p style="text-align:center;margin:24px 0">
      <a href="${resetUrl}"
         style="background:#18181b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;display:inline-block">
        Đặt lại mật khẩu
      </a>
    </p>
    <p style="color:#888;font-size:13px">
      Nếu nút không bấm được, mở link: <br/>
      <a href="${resetUrl}" style="color:#555;word-break:break-all">${resetUrl}</a>
    </p>
    <p style="color:#888;font-size:13px">
      Không phải bạn yêu cầu? Bỏ qua email này — mật khẩu của bạn không thay đổi.
    </p>
  </div>`;
}
