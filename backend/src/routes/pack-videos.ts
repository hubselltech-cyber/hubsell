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
//   GET  /deleted          lịch sử xóa: mã vận đơn + lý do (chỉ chủ shop)
//   GET  /stats            thống kê thời gian quay
//   GET  /hours            giờ đã mua · đã quay · còn lại + các gói giờ
//   POST /hours/checkout   { hours } → mã QR payOS mua giờ quay (máy chủ tự tính tiền)
//   GET  /match?code=&kind= màn quay hỏi: mã trên tem này khớp đơn nào, đơn có hoàn / đã có video chưa (chỉ đọc)
//   GET  /by-order/:orderId  hồ sơ video của một đơn
//   POST /order-flags      trong các đơn này, đơn nào đã có video
//   GET  /:id/url          đường dẫn xem / tải về (hạn ngắn)
//   DELETE /:id            chủ shop tự xóa một video đã lưu (không khôi phục được)
//   POST /consent          chủ shop đồng ý lần đầu (ghi sổ đồng ý) — đường DUY NHẤT qua cổng khi chưa đồng ý
//   POST /session          cấp VÉ PHIÊN QUAY 10 phút (M2.1) — đường nóng có vé thì không đọc database để xác thực
// ĐƯỜNG NÓNG nhận vé: GET /match · POST / · POST /:id/parts · POST /:id/complete (middleware/pack-session.ts).
// POST / và POST /:id/complete trả kèm hours (đã mua / đã quay / còn lại) — màn quay không gọi /hours riêng (M2.2).
// Các đường có chữ cố định (summary, returns, stats, hours, match, by-order, order-flags) khai TRƯỚC "/:id".
//
// QUYỀN TỪNG ĐƯỜNG (24/11/2026 — nhân viên của chủ đã mở được vào, docs VIDEO-DONG-HANG-THIET-KE mục 28;
// cổng tổng + `req.packVideoCaps` ở middleware/require-pack-video.ts):
//   quay ĐÓNG (PACK)  = chủ, hoặc nhân viên có quyền Đơn hàng          → POST / · GET /match (theo `kind`)
//   quay KHUI (UNBOX) = chủ, hoặc nhân viên có quyền Đối soát đơn hoàn → như trên
//   ký mảnh / báo tải xong: nhân viên chỉ video CHÍNH MÌNH quay (upload.ts)
//   xem danh sách / số chip / hồ sơ đơn / cờ đơn / xem video: ai qua cổng cũng được (theo gian được giao)
//   tải về (`download=1`), thống kê, tab đơn hoàn, lịch sử xóa, XÓA video: CHỈ chủ shop (`manage`)
//   /hours: nhân viên thấy SỐ GIỜ, không thấy sổ tiền; mua giờ: chỉ chủ (requireAdmin)
// ============================================================

import { Router, type NextFunction, type Response } from "express";
import { requireAdmin, type AuthRequest } from "../middleware/auth";
import type { PackVideoRequest } from "../middleware/require-pack-video";
import { PACK_HOT_RATE, packSessionEnabled } from "../config/pack-video";
import { createPackRateLimiter, packRateLimitMode } from "../lib/pack-rate-limit";
import { isPackHotPath } from "../middleware/pack-session";
import { PACK_SESSION_MAX_CHANNELS, signPackSessionTicket } from "../lib/pack-session-ticket";
import { NO_PACK_VIDEO_CAPS, isPackVideoPilot, type PackVideoCaps } from "../services/pack-video/access";
import { ownerEmailOf } from "../services/pack-video/subject";
import { R2Error } from "../integrations/r2/client";
import { prisma } from "../lib/prisma";
import { CheckoutError, createPackHoursCheckout } from "../services/gateway-checkout";
import { parseDateRange } from "../lib/date-range";
import { PACK_VIDEO_KINDS, parseBeginInput, type PackVideoKind } from "../lib/pack-video-rules";
import { getHoursOverview } from "../services/pack-video/hours";
import {
  PACK_VIDEO_CHIPS,
  RETURN_CARDS,
  RETURN_SORTS,
  listDeletedVideos,
  listReturnOrders,
  listVideos,
  matchTem,
  ordersWithVideo,
  summarizeVideos,
  videoStats,
  videoUrl,
  videosByOrder,
  type PackVideoChip,
  type PackVideoFilters,
  type PackVideoScope,
  type ReturnCard,
  type ReturnSort,
} from "../services/pack-video/library";
import { recordPackVideoConsent } from "../services/pack-video/consent";
import { deleteVideoByOwner } from "../services/pack-video/manual-delete";
import {
  PackVideoError,
  beginUpload,
  completeUpload,
  signUploadParts,
  type PackVideoActor,
} from "../services/pack-video/upload";

