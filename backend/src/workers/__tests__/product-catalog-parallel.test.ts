// Kéo danh mục song song tối đa MAX_PARALLEL gian (03/11/2026). Giả prisma + giả lượt kéo.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  shopName: string;
  channelName: string;
  nextProductSyncAt: Date | null;
  productSyncRequestedAt: Date | null;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  release: new Map<string, () => void>(),
  active: 0,
  peak: 0,
  started: [] as string[],
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    channel: {
      findFirst: async ({ where }: { where: { productSyncRequestedAt?: unknown; nextProductSyncAt: { lte: Date } } }) =>
        state.rows.find(
          (r) =>
            r.nextProductSyncAt &&
            r.nextProductSyncAt <= where.nextProductSyncAt.lte &&
            (where.productSyncRequestedAt === undefined || r.productSyncRequestedAt)
        ) ?? null,
      updateMany: async ({ where, data }: { where: { id: string; nextProductSyncAt: unknown }; data: { nextProductSyncAt: Date } }) => {
        const r = state.rows.find((x) => x.id === where.id);
        if (!r) return { count: 0 };
        // Trả về hàng chờ khi tắt: điều kiện { gt: now }.
        const cond = where.nextProductSyncAt as { gt?: Date } | Date;
        const ok =
          cond instanceof Date
            ? r.nextProductSyncAt?.getTime() === cond.getTime()
            : Boolean(cond?.gt && r.nextProductSyncAt && r.nextProductSyncAt > cond.gt);
        if (!ok) return { count: 0 };
        r.nextProductSyncAt = data.nextProductSyncAt;
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = state.rows.find((x) => x.id === where.id);
        if (r) Object.assign(r, data);
        return r;
      },
    },
  },
}));

vi.mock("../../marketplace/product-sync", () => ({
  syncChannelProducts: (ch: Row) => {
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    state.started.push(ch.id);
    return new Promise((resolve, reject) => {
      state.release.set(ch.id, () => {
        state.active--;
        if (ch.id === "loi") reject(new Error("sàn bận"));
        else resolve({ scanned: 1, created: 0, updated: 1, delisted: 0, deactivated: 0, costAutoFilled: 0 });
      });
    });
  },
}));

vi.mock("../../lib/cost-price", () => ({
  invalidateOwnerCostCaches: async () => {},
  repairZeroCostLinesForChannel: async () => ({ byId: 0, byCode: 0 }),
}));

const tick = () => new Promise((r) => setTimeout(r, 15));
const past = () => new Date(Date.now() - 1000);
const row = (id: string): Row => ({
  id,
  shopName: id,
  channelName: "TIKTOK",
  nextProductSyncAt: past(),
  productSyncRequestedAt: past(),
});
const finish = async (id: string) => {
  state.release.get(id)!();
  state.release.delete(id);
  await tick();
};

describe("runProductCatalogSync song song", () => {
  beforeEach(() => {
    state.rows = [];
    state.release.clear();
    state.active = 0;
    state.peak = 0;
    state.started = [];
  });

  it("kéo tối đa MAX_PARALLEL gian; một gian kéo lâu không chặn các gian khác; hết việc thì dừng", async () => {
    const { MAX_PARALLEL, runProductCatalogSync } = await import("../product-catalog-sync");
    expect(MAX_PARALLEL).toBe(3);
    state.rows = ["lau", "a", "b", "c", "d"].map(row);
    void runProductCatalogSync();
    await tick();
    expect(state.started).toEqual(["lau", "a", "b"]);

    // "lau" chưa xong mà c, d vẫn được chạy khi có chỗ trống.
    await finish("a");
    expect(state.started).toEqual(["lau", "a", "b", "c"]);
    await finish("b");
    expect(state.started).toEqual(["lau", "a", "b", "c", "d"]);
    await finish("c");
    await finish("d");
    expect(state.peak).toBe(3);
    await finish("lau");
    expect(state.active).toBe(0);
    expect(state.release.size).toBe(0);
  });

  it("không nhận trùng một gian; gian lỗi không chặn gian khác và ghi lịch thử lại", async () => {
    const { runProductCatalogSync } = await import("../product-catalog-sync");
    state.rows = ["loi", "x"].map(row);
    void runProductCatalogSync();
    await tick();
    void runProductCatalogSync(); // poll đến giữa chừng
    await tick();
    expect(state.started).toEqual(["loi", "x"]);
    await finish("loi");
    await finish("x");
    const loi = state.rows.find((r) => r.id === "loi") as Row & { productSyncError?: string };
    expect(loi.productSyncError).toBe("sàn bận");
    expect(loi.productSyncRequestedAt).toBeNull();
    expect(loi.nextProductSyncAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("tắt worker: trả MỌI gian đang kéo về hàng chờ, không nhận gian mới", async () => {
    const { runProductCatalogSync, stopProductCatalogSync } = await import("../product-catalog-sync");
    state.rows = ["p", "q", "r", "s"].map(row);
    void runProductCatalogSync();
    await tick();
    await stopProductCatalogSync();
    const now = Date.now();
    for (const id of ["p", "q", "r"]) {
      expect(state.rows.find((x) => x.id === id)!.nextProductSyncAt!.getTime()).toBeLessThanOrEqual(now);
    }
    for (const id of ["p", "q", "r"]) await finish(id);
    expect(state.started).not.toContain("s");
  });
});
