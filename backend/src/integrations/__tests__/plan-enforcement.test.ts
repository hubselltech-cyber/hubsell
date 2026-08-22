// ============================================================
// GĐ2 CƯỠNG CHẾ TRẦN GÓI — kiểm chứng máy trạng thái trên DB dev:
//   · Chưa có thuê bao → không giới hạn, không bao giờ khóa.
//   · Trần đơn bậc thang: <80% ok → 80% warn → 100% over (mở ân hạn 7 ngày,
//     ghi overQuotaSince) → 120% HOẶC quá ân hạn = locked; sang tháng tự reset.
//   · Gói hết hạn: trong ân hạn 7 ngày chỉ cảnh báo, quá ân hạn khóa (EXPIRED).
//   · Chặn cứng: assertChannelSlot chỉ đếm gian ACTIVE (ngắt kết nối = trống
//     chỗ), assertStaffSlot đếm nhân viên hiện có; đủ chỗ thì không ném.
// ============================================================
import "./load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../prisma";
import {
  PlanLimitError,
  assertChannelSlot,
  assertStaffSlot,
  getOwnerPlanState,
  invalidatePlanState,
} from "../../plan-enforcement";

const STAMP = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

let ownerId = "";
let planId = "";
let channelId = "";

/** Đổi thông số rồi đọc trạng thái TƯƠI (bỏ qua cache TTL 60s). */
async function freshState() {
  invalidatePlanState(ownerId);
  return getOwnerPlanState(ownerId);
}

async function setOrderCount(n: number) {
  await prisma.order.deleteMany({ where: { channelId } });
  for (let i = 0; i < n; i++) {
    await prisma.order.create({
      data: {
        channelId,
        orderCode: `TEST-PLANQ-${STAMP}-${i}`,
        customerName: "Khách test",
        itemCount: 1,
      },
    });
  }
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `test-planq-${STAMP}@hubsell.test`,
      passwordHash: "x",
      fullName: `TEST planq-${STAMP}`,
      role: "ADMIN",
    },
  });
  ownerId = owner.id;
  const channel = await prisma.channel.create({
    data: {
      userId: ownerId,
      channelName: "SHOPEE",
      shopName: `TEST planq ${STAMP}`,
      apiToken: `test_planq_${STAMP}`,
      status: "ACTIVE",
    },
  });
  channelId = channel.id;
  const plan = await prisma.servicePlan.create({
    data: {
      code: `TSTQ${STAMP}`,
      name: "Test Quota",
      priceMonthly: 99_000,
      maxOrdersPerMonth: 10,
      maxChannels: 1,
      maxStaff: 1,
      isActive: true,
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { ownerId } });
  await prisma.user.deleteMany({ where: { OR: [{ id: ownerId }, { ownerId }] } });
  await prisma.servicePlan.deleteMany({ where: { id: planId } });
  await prisma.$disconnect();
});

