import React from "react";
import { Text, View } from "react-native";
import { PREVIEW_ROWS, rowParts, type LabelTemplate } from "@/lib/label-template";

/**
 * KHUNG XEM TRƯỚC của màn Tùy chỉnh phiếu in: một tờ tem thu nhỏ, đổi theo từng công tắc
 * ngay khi bấm (không gọi máy chủ). Nửa trên là phần vận chuyển của sàn vẽ CÁCH ĐIỆU —
 * để người bán thấy phần đó được giữ nguyên; nửa dưới là thứ sẽ đổi: bảng sản phẩm của sàn
 * (dài, tràn sang tờ hai) hoặc bảng gọn của Hubsell. Chữ trong bảng gọn ghép bằng đúng luật
 * máy chủ dùng lúc in (lib/label-template rowParts). Tờ tem luôn nền trắng chữ đen — đó là
 * giấy, không đổi theo giao diện tối.
 */
const INK = "#0f172a";
const BARS = [3, 1, 2, 1, 1, 3, 2, 1, 3, 1, 1, 2, 3, 1, 2, 2, 1, 3, 1, 2, 1, 1, 3, 2, 1, 2, 3, 1, 1, 2, 2, 1, 3, 1];

export function LabelPreview({ template, width = 208 }: { template: LabelTemplate; width?: number }) {
  // Khổ A6 105 × 148 mm.
  const height = Math.round((width * 148) / 105);
  const totalQty = PREVIEW_ROWS.reduce((s, r) => s + r.quantity, 0);
  const note = template.note.trim();
  return (
    <View
      style={{ width, height, backgroundColor: "#fff", borderColor: "#cbd5e1", borderWidth: 1, borderRadius: 6, padding: 7 }}
      accessibilityLabel="Xem trước phiếu in"
    >
      {/* ── Phần vận chuyển của sàn: giữ nguyên ── */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 8, fontWeight: "700", color: INK }}>TikTok Shop</Text>
        <Text style={{ fontSize: 8, fontWeight: "700", color: INK }}>J&T Express</Text>
      </View>
      <View style={{ flexDirection: "row", height: 26, marginTop: 4, alignItems: "stretch", justifyContent: "center" }}>
        {BARS.map((w, i) => (
          <View key={i} style={{ width: w * 1.6, backgroundColor: i % 2 === 0 ? INK : "#fff" }} />
        ))}
      </View>
      <Text style={{ fontSize: 10, fontWeight: "800", color: INK, textAlign: "center", marginTop: 2 }}>
        860000000001
      </Text>
      <View style={{ flexDirection: "row", borderColor: INK, borderWidth: 1, marginTop: 4, flex: 1 }}>
        <View style={{ flex: 1.6, padding: 4, borderRightWidth: 1, borderColor: INK, justifyContent: "space-between" }}>
          <View>
            <Text style={{ fontSize: 6, color: "#475569" }}>Người nhận</Text>
            <Text style={{ fontSize: 9, fontWeight: "800", color: INK }}>n****m</Text>
            <Text style={{ fontSize: 7, fontWeight: "700", color: INK, marginTop: 2 }}>Số 6* ngõ 1*, P*** D** T**</Text>
          </View>
          <Text style={{ fontSize: 5.5, color: "#94a3b8" }}>Phần vận chuyển của sàn — giữ nguyên</Text>
        </View>
        <View style={{ flex: 1, padding: 4, gap: 2 }}>
          {["420", "C226A02", "006"].map((c) => (
            <Text key={c} style={{ fontSize: 10, fontWeight: "800", color: INK }}>
              {c}
            </Text>
          ))}
        </View>
      </View>

      {/* ── Phần danh sách sản phẩm: chỗ mẫu tác động ── */}
      <View style={{ height: Math.round(height * 0.34), marginTop: 5 }}>
        {template.enabled ? (
          <View style={{ flex: 1, borderColor: INK, borderWidth: 1, padding: 3, overflow: "hidden" }}>
            {note ? (
              <View style={{ borderColor: INK, borderWidth: 0.75, paddingHorizontal: 3, paddingVertical: 1.5, marginBottom: 2 }}>
                <Text style={{ fontSize: 6.5, fontWeight: "800", color: INK }} numberOfLines={1}>
                  {note}
                </Text>
              </View>
            ) : null}
            <Text style={{ fontSize: 6, fontWeight: "800", color: INK, borderBottomWidth: 0.75, borderColor: INK, paddingBottom: 1 }}>
              Tổng {totalQty} sản phẩm · {PREVIEW_ROWS.length} dòng
            </Text>
            {PREVIEW_ROWS.map((row, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 3,
                  paddingVertical: 1,
                  borderTopWidth: i === 0 ? 0 : 0.5,
                  borderColor: "#94a3b8",
                }}
              >
                <View
                  style={{
                    width: 13,
                    alignItems: "center",
                    backgroundColor: row.quantity > 1 ? INK : "transparent",
                  }}
                >
                  <Text style={{ fontSize: 7.5, fontWeight: "800", color: row.quantity > 1 ? "#fff" : INK }}>
                    {row.quantity}
                  </Text>
                </View>
                <Text style={{ flex: 1, fontSize: 7.5, color: INK }} numberOfLines={1}>
                  {rowParts(row, template).map((p, j) => (
                    <Text key={j} style={{ fontWeight: p.bold ? "800" : "400" }}>
                      {j > 0 ? " · " : ""}
                      {p.text}
                    </Text>
                  ))}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ flex: 1, overflow: "hidden" }}>
            <View style={{ borderColor: INK, borderWidth: 1 }}>
              <Text style={{ fontSize: 6, color: INK, textAlign: "center", paddingVertical: 1.5 }}>
                Tổng {PREVIEW_ROWS.length} mặt hàng
              </Text>
            </View>
            {PREVIEW_ROWS.slice(0, 3).map((row, i) => (
              <View key={i} style={{ flexDirection: "row", borderColor: INK, borderWidth: 1, borderTopWidth: 0 }}>
                <View style={{ width: 14, alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderColor: INK }}>
                  <Text style={{ fontSize: 7.5, fontWeight: "800", color: INK }}>{row.quantity}</Text>
                </View>
                <View style={{ flex: 1, paddingHorizontal: 3, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 6, fontWeight: "700", color: INK }} numberOfLines={1}>
                    {row.variant ?? "Mặc định"}
                  </Text>
                  <Text style={{ fontSize: 6, color: INK }} numberOfLines={1}>
                    {row.name}
                  </Text>
                </View>
              </View>
            ))}
            {/* Hết giấy ở đây — phần còn lại của bảng sàn tràn sang tờ thứ hai. */}
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "#fee2e2",
                paddingVertical: 2,
              }}
            >
              <Text style={{ fontSize: 6.5, fontWeight: "700", color: "#b91c1c", textAlign: "center" }}>
                ↓ Đơn nhiều món: bảng của sàn tràn sang tờ hai
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
