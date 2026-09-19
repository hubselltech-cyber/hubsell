/**
 * BÍ MẬT CỦA CẤU HÌNH HÓA ĐƠN — nối lib/secret-box vào 2 bảng (19/09/2026):
 *   · InvoiceConfig         — cấu hình của TỪNG SHOP (mật khẩu meInvoice của khách…)
 *   · PlatformInvoiceConfig — cấu hình hóa đơn của CHÍNH công ty Hubsell (HQ)
 *
 * QUY ƯỚC DUY NHẤT (đừng phá — lệch một chỗ là gửi bản mã sang MISA làm mật khẩu):
 *   ĐỌC để DÙNG bí mật  → luôn qua decryptInvoiceConfig / decryptPlatformInvoiceConfig.
 *   GHI bí mật          → luôn qua encryptInvoiceSecret / encryptPlatformInvoiceSecret.
 * Đọc chỉ để kiểm "đã có chưa" (Boolean) thì không cần giải mã.
 * Thêm cột bí mật mới = thêm vào mảng *_SECRET_FIELDS bên dưới, hết.
 */

import { prisma } from "../../lib/prisma";
import {
  decryptSecret,
  encryptSecret,
  needsEncryption,
  secretBoxEnabled,
} from "../../lib/secret-box";

export const INVOICE_CONFIG_SECRET_FIELDS = [
  "secretKey",
  "apiKey",
  "meinvoicePassword",
  "esignSecretKey",
  "esignPassword",
  "posSecretKey",
] as const;
export type InvoiceConfigSecretField = (typeof INVOICE_CONFIG_SECRET_FIELDS)[number];

export const PLATFORM_INVOICE_SECRET_FIELDS = [
  "meinvoicePassword",
  "esignSecretKey",
  "esignPassword",
] as const;
export type PlatformInvoiceSecretField = (typeof PLATFORM_INVOICE_SECRET_FIELDS)[number];

/**
 * Ngữ cảnh gắn vào bản mã: bảng + CHỦ SHOP + cột. Gắn theo ownerId (bất biến,
 * biết ngay lúc tạo hàng) chứ không theo id hàng — bản mã chép sang shop khác
 * hay cột khác đều không giải mã được.
 */
function invoiceAad(ownerId: string, field: InvoiceConfigSecretField): string {
  return `InvoiceConfig:${ownerId}:${field}`;
}
function platformAad(field: PlatformInvoiceSecretField): string {
  return `PlatformInvoiceConfig:${field}`;
}

export function encryptInvoiceSecret(
  ownerId: string,
  field: InvoiceConfigSecretField,
  plain: string | null | undefined
): string | null {
  return encryptSecret(plain, invoiceAad(ownerId, field));
}

export function encryptPlatformInvoiceSecret(
  field: PlatformInvoiceSecretField,
  plain: string | null | undefined
): string | null {
  return encryptSecret(plain, platformAad(field));
}

/** Bản sao của hàng InvoiceConfig với các cột bí mật (có mặt trong hàng) đã GIẢI MÃ. */
export function decryptInvoiceConfig<
  T extends { ownerId: string } & Partial<Record<InvoiceConfigSecretField, string | null>>,
>(row: T): T {
  const out: T = { ...row };
  for (const f of INVOICE_CONFIG_SECRET_FIELDS) {
    if (typeof row[f] === "string") {
      (out as Record<InvoiceConfigSecretField, string | null>)[f] = decryptSecret(
        row[f],
        invoiceAad(row.ownerId, f)
      );
    }
  }
  return out;
}

/**
 * Bản KHOAN DUNG cho màn hình cấu hình: ô nào không giải mã được thì coi như
 * CHƯA CÓ (null) thay vì ném lỗi, kèm danh sách ô hỏng. Trang cấu hình phải
 * luôn mở được — đó là lối duy nhất để chủ shop nhập lại mật khẩu khi bí mật cũ
 * không còn đọc được. TUYỆT ĐỐI không dùng bản này cho luồng gọi NCC.
 */
export function decryptInvoiceConfigLenient<
  T extends { ownerId: string } & Partial<Record<InvoiceConfigSecretField, string | null>>,
