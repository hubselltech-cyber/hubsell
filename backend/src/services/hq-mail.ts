// ============================================================
// THƯ BÁO NỘI BỘ HQ — gửi tới mọi tài khoản điều hành nền tảng có email.
//
// HQ không có chuông nên email là kênh chạm tới điện thoại anh Trung. Tiêu đề
// LUÔN mở đầu "[Hubsell]" — hộp thư Zoho có bộ lọc theo chuỗi này để gom thư
// nội bộ vào thư mục Hệ thống. Fire-and-forget: lỗi SMTP hay chưa cấu hình
// đều không được làm hỏng luồng nghiệp vụ gọi nó.
// ============================================================

import { prisma } from "../lib/prisma";
import { isMailerConfigured, sendMail } from "../lib/mailer";

export async function mailHq(input: { subject: string; html: string }): Promise<void> {
  try {
    if (!isMailerConfigured()) return;
    const admins = await prisma.user.findMany({
      where: { isPlatformAdmin: true, email: { not: null } },
      select: { email: true },
    });
    await Promise.allSettled(
      admins.map((a) =>
        sendMail({
          to: a.email!,
          subject: input.subject,
          html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">${input.html}</div>`,
        })
      )
    );
  } catch (err) {
    console.error("[HQ mail] Gửi lỗi:", (err as Error).message);
  }
}
