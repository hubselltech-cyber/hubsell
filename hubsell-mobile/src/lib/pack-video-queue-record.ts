// ============================================================
// SỔ HÀNG CHỜ TẢI VIDEO trên máy (app mobile) — 20/11/2026; lên bản app thật 26/11/2026.
//
// Anh Trung 20/11: "làm hàng chờ". Trước đó hàng chờ chỉ nằm trong bộ nhớ: tắt app giữa lúc chờ / đang gửi là MẤT
// lượt gửi, tệp clip nằm lại trong máy không ai gửi. Nay mỗi clip chờ gửi có MỘT tệp sổ nhỏ (`<clientId>.json`) nằm
// cạnh tệp clip (`<clientId>.mp4`) trong thư mục hàng chờ; mở lại app thì đọc các tệp sổ và gửi tiếp.
//
// Vì sao mỗi clip một tệp sổ chứ không phải một tệp danh sách chung: ghi đè một tệp chung mà app bị tắt giữa chừng thì
// hỏng cả danh sách (bài học hàng chờ bền bản web, THIET-KE mục 21 — "ghi theo mảnh, đừng ghi một tệp dài").
//
// `clientId` nằm trong sổ → lần gửi sau khi mở lại app dùng ĐÚNG mã cũ → máy chủ trả lại dòng cũ, không sinh video
// trùng (rào D1 của máy chủ).
// Tệp THUẦN (không nhập react-native / expo) để chạy test bằng node:test.
// ============================================================

export type QueueKind = "PACK" | "UNBOX";

export interface QueueRecord {
  v: 1;
  clientId: string;
  /**
   * Tài khoản ĐÃ QUAY clip. Chỉ tài khoản đó mới gửi clip này — đổi tài khoản trên cùng máy thì clip nằm chờ, không
   * lên nhầm shop khác. null = bản thử không đăng nhập.
   */
  ownerId: string | null;
  /**
   * Tên tệp clip TRONG thư mục hàng chờ. Chỉ lưu TÊN, không lưu đường dẫn đầy đủ: trên iPhone đường dẫn thư mục của
   * app đổi sau mỗi lần cập nhật app, đường dẫn đầy đủ ghi hôm trước hôm sau trỏ vào chỗ không còn.
   */
  fileName: string | null;
  /** Chỉ dùng khi không dời được tệp vào thư mục hàng chờ (Android ghi ra thư mục ngoài): đường dẫn gốc của tệp. */
  absPath: string | null;
  trackingCode: string;
  kind: QueueKind;
  /** Lúc bắt đầu quay (ISO). Máy chủ dùng mốc này cho luật "clip bắt đầu lúc còn giờ thì vẫn nhận". */
  recordedAt: string;
  durationSec: number;
  width: number | null;
  height: number | null;
  deviceName: string | null;
  /**
   * VÉ TẢI LÊN của máy chủ (đường v2, M2.4 — 26/11/2026): máy chủ chưa ghi sổ lúc bắt đầu, mọi thứ nằm trong vé. Giữ
   * vé trên máy để lần mở app sau báo xong / gửi nốt mảnh bằng ĐÚNG vé cũ. Vắng ở dòng sổ ghi bởi bản app trước → null.
   */
  ticket?: string | null;
  /** Cỡ mảnh của lượt tải theo mảnh gắn với vé (null = tải một lượt). */
  partSize?: number | null;
}

/** Vé là chuỗi ký sẵn của máy chủ; dài bất thường thì không phải vé — bỏ, bắt đầu lại. */
const TICKET_MAX_CHARS = 4000;

export const QUEUE_DIR_NAME = "pack-video-queue";

/** `clientId` do app sinh: chữ thường + số. Kiểm chặt vì nó thành TÊN TỆP. */
export function isClientId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{6,40}$/.test(value);
}

export const recordFileName = (clientId: string) => `${clientId}.json`;
export const clipFileName = (clientId: string) => `${clientId}.mp4`;

export function encodeRecord(record: QueueRecord): string {
  return JSON.stringify(record);
}

const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const sizeOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v) && v > 0);

/** Đọc một tệp sổ. Sai định dạng / thiếu trường / tệp ghi dở → null (bỏ qua tệp đó, KHÔNG xóa gì). */
export function decodeRecord(text: string): QueueRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !isClientId(r.clientId)) return null;
  if (!strOrNull(r.ownerId) || !strOrNull(r.fileName) || !strOrNull(r.absPath) || !strOrNull(r.deviceName)) return null;
  // Tên tệp phải đúng là tệp clip của chính dòng sổ này — không nhận tên có dấu gạch chéo / trỏ ra ngoài thư mục.
  if (r.fileName !== null && r.fileName !== clipFileName(r.clientId)) return null;
  if (r.fileName === null && !r.absPath) return null;
  if (typeof r.trackingCode !== "string" || !r.trackingCode) return null;
  if (r.kind !== "PACK" && r.kind !== "UNBOX") return null;
  if (typeof r.recordedAt !== "string" || Number.isNaN(Date.parse(r.recordedAt))) return null;
  if (typeof r.durationSec !== "number" || !Number.isFinite(r.durationSec) || r.durationSec < 0) return null;
  if (!sizeOrNull(r.width) || !sizeOrNull(r.height)) return null;
  // Vé hỏng / lạ KHÔNG làm hỏng dòng sổ: bỏ vé, clip vẫn được gửi (bắt đầu lại từ bước xin vé).
  const ticket = typeof r.ticket === "string" && r.ticket.length > 0 && r.ticket.length <= TICKET_MAX_CHARS ? r.ticket : null;
  const partSize = ticket && typeof r.partSize === "number" && Number.isInteger(r.partSize) && r.partSize > 0 ? r.partSize : null;
  return {
    v: 1,
    clientId: r.clientId,
    ownerId: r.ownerId,
    fileName: r.fileName,
    absPath: r.absPath,
    trackingCode: r.trackingCode,
    kind: r.kind,
    recordedAt: r.recordedAt,
    durationSec: r.durationSec,
    width: r.width,
    height: r.height,
    deviceName: r.deviceName,
    ticket,
    partSize,
  };
}

/**
 * Trong các dòng sổ đọc được, dòng nào được gửi lúc này: đúng tài khoản đang đăng nhập, chưa nằm trong hàng chờ đang
 * chạy; xếp theo giờ quay (clip cũ gửi trước).
 */
export function recordsToResume(
  records: QueueRecord[],
  ownerId: string | null,
  alreadyLoaded: ReadonlySet<string>
): QueueRecord[] {
  return records
    .filter((r) => r.ownerId === ownerId && !alreadyLoaded.has(r.clientId))
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
}