>(row: T): { row: T; unreadable: InvoiceConfigSecretField[] } {
  const out: T = { ...row };
  const unreadable: InvoiceConfigSecretField[] = [];
  for (const f of INVOICE_CONFIG_SECRET_FIELDS) {
    if (typeof row[f] !== "string") continue;
    try {
      (out as Record<InvoiceConfigSecretField, string | null>)[f] = decryptSecret(
        row[f],
        invoiceAad(row.ownerId, f)
      );
    } catch {
      (out as Record<InvoiceConfigSecretField, string | null>)[f] = null;
      unreadable.push(f);
    }
  }
  return { row: out, unreadable };
}

/** Bản sao của hàng PlatformInvoiceConfig với các cột bí mật đã GIẢI MÃ. */
export function decryptPlatformInvoiceConfig<
  T extends Partial<Record<PlatformInvoiceSecretField, string | null>>,
>(row: T): T {
  const out: T = { ...row };
  for (const f of PLATFORM_INVOICE_SECRET_FIELDS) {
    if (typeof row[f] === "string") {
      (out as Record<PlatformInvoiceSecretField, string | null>)[f] = decryptSecret(
        row[f],
        platformAad(f)
      );
    }
  }
  return out;
}

export interface SecretBackfillReport {
  scanned: number;
  encrypted: number;
  /** Ô không xử lý được (VD bản mã của khóa đã bị gỡ khỏi env) — giữ nguyên, không ghi đè. */
  failed: number;
}

/**
 * CHUYỂN ĐỔI DỮ LIỆU CŨ — chạy lúc khởi động khi đã có khóa: mã hóa mọi ô còn
 * chữ thường, và mã hóa LẠI ô đang dùng khóa cũ (sau khi xoay khóa).
 *
 * An toàn để chạy lặp + chạy song song nhiều tiến trình:
 *   · Bước kiểm: mã hóa xong GIẢI MÃ THỬ, khớp nguyên văn mới ghi — không bao giờ
 *     ghi xuống một bản mã mà chính mình không đọc lại được.
 *   · Ghi có điều kiện `where: {id, <cột>: <giá trị cũ>}` — tiến trình khác (hoặc
 *     chủ shop) vừa đổi ô đó thì lệnh ghi này trượt, không đè lên dữ liệu mới.
 *   · Ô lỗi thì bỏ qua + đếm, không dừng cả lượt, không ghi đè.
 * Log CHỈ in số đếm — không in giá trị, không in ownerId kèm tên cột.
 */
export async function backfillInvoiceSecrets(): Promise<SecretBackfillReport> {
  const report: SecretBackfillReport = { scanned: 0, encrypted: 0, failed: 0 };
  if (!secretBoxEnabled()) return report;

  const rows = await prisma.invoiceConfig.findMany({
    select: {
      id: true,
      ownerId: true,
      secretKey: true,
      apiKey: true,
      meinvoicePassword: true,
      esignSecretKey: true,
      esignPassword: true,
      posSecretKey: true,
    },
  });
  for (const row of rows) {
    for (const f of INVOICE_CONFIG_SECRET_FIELDS) {
      const stored = row[f];
      if (!stored) continue;
      report.scanned += 1;
      if (!needsEncryption(stored)) continue;
      try {
        const aad = invoiceAad(row.ownerId, f);
        const plain = decryptSecret(stored, aad);
        const next = encryptSecret(plain, aad);
        if (!next || decryptSecret(next, aad) !== plain) throw new Error("roundtrip");
        const r = await prisma.invoiceConfig.updateMany({
          where: { id: row.id, [f]: stored },
          data: { [f]: next },
        });
        report.encrypted += r.count;
      } catch {
        report.failed += 1;
      }
    }
  }

  const platformRows = await prisma.platformInvoiceConfig.findMany({
    select: { id: true, meinvoicePassword: true, esignSecretKey: true, esignPassword: true },
  });
  for (const row of platformRows) {
    for (const f of PLATFORM_INVOICE_SECRET_FIELDS) {
      const stored = row[f];
      if (!stored) continue;
      report.scanned += 1;
      if (!needsEncryption(stored)) continue;
      try {
        const aad = platformAad(f);
        const plain = decryptSecret(stored, aad);
        const next = encryptSecret(plain, aad);
        if (!next || decryptSecret(next, aad) !== plain) throw new Error("roundtrip");
        const r = await prisma.platformInvoiceConfig.updateMany({
          where: { id: row.id, [f]: stored },
          data: { [f]: next },
        });
        report.encrypted += r.count;
      } catch {
        report.failed += 1;
      }
    }
  }
  return report;
}