describe("getOwnerPlanState — trần đơn bậc thang", () => {
  it("chưa có thuê bao: không giới hạn, không khóa", async () => {
    const st = await freshState();
    expect(st.hasSubscription).toBe(false);
    expect(st.locked).toBe(false);
    expect(st.orders.state).toBe("ok");
  });

  it("dưới 80%: ok — không mốc chuông, không ân hạn", async () => {
    await prisma.subscription.create({
      data: {
        userId: ownerId,
        planId,
        currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS),
      },
    });
    await setOrderCount(7);
    const st = await freshState();
    expect(st.orders.state).toBe("ok");
    expect(st.orders.used).toBe(7);
    expect(st.locked).toBe(false);
  });

  it("chạm 80%: warn + ghi mốc chuông 80 (một lần mỗi tháng)", async () => {
    await setOrderCount(8);
    const st = await freshState();
    expect(st.orders.state).toBe("warn");
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: ownerId } });
    expect(sub.quotaNotifiedLevel).toBe(80);
    expect(sub.overQuotaSince).toBeNull();
  });

  it("chạm 100%: over + mở đồng hồ ân hạn, CHƯA khóa", async () => {
    await setOrderCount(10);
    const st = await freshState();
    expect(st.orders.state).toBe("over");
    expect(st.locked).toBe(false);
    expect(st.orders.graceDeadline).not.toBeNull();
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: ownerId } });
    expect(sub.overQuotaSince).not.toBeNull();
    expect(sub.quotaNotifiedLevel).toBe(100);
  });

  it("vượt 120%: khóa ngay dù chưa hết 7 ngày ân hạn", async () => {
    await setOrderCount(12);
    const st = await freshState();
    expect(st.orders.state).toBe("locked");
    expect(st.locked).toBe(true);
    expect(st.lockedReason).toBe("ORDERS");
  });

  it("quá 7 ngày ân hạn (dù mới 100%): khóa", async () => {
    await setOrderCount(10);
    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    await prisma.subscription.update({
      where: { userId: ownerId },
      data: { quotaMonth: monthKey, overQuotaSince: new Date(Date.now() - 8 * DAY_MS) },
    });
    const st = await freshState();
    expect(st.orders.state).toBe("locked");
    expect(st.lockedReason).toBe("ORDERS");
  });

  it("sang tháng (quotaMonth cũ) + đơn tụt dưới trần: tự lành về ok, xoá mốc", async () => {
    await setOrderCount(3);
    await prisma.subscription.update({
      where: { userId: ownerId },
      data: {
        quotaMonth: "2020-01",
        overQuotaSince: new Date(Date.now() - 40 * DAY_MS),
        quotaNotifiedLevel: 120,
      },
    });
    const st = await freshState();
    expect(st.orders.state).toBe("ok");
    expect(st.locked).toBe(false);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { userId: ownerId } });
    expect(sub.overQuotaSince).toBeNull();
    expect(sub.quotaNotifiedLevel).toBe(0);
  });
});

describe("getOwnerPlanState — gói hết hạn", () => {
  it("hết hạn 2 ngày (trong ân hạn 7 ngày): cảnh báo nhưng CHƯA khóa", async () => {
    await prisma.subscription.update({
      where: { userId: ownerId },
      data: { currentPeriodEnd: new Date(Date.now() - 2 * DAY_MS) },
    });
    const st = await freshState();
    expect(st.subscription?.status).toBe("EXPIRED");
    expect(st.expiry.expired).toBe(true);
    expect(st.locked).toBe(false);
  });

  it("hết hạn 8 ngày (quá ân hạn): khóa vì EXPIRED", async () => {
    await prisma.subscription.update({
      where: { userId: ownerId },
      data: { currentPeriodEnd: new Date(Date.now() - 8 * DAY_MS) },
    });
    const st = await freshState();
    expect(st.locked).toBe(true);
    expect(st.lockedReason).toBe("EXPIRED");
    // Gia hạn xong là mở lại ngay.
    await prisma.subscription.update({
      where: { userId: ownerId },
      data: { currentPeriodEnd: new Date(Date.now() + 30 * DAY_MS) },
    });
    const after = await freshState();
    expect(after.locked).toBe(false);
  });
});

describe("assertChannelSlot / assertStaffSlot — chặn cứng tạo mới", () => {
  it("đủ trần gian ACTIVE thì ném PlanLimitError; ngắt kết nối là trống chỗ", async () => {
    invalidatePlanState(ownerId);
    // maxChannels = 1, đang có 1 gian ACTIVE → hết chỗ.
    await expect(assertChannelSlot(ownerId)).rejects.toBeInstanceOf(PlanLimitError);
    // Ngắt kết nối gian → trống chỗ, tạo mới được.
    await prisma.channel.update({
      where: { id: channelId },
      data: { status: "DISCONNECTED" },
    });
    await expect(assertChannelSlot(ownerId)).resolves.toBeUndefined();
    // Xin 2 chỗ một lúc (lô TikTok) khi chỉ còn 1 → vẫn chặn.
    await expect(assertChannelSlot(ownerId, 2)).rejects.toBeInstanceOf(PlanLimitError);
    await prisma.channel.update({ where: { id: channelId }, data: { status: "ACTIVE" } });
  });

  it("đủ trần nhân viên thì ném; còn chỗ thì cho qua", async () => {
    invalidatePlanState(ownerId);
    await expect(assertStaffSlot(ownerId)).resolves.toBeUndefined();
    await prisma.user.create({
      data: {
        staffUsername: `planq${STAMP}`,
        passwordHash: "x",
        fullName: "NV test trần",
        role: "SALES",
        ownerId,
      },
    });
    await expect(assertStaffSlot(ownerId)).rejects.toBeInstanceOf(PlanLimitError);
  });
});
