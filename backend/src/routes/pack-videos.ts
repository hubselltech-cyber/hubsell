// ============================================================
// VIDEO ĐÓNG HÀNG — /api/pack-videos (16/11/2026, docs/VIDEO-DONG-HANG-THIET-KE.md mục 5)
//
// Mount trong app.ts SAU requireAuth + requirePackVideo: cả nhóm chỉ mở cho tài khoản được bật
// tính năng (bản thí điểm: một tài khoản). Tệp này MỎNG — đọc tham số, gọi service, trả kết quả.
// Chủ shop LUÔN lấy từ phiên đăng nhập (req.ownerId), không đọc từ thân / query.
//
//   POST /                 app báo "đã quay xong"        → dòng sổ PENDING + đường dẫn tải ký sẵn
//   POST /:id/parts        xin ký lại / ký thêm mảnh
//   POST /:id/complete     app báo "tải xong"            → máy chủ hỏi R2 rồi mới ghi STORED
//   GET  /                 danh sách video (con trỏ)
//   GET  /summary          số trên chip
//   GET  /returns          danh sách ĐƠN hoàn + số trên thẻ
//   GET  /stats            thống kê thời gian quay
//   GET  /hours            giờ đã mua · đã quay · còn lại + các gói giờ
//   GET  /by-order/:orderId  hồ sơ video của một đơn
//   POST /order-flags      trong các đơn này, đơn nào đã có video
//   GET  /:id/url          đường dẫn xem / tải về (hạn ngắn)
// Các đường có chữ cố định (summary, returns, stats, hours, by-order, order-flags) khai TRƯỚC "/:id".
// ============================================================

