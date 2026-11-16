// ============================================================
// Script DEV LOCAL: nạp CLIP THẬT vào sổ Video đóng hàng của tài khoản thí điểm để có dữ liệu cho
// trang /orders/videos (docs/VIDEO-DONG-HANG-THIET-KE.md, bước W1b).
//
// Đi qua CHÍNH các hàm service (beginUpload → tải lên R2 bằng đường dẫn ký sẵn → completeUpload),
// đóng vai app điện thoại; không gọi HTTP của backend. Tạo các ca: vài đơn thường, hai đơn có hoàn
// (một đơn kèm video khui), một mã không khớp đơn nào, một dòng để PENDING, một clip dài đi đường
// tải theo mảnh. KHÔNG sửa bất kỳ dòng Order nào — thiếu đơn hoàn thì chỉ báo ra.
//
// Chạy lại không sinh dòng trùng (clientId cố định theo tên ca).
//
// Rào an toàn: chỉ chạy khi DATABASE_URL trỏ localhost VÀ tên bucket kết thúc bằng "-thu".
//
// Chạy: npx tsx scripts/pack-video-seed-clips.ts "<thư mục chứa c3.mp4, b9-full.mp4, dai.mp4>"
// ============================================================
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ReturnStatus } from "@prisma/client";
import { PACK_VIDEO_PILOT_EMAILS } from "../src/config/pack-video";
import { r2ConfigFromEnv } from "../src/integrations/r2/client";
import type { PackVideoKind } from "../src/lib/pack-video-rules";
import { prisma } from "../src/lib/prisma";
import { beginUpload, completeUpload, type UploadPlan } from "../src/services/pack-video/upload";

/** Thời lượng thật của các clip thử (ffprobe 14–15/11/2026). Tệp khác → ước từ cỡ tệp. */
const KNOWN_DURATION_SEC: Record<string, number> = {
  "c3.mp4": 94,
  "b9-full.mp4": 74,
  "dai.mp4": 544,
  "dai15.mp4": 900,
};

interface Case {
  name: string;
  file: string;
  trackingCode: string;
  kind: PackVideoKind;
  hoursAgo: number;
  /** false = chỉ báo "đã quay xong", không tải — để lại dòng PENDING. */
  upload: boolean;
}

function assertSafe(): void {
  const db = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(db)) {
    throw new Error("Script này chỉ chạy với database LOCAL (DATABASE_URL phải trỏ localhost).");
  }
  const cfg = r2ConfigFromEnv();
  if (!cfg) throw new Error("Thiếu cấu hình R2 trong backend/.env (R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).");
  if (!cfg.bucket.endsWith("-thu")) {
    throw new Error(`Bucket "${cfg.bucket}" không phải bucket thử (tên phải kết thúc bằng "-thu").`);
  }
}

