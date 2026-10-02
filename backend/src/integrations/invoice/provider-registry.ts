/**
 * SỔ ĐĂNG KÝ NHÀ CUNG CẤP HÓA ĐƠN — MỘT chỗ khai mọi NCC mà Hubsell biết
 * (02/10/2026, giai đoạn 2 bước 5 — docs/HANG-DOI-BEN.md mục 3.8 "Cổng chờ cho
 * nhà cung cấp khác").
 *
 * Trước đây danh sách NCC nằm rải ở ba nơi (danh sách hợp lệ + danh sách "sắp ra
 * mắt" trong routes/invoice-config.ts, bảng adapter trong index.ts). Nay mọi nơi
 * đọc từ đây, nên THÊM MỘT NCC là:
 *   1. viết một tệp adapter cài InvoiceProvider (kèm bảng khả năng có ghi nguồn);
 *   2. đổi dòng của NCC đó dưới đây sang ACTIVE + gắn `create`;
 *   3. bỏ cờ `soon` của NCC đó ở frontend/src/lib/invoice-vendors.ts;
 *   4. đặt biến môi trường <MÃ>_ALLOW_PUBLISH=1 khi đã được phép phát hành thật.
 * Lõi phát hành, hàng đợi và worker không phải sửa.
 */

import type { InvoiceConfig } from "@prisma/client";

import { MisaInvoiceProvider } from "./misa-provider";
import { isProviderPublishAllowed } from "./publish-switch";
import type { InvoiceProvider, ProviderCredentials } from "./types";

/**
 *   ACTIVE      — có adapter: chọn được, phát hành được (khi công tắc của NCC mở).
 *   NO_ADAPTER  — lưu được cấu hình nhưng chưa có adapter (CUSTOM): nơi gọi báo
 *                 "NCC chưa được hỗ trợ" thay vì crash.
 *   COMING_SOON — hiện ở giao diện dạng "Sắp ra mắt", backend CHẶN lưu cấu hình.
 *   RESERVED    — chỉ giữ chỗ mã, chưa công bố ở đâu, không nhận ở cấu hình.
 */
export type ProviderStatus = "ACTIVE" | "NO_ADAPTER" | "COMING_SOON" | "RESERVED";

export interface ProviderEntry {
  /** Mã NCC — khớp cột InvoiceConfig.provider, InvoiceLog.provider, webhook_events.source. */
  code: string;
  label: string;
  status: ProviderStatus;
  /**
   * Dựng adapter từ NGUYÊN ROW cấu hình của shop (đã giải mã) + bộ khóa đã hòa
   * giải theo gian hàng. Bắt buộc có khi status = ACTIVE.
   */
  create?: (shopConfig: InvoiceConfig, creds: ProviderCredentials) => InvoiceProvider;
}

const ENTRIES: readonly ProviderEntry[] = [
  { code: "MISA", label: "MISA meInvoice", status: "ACTIVE", create: (shopConfig) => new MisaInvoiceProvider(shopConfig) },
  // Tích hợp SAU KHI THƯƠNG MẠI HÓA HUBSELL (chiến lược 25/08/2026: MISA lấy
  // khách trước, có data mới đàm phán từng bên — EasyInvoice là đích nhắm chính).
  { code: "EASYINVOICE", label: "EasyInvoice", status: "COMING_SOON" },
  { code: "MINVOICE", label: "M-Invoice", status: "COMING_SOON" },
  { code: "MATBAO", label: "Mắt Bão", status: "COMING_SOON" },
  { code: "VIETTEL", label: "Viettel SInvoice", status: "COMING_SOON" },
  { code: "VNPT", label: "VNPT Invoice", status: "COMING_SOON" },
  { code: "BKAV", label: "BKAV eHoadon", status: "COMING_SOON" },
  { code: "CUSTOM", label: "Tùy biến", status: "NO_ADAPTER" },
  // Cổng chờ cho sản phẩm hóa đơn của chính Hubsell (anh Trung 01/10/2026). Khi
  // có, Hubtax nối vào qua ĐÚNG hợp đồng adapter như một NCC bên ngoài — không đi
  // cửa sau vào database của Hubsell. Chưa hiện ở giao diện khách.
  { code: "HUBTAX", label: "Hubtax", status: "RESERVED" },
];

const BY_CODE = new Map(ENTRIES.map((e) => [e.code, e]));

export function listProviderEntries(): readonly ProviderEntry[] {
  return ENTRIES;
}

export function getProviderEntry(code: string | null | undefined): ProviderEntry | null {
  return (code && BY_CODE.get(code)) || null;
}

/** Mã NCC được nhận ở form cấu hình (mọi NCC đã công bố, kể cả "sắp ra mắt"). */
export function isListedProvider(code: string): boolean {
  const entry = BY_CODE.get(code);
  return !!entry && entry.status !== "RESERVED";
}

/** NCC đã công bố nhưng chưa nối API — xem trước giao diện được, KHÔNG lưu cấu hình được. */
export function isComingSoonProvider(code: string): boolean {
  return BY_CODE.get(code)?.status === "COMING_SOON";
}

/**
 * Dựng adapter cho một shop. Trả null khi NCC chưa có adapter (hoặc mã lạ) —
 * nơi gọi hiển thị "NCC chưa được hỗ trợ".
 */
export function createProvider(
  shopConfig: InvoiceConfig,
  creds: ProviderCredentials
): InvoiceProvider | null {
  const entry = BY_CODE.get(shopConfig.provider);
  if (!entry || entry.status !== "ACTIVE" || !entry.create) return null;
  return entry.create(shopConfig, creds);
}

/**
 * NCC này đang được phép phát hành? Phải vừa có adapter, vừa bật công tắc riêng
 * của nó (<MÃ>_ALLOW_PUBLISH) — NCC giữ chỗ / sắp ra mắt luôn là KHÔNG dù ai đó
 * lỡ đặt biến môi trường.
 */
export function providerPublishAllowed(
  code: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return BY_CODE.get(code)?.status === "ACTIVE" && isProviderPublishAllowed(code, env);
}
