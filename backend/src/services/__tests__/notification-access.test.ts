import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  CATEGORY_PERMISSIONS,
  categoriesForPermissions,
  cleanChannelIds,
  staffCanSeeNotification,
  staffNotificationScope,
  staffNotificationWhere,
} from "../notification-access";
import { NOTIFICATION_GROUPS, categoryOf } from "../notification-categories";
import { ALL_LEAF_KEYS, PERMISSION_PRESETS } from "../../config/permission-registry";

/**
 * Chuông + tin đẩy cho nhân viên theo quyền (23/11/2026, docs/MOBILE-PHAN-QUYEN-NHAN-VIEN.md mục 8).
 * Thuần logic, không đụng DB. Phép lọc mảng của Prisma (isEmpty / hasSome) được chạy thật bằng
 * các lượt gọi API trên DB local, ghi ở docs mục 8.
 */

const ALL_CATEGORIES = NOTIFICATION_GROUPS.flatMap((g) => g.items.map((it) => it.key));
const OWNER_ONLY = ["channel_disconnected", "sync_stalled", "plan", "system_other"];
const preset = (key: string) => PERMISSION_PRESETS.find((p) => p.key === key)!.permissions;

describe("mục thông báo ↔ quyền nhân viên", () => {
  it("mọi mục đều có luật, mọi khóa quyền trong luật là khóa thật của cây quyền", () => {
    const groups = new Set(ALL_LEAF_KEYS.map((k) => k.split(".")[0]));
    for (const key of ALL_CATEGORIES) {
      expect(key in CATEGORY_PERMISSIONS, key).toBe(true);
      for (const p of CATEGORY_PERMISSIONS[key] ?? []) {
        expect(ALL_LEAF_KEYS.includes(p) || groups.has(p), `${key} → ${p}`).toBe(true);
      }
    }
  });

  it("nhân viên đủ quyền nhận mọi mục, trừ bốn mục chỉ chủ shop", () => {
    const got = categoriesForPermissions(ALL_LEAF_KEYS);
    expect(ALL_CATEGORIES.filter((c) => !got.includes(c))).toEqual(OWNER_ONLY);
  });

  it("gói dịch vụ / hệ thống / nối lại gian không bao giờ tới nhân viên", () => {
    for (const c of OWNER_ONLY) expect(CATEGORY_PERMISSIONS[c as keyof typeof CATEGORY_PERMISSIONS]).toBeNull();
    // type lạ rơi về system_other (luôn bật với chủ shop) → nhân viên cũng không thấy
    expect(CATEGORY_PERMISSIONS[categoryOf("loai-moi-chua-xep")]).toBeNull();
    expect(CATEGORY_PERMISSIONS[categoryOf("plan-expired")]).toBeNull();
  });

  it("ba mẫu quyền có sẵn", () => {
    // Nhân viên kho: đơn hàng + hoàn + tồn kho; KHÔNG báo cáo tuần, quảng cáo, hóa đơn
    expect(categoriesForPermissions(preset("WAREHOUSE"))).toEqual([
      "order_new",
      "order_express",
      "cancel_request",
      "return",
      "delivery_fail",
      "auto_arrange",
      "stockout",
      "low_stock",
    ]);
    // Kế toán: tài chính + hóa đơn; KHÔNG đơn hàng, kho, quảng cáo
    expect(categoriesForPermissions(preset("ACCOUNTANT"))).toEqual([
      "weekly_report",
      "finance_alert",
      "invoice",
      "tax_deadline",
    ]);
    // Nhân viên vận hành: như kho (không có Tổng kho… có warehouse.products) — không tài chính
    const sales = categoriesForPermissions(preset("SALES"));
    expect(sales).toContain("order_new");
    expect(sales).toContain("stockout");
    expect(sales).not.toContain("weekly_report");
    expect(sales).not.toContain("ads_daily");
  });

  it("quyền lẻ", () => {
    expect(categoriesForPermissions(["warehouse.returns"])).toEqual(["return"]);
    expect(categoriesForPermissions(["ads.tiktok"])).toEqual(["ads_advice", "ads_auto", "ads_wallet", "ads_daily", "ads_link"]);
    expect(categoriesForPermissions(["koc"])).toEqual(["koc"]);
    // Có quyền tài chính nhưng không phải Báo cáo dòng tiền → không nhận báo cáo tuần
    expect(categoriesForPermissions(["finance.realized-pnl", "finance.fee-audit"])).toEqual([]);
    expect(categoriesForPermissions(["dashboard", "operations.reviews"])).toEqual([]);
    expect(categoriesForPermissions([])).toEqual([]);
  });
});

/** Chạy điều kiện Prisma trong bộ nhớ — chỉ đủ các toán tử staffNotificationWhere dùng. */
function matchesWhere(where: Prisma.NotificationWhereInput, n: { category: string | null; channelIds: string[] }): boolean {
  const cat = where.category as { in: string[] };
  if (!n.category || !cat.in.includes(n.category)) return false;
  const arr = where.channelIds as { isEmpty?: boolean } | undefined;
  if (arr?.isEmpty === false && n.channelIds.length === 0) return false;
  const not = where.NOT as { channelIds: { hasSome: string[] } } | undefined;
  if (not && n.channelIds.some((id) => not.channelIds.hasSome.includes(id))) return false;
  return true;
}

