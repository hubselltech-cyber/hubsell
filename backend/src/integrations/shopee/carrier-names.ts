// ============================================================
// HỎI LẠI TÊN HÃNG CỦA ĐƠN SHOPEE CHƯA RÕ HÃNG (09/11/2026)
// docs/TU-CHUAN-BI-HANG.md mục 3.1
//
// Đơn Shopee vừa về có lúc chưa kèm shipping_carrier (trống / "Đang Điều Phối
// ĐVVC"). Làn tự chuẩn bị hàng không được coi đơn đó là đơn thường — 2 đơn SPX
// Instant gian ANO đã bị máy chuẩn bị theo đường này (anh Trung báo 09/11). Trước
// khi chọn đơn, làn gọi hàm này: MỘT lệnh get_order_detail cho tối đa 50 đơn,
// ghi tên hãng biết được xuống DB. Đơn vẫn chưa rõ thì máy chờ lượt sau.
// ============================================================

import { ShippingStatus, type Carrier, type Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { isCarrierUnknown } from "../../lib/auto-arrange";
import { carrierFromName } from "../../services/shipping";
import { getOrderCarrierNames, type ShopeeOrderCarrierInfo } from "./client";
import { getValidShopeeAccessToken } from "./service";

/** Trần order_sn một lệnh get_order_detail của Shopee → một lượt hỏi tối đa ngần này đơn. */
export const CARRIER_REFRESH_MAX = 50;

export type CarrierNameSource = "carrier" | "checkout";

/**
 * Tên dùng để nhận diện hỏa tốc: hãng sàn đã gán (shipping_carrier) trước; chưa
 * có thì kênh khách chọn lúc đặt (checkout_shipping_carrier — "Hỏa Tốc", "Nhanh"…).
 * Cả hai trống / còn là chữ giữ chỗ → null (vẫn chưa rõ).
 */
export function pickCarrierName(
  info: Pick<ShopeeOrderCarrierInfo, "shipping_carrier" | "checkout_shipping_carrier">
): { name: string; source: CarrierNameSource } | null {
  const real = info.shipping_carrier?.trim();
  if (real && !isCarrierUnknown(real)) return { name: real, source: "carrier" };
  const chosen = info.checkout_shipping_carrier?.trim();
  if (chosen && !isCarrierUnknown(chosen)) return { name: chosen, source: "checkout" };
  return null;
}

export interface CarrierRefreshResult {
  /** Số đơn đã hỏi sàn. */
  asked: number;
  /** id đơn → tên vừa biết (đã ghi DB). Đơn vắng mặt = vẫn chưa rõ. */
  names: Map<string, string>;
  fromCarrier: number;
  fromCheckout: number;
  /** Các tên khác nhau vừa nhận (tối đa 6) — để log soi sàn thật trả gì. */
  samples: string[];
}

/** Sàn từ chối THAM SỐ (không phải mạng / token / 429) → thử lại không xin trường mới. */
function isParamError(err: unknown): boolean {
  return /error_param|invalid.{0,20}(field|param)|response_optional_fields/i.test((err as Error)?.message ?? "");
}

/**
 * Hỏi Shopee tên hãng của các đơn chưa rõ (cắt còn CARRIER_REFRESH_MAX đơn đầu)
 * rồi ghi xuống DB. Ném lỗi khi sàn không trả lời — nơi gọi bắt và để đơn chờ.
 */
export async function refreshShopeeCarrierNames(
  channel: Channel,
  orders: readonly { id: string; orderCode: string }[]
): Promise<CarrierRefreshResult> {
  const batch = orders.slice(0, CARRIER_REFRESH_MAX);
  const result: CarrierRefreshResult = { asked: batch.length, names: new Map(), fromCarrier: 0, fromCheckout: 0, samples: [] };
  if (batch.length === 0) return result;

  const { accessToken, shopId } = await getValidShopeeAccessToken(channel);
  const sns = batch.map((o) => o.orderCode);
  let infos: ShopeeOrderCarrierInfo[];
  try {
    infos = await getOrderCarrierNames(accessToken, shopId, sns, true);
  } catch (err) {
    if (!isParamError(err)) throw err;
    console.warn(`[auto-arrange] Shopee từ chối checkout_shipping_carrier, hỏi lại chỉ shipping_carrier — ${(err as Error).message}`);
    infos = await getOrderCarrierNames(accessToken, shopId, sns, false);
  }

  const idByCode = new Map(batch.map((o) => [o.orderCode, o.id]));
  /** tên → id đơn, tách theo nguồn (luật ghi khác nhau). */
  const byCarrier = new Map<string, string[]>();
  const byCheckout = new Map<string, string[]>();
  const samples = new Set<string>();
  for (const info of infos) {
    const id = idByCode.get(info.order_sn);
    const picked = id ? pickCarrierName(info) : null;
    if (!id || !picked) continue;
    result.names.set(id, picked.name);
    const bucket = picked.source === "carrier" ? byCarrier : byCheckout;
    bucket.set(picked.name, [...(bucket.get(picked.name) ?? []), id]);
    if (picked.source === "carrier") result.fromCarrier += 1;
    else result.fromCheckout += 1;
    if (samples.size < 6) samples.add(`${picked.source === "carrier" ? "hãng" : "kênh khách chọn"} "${picked.name}"`);
  }
  result.samples = [...samples];

  // Hãng sàn đã gán = dữ kiện sàn, ghi như luồng đồng bộ (planShopeeOrderUpdate);
  // enum hãng chỉ điền khi trống (không đè lựa chọn tay của kho).
  for (const [name, ids] of byCarrier) {
    await prisma.order.updateMany({
      where: { id: { in: ids }, shippingStatus: ShippingStatus.PENDING },
      data: { shippingCarrierName: name },
    });
    const carrier: Carrier | null = carrierFromName(name);
    if (carrier) {
      await prisma.order.updateMany({ where: { id: { in: ids }, carrier: null }, data: { carrier } });
    }
  }
  // Kênh khách chọn chỉ là tên TẠM: chỉ ghi khi ô tên còn trống / chữ giữ chỗ (lượt
  // đồng bộ chen giữa đã ghi hãng thật thì giữ hãng thật); không suy ra enum hãng.
  for (const [name, ids] of byCheckout) {
    await prisma.order.updateMany({
      where: {
        id: { in: ids },
        shippingStatus: ShippingStatus.PENDING,
        OR: [
          { shippingCarrierName: null },
          { shippingCarrierName: "" },
          { shippingCarrierName: { contains: "điều phối", mode: "insensitive" } },
        ],
      },
      data: { shippingCarrierName: name },
    });
  }
  return result;
}
