/**
 * ĐIỂM VÀO của module NCC hóa đơn cho code nghiệp vụ.
 *
 * Nơi khác chỉ gọi `getInvoiceProvider(ownerId)`: hàm tự đọc InvoiceConfig cấp
 * shop, chọn adapter theo cột `provider` và bơm credentials vào. Danh sách NCC
 * và cách thêm NCC mới: xem provider-registry.ts.
 */

import { prisma } from "../../lib/prisma";
import { decryptInvoiceConfig } from "./config-secrets";
import { createProvider } from "./provider-registry";
import type { InvoiceProvider } from "./types";

export * from "./types";

/**
 * Dựng adapter theo cấu hình của shop.
 *
 * @param channelId Truyền vào để ưu tiên api_key RIÊNG của gian hàng đó
 *                  (đối soát hoa hồng theo shop); bỏ trống dùng cấu hình chung.
 * @returns null khi shop chưa cấu hình hoặc chọn NCC chưa có adapter.
 */
export async function getInvoiceProvider(
  ownerId: string,
  channelId?: string
): Promise<InvoiceProvider | null> {
  const [shopRow, channelRow] = await Promise.all([
    prisma.invoiceConfig.findFirst({ where: { ownerId, channelId: null } }),
    channelId
      ? prisma.invoiceConfig.findFirst({ where: { ownerId, channelId } })
      : Promise.resolve(null),
  ]);
  if (!shopRow) return null;
  // Bí mật nằm trong DB ở dạng ĐÃ MÃ HÓA (config-secrets.ts) — giải mã tại đây,
  // điểm vào duy nhất của luồng phát hành, để adapter phía sau chỉ thấy chữ
  // thường. Ném SecretBoxError khi không giải mã được (nơi gọi tự xử lý).
  const shopConfig = decryptInvoiceConfig(shopRow);
  const channelConfig = channelRow ? decryptInvoiceConfig(channelRow) : null;

  return createProvider(shopConfig, {
    clientId: shopConfig.clientId,
    secretKey: shopConfig.secretKey,
    apiKey: channelConfig?.apiKey ?? shopConfig.apiKey,
    customApiUrl: shopConfig.customApiUrl,
    partnerCode: shopConfig.partnerCode,
  });
}
