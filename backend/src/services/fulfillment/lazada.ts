// ============================================================
// ADAPTER LAZADA — pack → RTS → tải vận đơn PDF (04/09/2026)
//
// Lazada không hỏi pickup/dropoff qua API (cài ở Seller Center), nên hộp thoại
// chỉ hiện ghi chú. order_item_id không lưu trong DB Hubsell → hỏi lại sàn lúc
// pack (1 call/đơn, chấp nhận được vì Lazada ít đơn hơn Shopee nhiều).
// Kiểm chứng thật 04/09 (gian Hi.Bé, đơn 527599097428756): /order/package/
// document/get trả {result:{data:{pdf_url,file,doc_type}}} và pdf_url tải được
// PDF 265KB không cần đăng nhập → đường in vận đơn ĐÃ CHẠY THẬT. pack lần đầu
// (đơn 528594675928756) bị "argument type mismatch" vì gửi order_item_list dạng
// object/chuỗi — sàn cần MẢNG SỐ (đã sửa ở client.packOrders).
// ============================================================

import type { Channel } from "@prisma/client";
import { ChannelName } from "@prisma/client";
import {
  getMultipleOrderItems,
  getPackageDocument,
  packOrders,
  readyToShipPackages,
} from "../../integrations/lazada/client";
import { getValidLazadaAccessToken } from "../../integrations/lazada/service";
import { isLazadaConfigured } from "../../integrations/lazada/config";
import {
  errMessage,
  type ArrangeResult,
  type FulfillOrderRef,
  type FulfillmentAdapter,
  type LabelFetchResult,
} from "./types";

const PACKABLE = new Set(["pending", "repacked"]);

/** Tải một URL, trả Buffer nếu đúng là PDF; null nếu lỗi/không phải PDF. */
async function fetchPdf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.subarray(0, 4).toString("latin1") === "%PDF" ? buf : null;
  } catch {
    return null;
  }
}

/** Dòng hàng của một đơn theo order_id (Lazada trả map theo đơn). */
async function orderItemsOf(accessToken: string, orderCode: string) {
  const map = await getMultipleOrderItems(accessToken, [orderCode]);
  const entry = map.get(String(orderCode)) ?? [...map.values()][0] ?? [];
  return entry;
}

export const lazadaFulfillment: FulfillmentAdapter = {
  channelName: ChannelName.LAZADA,
  supported: true,

  async getShippingOptions(channel) {
    if (!isLazadaConfigured()) throw new Error("Máy chủ chưa cấu hình Lazada");
    // Xác nhận token còn sống để hộp thoại báo sớm nếu gian đã mất kết nối
    await getValidLazadaAccessToken(channel);
    return {
      methods: [],
      pickupAddresses: [],
      dropoffBranches: [],
      note: "Lazada tự sắp xếp hãng và cách lấy hàng theo cài đặt gian trên Seller Center. Hubsell sẽ đóng gói + báo Sẵn sàng giao.",
    };
  },

  async arrangeShipment(channel, order): Promise<ArrangeResult> {
    try {
      const accessToken = await getValidLazadaAccessToken(channel);
      const items = await orderItemsOf(accessToken, order.orderCode);
      const packable = items.filter((it) => PACKABLE.has(String(it.status ?? "").toLowerCase()));
      const ids = packable.map((it) => it.order_item_id).filter((x): x is string | number => x != null);
      if (ids.length === 0) {
        // Đã pack ở Seller Center? Lấy package_id sẵn có để RTS/tải phiếu
        const existing = items.find((it) => it.package_id)?.package_id;
        if (existing) {
          return {
            ok: true,
            packageId: String(existing),
            trackingCode: (items.find((it) => it.tracking_code)?.tracking_code as string) ?? null,
            note: "Đơn đã được đóng gói trước đó trên Seller Center",
          };
        }
        return { ok: false, error: "Không có dòng hàng nào ở trạng thái chờ đóng gói (pending)" };
      }
      const packed = await packOrders(accessToken, [{ orderId: order.orderCode, orderItemIds: ids }]);
      const lines = packed.flatMap((p) => p.order_item_list ?? []);
      const bad = lines.find((l) => l.item_err_code != null && String(l.item_err_code) !== "0");
      if (bad) return { ok: false, error: `Sàn từ chối đóng gói: ${bad.msg || bad.item_err_code}` };
      const packageIds = [...new Set(lines.map((l) => l.package_id).filter((x): x is string => Boolean(x)))];
      if (packageIds.length === 0) return { ok: false, error: "Sàn không trả package_id sau khi đóng gói" };
      await readyToShipPackages(accessToken, packageIds);
      return {
        ok: true,
        packageId: packageIds[0],
        trackingCode: lines.find((l) => l.tracking_number)?.tracking_number ?? null,
        note: packageIds.length > 1 ? `Sàn tách ${packageIds.length} kiện` : undefined,
      };
    } catch (err) {
      return { ok: false, error: errMessage(err) };
    }
  },

  async fetchLabels(channel, orders): Promise<LabelFetchResult> {
    const result: LabelFetchResult = { pdfs: new Map(), discovered: new Map(), failed: [] };
    const accessToken = await getValidLazadaAccessToken(channel);
    for (const o of orders) {
      try {
        let packageId = o.platformPackageId;
        if (!packageId) {
          const items = await orderItemsOf(accessToken, o.orderCode);
          const found = items.find((it) => it.package_id)?.package_id;
          packageId = found ? String(found) : null;
          if (packageId) {
            const tracking = (items.find((it) => it.tracking_code)?.tracking_code as string) ?? null;
            result.discovered.set(o.id, { packageId, trackingCode: tracking });
          }
        }
        if (!packageId) {
          result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason: "Đơn chưa được đóng gói trên Lazada" });
          continue;
        }
        const doc = await getPackageDocument(accessToken, [packageId]);
        let pdf: Buffer | null = null;
        if (doc.pdfUrl) {
          pdf = await fetchPdf(doc.pdfUrl);
          // pdf_url là link qua proxy Seller Center bọc link OSS ký sẵn (probe
          // 04/09: cả hai đều tải được không cần đăng nhập) — proxy hỏng thì
          // gọi thẳng OSS.
          const m = !pdf && /\/oss\/galaxy\/proxy\/(.+)$/.exec(doc.pdfUrl);
          if (m) pdf = await fetchPdf(`https://${m[1]}`);
        }
        if (!pdf && doc.file) {
          const decoded = Buffer.from(doc.file, "base64");
          pdf = decoded.subarray(0, 4).toString("latin1") === "%PDF" ? decoded : null;
        }
        if (!pdf || pdf.subarray(0, 4).toString("latin1") !== "%PDF") {
          throw new Error("sàn không trả file PDF (có thể là HTML) — in tạm từ Seller Center");
        }
        result.pdfs.set(o.id, pdf);
      } catch (err) {
        result.failed.push({ orderId: o.id, orderCode: o.orderCode, reason: errMessage(err) });
      }
    }
    return result;
  },
};
