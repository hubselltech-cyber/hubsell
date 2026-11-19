"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

import { fetchStocktakeSession, getToken } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";

/**
 * BIÊN BẢN KIỂM KÊ — A4, in trong trình duyệt (kho chuẩn quốc tế lát 5, 20/11/2026,
 * docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 17; cùng cách với /print/stock-voucher). Mở ở tab mới từ
 * màn phiên kiểm kê đã duyệt. Tự gọi hộp in khi tải xong; thanh nút trên cùng không in.
 *
 * Mẫu theo Biên bản kiểm kê vật tư, công cụ, sản phẩm, hàng hóa 05-VT (Thông tư 200) lược bớt: đầu
 * biên bản đơn vị + số + ngày, kho, người đếm / người duyệt; bảng STT · Mã · Tên · Sổ lúc đếm · Thực
 * đếm · Thừa · Thiếu; tổng; ba ô ký. KHÔNG có cột tiền (biên bản do nhân viên kho in).
 *
 * Toàn bộ màu dùng mã hex cố định, KHÔNG dùng token giao diện: chứng từ giấy phải trắng – đen kể cả
 * khi app đang ở giao diện tối.
 */
export default function StocktakePrintPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";
  const printed = useRef(false);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const q = useApiQuery({ queryKey: qk.stocktakeSession(id), queryFn: () => fetchStocktakeSession(id), enabled: Boolean(id), staleTime: Infinity });
  const data = q.data;
  const s = data?.session;
  const approved = s?.status === "APPROVED";

  useEffect(() => {
    if (!data || !approved || printed.current) return;
    printed.current = true;
    // ?preview=1 = chỉ xem, không tự mở hộp in.
    if (new URLSearchParams(window.location.search).has("preview")) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [data, approved]);

  const lines = data?.lines ?? [];
  const at = s?.approvedAt ? new Date(s.approvedAt) : null;
  const counters = [...new Set(lines.map((l) => l.countedByName).filter((v): v is string => Boolean(v)))];
  const totalBook = lines.reduce((a, l) => a + (l.bookAtCount ?? 0), 0);
  const totalCounted = lines.reduce((a, l) => a + l.counted, 0);

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
          {s
            ? approved
              ? `Biên bản ${s.code} — nếu hộp in không tự mở, bấm In.`
              : `Phiên ${s.code} chưa duyệt — biên bản chỉ in được sau khi duyệt.`
            : q.error
              ? `Không tải được phiên: ${q.error}`
              : "Đang tải biên bản…"}
        </span>
        <button type="button" onClick={() => window.print()} disabled={!approved} style={btn(true)}>
          In
        </button>
        <button type="button" onClick={() => window.close()} style={btn(false)}>
          Đóng
        </button>
      </div>

      {s && approved && at && data && (
        <div className="sheet" style={{ maxWidth: "190mm", margin: "16px auto", padding: "12mm 10mm", boxShadow: "0 0 0 1px #e5e5e5" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{data.shop.name}</div>
              {data.shop.phone && <div>ĐT: {data.shop.phone}</div>}
              {data.shop.email && <div>{data.shop.email}</div>}
              {s.locationName && <div>Kho / vị trí: {s.locationName}</div>}
            </div>
            <div style={{ textAlign: "right", fontSize: 12.5, lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: 0.5 }}>BIÊN BẢN KIỂM KÊ</div>
              <div>
                Số: <b style={{ fontFamily: "ui-monospace, Consolas, monospace" }}>{s.code}</b>
              </div>
              <div>
                Duyệt ngày {pad(at.getDate())} tháng {pad(at.getMonth() + 1)} năm {at.getFullYear()} · {pad(at.getHours())}:{pad(at.getMinutes())}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, fontSize: 12.5, lineHeight: 1.6 }}>
            <div>
              <b>Mở phiên:</b> {fmtAt(s.createdAt)}
              {s.createdByName ? ` · ${s.createdByName}` : ""}
            </div>
            <div>
              <b>Người đếm:</b> {counters.length ? counters.join(", ") : "—"}
            </div>
            <div>
              <b>Người duyệt:</b> {s.approvedByName ?? "—"}
            </div>
            {s.note && (
              <div>
                <b>Ghi chú:</b> {s.note}
              </div>
            )}
          </div>

          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th style={{ width: 28 }}>STT</th>
                <th style={{ width: 120 }}>Mã SKU</th>
                <th>Tên hàng hóa</th>
                <th style={{ width: 62 }}>Sổ lúc đếm</th>
                <th style={{ width: 62 }}>Thực đếm</th>
                <th style={{ width: 52 }}>Thừa</th>
                <th style={{ width: 52 }}>Thiếu</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const d = l.delta ?? 0;
                return (
                  <tr key={l.productId}>
                    <td className="ctr">{i + 1}</td>
                    <td style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12, wordBreak: "break-all" }}>{l.skuCode}</td>
                    <td>
                      {l.productName}
                      {l.applied && l.delta === null ? " (mã đã xóa khỏi kho — không điều chỉnh)" : ""}
                    </td>
                    <td className="num">{l.bookAtCount === undefined ? "" : fmt(l.bookAtCount)}</td>
                    <td className="num">{fmt(l.counted)}</td>
                    <td className="num">{d > 0 ? fmt(d) : ""}</td>
                    <td className="num">{d < 0 ? fmt(-d) : ""}</td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={3} style={{ fontWeight: 600 }}>
                  Cộng ({fmt(lines.length)} mã, {fmt(s.adjustedCount)} mã chênh)
                </td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(totalBook)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(totalCounted)}</td>
                <td className="num" style={{ fontWeight: 700 }}>{s.totalUp ? fmt(s.totalUp) : ""}</td>
                <td className="num" style={{ fontWeight: 700 }}>{s.totalDown ? fmt(s.totalDown) : ""}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Sổ lúc đếm = số trên sổ kho tại thời điểm đếm từng mã. Phần thừa / thiếu đã được ghi vào sổ kho khi duyệt.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 28, fontSize: 12.5, textAlign: "center" }}>
            {["Người đếm", "Thủ kho", "Người duyệt"].map((role) => (
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
function fmtAt(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
