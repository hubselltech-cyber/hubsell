// ============================================================
// VIDEO ĐÓNG HÀNG — SỐ KHO R2 CHO HQ SỨC KHỎE (26/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 36)
//
// Anh Trung 19/11: "HQ để biết R2 mình full hay không còn kịp gia hạn nữa"; 26/11: "nếu vượt còn phải mua thêm
// dung lượng". R2 KHÔNG có trần và không có "gia hạn": quá 10 GB miễn phí thì Cloudflare tự trừ thẻ. Thứ phải canh:
//   1. đang lưu bao nhiêu → ước tiền kho một tháng, so với tiền bán giờ;
//   2. luật tự xóa có XÓA THẬT không (Chính sách bảo mật mục 8 hứa tự xóa);
//   3. worker dọn còn chạy không.
// Thẻ thanh toán Cloudflare còn trừ được không thì mã KHÔNG đọc được — phải xem trang Billing của Cloudflare.
//
// Cách làm:
//   • Worker dọn (mỗi 6 giờ) chạy MỘT câu đếm trên sổ video, chỉ trong PACK_STORAGE_WINDOW_DAYS ngày gần nhất
//     (Postgres bỏ qua các mảnh tháng cũ hơn), cộng một câu trên sổ giờ, rồi ghi kết quả vào maintenance_jobs.
//   • HQ đọc đúng MỘT dòng theo khóa chính — mở trang HQ không đụng sổ video.
//   • Không gọi Cloudflare, không thêm bảng, không migration. Nguồn là sổ của mình: tệp mồ côi trên R2 (có tệp,
//     không có dòng sổ) KHÔNG được đếm → thỉnh thoảng so tay với số trang R2 của Cloudflare.
//   • Câu đếm tốn theo số video còn trong cửa sổ. Nó tự ghi thời gian chạy (`ms`); quá PACK_STORAGE_SLOW_MS thì HQ
//     báo vàng = tới lúc đổi sang cộng dồn theo ngày. Sổ video tách sang database riêng (M2.7) thì chỉ tệp này đi theo.
// ============================================================

import { Prisma } from "@prisma/client";
import {
  PACK_STORAGE_COST_FLOOR_USD,
  PACK_STORAGE_COST_WARN_PCT,
  PACK_STORAGE_OVERDUE_GRACE_DAYS,
  PACK_STORAGE_SLOW_MS,
  PACK_STORAGE_STALE_HOURS,
  PACK_STORAGE_USD_VND,
  PACK_STORAGE_WINDOW_DAYS,
  R2_PRICING,
  packVideoGate,
  type PackVideoGate,
} from "../../config/pack-video";
import { RETENTION_DAYS, addDays, vnDateKey } from "../../lib/pack-video-retention";
import { prisma } from "../../lib/prisma";

export const STORAGE_JOB_KEY = "pack-storage-health";

const DAY_MS = 86_400_000;
const BYTES_PER_MB = 1_000_000;

interface CountSize {
  count: number;
  /** MB theo 10^6 byte (cùng hệ với GB của bảng giá R2). */
  mb: number;
}

/** Kết quả lượt dọn vừa chạy trên CHÍNH tiến trình worker (công tắc xóa + khóa R2 là của tiến trình đó). */
export interface JanitorOutcome {
  /** true = chạy bóng: không xóa tệp nào. */
  shadow: boolean;
  deleted: number;
  wouldDelete: number;
  errors: number;
  /** Lượt tải dở quá hạn tìm thấy / đã dọn. */
  staleFound: number;
  staleCleared: number;
}

/** Nội dung cột cursor của dòng STORAGE_JOB_KEY. */
export interface PackStorageRecord {
  at: string;
  /** Thời gian chạy câu đếm sổ video (ms). */
  ms: number;
  windowDays: number;
  stored: CountSize & { owners: number };
  /** Đang giữ làm bằng chứng (có lý do giữ, chưa có hạn xóa). */
  held: CountSize;
  /** Có hạn xóa đã qua quá PACK_STORAGE_OVERDUE_GRACE_DAYS ngày mà vẫn còn. */
  overdue: CountSize;
  /** Còn lưu quá trần giữ + 3 ngày. */
  pastCap: CountSize;
  pending: number;
  uploaded7d: CountSize;
  uploaded30d: number;
  deleted7d: CountSize;
  revenue30dVnd: number;
  purchases30d: number;
  janitor: JanitorOutcome | null;
}

/** Thứ HQ nhận: bản ghi + tuổi + tiền ước + cổng của tiến trình đang đọc. */
export interface PackStorageHealth {
  record: PackStorageRecord | null;
  ageHours: number | null;
  gate: PackVideoGate;
  storedGb: number | null;
  /** Ước tiền Cloudflare trừ một tháng NẾU giữ mức đang lưu cả tháng (kho + lượt ghi vượt miễn phí). */
  estUsdPerMonth: number | null;
  estVndPerMonth: number | null;
  freeStorageGb: number;
}

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const toMb = (bytes: bigint | number | null | undefined) => Math.round((num(bytes) / BYTES_PER_MB) * 10) / 10;

