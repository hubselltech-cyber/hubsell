// ============================================================
// BỘ LỌC "TRẠNG THÁI VẬN CHUYỂN" của Đối soát đơn hoàn — điều kiện Prisma
// (returnShippingWhere) phải chia đơn Y HỆT hàm thuần (returnShippingFilterOf) mà cột
// trên web dùng. Chạy trên Postgres thật vì chỗ dễ lệch là NULL / chuỗi rỗng / NOT.
// Tự tạo gian + đơn riêng rồi xóa; không nối được DB → cả file tự BỎ QUA.
// docs/DOI-SOAT-DON-HOAN-HANG-LOAT-VA-THAT-THU.md mục 14
// ============================================================

import "../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChannelName, ReturnStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { CANCELLED_AFTER_SHIP } from "../../integrations/cancelled-after-ship";
import {
  RETURN_SHIPPING_FILTERS,
  returnShippingFilterOf,
  returnShippingWhere,
  type ReturnShippingFilter,
} from "../return-shipping";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `rsf-${Date.now()}`;
const T1 = new Date("2026-11-01T00:00:00Z");
const T2 = new Date("2026-11-05T00:00:00Z");

interface Case {
  code: string;
  expected: ReturnShippingFilter;
  returnStatus: ReturnStatus;
  platformReturnStatus?: string | null;
  returnDeliveredAt?: Date | null;
  returnedAt?: Date | null;
  returnTrackingCode?: string | null;
}

const A = ReturnStatus.AWAITING;
const CASES: Case[] = [
  // Kho đã nhận: luôn "hoàn thành công", bất kể sàn nói gì.
  { code: "kho-nhan", expected: "RETURNED", returnStatus: ReturnStatus.RECEIVED, returnedAt: T2 },
  { code: "kho-nhap", expected: "RETURNED", returnStatus: ReturnStatus.RECEIVED_INTACT, returnedAt: T2, platformReturnStatus: "ACCEPTED", returnDeliveredAt: T1 },
  { code: "kho-hong-giao-that-bai", expected: "RETURNED", returnStatus: ReturnStatus.DAMAGED, returnedAt: T2, platformReturnStatus: CANCELLED_AFTER_SHIP },
  { code: "kho-xoa-so", expected: "RETURNED", returnStatus: ReturnStatus.WRITTEN_OFF },
  // Sàn báo kiện đã về, kho chưa quét.
  { code: "san-bao-ve", expected: "RETURNED", returnStatus: A, platformReturnStatus: "ACCEPTED", returnDeliveredAt: T1, returnTrackingCode: "SPX1" },
  { code: "san-bao-ve-giao-that-bai", expected: "RETURNED", returnStatus: A, platformReturnStatus: CANCELLED_AFTER_SHIP, returnDeliveredAt: T1 },
  { code: "lazada-bao-ve", expected: "RETURNED", returnStatus: A, platformReturnStatus: "RTM_RECEIVE_ITEM", returnTrackingCode: "LZ1" },
  // Giao thất bại quay đầu, chưa có mốc về (có hay không có mã vận đơn hoàn đều thế).
  { code: "giao-that-bai", expected: "FAILED_DELIVERY", returnStatus: A, platformReturnStatus: CANCELLED_AFTER_SHIP },
  { code: "giao-that-bai-co-ma", expected: "FAILED_DELIVERY", returnStatus: A, platformReturnStatus: CANCELLED_AFTER_SHIP, returnTrackingCode: "SPX2" },
  // Không có trạng thái sàn: null lẫn chuỗi rỗng, kể cả khi có mã vận đơn hoàn.
  { code: "khong-trang-thai", expected: "NO_SIGNAL", returnStatus: A, platformReturnStatus: null },
  { code: "trang-thai-rong", expected: "NO_SIGNAL", returnStatus: A, platformReturnStatus: "" },
  { code: "khong-trang-thai-co-ma", expected: "NO_SIGNAL", returnStatus: A, platformReturnStatus: null, returnTrackingCode: "SPX3" },
  // Khách đã gửi kiện.
  { code: "co-ma-van-don", expected: "RETURNING", returnStatus: A, platformReturnStatus: "PROCESSING", returnTrackingCode: "SPX4" },
  { code: "tiktok-da-gui", expected: "RETURNING", returnStatus: A, platformReturnStatus: "BUYER_SHIPPED_ITEM", returnTrackingCode: null },
  { code: "lazada-da-gui", expected: "RETURNING", returnStatus: A, platformReturnStatus: "BUYER_RETURN_ITEM", returnTrackingCode: "" },
  // Khách chưa gửi: mã vận đơn hoàn null lẫn chuỗi rỗng.
  { code: "cho-khach-null", expected: "WAITING_BUYER", returnStatus: A, platformReturnStatus: "REQUESTED", returnTrackingCode: null },
  { code: "cho-khach-rong", expected: "WAITING_BUYER", returnStatus: A, platformReturnStatus: "AWAITING_BUYER_SHIP", returnTrackingCode: "" },
];

describe.skipIf(!dbReady)("Bộ lọc Trạng thái vận chuyển — điều kiện Prisma khớp hàm thuần", () => {
  let userId = "";
  let channelId = "";

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${TAG}@test.local`, passwordHash: "x", fullName: TAG },
      select: { id: true },
    });
    userId = user.id;
    const channel = await prisma.channel.create({
      data: { userId, channelName: ChannelName.SHOPEE, shopName: TAG },
      select: { id: true },
    });
    channelId = channel.id;
    await prisma.order.createMany({
      data: CASES.map((c) => ({
        channelId,
        orderCode: `${TAG}-${c.code}`,
        customerName: "Khách thử",
        totalAmount: 100_000,
        returnStatus: c.returnStatus,
        platformReturnStatus: c.platformReturnStatus ?? null,
        returnDeliveredAt: c.returnDeliveredAt ?? null,
        returnedAt: c.returnedAt ?? null,
        returnTrackingCode: c.returnTrackingCode ?? null,
      })),
    });
  });

  afterAll(async () => {
    if (channelId) await prisma.order.deleteMany({ where: { channelId } });
    if (channelId) await prisma.channel.deleteMany({ where: { id: channelId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("hàm thuần xếp từng ca đúng nhóm mong đợi", () => {
    for (const c of CASES) {
      expect(
        returnShippingFilterOf({
          returnStatus: c.returnStatus,
          returnedAt: c.returnedAt ?? null,
          returnDeliveredAt: c.returnDeliveredAt ?? null,
          platformReturnStatus: c.platformReturnStatus ?? null,
          returnTrackingCode: c.returnTrackingCode ?? null,
        }),
        c.code
      ).toBe(c.expected);
    }
  });

  it("mỗi nhóm lọc trả đúng các đơn hàm thuần xếp vào nhóm đó; không sót, không trùng", async () => {
    const seen: string[] = [];
    for (const filter of RETURN_SHIPPING_FILTERS) {
      const rows = await prisma.order.findMany({
        where: { AND: [{ channelId }, returnShippingWhere(filter)] },
        select: { orderCode: true },
      });
      const got = rows.map((r) => r.orderCode.replace(`${TAG}-`, "")).sort();
      const want = CASES.filter((c) => c.expected === filter).map((c) => c.code).sort();
      expect(got, filter).toEqual(want);
      seen.push(...got);
    }
    expect(seen.sort()).toEqual(CASES.map((c) => c.code).sort());
  });
});
