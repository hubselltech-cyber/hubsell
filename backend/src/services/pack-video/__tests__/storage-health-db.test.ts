// ============================================================
// VIDEO ĐÓNG HÀNG — câu đếm kho cho HQ chạy trên Postgres thật.
// Câu đếm là của CẢ database (không lọc chủ shop) nên rào kiểm so CHÊNH LỆCH trước / sau khi chèn video thử.
// Dòng số của HQ trong maintenance_jobs được chép ra trước và trả lại y như cũ.
// Tự tạo dữ liệu rồi xóa; không nối được DB → cả file tự BỎ QUA.
// ============================================================

import "../../../integrations/__tests__/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RETENTION_DAYS, addDays, vnDateKey } from "../../../lib/pack-video-retention";
import { buildPackVideoKey } from "../../../lib/pack-video-key";
import { prisma } from "../../../lib/prisma";
import { STORAGE_JOB_KEY, collectPackStorageHealth, measurePackStorage, recordPackStorage } from "../storage-health";

const dbReady: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "pack_videos" LIMIT 1`;
    await prisma.$queryRaw`SELECT 1 FROM "pack_hour_grants" LIMIT 1`;
    return true;
  } catch {
    return false;
  }
})();

const TAG = `pvs${Date.now()}`;
const NOW = new Date();
const TODAY = vnDateKey(NOW);
const MB = 1_000_000;

describe.skipIf(!dbReady)("Video đóng hàng — câu đếm kho cho HQ", () => {
  const ownerA = `${TAG}-a`;
  const ownerB = `${TAG}-b`;
  let seq = 0;
  let savedJob: { cursor: string | null; processed: number; updatedAt: Date } | null = null;

  async function addVideo(o: {
    owner: string;
    status: "STORED" | "DELETED" | "PENDING";
    mb: number;
    deleteAfter?: string;
    holdReason?: string;
    deletedAt?: Date;
  }) {
    seq += 1;
    const id = `${TAG}v${seq}`;
    await prisma.packVideo.create({
      data: {
        id,
        recordedDate: new Date(`${TODAY}T00:00:00.000Z`),
        ownerId: o.owner,
        clientId: `${TAG}-c${seq}`,
        trackingCode: `${TAG}-T${seq}`,
        kind: "PACK",
        recordedById: o.owner,
        recordedAt: NOW,
        durationSec: 60,
        sizeBytes: BigInt(o.mb * MB),
        objectKey: buildPackVideoKey({ ownerId: o.owner, recordedDate: TODAY, id }),
        status: o.status,
        uploadedAt: o.status === "PENDING" ? null : NOW,
        deleteAfter: o.deleteAfter ? new Date(`${o.deleteAfter}T00:00:00.000Z`) : null,
        holdReason: o.holdReason ?? null,
        deletedAt: o.deletedAt ?? null,
      },
    });
  }

  beforeAll(async () => {
    savedJob = await prisma.maintenanceJob.findUnique({
      where: { key: STORAGE_JOB_KEY },
      select: { cursor: true, processed: true, updatedAt: true },
    });
  });

  afterAll(async () => {
    await prisma.packVideo.deleteMany({ where: { ownerId: { in: [ownerA, ownerB] } } });
    await prisma.packHourGrant.deleteMany({ where: { ownerId: { in: [ownerA, ownerB] } } });
    if (savedJob) {
      await prisma.maintenanceJob.update({ where: { key: STORAGE_JOB_KEY }, data: savedJob });
    } else {
      await prisma.maintenanceJob.deleteMany({ where: { key: STORAGE_JOB_KEY } });
    }
  });

  it("đếm đúng phần chênh: đang lưu / đang giữ / quá hạn / tải dở / tải lên / đã xóa / tiền bán giờ", async () => {
    const before = await measurePackStorage(NOW);

    await addVideo({ owner: ownerA, status: "STORED", mb: 6 }); // chưa có hạn, không giữ
    await addVideo({ owner: ownerA, status: "STORED", mb: 4, holdReason: "RETURN_OPEN" }); // đang giữ
    await addVideo({ owner: ownerB, status: "STORED", mb: 10, deleteAfter: addDays(TODAY, -3) }); // quá hạn 3 ngày
    await addVideo({ owner: ownerB, status: "STORED", mb: 2, deleteAfter: TODAY }); // tới hạn hôm nay — CHƯA tính quá hạn
    await addVideo({ owner: ownerB, status: "DELETED", mb: 8, deletedAt: NOW }); // đã xóa
    await addVideo({ owner: ownerA, status: "PENDING", mb: 5 }); // tải dở — không tính vào đang lưu
    await prisma.packHourGrant.createMany({
      data: [
        { id: `${TAG}g1`, ownerId: ownerA, seconds: 72_000, kind: "PURCHASE", paymentRef: `test:${TAG}:1`, amountVnd: 40_000 },
        { id: `${TAG}g2`, ownerId: ownerA, seconds: 7_200, kind: "GRANT", paymentRef: `welcome-test:${TAG}` }, // tặng — không phải tiền
      ],
    });

    const after = await measurePackStorage(NOW);
    const d = (pick: (r: typeof after) => number) => Math.round((pick(after) - pick(before)) * 10) / 10;

    expect(d((r) => r.stored.count)).toBe(4);
    expect(d((r) => r.stored.mb)).toBe(22);
    expect(d((r) => r.stored.owners)).toBe(2);
    expect(d((r) => r.held.count)).toBe(1);
    expect(d((r) => r.held.mb)).toBe(4);
    expect(d((r) => r.overdue.count)).toBe(1);
    expect(d((r) => r.overdue.mb)).toBe(10);
    expect(d((r) => r.pastCap.count)).toBe(0);
    expect(d((r) => r.pending)).toBe(1);
    expect(d((r) => r.uploaded7d.count)).toBe(5); // 4 đang lưu + 1 đã xóa
    expect(d((r) => r.uploaded7d.mb)).toBe(30);
    expect(d((r) => r.uploaded30d)).toBe(5);
    expect(d((r) => r.deleted7d.count)).toBe(1);
    expect(d((r) => r.deleted7d.mb)).toBe(8);
    expect(d((r) => r.revenue30dVnd)).toBe(40_000);
    expect(d((r) => r.purchases30d)).toBe(1);
    expect(after.ms).toBeGreaterThanOrEqual(0);
  });

  it("video còn lưu quá trần giữ + 3 ngày được đếm riêng", async () => {
    // Dời "hôm nay" tới sau trần: 4 video thử (quay hôm nay, còn lưu) thành quá trần.
    const later = new Date(NOW.getTime() + (RETENTION_DAYS.HARD_CAP + 5) * 86_400_000);
    const all = await measurePackStorage(later);
    await prisma.packVideo.deleteMany({ where: { ownerId: { in: [ownerA, ownerB] }, status: "STORED" } });
    const without = await measurePackStorage(later);
    expect(all.pastCap.count - without.pastCap.count).toBe(4);
    expect(Math.round((all.pastCap.mb - without.pastCap.mb) * 10) / 10).toBe(22);
  });

  it("ghi số kèm kết quả lượt dọn → HQ đọc lại đúng một dòng", async () => {
    const janitor = { shadow: false, deleted: 7, wouldDelete: 0, errors: 1, staleFound: 2, staleCleared: 2 };
    const saved = await recordPackStorage(NOW, janitor);
    const h = await collectPackStorageHealth(new Date(NOW.getTime() + 3 * 3_600_000));
    expect(h.record?.janitor).toEqual(janitor);
    expect(h.record?.stored.count).toBe(saved.stored.count);
    expect(h.ageHours).toBe(3);
    expect(h.storedGb).toBeCloseTo(saved.stored.mb / 1000, 3);
    expect(h.freeStorageGb).toBe(10);
  });
});
