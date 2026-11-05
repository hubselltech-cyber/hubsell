// Tự điền mã vạch cho sản phẩm cũ theo từng bước (05/11/2026 đêm). Chạy trên DB dev.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { isInternalBarcode } from "../../lib/product-barcode";
import { runBarcodeBackfillStep } from "../product-barcode-backfill";

const stamp = Date.now();
const key = `test-barcode-backfill-${stamp}`;
let userId = "";
let ids: string[] = [];
let keptId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `barcode-backfill-${stamp}@test.local`, passwordHash: "x", fullName: "Test mã vạch" },
    select: { id: true },
  });
  userId = user.id;
  // Con trỏ đặt ở id lớn nhất đang có → việc thử chỉ duyệt các dòng tạo trong test này.
  const last = await prisma.product.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
  await prisma.maintenanceJob.create({ data: { key, cursor: last?.id ?? null } });
  for (let i = 0; i < 5; i++) {
    const p = await prisma.product.create({
      data: { userId, skuCode: `BF-${stamp}-${i}`, productName: "Sản phẩm cũ" },
      select: { id: true },
    });
    ids.push(p.id);
  }
  // Giả lập sản phẩm có TRƯỚC migration: mã vạch NULL.
  await prisma.product.updateMany({ where: { id: { in: ids } }, data: { barcode: null } });
  // Một sản phẩm đã có mã khách tự nhập — không được đụng.
  const kept = await prisma.product.create({
    data: { userId, skuCode: `BF-${stamp}-KEEP`, productName: "Đã có mã", barcode: `NSX-${stamp}` },
    select: { id: true },
  });
  keptId = kept.id;
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { userId } });
  await prisma.maintenanceJob.deleteMany({ where: { key } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("runBarcodeBackfillStep", () => {
  it("điền dần theo lô, nhớ con trỏ, xong thì đánh dấu và không quét lại", async () => {
    const s1 = await runBarcodeBackfillStep({ batch: 2, key });
    expect(s1).toMatchObject({ scanned: 2, filled: 2, done: false, totalFilled: 2 });

    // Dừng giữa chừng rồi chạy tiếp (worker khởi động lại): đi tiếp từ con trỏ, không điền lại dòng cũ.
    const afterFirst = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, barcode: true }, orderBy: { id: "asc" } });
    const firstTwo = afterFirst.slice(0, 2).map((p) => p.barcode);
    expect(firstTwo.every((b) => b && isInternalBarcode(b))).toBe(true);
    expect(afterFirst.slice(2).every((p) => p.barcode === null)).toBe(true);

    const s2 = await runBarcodeBackfillStep({ batch: 2, key });
    expect(s2).toMatchObject({ scanned: 2, filled: 2, done: false, totalFilled: 4 });
    // Lô cuối gồm dòng NULL thứ năm và dòng đã có mã — chỉ điền một.
    const s3 = await runBarcodeBackfillStep({ batch: 2, key });
    expect(s3).toMatchObject({ scanned: 2, filled: 1, done: false, totalFilled: 5 });
    const s4 = await runBarcodeBackfillStep({ batch: 2, key });
    expect(s4).toMatchObject({ scanned: 0, filled: 0, done: true, totalFilled: 5 });

    const all = await prisma.product.findMany({ where: { id: { in: ids } }, select: { barcode: true }, orderBy: { id: "asc" } });
    const codes = all.map((p) => p.barcode as string);
    expect(codes.every((c) => isInternalBarcode(c))).toBe(true);
    expect(new Set(codes).size).toBe(5);
    expect(codes.slice(0, 2)).toEqual(firstTwo);

    const kept = await prisma.product.findUniqueOrThrow({ where: { id: keptId }, select: { barcode: true } });
    expect(kept.barcode).toBe(`NSX-${stamp}`);

    const job = await prisma.maintenanceJob.findUniqueOrThrow({ where: { key } });
    expect(job.doneAt).not.toBeNull();
    expect(job.processed).toBe(5);

    // Đã xong: gọi lại không duyệt, không ghi.
    const s5 = await runBarcodeBackfillStep({ batch: 2, key });
    expect(s5).toMatchObject({ scanned: 0, filled: 0, done: true, totalFilled: 5 });
  });
});
