"use client";

import { Shirt, TriangleAlert } from "lucide-react";

import {
  channelMeta,
  type MockProductInfo,
  type OpsChannel,
  type StockSource,
} from "@/components/operations/mock-data";
import { Badge } from "@/components/ui/badge";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * WIDGET "SẢN PHẨM ĐANG CHAT" (Product Context Card)
 *
 * Hiện ngay cạnh khung chat để nhân viên CSKH vừa đọc hội thoại vừa thấy
 * size chart + tồn kho, không phải bật sang trang Kho tra tay.
 *
 * TỒN KHO 2 NGUỒN: số CHÍNH trong ma trận là TỒN TRÊN SÀN của gian hàng
 * khách đang chat (số khách bấm mua được — nguồn AI tư vấn mặc định); ô nào
 * lệch với Kho vật lý thì ghi kèm `Kho: Y` bên dưới + badge [Lệch tồn] trên
 * đầu, cho shop không bật đồng bộ kho thấy ngay chỗ phải đi chỉnh.
 */
export function ProductContextCard({
  product,
  channel,
  stockSource,
}: {
  product: MockProductInfo;
  /** Sàn của hội thoại đang mở — để ghi nhãn "Tồn trên sàn Shopee". */
  channel: OpsChannel;
  /** Nguồn AI đang dùng tư vấn (theo cấu hình seller) — hiện ở dòng chú thích. */
  stockSource: StockSource;
}) {
  // Gom tồn kho thành ma trận màu × size cho bảng đọc nhanh.
  // variants đọc phòng thủ: dữ liệu thật có thể chưa đồng bộ biến thể nào.
  const variants = product.variants ?? [];
  const colors = [...new Set(variants.map((v) => v.color))];
  const sizes = [...new Set(variants.map((v) => v.size))];
  const variantOf = (color: string, size: string) =>
    variants.find((v) => v.color === color && v.size === size) ?? null;

  const totalChannel = variants.reduce((s, v) => s + (Number(v.channelStock) || 0), 0);
  const totalPhysical = variants.reduce((s, v) => s + (Number(v.stockQuantity) || 0), 0);
  const hasMismatch = variants.some((v) => v.channelStock !== v.stockQuantity);
  const channelLabel = channelMeta(channel).label;

  return (
    <div className="space-y-4 p-4">
      {/* Ảnh giữ chỗ + tên + SKU */}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white",
            product.imageClass
          )}
        >
          <Shirt className="size-6" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-slate-900">
            {product.name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {product.sku}
            </Badge>
            {hasMismatch && (
              <Badge
                variant="outline"
                className="gap-1 border-amber-200 bg-amber-50 text-amber-700"
              >
                <TriangleAlert className="size-3" />
                Lệch tồn
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Dòng so sánh tổng 2 nguồn tồn */}
      <p className="text-sm">
        <span className="text-slate-500">Sàn ({channelLabel}):</span>{" "}
        <span
          className={cn(
            "font-semibold",
            totalChannel > 0 ? "text-emerald-500" : "text-red-500"
          )}
        >
          {totalChannel}
        </span>
        <span className="mx-1.5 text-slate-300">|</span>
        <span className="text-slate-500">Kho vật lý:</span>{" "}
        <span className="font-medium text-slate-700">{totalPhysical}</span>
      </p>

      {/* Chất liệu & bảo quản — hai câu khách hỏi nhiều nhất sau size */}
      <div className="space-y-1.5">
        <p className="text-sm text-slate-900">
          <span className="text-slate-500">Chất liệu:</span> {product.material}
        </p>
        <p className="text-sm text-slate-900">
          <span className="text-slate-500">Bảo quản:</span> {product.care}
        </p>
      </div>

      {/* Bảng quy đổi size */}
      {product.sizeChart.length > 0 && (
        <div>
          <p className={cn(TEXT_SUB, "mb-1.5 font-medium uppercase tracking-wide")}>
            Bảng size
          </p>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Size</th>
                  <th className="px-2 py-1.5 text-left font-medium">Cao (cm)</th>
                  <th className="px-2 py-1.5 text-left font-medium">Nặng (kg)</th>
                </tr>
              </thead>
              <tbody>
                {product.sizeChart.map((r) => (
                  <tr key={r.size} className="border-t">
                    <td className="px-2 py-1.5 font-semibold text-slate-900">
                      {r.size}
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">
                      {r.heightCm[0]}–{r.heightCm[1]}
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">
                      {r.weightKg[0]}–{r.weightKg[1]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ma trận TỒN TRÊN SÀN màu × size — đỏ khi hết, vàng khi sắp hết (≤5);
          ô lệch kho vật lý ghi kèm "Kho: Y" bên dưới. Chưa có biến thể nào
          (SP thật chưa đồng bộ chi tiết) thì ẩn hẳn khối, không vẽ bảng rỗng. */}
      {variants.length > 0 && (
      <div>
        <p className={cn(TEXT_SUB, "mb-1.5 font-medium uppercase tracking-wide")}>
          Tồn trên sàn {channelLabel}
        </p>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Màu</th>
                {sizes.map((s) => (
                  <th key={s} className="px-2 py-1.5 text-center font-medium">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {colors.map((c) => (
                <tr key={c} className="border-t">
                  <td className="px-2 py-1.5 font-medium text-slate-900">{c}</td>
                  {sizes.map((s) => {
                    const v = variantOf(c, s);
                    const qty = v?.channelStock ?? null;
                    const mismatch = v !== null && v.channelStock !== v.stockQuantity;
                    return (
                      <td key={s} className="px-2 py-1.5 text-center align-top">
                        <span
                          className={cn(
                            "tabular-nums",
                            qty === null && "text-slate-300",
                            qty !== null && qty === 0 && "font-semibold text-red-500",
                            qty !== null && qty > 0 && qty <= 5 && "font-semibold text-amber-600",
                            qty !== null && qty > 5 && "text-slate-700"
                          )}
                        >
                          {qty === null ? "—" : qty === 0 ? "Hết" : qty}
                        </span>
                        {mismatch && (
                          <span className="block text-[10px] leading-tight text-amber-600">
                            Kho: {v.stockQuantity}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={cn(TEXT_SUB, "mt-1.5")}>
          AI đang tư vấn theo{" "}
          {stockSource === "CHANNEL" ? (
            <>
              <b>tồn trên sàn</b> (cấu hình mặc định)
            </>
          ) : (
            <>
              <b>kho vật lý</b> (theo cấu hình)
            </>
          )}
          . Vàng: sắp hết (≤5).
        </p>
      </div>
      )}
    </div>
  );
}