describe("phạm vi gian", () => {
  const OWNER = ["A", "B", "C"];
  const perms = ["orders", "finance.analytics"];

  it("được giao đủ gian: thấy cả thông báo của cả shop; không thêm điều kiện gian vào SQL", () => {
    const scope = staffNotificationScope(perms, ["A", "B", "C"], OWNER);
    expect(scope.forbiddenChannelIds).toEqual([]);
    expect(staffNotificationWhere(scope)).toEqual({ category: { in: scope.categories } });
    expect(staffCanSeeNotification(scope, { category: "weekly_report", channelIds: [] })).toBe(true);
    expect(staffCanSeeNotification(scope, { category: "order_new", channelIds: ["A", "C"] })).toBe(true);
  });

  it("bị giới hạn gian: chỉ thấy thông báo mà MỌI gian của nó đều được giao", () => {
    const scope = staffNotificationScope(perms, ["A"], OWNER);
    expect(scope.forbiddenChannelIds).toEqual(["B", "C"]);
    expect(staffCanSeeNotification(scope, { category: "cancel_request", channelIds: ["A"] })).toBe(true);
    expect(staffCanSeeNotification(scope, { category: "cancel_request", channelIds: ["B"] })).toBe(false);
    // đợt đơn mới gom gian A + B: có gian không được giao → không thấy cả đợt
    expect(staffCanSeeNotification(scope, { category: "order_new", channelIds: ["A", "B"] })).toBe(false);
    // chuyện của cả shop (không ghi gian) → không tới người bị giới hạn gian
    expect(staffCanSeeNotification(scope, { category: "weekly_report", channelIds: [] })).toBe(false);
  });

  it("shop nối thêm gian mà chưa giao cho nhân viên → nhân viên thành bị giới hạn gian", () => {
    const before = staffNotificationScope(perms, ["A", "B", "C"], OWNER);
    const after = staffNotificationScope(perms, ["A", "B", "C"], [...OWNER, "D"]);
    expect(staffCanSeeNotification(before, { category: "weekly_report", channelIds: [] })).toBe(true);
    expect(staffCanSeeNotification(after, { category: "weekly_report", channelIds: [] })).toBe(false);
    expect(staffCanSeeNotification(after, { category: "order_new", channelIds: ["A"] })).toBe(true);
    expect(staffCanSeeNotification(after, { category: "order_new", channelIds: ["D"] })).toBe(false);
  });

  it("gian đã xóa khỏi shop không chặn thông báo cũ của nó", () => {
    const scope = staffNotificationScope(perms, ["A"], ["A"]);
    expect(staffCanSeeNotification(scope, { category: "order_new", channelIds: ["GIAN-DA-XOA"] })).toBe(true);
  });

  it("thông báo cũ chưa có mục (phát trước bản này) và mục ngoài quyền: không thấy", () => {
    const scope = staffNotificationScope(["orders"], ["A", "B", "C"], OWNER);
    expect(staffCanSeeNotification(scope, { category: null, channelIds: [] })).toBe(false);
    expect(staffCanSeeNotification(scope, { category: "weekly_report", channelIds: [] })).toBe(false);
    expect(staffCanSeeNotification(scope, { category: "plan", channelIds: [] })).toBe(false);
  });

  it("điều kiện SQL và phép lọc trong bộ nhớ cho CÙNG kết quả trên mọi tổ hợp", () => {
    const scopes = [
      staffNotificationScope(ALL_LEAF_KEYS, ["A", "B", "C"], OWNER),
      staffNotificationScope(ALL_LEAF_KEYS, ["A", "B"], OWNER),
      staffNotificationScope(["orders"], ["A"], OWNER),
      staffNotificationScope(["warehouse.returns"], [], OWNER),
      staffNotificationScope(["finance.analytics"], ["B", "C"], OWNER),
    ];
    const channelSets = [[], ["A"], ["B"], ["A", "B"], ["A", "C"], ["A", "B", "C"], ["X"], ["A", "X"]];
    let checked = 0;
    for (const scope of scopes) {
      const where = staffNotificationWhere(scope);
      for (const category of [...ALL_CATEGORIES, null]) {
        for (const channelIds of channelSets) {
          const n = { category, channelIds };
          expect(matchesWhere(where, n), JSON.stringify({ scope, n })).toBe(staffCanSeeNotification(scope, n));
          checked++;
        }
      }
    }
    expect(checked).toBe(scopes.length * (ALL_CATEGORIES.length + 1) * channelSets.length);
  });
});

describe("cleanChannelIds", () => {
  it("bỏ rỗng, bỏ trùng, giữ thứ tự", () => {
    expect(cleanChannelIds(["A", null, undefined, "", "B", "A"])).toEqual(["A", "B"]);
    expect(cleanChannelIds(undefined)).toEqual([]);
    expect(cleanChannelIds([undefined])).toEqual([]);
  });
});
