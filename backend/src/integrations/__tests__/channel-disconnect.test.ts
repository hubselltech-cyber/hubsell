// ============================================================
// LÝ DO GIAN RỚT KẾT NỐI (07/11/2026, integrations/channel-disconnect.ts) — phần thuần, không DB.
//
// Ca gốc 07/11: HQ "Gian rớt kết nối" vàng vì 3 gian rớt 24h ≥ ngưỡng 3, nhưng 2 gian là
// khách tự xóa tài khoản (rớt cùng mili-giây, hạn ủy quyền 99 năm) + 1 gian TORANO hết hạn
// ủy quyền → chỉ 1 ca phía sàn, thẻ không được vàng. Test khóa luật suy lý do cho dòng cũ
// (cột trống) và cách gom / đếm phía sàn cho thẻ HQ.
// ============================================================
import { describe, expect, it } from "vitest";
import {
  DISCONNECT_REASON,
  describeDisconnects,
  inferDisconnectReason,
  summarizeDisconnects,
  type DisconnectedRow,
} from "../channel-disconnect";

const AT = new Date("2026-11-06T18:28:36.395Z");
const row = (o: Partial<DisconnectedRow> = {}): DisconnectedRow => ({
  shopName: "Gian A",
  channelName: "TIKTOK",
  disconnectReason: null,
  disconnectedAt: AT,
  authLostReason: null,
  lastSyncError: null,
  refreshTokenExpireAt: null,
  authExpireAt: null,
  ownerDeletedAt: null,
  ...o,
});

describe("inferDisconnectReason — cột ghi tại nguồn thắng, dòng cũ suy từ cột khác", () => {
  it("cột disconnectReason có mã hợp lệ → dùng nguyên, không suy lại dù dấu khác trái ngược", () => {
    expect(inferDisconnectReason(row({ disconnectReason: DISCONNECT_REASON.MANUAL, ownerDeletedAt: AT }))).toBe("MANUAL");
    expect(inferDisconnectReason(row({ disconnectReason: DISCONNECT_REASON.AUTH_REVOKED }))).toBe("AUTH_REVOKED");
  });

  it("mã lạ trong cột → coi như dòng cũ, suy theo luật", () => {
    expect(inferDisconnectReason(row({ disconnectReason: "GI_DO", ownerDeletedAt: AT }))).toBe("ACCOUNT_DELETED");
  });

  it("ca 07/11: chủ shop đã xóa tài khoản (hạn ủy quyền 99 năm, 0 lỗi) → ACCOUNT_DELETED", () => {
    const c = row({ ownerDeletedAt: AT, refreshTokenExpireAt: new Date("2125-10-13T17:57:50Z") });
    expect(inferDisconnectReason(c)).toBe("ACCOUNT_DELETED");
  });

  it("authLostReason (luật mất ủy quyền chung đã ghi mã sàn) → AUTH_REVOKED", () => {
    expect(inferDisconnectReason(row({ authLostReason: "shop_no_linked" }))).toBe("AUTH_REVOKED");
  });

  it("Shopee báo shop_access_expired ở lượt đồng bộ cuối → AUTH_EXPIRED", () => {
    expect(inferDisconnectReason(row({ channelName: "SHOPEE", lastSyncError: "Shopee lỗi: shop_access_expired" }))).toBe("AUTH_EXPIRED");
  });

  it("TORANO: hạn ủy quyền TikTok đến TRƯỚC lúc ngắt → AUTH_EXPIRED (cùng luật thẻ gian frontend)", () => {
    const c = row({
      shopName: "TORANO MENSWEAR",
      disconnectedAt: new Date("2026-11-06T07:14:45Z"),
      refreshTokenExpireAt: new Date("2026-11-06T07:09:28Z"),
    });
    expect(inferDisconnectReason(c)).toBe("AUTH_EXPIRED");
  });

  it("hạn Shopee (authExpireAt) đã qua lúc ngắt → AUTH_EXPIRED; hạn còn xa và không dấu gì → UNKNOWN", () => {
    expect(inferDisconnectReason(row({ channelName: "SHOPEE", authExpireAt: new Date("2026-11-01T00:00:00Z") }))).toBe("AUTH_EXPIRED");
    expect(inferDisconnectReason(row({ refreshTokenExpireAt: new Date("2027-01-01T00:00:00Z") }))).toBe("UNKNOWN");
    expect(inferDisconnectReason(row())).toBe("UNKNOWN");
  });

  it("chưa có disconnectedAt → so hạn với 'bây giờ' truyền vào", () => {
    const c = row({ disconnectedAt: null, refreshTokenExpireAt: new Date("2026-11-10T00:00:00Z") });
    expect(inferDisconnectReason(c, Date.parse("2026-11-09T00:00:00Z"))).toBe("UNKNOWN");
    expect(inferDisconnectReason(c, Date.parse("2026-11-11T00:00:00Z"))).toBe("AUTH_EXPIRED");
  });
});

describe("summarizeDisconnects / describeDisconnects — thẻ HQ", () => {
  const CASE_0711: DisconnectedRow[] = [
    row({ shopName: "ĐIỆN CƠ NAM SƠN", disconnectReason: DISCONNECT_REASON.ACCOUNT_DELETED }),
    row({ shopName: "Shop Điện Cơ Kim Khí Nam Loan", disconnectReason: DISCONNECT_REASON.ACCOUNT_DELETED }),
    row({ shopName: "TORANO MENSWEAR", disconnectReason: DISCONNECT_REASON.AUTH_EXPIRED }),
  ];

  it("ca 07/11: tổng 3 nhưng phía sàn chỉ 1 → không chạm ngưỡng 3; nhóm phía sàn đứng trước", () => {
    const s = summarizeDisconnects(CASE_0711);
    expect(s.total).toBe(3);
    expect(s.platformSide).toBe(1);
    expect(s.groups.map((g) => [g.reason, g.count, g.platformSide])).toEqual([
      ["AUTH_EXPIRED", 1, true],
      ["ACCOUNT_DELETED", 2, false],
    ]);
    expect(describeDisconnects(s)).toBe(
      "1 hết hạn ủy quyền (TORANO MENSWEAR · TIKTOK) · 2 khách xóa tài khoản (ĐIỆN CƠ NAM SƠN · TIKTOK, Shop Điện Cơ Kim Khí Nam Loan · TIKTOK)"
    );
  });

  it("dòng cũ chưa ghi lý do (UNKNOWN) và sàn từ chối đều tính phía sàn; khách ngắt tay thì không", () => {
    const s = summarizeDisconnects([
      row({ authLostReason: "36009005" }),
      row(),
      row({ disconnectReason: DISCONNECT_REASON.MANUAL }),
    ]);
    expect(s.platformSide).toBe(2);
    expect(s.groups.map((g) => g.reason)).toEqual(["AUTH_REVOKED", "UNKNOWN", "MANUAL"]);
  });

  it("tên gian giới hạn 3 mỗi nhóm, dư thì thêm '…'; danh sách rỗng → chữ rỗng", () => {
    const rows = ["A", "B", "C", "D", "E"].map((n) => row({ shopName: n, disconnectReason: DISCONNECT_REASON.AUTH_REVOKED }));
    const s = summarizeDisconnects(rows);
    expect(s.groups[0].names).toHaveLength(3);
    expect(describeDisconnects(s)).toBe("5 sàn từ chối / thu hồi (A · TIKTOK, B · TIKTOK, C · TIKTOK, …)");
    expect(summarizeDisconnects([]).total).toBe(0);
    expect(describeDisconnects(summarizeDisconnects([]))).toBe("");
  });
});