import { Router, type NextFunction, type Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { R2Error } from "../integrations/r2/client";
import { parseDateRange } from "../lib/date-range";
import { PACK_VIDEO_KINDS, parseBeginInput, type PackVideoKind } from "../lib/pack-video-rules";
import { getHoursOverview } from "../services/pack-video/hours";
import {
  PACK_VIDEO_CHIPS,
  RETURN_CARDS,
  listReturnOrders,
  listVideos,
  ordersWithVideo,
  summarizeVideos,
  videoStats,
  videoUrl,
  videosByOrder,
  type PackVideoChip,
  type PackVideoFilters,
  type PackVideoScope,
  type ReturnCard,
} from "../services/pack-video/library";
import {
  PackVideoError,
  beginUpload,
  completeUpload,
  signUploadParts,
  type PackVideoActor,
} from "../services/pack-video/upload";

const router = Router();

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER_FLAGS_MAX = 100;

function actorOf(req: AuthRequest): PackVideoActor {
  return { ownerId: req.ownerId!, userId: req.userId! };
}

function scopeOf(req: AuthRequest): PackVideoScope {
  return { ownerId: req.ownerId!, allowedChannelIds: req.allowedChannelIds ?? null };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function idList(v: unknown, max: number): string[] {
  return [...new Set(str(v).split(",").map((s) => s.trim()).filter((s) => ID_RE.test(s)))].slice(0, max);
}

function filtersOf(req: AuthRequest): PackVideoFilters {
  const kind = str(req.query.kind).toUpperCase();
  const recordedById = str(req.query.recordedById);
  const channelIds = idList(req.query.channelIds, 50);
  return {
    kind: PACK_VIDEO_KINDS.includes(kind as PackVideoKind) ? (kind as PackVideoKind) : undefined,
    range: parseDateRange(req.query),
    channelIds: channelIds.length ? channelIds : undefined,
    recordedById: ID_RE.test(recordedById) ? recordedById : undefined,
    q: str(req.query.q) || undefined,
  };
}

/** Bọc handler: lỗi nghiệp vụ có mã → phản hồi HTTP; lỗi khác đi tiếp về trình xử lý chung. */
function handle(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    fn(req, res).catch((err: unknown) => {
      if (err instanceof PackVideoError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      // Kho R2 lỗi / quá hạn chờ: báo rõ để web hiện nút thử lại, app giữ tệp và tự thử sau.
      if (isStorageFailure(err)) {
        console.error("[PackVideo] Kho R2 không phản hồi:", (err as Error).message);
        res.status(503).json({
          error: "Kho video đang không phản hồi — thử lại sau ít phút",
          code: "STORAGE_UNAVAILABLE",
        });
        return;
      }
      next(err);
    });
  };
}

function isStorageFailure(err: unknown): boolean {
  if (err instanceof R2Error) return true;
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

function requireId(raw: string): string {
  if (!ID_RE.test(raw)) throw new PackVideoError(404, "NOT_FOUND", "Không tìm thấy");
  return raw;
}

// ───────── Tải lên ─────────

router.post(
  "/",
  handle(async (req, res) => {
    const parsed = parseBeginInput(req.body);
    if (!parsed.ok) throw new PackVideoError(400, "BAD_INPUT", parsed.error);
    res.json(await beginUpload(actorOf(req), parsed.value));
  })
);

router.post(
  "/order-flags",
  handle(async (req, res) => {
    const raw = (req.body as { orderIds?: unknown } | undefined)?.orderIds;
    if (!Array.isArray(raw) || raw.length > ORDER_FLAGS_MAX) {
      throw new PackVideoError(400, "BAD_INPUT", `orderIds phải là mảng tối đa ${ORDER_FLAGS_MAX} mã`);
    }
    const orderIds = [...new Set(raw.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))];
    res.json({ withVideo: await ordersWithVideo(scopeOf(req), orderIds) });
  })
);

router.post(
  "/:id/parts",
  handle(async (req, res) => {
    const body = (req.body ?? {}) as { partNumbers?: unknown };
    res.json(await signUploadParts(actorOf(req), requireId(req.params.id), body.partNumbers));
  })
);

router.post(
  "/:id/complete",
  handle(async (req, res) => {
    const body = (req.body ?? {}) as { parts?: unknown };
    res.json(await completeUpload(actorOf(req), requireId(req.params.id), body.parts));
  })
);

// ───────── Đọc ─────────

router.get(
  "/",
  handle(async (req, res) => {
    const chip = str(req.query.chip) as PackVideoChip;
    res.json(
      await listVideos(scopeOf(req), filtersOf(req), {
        chip: PACK_VIDEO_CHIPS.includes(chip) ? chip : "all",
        cursor: str(req.query.cursor) || undefined,
        limit: Number(req.query.limit),
      })
    );
  })
);

router.get(
  "/summary",
  handle(async (req, res) => {
    res.json(await summarizeVideos(scopeOf(req), filtersOf(req)));
  })
);

router.get(
  "/returns",
  handle(async (req, res) => {
    const card = str(req.query.card) as ReturnCard;
    res.json(
      await listReturnOrders(scopeOf(req), {
        card: RETURN_CARDS.includes(card) ? card : "all",
        cursor: str(req.query.cursor) || undefined,
        limit: Number(req.query.limit),
      })
    );
  })
);

router.get(
  "/stats",
  handle(async (req, res) => {
    res.json(await videoStats(scopeOf(req), parseDateRange(req.query)));
  })
);

// Số giờ là của CHỦ SHOP (không theo gian) — nhân viên bị giới hạn gian vẫn thấy cùng một số dư.
router.get(
  "/hours",
  handle(async (req, res) => {
    res.json(await getHoursOverview(req.ownerId!));
  })
);

router.get(
  "/by-order/:orderId",
  handle(async (req, res) => {
    res.json(await videosByOrder(scopeOf(req), requireId(req.params.orderId)));
  })
);

router.get(
  "/:id/url",
  handle(async (req, res) => {
    const download = str(req.query.download) === "1";
    res.json(await videoUrl(scopeOf(req), requireId(req.params.id), download));
  })
);

export default router;
