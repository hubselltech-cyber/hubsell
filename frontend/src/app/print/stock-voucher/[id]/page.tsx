"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

import { fetchStockVoucher, getToken, type StockVoucherLine } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";

/**
 * BẢN IN PHIẾU NHẬP / XUẤT KHO — A4, in trong trình duyệt (05/11/2026, docs/QUAN-LY-KHO-TAI-CAU-TRUC.md
 * mục 4). Mở ở tab mới từ màn Phiếu nhiều mã (ngay sau khi ghi) hoặc tab Phiếu kho (in lại). Tự gọi
 * hộp in khi tải xong; thanh nút trên cùng không in.
 *
 * Mẫu theo Phiếu nhập kho 01-VT / Phiếu xuất kho 02-VT (Thông tư 200) lược bớt: đầu phiếu đơn vị +
 * số phiếu + ngày, lý do, kho; bảng STT · Mã · Tên · Phân loại · ĐVT · Số lượng · Đơn giá · Thành
 * tiền; tổng; bốn ô ký. Nhân viên không được xem tài chính: API trả unitCost null → ẩn hai cột tiền.
 *
 * Toàn bộ màu dùng mã hex cố định, KHÔNG dùng token giao diện: đây là chứng từ giấy, phải trắng – đen
 * kể cả khi app đang ở giao diện tối.
 */
export default function StockVoucherPrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const printed = useRef(false);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const q = useApiQuery({ queryKey: qk.stockVoucher(id), queryFn: () => fetchStockVoucher(id), enabled: Boolean(id), staleTime: Infinity });
  const data = q.data;

  useEffect(() => {
    if (!data || printed.current) return;
    printed.current = true;
    // ?preview=1 = chỉ xem, không tự mở hộp in (soi giao diện / khách muốn xem trước rồi bấm In).
    if (new URLSearchParams(window.location.search).has("preview")) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [data]);

  const v = data?.voucher;
  const isImport = v?.type === "IMPORT";
  const showCost = Boolean(v?.lines.some((l) => l.unitCost != null));
  const title = isImport ? "PHIẾU NHẬP KHO" : "PHIẾU XUẤT KHO";
  const at = v ? new Date(v.createdAt) : null;

  return (
    <div style={{ background: "#fff", color: "#111", minHeight: "100vh", fontFamily: "Inter, Arial, sans-serif" }}>
      <style>{`
        html, body { background: #fff !important; }
        @page { size: A4; margin: 14mm 12mm; }
        @media print { .no-print { display: none !important; } .sheet { box-shadow: none !important; margin: 0 !important; max-width: none !important; padding: 0 !important; } }
        .sheet table { border-collapse: collapse; width: 100%; }
        .sheet th, .sheet td { border: 1px solid #555; padding: 5px 6px; font-size: 12.5px; vertical-align: top; }
        .sheet th { background: #f2f2f2; font-weight: 600; text-align: center; }
        .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .ctr { text-align: center; }
      `}</style>

      <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #ddd", background: "#fafafa", fontSize: 13 }}>
        <span style={{ flex: 1, color: "#444" }}>
          {v ? `Phiếu ${v.code} — nếu hộp in không tự mở, bấm In.` : q.error ? `Không tải được phiếu: ${q.error}` : "Đang tải phiếu…"}
        </span>
        <button type="button" onClick={() => window.print()} disabled={!v} style={btn(true)}>
          In
        </button>
        <button type="button" onClick={() => window.close()} style={btn(false)}>
          Đóng
        </button>
      </div>

      {v && at && (
        <div className="sheet" style={{ maxWidth: "190mm", margin: "16px auto", padding: "12mm 10mm", boxShadow: "0 0 0 1px #e5e5e5" }}>
          {/* Đầu phiếu */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{data.shop.name}</div>
              {data.shop.phone && <div>ĐT: {data.shop.phone}</div>}
              {data.shop.email && <div>{data.shop.email}</div>}
              {v.locationName && <div>Kho: {v.locationName}</div>}
            </div>
            <div style={{ textAlign: "right", fontSize: 12.5, lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: 0.5 }}>{title}</div>
              <div>
                Số: <b style={{ fontFamily: "ui-monospace, Consolas, monospace" }}>{v.code}</b>
              </div>
              <div>
                Ngày {pad(at.getDate())} tháng {pad(at.getMonth() + 1)} năm {at.getFullYear()} · {pad(at.getHours())}:{pad(at.getMinutes())}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.6 }}>
            <div>
              <b>Lý do {isImport ? "nhập" : "xuất"}:</b> {v.reason}
            </div>
            <div>
              <b>Người lập phiếu:</b> {data.createdByName ?? "—"}
            </div>
          </div>

          {/* Bảng dòng */}
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                {/* Tên hàng lấy phần rộng còn lại — các cột số bó hẹp vừa chữ để tên không gãy 3–4 dòng. */}
                <th style={{ width: 28 }}>STT</th>
                <th style={{ width: 96 }}>Mã SKU</th>
                <th>Tên hàng hóa</th>
                <th style={{ width: 88 }}>Phân loại</th>
                <th style={{ width: 40 }}>ĐVT</th>
                <th style={{ width: 56 }}>SL</th>
                {showCost && <th style={{ width: 78 }}>Đơn giá</th>}
                {showCost && <th style={{ width: 92 }}>Thành tiền</th>}
              </tr>
            </thead>
            <tbody>
              {v.lines.map((l: StockVoucherLine, i: number) => (
                <tr key={`${l.productId}-${i}`}>
                  <td className="ctr">{i + 1}</td>
                  <td style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12 }}>{l.skuCode}</td>
                  <td>{l.productName}</td>
                  <td>{l.variantName ?? ""}</td>
                  <td className="ctr">chiếc</td>
                  <td className="num">{fmt(l.quantity)}</td>
                  {showCost && <td className="num">{l.unitCost != null ? fmt(l.unitCost) : ""}</td>}
                  {showCost && <td className="num">{l.unitCost != null ? fmt(l.unitCost * l.quantity) : ""}</td>}
                </tr>
              ))}
              <tr>
                <td colSpan={5} style={{ fontWeight: 600 }}>
                  Cộng ({fmt(v.lineCount)} mã)
                </td>
                <td className="num" style={{ fontWeight: 700 }}>
                  {fmt(v.totalQuantity)}
                </td>
                {showCost && <td />}
                {showCost && (
                  <td className="num" style={{ fontWeight: 700 }}>
                    {v.totalCost != null ? fmt(v.totalCost) : ""}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
          {showCost && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Đơn giá = giá vốn mặc định của SKU tại thời điểm lập phiếu (đồng). Tổng giá trị: <b>{fmt(v.totalCost ?? 0)} đ</b>.
            </div>
          )}

          {/* Chữ ký */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 28, fontSize: 12.5, textAlign: "center" }}>
            {["Người lập phiếu", isImport ? "Người giao hàng" : "Người nhận hàng", "Thủ kho", "Kế toán"].map((role) => (
              <div key={role}>
                <div style={{ fontWeight: 600 }}>{role}</div>
                <div style={{ fontSize: 11, color: "#555" }}>(Ký, họ tên)</div>
                <div style={{ height: 64 }} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 18, fontSize: 10.5, color: "#666", textAlign: "right" }}>
            In từ Hubsell · {pad(new Date().getDate())}/{pad(new Date().getMonth() + 1)}/{new Date().getFullYear()}
          </div>
        </div>
      )}
    </div>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
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
