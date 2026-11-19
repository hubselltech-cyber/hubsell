import { useQuery } from "@tanstack/react-query";

import { fetchStockModel, type Product, type RestockOnReturn, type StockModel } from "@/lib/api";

/**
 * "TỒN KHO" LÀ SỐ NÀO — kho chuẩn quốc tế lát 3 (20/11/2026, docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 15).
 *
 * Mỗi shop chạy một trong hai cách (máy chủ quyết, gắn vào từng sản phẩm của danh sách):
 *   LEGACY  — cột Tồn kho = sổ `quantityInStock` (đã trừ đơn đã chốt), như trước 20/11/2026;
 *   ON_HAND — cột Tồn kho = hàng TRONG KHO `onHand` = sổ + đang giữ cho đơn + ô không bán.
 * "Có thể bán" (số đẩy lên sàn) KHÔNG đổi nghĩa ở cả hai cách.
 *
 * Mọi màn đọc số tồn phải đi qua các hàm ở đây, không tự lấy `quantityInStock` làm "tồn kho" —
 * để một shop không bao giờ thấy hai màn hai nghĩa.
 */

type StockFields = Pick<Product, "quantityInStock" | "holdQuantity" | "onHand" | "heldQuantity" | "stockModel">;

/** Sản phẩm này thuộc shop chạy cách "hàng trong kho" (chuẩn quốc tế). */
export function isOnHand(p: Pick<Product, "stockModel">): boolean {
  return p.stockModel === "ON_HAND";
}

/** Số hiện ở cột / nhãn "Tồn kho" của sản phẩm. */
export function stockShown(p: StockFields): number {
  return isOnHand(p) ? (p.onHand ?? p.quantityInStock) : p.quantityInStock;
}

/**
 * "Đang giữ" hiện cho khách ở cách ON_HAND: hàng đã có đơn, còn trong kho = đơn đã chốt chưa giao +
 * đơn chưa thanh toán. Ở cách LEGACY chỉ là phần giữ tạm của đơn chưa thanh toán (như trước).
 */
export function heldShown(p: StockFields): number {
  return isOnHand(p) ? (p.heldQuantity ?? p.holdQuantity ?? 0) : (p.holdQuantity ?? 0);
}

/** Số tối đa xuất tay / bán thêm được ngay: sổ tồn bán (không đổi theo cách hiển thị). */
export function sellableNow(p: Pick<Product, "quantityInStock">): number {
  return p.quantityInStock;
}

/** Tổng "Đang giữ" của cả mẫu (dòng cha). */
export function groupHeld(rows: StockFields[]): number {
  return rows.reduce((s, p) => s + heldShown(p), 0);
}

/** Chú thích khi rê chuột vào số "Đang giữ" của một mã (cách ON_HAND). */
export function heldTitle(p: StockFields & Pick<Product, "awaitingShipOrders">): string {
  const unpaid = p.holdQuantity ?? 0;
  const held = heldShown(p);
  const orders = p.awaitingShipOrders ?? 0;
  return (
    `${held.toLocaleString("vi-VN")} sản phẩm đã có đơn, còn trong kho` +
    (orders > 0 ? ` (${orders.toLocaleString("vi-VN")} đơn đã chốt chưa giao cho vận chuyển)` : "") +
    (unpaid > 0 ? `, trong đó ${unpaid.toLocaleString("vi-VN")} của đơn chưa thanh toán` : "") +
    ". Nằm TRONG Tồn kho; giao cho vận chuyển thì Tồn kho mới giảm."
  );
}

export const HELD_GROUP_TITLE =
  "Tổng đang giữ các phân loại: hàng đã có đơn, còn trong kho. Nằm TRONG Tồn kho; giao cho vận chuyển thì Tồn kho mới giảm.";

/**
 * Hai cài đặt kho của shop cho các màn KHÔNG tải danh sách sản phẩm (đơn hàng, đơn hoàn, kiểm kê
 * lúc chưa có phiếu). Trong lúc chưa tải xong trả về cách cũ — câu chữ theo cách cũ không sai với
 * shop nào tới khi biết chắc.
 */
export function useStockSettings(): { stockModel: StockModel; restockOnReturn: RestockOnReturn; loaded: boolean } {
  const q = useQuery({
    queryKey: ["stock-model"],
    queryFn: fetchStockModel,
    staleTime: 5 * 60 * 1000,
  });
  return {
    stockModel: q.data?.stockModel ?? "LEGACY",
    restockOnReturn: q.data?.restockOnReturn ?? "ON_CANCEL",
    loaded: q.isSuccess,
  };
}