const router = Router();

// ───────── Chặn gọi dồn trên đường nóng (M2.6) ─────────
// Đếm theo tài khoản đang đăng nhập, trong tiến trình này (lib/pack-rate-limit.ts). Mặc định CHẠY BÓNG: chỉ ghi nhật
// ký "ai vượt hạn mức", không chặn. PACK_RATE_LIMIT=on → trả 429 + Retry-After; màn quay coi 429 là "thử lại sau" và
// chờ đúng số giây máy chủ bảo, video không mất. Đặt TRƯỚC mọi đường để lượt bị chặn không chạm database / R2.
const hotLimiter = createPackRateLimiter(PACK_HOT_RATE);
router.use((req: AuthRequest, res: Response, next: NextFunction) => {
  const mode = packRateLimitMode();
  if (mode === "off" || !req.userId || !isPackHotPath(req.method, req.path)) {
    next();
    return;
  }
  const verdict = hotLimiter.take(req.userId);
  if (verdict.ok || mode === "shadow") {
    next();
    return;
  }
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))));
  res.status(429).json({
    error: "Máy quay đang gọi máy chủ quá dồn — tự thử lại sau ít giây",
    code: "TOO_MANY_REQUESTS",
  });
});

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ORDER_FLAGS_MAX = 100;

function capsOf(req: AuthRequest): PackVideoCaps {
  return (req as PackVideoRequest).packVideoCaps ?? NO_PACK_VIDEO_CAPS;
}

function actorOf(req: AuthRequest): PackVideoActor {
  return { ownerId: req.ownerId!, userId: req.userId!, staff: !capsOf(req).manage };
}

function denied(message: string): PackVideoError {
  return new PackVideoError(403, "PERMISSION_DENIED", message);
}

/** Việc của chủ shop (tải về, thống kê, tab đơn hoàn). */
function requireManage(req: AuthRequest): void {
  if (!capsOf(req).manage) throw denied("Chỉ chủ shop xem được mục này");
}

