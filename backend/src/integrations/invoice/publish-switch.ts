/**
 * CÔNG TẮC CHO PHÉP PHÁT HÀNH — RIÊNG TỪNG NHÀ CUNG CẤP (02/10/2026, giai đoạn 2
 * bước 5, docs/HANG-DOI-BEN.md mục 3.8).
 *
 * Mỗi NCC có một biến môi trường `<MÃ NCC>_ALLOW_PUBLISH`. Mặc định CHẶN; chỉ mở
 * khi người vận hành chủ động đặt "1" hoặc "true" sau khi đã xác nhận NCC đó
 * được phép phát hành trên môi trường đang trỏ tới. Nhờ tách riêng, mở một NCC
 * mới không mở theo các NCC khác, và tắt một NCC đang trục trặc không dừng cả hệ thống.
 *
 * MISA giữ nguyên tên biến đang dùng trên prod (MISA_ALLOW_PUBLISH) — lý do phải
 * có chốt này xem misa-safety.ts.
 *
 * Tệp này cố ý KHÔNG import gì: sổ đăng ký NCC lẫn từng adapter đều đọc nó.
 */

/** Tên biến môi trường của công tắc phát hành cho một NCC. */
export function publishSwitchEnvName(providerCode: string): string {
  return `${providerCode.trim().toUpperCase()}_ALLOW_PUBLISH`;
}

/** NCC này đang được phép phát hành? (biến "1" | "true", không phân biệt hoa thường) */
export function isProviderPublishAllowed(
  providerCode: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = env[publishSwitchEnvName(providerCode)]?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}