async function put(url: string, body: Buffer, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, { method: "PUT", body, headers });
  if (!res.ok) throw new Error(`Tải lên kho thất bại: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.headers.get("etag") ?? "";
}

async function sendToR2(plan: UploadPlan, bytes: Buffer): Promise<{ partNumber: number; etag: string }[] | undefined> {
  if (plan.mode === "single") {
    await put(plan.url, bytes, plan.headers);
    return undefined;
  }
  const done: { partNumber: number; etag: string }[] = [];
  const held = new Set(plan.uploadedParts ?? []);
  for (const part of plan.parts) {
    if (held.has(part.partNumber)) continue;
    const start = (part.partNumber - 1) * plan.partSize;
    const etag = await put(part.url, bytes.subarray(start, Math.min(start + plan.partSize, bytes.length)));
    done.push({ partNumber: part.partNumber, etag });
  }
  // Có mảnh từ lượt trước thì để máy chủ tự hỏi kho danh sách mảnh.
  return held.size > 0 ? undefined : done;
}

async function main(): Promise<void> {
  assertSafe();
  const dir = process.argv[2];
  if (!dir) throw new Error('Thiếu thư mục clip. Chạy: npx tsx scripts/pack-video-seed-clips.ts "<thư mục>"');

  const owner = await prisma.user.findFirst({
    where: { email: PACK_VIDEO_PILOT_EMAILS[0], ownerId: null, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!owner) throw new Error(`Không có tài khoản ${PACK_VIDEO_PILOT_EMAILS[0]} trong database local.`);

  const pick = (returns: boolean, take: number) =>
    prisma.order.findMany({
      where: {
        channel: { userId: owner.id },
        trackingCode: { not: null },
        NOT: { trackingCode: "" },
        returnStatus: returns ? { not: ReturnStatus.NONE } : ReturnStatus.NONE,
      },
      select: { id: true, orderCode: true, trackingCode: true, returnStatus: true },
      orderBy: { createdAt: "desc" },
      take,
    });
  const normal = await pick(false, 5);
  const returned = await pick(true, 2);
  console.log(`Đơn thường có mã vận đơn: ${normal.length} · đơn có hoàn có mã vận đơn: ${returned.length}`);
  if (normal.length < 1) throw new Error("Tài khoản local cần ít nhất 1 đơn thường có mã vận đơn.");
  if (normal.length < 3) {
    console.warn(`⚠️ Chỉ có ${normal.length} đơn thường có mã vận đơn — clip dài sẽ gắn thêm vào đơn đầu (một đơn hai video).`);
  }
  if (returned.length < 2) {
    console.warn(`⚠️ Tài khoản local chỉ có ${returned.length} đơn hoàn có mã vận đơn — script KHÔNG tự sửa đơn; ca đơn hoàn sẽ thiếu.`);
  }

  const code = (o: { trackingCode: string | null }) => o.trackingCode as string;
  const cases: Case[] = [
    { name: "thuong-1", file: "c3.mp4", trackingCode: code(normal[0]), kind: "PACK", hoursAgo: 2, upload: true },
    { name: "thuong-2", file: "b9-full.mp4", trackingCode: code(normal[1] ?? normal[0]), kind: "PACK", hoursAgo: 5, upload: true },
    { name: "dai-theo-manh", file: "dai.mp4", trackingCode: code(normal[2] ?? normal[0]), kind: "PACK", hoursAgo: 27, upload: true },
    { name: "khong-khop", file: "c3.mp4", trackingCode: "KHONGKHOPDON0001", kind: "PACK", hoursAgo: 30, upload: true },
    {
      name: "cho-tai",
      file: "b9-full.mp4",
      trackingCode: normal[3] ? code(normal[3]) : "CHOTAILEN0001",
      kind: "PACK",
      hoursAgo: 1,
      upload: false,
    },
  ];
  if (returned[0]) {
    cases.push(
      { name: "hoan-1-dong", file: "c3.mp4", trackingCode: code(returned[0]), kind: "PACK", hoursAgo: 96, upload: true },
      { name: "hoan-1-khui", file: "b9-full.mp4", trackingCode: code(returned[0]), kind: "UNBOX", hoursAgo: 8, upload: true }
    );
  }
  if (returned[1]) {
    cases.push({ name: "hoan-2-dong", file: "b9-full.mp4", trackingCode: code(returned[1]), kind: "PACK", hoursAgo: 120, upload: true });
  }

  const actor = { ownerId: owner.id, userId: owner.id };
  const cache = new Map<string, Buffer>();
  for (const c of cases) {
    const bytes = cache.get(c.file) ?? (await fs.readFile(path.join(dir, c.file)));
    cache.set(c.file, bytes);
    const durationSec = KNOWN_DURATION_SEC[c.file] ?? Math.max(1, Math.round(((bytes.length - 400_000) / 6_100_000) * 60));
    const t0 = Date.now();
    const begun = await beginUpload(actor, {
      clientId: `seed-${c.name}`,
      trackingCode: c.trackingCode,
      kind: c.kind,
      recordedAt: new Date(Date.now() - c.hoursAgo * 3_600_000),
      durationSec,
      sizeBytes: bytes.length,
      width: 720,
      height: 1280,
      deviceName: "Galaxy Note8 (nạp thử)",
    });
    let status: string = begun.video.status;
    let how = "đã có sẵn";
    if (begun.upload && c.upload) {
      const parts = await sendToR2(begun.upload, bytes);
      status = (await completeUpload(actor, begun.video.id, parts)).video.status;
      how = begun.upload.mode === "single" ? "tải một lần" : `tải theo mảnh (${begun.upload.parts.length} mảnh)`;
    } else if (begun.upload) {
      how = "để chờ tải";
    }
    console.log(
      `${c.name.padEnd(14)} ${c.kind.padEnd(5)} ${(bytes.length / 1_048_576).toFixed(1).padStart(6)} MB  ${String(durationSec).padStart(4)} s  → ${status.padEnd(7)} ${how}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`
    );
  }

  const count = await prisma.packVideo.groupBy({ by: ["status"], where: { ownerId: owner.id }, _count: { _all: true } });
  console.log("Sổ video của tài khoản thí điểm:", count.map((c) => `${c.status} ${c._count._all}`).join(" · "));
}

main()
  .catch((err) => {
    console.error("LỖI:", (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