/**
 * Ước tiền R2 một tháng (USD): phần kho vượt miễn phí + lượt ghi vượt miễn phí. Thuần, để test được.
 * Cloudflare tính theo GB-tháng TRUNG BÌNH; đây là số "nếu giữ nguyên mức hôm nay cả tháng".
 */
export function estimateR2MonthlyUsd(storedGb: number, uploads30d: number): number {
  const storage = Math.max(0, storedGb - R2_PRICING.freeStorageGb) * R2_PRICING.storageUsdPerGbMonth;
  const classA = (Math.max(0, uploads30d - R2_PRICING.freeClassAOps) / 1_000_000) * R2_PRICING.classAUsdPerMillion;
  return Math.round((storage + classA) * 100) / 100;
}

type ScanRow = {
  stored: bigint; storedBytes: bigint | null; owners: bigint;
  held: bigint; heldBytes: bigint | null;
  overdue: bigint; overdueBytes: bigint | null;
  pastCap: bigint; pastCapBytes: bigint | null;
  pending: bigint;
  up7: bigint; up7Bytes: bigint | null; up30: bigint;
  del7: bigint; del7Bytes: bigint | null;
};

/** Đếm kho từ sổ video + tiền bán giờ 30 ngày. Chạy trên worker dọn; KHÔNG gọi từ đường khách bấm. */
export async function measurePackStorage(now: Date = new Date()): Promise<Omit<PackStorageRecord, "janitor">> {
  const today = vnDateKey(now);
  const from = addDays(today, -PACK_STORAGE_WINDOW_DAYS);
  const overdueBefore = addDays(today, -PACK_STORAGE_OVERDUE_GRACE_DAYS);
  const capBefore = addDays(today, -(RETENTION_DAYS.HARD_CAP + 3));
  const d7 = addDays(today, -7);
  const d30 = addDays(today, -30);
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);

  const started = Date.now();
  // Một lượt đọc các mảnh tháng trong cửa sổ. "Tải lên" tính cả video đã xóa sau đó (STORED + DELETED).
  const [r] = await prisma.$queryRaw<ScanRow[]>(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE v."status" = 'STORED') AS "stored",
      sum(v."sizeBytes") FILTER (WHERE v."status" = 'STORED')::bigint AS "storedBytes",
      count(DISTINCT v."ownerId") FILTER (WHERE v."status" = 'STORED') AS "owners",
      count(*) FILTER (WHERE v."status" = 'STORED' AND v."deleteAfter" IS NULL AND v."holdReason" IS NOT NULL) AS "held",
      sum(v."sizeBytes") FILTER (WHERE v."status" = 'STORED' AND v."deleteAfter" IS NULL AND v."holdReason" IS NOT NULL)::bigint AS "heldBytes",
      count(*) FILTER (WHERE v."status" = 'STORED' AND v."deleteAfter" < ${overdueBefore}::date) AS "overdue",
      sum(v."sizeBytes") FILTER (WHERE v."status" = 'STORED' AND v."deleteAfter" < ${overdueBefore}::date)::bigint AS "overdueBytes",
      count(*) FILTER (WHERE v."status" = 'STORED' AND v."recordedDate" < ${capBefore}::date) AS "pastCap",
      sum(v."sizeBytes") FILTER (WHERE v."status" = 'STORED' AND v."recordedDate" < ${capBefore}::date)::bigint AS "pastCapBytes",
      count(*) FILTER (WHERE v."status" = 'PENDING') AS "pending",
      count(*) FILTER (WHERE v."status" IN ('STORED', 'DELETED') AND v."recordedDate" > ${d7}::date) AS "up7",
      sum(v."sizeBytes") FILTER (WHERE v."status" IN ('STORED', 'DELETED') AND v."recordedDate" > ${d7}::date)::bigint AS "up7Bytes",
      count(*) FILTER (WHERE v."status" IN ('STORED', 'DELETED') AND v."recordedDate" > ${d30}::date) AS "up30",
      count(*) FILTER (WHERE v."status" = 'DELETED' AND v."deletedAt" >= ${since7}::timestamptz) AS "del7",
      sum(v."sizeBytes") FILTER (WHERE v."status" = 'DELETED' AND v."deletedAt" >= ${since7}::timestamptz)::bigint AS "del7Bytes"
    FROM "pack_videos" v
    WHERE v."recordedDate" >= ${from}::date`);
  const ms = Date.now() - started;

  // Sổ giờ: một dòng / lần mua hoặc tặng — bảng nhỏ hơn sổ video nhiều bậc.
  const [rev] = await prisma.$queryRaw<{ vnd: bigint | null; n: bigint }[]>(Prisma.sql`
    SELECT sum(g."amountVnd")::bigint AS "vnd", count(*) AS "n"
    FROM "pack_hour_grants" g
    WHERE g."kind" = 'PURCHASE' AND g."createdAt" >= ${since30}::timestamptz`);

  return {
    at: now.toISOString(),
    ms,
    windowDays: PACK_STORAGE_WINDOW_DAYS,
    stored: { count: num(r?.stored), mb: toMb(r?.storedBytes), owners: num(r?.owners) },
    held: { count: num(r?.held), mb: toMb(r?.heldBytes) },
    overdue: { count: num(r?.overdue), mb: toMb(r?.overdueBytes) },
    pastCap: { count: num(r?.pastCap), mb: toMb(r?.pastCapBytes) },
    pending: num(r?.pending),
    uploaded7d: { count: num(r?.up7), mb: toMb(r?.up7Bytes) },
    uploaded30d: num(r?.up30),
    deleted7d: { count: num(r?.del7), mb: toMb(r?.del7Bytes) },
    revenue30dVnd: num(rev?.vnd),
    purchases30d: num(rev?.n),
  };
}

/** Worker dọn gọi ở CUỐI mỗi lượt: đếm kho + ghi kèm kết quả lượt dọn. Trả bản ghi vừa lưu. */
export async function recordPackStorage(now: Date, janitor: JanitorOutcome | null): Promise<PackStorageRecord> {
  const record: PackStorageRecord = { ...(await measurePackStorage(now)), janitor };
  const cursor = JSON.stringify(record);
  await prisma.maintenanceJob.upsert({
    where: { key: STORAGE_JOB_KEY },
    create: { key: STORAGE_JOB_KEY, cursor, processed: record.stored.count, updatedAt: now },
    update: { cursor, processed: record.stored.count, updatedAt: now },
  });
  return record;
}

function parseRecord(cursor: string | null | undefined): PackStorageRecord | null {
  try {
    const r = cursor ? (JSON.parse(cursor) as PackStorageRecord) : null;
    return r && typeof r.at === "string" && r.stored && typeof r.stored.mb === "number" ? r : null;
  } catch {
    return null;
  }
}

/** Dựng thứ HQ đọc từ một bản ghi. Thuần, để test được. */
export function toPackStorageHealth(record: PackStorageRecord | null, now: Date, gate: PackVideoGate): PackStorageHealth {
  const storedGb = record ? Math.round((record.stored.mb / 1000) * 1000) / 1000 : null;
  const estUsd = record && storedGb != null ? estimateR2MonthlyUsd(storedGb, record.uploaded30d) : null;
  return {
    record,
    ageHours: record ? Math.round(((now.getTime() - Date.parse(record.at)) / 3_600_000) * 10) / 10 : null,
    gate,
    storedGb,
    estUsdPerMonth: estUsd,
    estVndPerMonth: estUsd != null ? Math.round(estUsd * PACK_STORAGE_USD_VND) : null,
    freeStorageGb: R2_PRICING.freeStorageGb,
  };
}

/** HQ Sức khỏe gọi: đọc MỘT dòng theo khóa chính. */
export async function collectPackStorageHealth(now: Date = new Date()): Promise<PackStorageHealth> {
  const job = await prisma.maintenanceJob.findUnique({ where: { key: STORAGE_JOB_KEY }, select: { cursor: true } });
  return toPackStorageHealth(parseRecord(job?.cursor), now, packVideoGate());
}

const vi = (n: number, digits = 0) => n.toLocaleString("vi-VN", { maximumFractionDigits: digits });
/** "850 MB" dưới 1 GB, "12,4 GB" từ 1 GB. */
export function fmtStorage(mb: number): string {
  return mb < 1000 ? `${vi(mb)} MB` : `${vi(mb / 1000, mb < 100_000 ? 1 : 0)} GB`;
}

/**
 * Dấu hiệu "Kho video R2" của HQ Sức khỏe. Thuần, để test được.
 *   ĐỎ  : số của lượt dọn quá PACK_STORAGE_STALE_HOURS giờ (worker dọn không chạy) · cổng đang mở mà lượt dọn CHẠY
 *         BÓNG (không xóa video nào) · có video quá hạn xóa hơn 1 ngày vẫn còn · có video còn lưu quá trần giữ;
 *   VÀNG: chưa có số · lượt dọn có lỗi xóa · câu đếm kho chậm · tiền kho vượt PACK_STORAGE_COST_WARN_PCT % tiền bán giờ;
 *   XANH: còn lại. Vượt 10 GB miễn phí KHÔNG tự làm vàng — chỉ hiện số tiền.
 */
export function packStorageSignal(h: PackStorageHealth | null): [value: string, level: "ok" | "warn" | "crit", hint: string] {
  const billing =
    "R2 không có trần dung lượng: quá 10 GB miễn phí thì Cloudflare trừ thẻ theo tháng. HQ không đọc được thẻ còn trừ được không — xem trang Billing của Cloudflare";
  if (!h) return ["không đọc được", "warn", "Bảng maintenance_jobs không đọc được — xem log [Health]"];
  const r = h.record;
  if (!r || h.ageHours == null) {
    return [
      "chưa có số",
      "warn",
      "Worker dọn video ghi số 10 phút sau khi khởi động rồi mỗi 6 giờ. Chờ quá 30 phút vẫn trống thì đọc log worker [pack-video-janitor] (PACK_VIDEO_JANITOR_OFF=1?)",
    ];
  }
  const cost =
    h.estUsdPerMonth != null && h.estUsdPerMonth > 0
      ? `≈ ${vi(h.estUsdPerMonth, 2)} USD / tháng`
      : `trong ${h.freeStorageGb} GB miễn phí`;
  const j = r.janitor;
  const janitorPart = j
    ? j.shadow
      ? `CHẠY BÓNG (sẽ xóa ${vi(j.wouldDelete)})`
      : `xóa thật ${vi(j.deleted)}${j.errors > 0 ? `, LỖI ${vi(j.errors)}` : ""}`
    : "không rõ kết quả";
  const value =
    `đang lưu ${fmtStorage(r.stored.mb)} · ${vi(r.stored.count)} video · ${vi(r.stored.owners)} chủ shop · ${cost}` +
    ` · 7 ngày: tải lên ${fmtStorage(r.uploaded7d.mb)}, đã xóa ${fmtStorage(r.deleted7d.mb)}` +
    ` · dọn ${vi(h.ageHours, 1)} giờ trước: ${janitorPart}` +
    (r.overdue.count > 0 ? ` · ${vi(r.overdue.count)} video QUÁ HẠN chưa xóa (${fmtStorage(r.overdue.mb)})` : "") +
    (r.pastCap.count > 0 ? ` · ${vi(r.pastCap.count)} video quá trần ${RETENTION_DAYS.HARD_CAP} ngày` : "");

  if (h.ageHours > PACK_STORAGE_STALE_HOURS) {
    return [value, "crit", `Số đã cũ quá ${PACK_STORAGE_STALE_HOURS} giờ — worker dọn video không chạy hoặc lượt dọn lỗi giữa chừng; trong lúc này không video nào được xóa. Đọc log worker [pack-video-janitor]`];
  }
  if (j?.shadow && h.gate !== "off" && r.stored.count > 0) {
    return [value, "crit", "Tính năng đang mở mà lượt dọn CHẠY BÓNG — Chính sách bảo mật mục 8 hứa tự xóa. Worker cần PACK_VIDEO_DELETE_ENABLED=1 và đủ 4 biến R2_* (nhóm biến Render hubsell-r2-video)"];
  }
  if (r.overdue.count > 0) {
    return [value, "crit", "Có video qua hạn xóa hơn 1 ngày vẫn còn — luật xóa không xóa được (lỗi R2 / khóa tệp không khớp chủ shop). Đọc log worker dòng 'Xóa tệp lỗi'"];
  }
  if (r.pastCap.count > 0) {
    return [value, "crit", `Có dòng sổ còn ở trạng thái đã lưu quá trần ${RETENTION_DAYS.HARD_CAP} ngày — luật vòng đời R2 đã xóa tệp sau 60 ngày, sổ đang lệch với kho. Đọc log worker [pack-video-janitor]`];
  }
  if (j && j.errors > 0) return [value, "warn", "Lượt dọn gần nhất có lỗi xóa tệp — lượt sau tự thử lại; lặp lại thì đọc log worker dòng 'Xóa tệp lỗi'"];
  if (r.ms > PACK_STORAGE_SLOW_MS) {
    return [value, "warn", `Câu đếm kho chạy ${vi(r.ms)} ms (> ${vi(PACK_STORAGE_SLOW_MS)}) — tới lúc đổi sang cộng dồn theo ngày (services/pack-video/storage-health.ts)`];
  }
  if (
    h.estUsdPerMonth != null &&
    h.estVndPerMonth != null &&
    h.estUsdPerMonth >= PACK_STORAGE_COST_FLOOR_USD &&
    h.estVndPerMonth * 100 > r.revenue30dVnd * PACK_STORAGE_COST_WARN_PCT
  ) {
    return [value, "warn", `Tiền kho ước ${vi(h.estVndPerMonth)} đ / tháng vượt ${PACK_STORAGE_COST_WARN_PCT} % tiền bán giờ 30 ngày (${vi(r.revenue30dVnd)} đ). ${billing}`];
  }
  return [value, "ok", billing];
}
