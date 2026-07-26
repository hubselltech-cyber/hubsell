/**
 * REGISTRY NCC HÓA ĐƠN — điểm vào duy nhất của module cho code nghiệp vụ.
 *
 * Nơi khác chỉ gọi `getInvoiceProvider(ownerId)`: hàm tự đọc InvoiceConfig cấp
 * shop, chọn adapter theo cột `provider` và bơm credentials vào. Thêm NCC mới =
 * viết thêm một adapter + một dòng trong PROVIDER_FACTORIES.
 */

import { prisma } from "../../prisma";
import { BkavInvoiceProvider } from "./bkav-provider";
import { MisaInvoiceProvider } from "./misa-provider";
import type { InvoiceProvider, ProviderCredentials } from "./types";

export * from "./types";

const PROVIDER_FACTORIES: Record<
  string,
  (creds: ProviderCredentials) => InvoiceProvider
> = {
  MISA: (creds) => new MisaInvoiceProvider(creds),
  BKAV: (creds) => new BkavInvoiceProvider(creds),
  // VIETTEL / VNPT / CUSTOM: chưa có adapter — getInvoiceProvider trả null,
  // nơi gọi hiển thị "NCC chưa được hỗ trợ" thay vì crash.
};

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
  const [shopConfig, channelConfig] = await Promise.all([
    prisma.invoiceConfig.findFirst({ where: { ownerId, channelId: null } }),
    channelId
      ? prisma.invoiceConfig.findFirst({ where: { ownerId, channelId } })
      : Promise.resolve(null),
  ]);
  if (!shopConfig) return null;

  const factory = PROVIDER_FACTORIES[shopConfig.provider];
  if (!factory) return null;

  return factory({
    clientId: shopConfig.clientId,
    secretKey: shopConfig.secretKey,
    apiKey: channelConfig?.apiKey ?? shopConfig.apiKey,
    customApiUrl: shopConfig.customApiUrl,
    partnerCode: shopConfig.partnerCode,
  });
}
