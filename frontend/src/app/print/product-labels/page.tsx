"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { BarcodeSvg } from "@/components/products/barcode-svg";
import { getToken } from "@/lib/api";
import { barcodeShape } from "@/lib/barcode";
import { LABEL_PADDING_X_MM, expandLabels, labelSizeOf, paginateLabels, readLabelJob, type LabelJob } from "@/lib/label-print";

/**
 * BẢN IN TEM MÃ VẠCH sản phẩm kho — in trong trình duyệt (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md
 * mục 6.4; cùng cách với /print/stock-voucher). Mở ở tab mới từ hộp "In mã vạch" của Tổng kho: hộp
 * đó ghi lệnh in (khổ tem + danh sách mã + số tem) vào localStorage, trang này đọc lại, dựng tem đúng
 * kích thước mm và tự gọi hộp in. `?preview=1` = chỉ xem, không tự mở hộp in.
 *
 * Mỗi "trang" là một khối đúng khổ giấy: tem cuộn = một hàng tem, A4 = 65 tem. Kích thước dùng mm,
 * chữ dùng pt để ra giấy đúng cỡ. Toàn bộ màu là mã hex cố định (giấy in trắng – đen kể cả khi app
 * đang ở giao diện tối).
 */
export default function ProductLabelsPrintPage() {
  const router = useRouter();
  const [job, setJob] = useState<LabelJob | null | undefined>(undefined);
  const printed = useRef(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setJob(readLabelJob());
  }, [router]);

  const size = labelSizeOf(job?.sizeKey);
  const labels = useMemo(() => (job ? expandLabels(job.items) : []), [job]);
  const pages = useMemo(() => paginateLabels(labels, size), [labels, size]);

  useEffect(() => {
    if (!job || labels.length === 0 || printed.current) return;
    printed.current = true;
    if (new URLSearchParams(window.location.search).has("preview")) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [job, labels.length]);

  // Tem thấp (22 mm) chỉ đủ chỗ cho một dòng tên; tem 30 mm in tên to hơn một nấc.
  const compact = size.labelH < 25;

  return (
    <div style={{ background: "#eee", color: "#111", minHeight: "100vh", fontFamily: "Inter, Arial, sans-serif" }}>
      <style>{`
        html, body { background: #eee !important; margin: 0; }
        @page { size: ${size.pageW}mm ${size.pageH}mm; margin: 0; }
        .lb-page { width: ${size.pageW}mm; height: ${size.pageH}mm; box-sizing: border-box; padding: ${size.marginY}mm ${size.marginX}mm; background: #fff; display: grid; grid-template-columns: repeat(${size.cols}, ${size.labelW}mm); grid-auto-rows: ${size.labelH}mm; column-gap: ${size.gapX}mm; align-content: start; overflow: hidden; margin: 12px auto; box-shadow: 0 0 0 1px #ccc; break-after: page; page-break-after: always; }
        .lb { width: ${size.labelW}mm; height: ${size.labelH}mm; box-sizing: border-box; padding: 1mm ${LABEL_PADDING_X_MM}mm; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; text-align: center; line-height: 1.15; }
        .lb-name { width: 100%; font-size: ${compact ? 5.5 : 7}pt; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lb-bars { width: 100%; flex: 1 1 auto; min-height: 0; margin: 0.5mm 0 0.3mm; }
        .lb-code { font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: ${compact ? 6.5 : 8}pt; letter-spacing: 0.4pt; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
        .lb-sku { width: 100%; font-family: ui-monospace, Consolas, "Courier New", monospace; font-size: ${compact ? 5.5 : 6.5}pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .lb-wrap { background: #fff !important; padding: 0 !important; }
          .lb-page { margin: 0 !important; box-shadow: none !important; }
          .lb-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>

      <div
        className="no-print"
        style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #ddd", background: "#fafafa", fontSize: 13, position: "sticky", top: 0, zIndex: 1 }}
      >
        <span style={{ flex: 1, color: "#444" }}>
          {job === undefined
            ? "Đang dựng tem…"
            : labels.length === 0
              ? "Không có lệnh in tem nào. Quay lại Tổng kho, bấm biểu tượng máy in cạnh mã vạch."
              : `${fmt(labels.length)} tem · ${size.label} (${size.hint}) · ${fmt(pages.length)} trang. Trong hộp in chọn khổ giấy ${size.pageW} × ${size.pageH} mm, tỷ lệ 100%, lề "Không".`}
        </span>
        <button type="button" onClick={() => window.print()} disabled={labels.length === 0} style={btn(true)}>
          In
        </button>
        <button type="button" onClick={() => window.close()} style={btn(false)}>
          Đóng
        </button>
      </div>

      <div className="lb-wrap" style={{ padding: "4px 12px 24px" }}>
        {pages.map((page, pi) => (
          <div className="lb-page" key={pi}>
            {page.map((it, li) => (
              <div className="lb" key={li}>
                <div className="lb-name">
                  {it.productName}
                  {it.variantName ? ` · ${it.variantName}` : ""}
                </div>
                {barcodeShape(it.barcode) ? (
                  <BarcodeSvg code={it.barcode} className="lb-bars" />
                ) : (
                  <div className="lb-bars" />
                )}
                <div className="lb-code">{it.barcode}</div>
                <div className="lb-sku">{it.skuCode}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("vi-VN").format(n);
}
function btn(primary: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 6,
    border: primary ? "1px solid #111" : "1px solid #bbb",
    background: primary ? "#111" : "#fff",
    color: primary ? "#fff" : "#111",
    fontSize: 13,
    cursor: "pointer",
  };
}