/** Quay đúng kiểu mình có quyền: đóng hàng cần quyền Đơn hàng, khui hàng hoàn cần quyền Đối soát đơn hoàn. */
function requireRecordKind(req: AuthRequest, kind: PackVideoKind): void {
  const caps = capsOf(req);
  if (kind === "UNBOX" ? !caps.unbox : !caps.pack) {
    throw denied(
      kind === "UNBOX"
        ? "Tài khoản này chưa có quyền Đối soát đơn hoàn để quay khui hàng"
        : "Tài khoản này chưa có quyền Đơn hàng để quay video đóng hàng"
    );
  }
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

// ───────── Đồng ý lần đầu ─────────

// Chỉ CHỦ SHOP đồng ý được (nhân viên chờ chủ). Gọi lại khi đã đồng ý cũng trả ok, không sinh dòng thứ hai.
router.post(
  "/consent",
  handle(async (req, res) => {
    if (req.userId !== req.ownerId) throw denied("Chỉ chủ shop bật được tính năng này");
    const fwd = req.headers["x-forwarded-for"];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
    await recordPackVideoConsent(req.ownerId!, {
      ip: first || req.ip || null,
      userAgent: String(req.headers["user-agent"] ?? "") || null,
    });
    res.json({ ok: true });
  })
);

// ───────── Vé phiên quay (M2.1) ─────────

// Màn quay xin vé MỘT lần rồi gửi kèm ở các đường nóng (tiêu đề X-Pack-Session) — trong hạn vé các đường đó không
// đọc database để xác thực (middleware/pack-session.ts). Đường này LUÔN đi xác thực thường: không dùng vé để xin vé.
// ticket = null: máy chủ không cấp (đang tắt, hoặc nhân viên được giao quá nhiều gian) → máy quay cứ gọi như cũ.
router.post(
  "/session",
  handle(async (req, res) => {
    const caps = capsOf(req);
    const channels = req.allowedChannelIds ?? null;
    if (!packSessionEnabled() || (channels !== null && channels.length > PACK_SESSION_MAX_CHANNELS)) {
      res.json({ ticket: null, expiresAt: null, ttlSec: 0 });
      return;
    }
    const staff = !caps.manage;
    const ownerEmail = staff ? await ownerEmailOf(req.ownerId!) : (req.userEmail ?? null);
    res.json(
      signPackSessionTicket({
        userId: req.userId!,
        ownerId: req.ownerId!,
        staff,
        pack: caps.pack,
        unbox: caps.unbox,
        pilot: isPackVideoPilot(ownerEmail),
        allowedChannelIds: channels,
      })
    );
  })
);

// ───────── Tải lên ─────────

router.post(
  "/",
  handle(async (req, res) => {
    const parsed = parseBeginInput(req.body);
    if (!parsed.ok) throw new PackVideoError(400, "BAD_INPUT", parsed.error);
    requireRecordKind(req, parsed.value.kind);
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
    requireManage(req);
    const card = str(req.query.card) as ReturnCard;
    const sort = str(req.query.sort) as ReturnSort;
    res.json(
      await listReturnOrders(scopeOf(req), {
        card: RETURN_CARDS.includes(card) ? card : "all",
        sort: RETURN_SORTS.includes(sort) ? sort : undefined,
        q: str(req.query.q) || undefined,
        cursor: str(req.query.cursor) || undefined,
        limit: Number(req.query.limit),
      })
    );
  })
);

// Lịch sử xóa: video đã xóa (hệ thống tự xóa hoặc chủ shop tự xóa) + lý do. Chỉ chủ shop (cùng nhóm với tab Đơn hoàn / Thống kê).
router.get(
  "/deleted",
  handle(async (req, res) => {
    requireManage(req);
    res.json(
      await listDeletedVideos(scopeOf(req), {
        q: str(req.query.q) || undefined,
        cursor: str(req.query.cursor) || undefined,
        limit: Number(req.query.limit),
      })
    );
  })
);

router.get(
  "/stats",
  handle(async (req, res) => {
    requireManage(req);
    res.json(await videoStats(scopeOf(req), parseDateRange(req.query)));
  })
);

// Số giờ là của CHỦ SHOP (không theo gian) — nhân viên bị giới hạn gian vẫn thấy cùng một số dư.
// Nhân viên (anh Trung 24/11/2026: "Thấy số, không nút mua"): giữ số dư, bỏ sổ (có số tiền + số hóa đơn),
// salesOpen = false để không vẽ hộp mua.
router.get(
  "/hours",
  handle(async (req, res) => {
    const overview = await getHoursOverview(req.ownerId!);
    res.json(capsOf(req).manage ? overview : { ...overview, salesOpen: false, ledger: [] });
  })
);

// MUA GIỜ QUAY qua payOS: trình duyệt chỉ gửi SỐ GIỜ, máy chủ tự tính tiền. Chỉ CHỦ SHOP (tiền nong của
// chủ). Trạng thái / hủy mã dùng chung đường /api/subscription/checkout/:orderCode (cùng bảng đơn cổng).
router.post("/hours/checkout", requireAdmin, async (req: AuthRequest, res, next) => {
  try {
    const buyer = await prisma.user.findUnique({
      where: { id: req.ownerId! },
      select: { fullName: true, email: true, phone: true },
    });
    const checkout = await createPackHoursCheckout({
      userId: req.ownerId!,
      hours: (req.body as { hours?: unknown } | undefined)?.hours,
      buyer: { name: buyer?.fullName, email: buyer?.email, phone: buyer?.phone },
    });
    res.status(201).json({ checkout });
  } catch (err) {
    if (err instanceof CheckoutError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// Mã trên tem: cùng luật với bước tải lên (không khoảng trắng, tối đa 64 ký tự).
router.get(
  "/match",
  handle(async (req, res) => {
    const code = str(req.query.code);
    if (!code || code.length > 64 || /\s/.test(code)) {
      throw new PackVideoError(400, "BAD_INPUT", "Mã vận đơn không hợp lệ");
    }
    // Chế độ đang quay: PACK (mặc định) hay UNBOX — khui hàng hoàn thì thử thêm mã vận đơn chiều hoàn.
    const kind: PackVideoKind = str(req.query.kind).toUpperCase() === "UNBOX" ? "UNBOX" : "PACK";
    requireRecordKind(req, kind);
    res.json(await matchTem(scopeOf(req), code, kind));
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
    // Nhân viên xem được, không tải về (anh Trung 24/11/2026).
    if (download) requireManage(req);
    res.json(await videoUrl(scopeOf(req), requireId(req.params.id), download));
  })
);

// Chủ shop tự xóa một video đã lưu. Nhân viên không xóa được (kể cả video mình quay); giờ đã quay không cộng lại.
router.delete(
  "/:id",
  handle(async (req, res) => {
    requireManage(req);
    res.json(await deleteVideoByOwner(req.ownerId!, requireId(req.params.id)));
  })
);

export default router;
