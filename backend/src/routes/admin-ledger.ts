// ============================================================
// HQ — SỔ CÁI ĐƠN (docs/SO-CAI-DON.md): trạng thái sổ + ĐỐI SOÁT sổ ↔ tính lại.
// Router con gắn cùng cửa /api/admin. Lá quyền `hq.health` (cùng trang Sức
// khỏe). Đây là công cụ nghiệm thu giai đoạn 1: "với mọi bộ lọc, số từ sổ
// khớp từng đồng với số tính từ đơn gốc" — chạy trên dữ liệu prod thật trước
// khi chuyển từng báo cáo sang đọc sổ.
// ============================================================

import { Router } from "express";
import { ChannelName } from "@prisma/client";
import {
  requirePlatformAdmin,
  requirePlatformPermission,
  type AuthRequest,
} from "../middleware/auth";
import { writeAuditLog } from "../services/platform-audit";
import type { ChannelScope } from "../lib/channel-filter";
import { parseDateRange, type DateRangeFilter } from "../lib/date-range";
import {
  auditLedger,
  compareLedger,
  ledgerStatus,
  markLedgerScope,
} from "../services/order-ledger";
import { runNightlyMaintenance } from "../workers/order-ledger";

const router = Router();

/** GET /api/admin/ledger/status — số liệu sổ cho trang HQ (tươi, không cache). */
router.get("/ledger/status", requirePlatformPermission("hq.health"), async (_req: AuthRequest, res, next) => {
  try {
    res.json(await ledgerStatus());
  } catch (err) {
    next(err);
  }
});

/** Đọc phạm vi từ query của HQ: ownerId bắt buộc (góc nhìn nền tảng), gian/sàn tùy chọn. */
function readScope(req: AuthRequest): { scope: ChannelScope; range?: DateRangeFilter } | { error: string } {
  const ownerId = typeof req.query.ownerId === "string" ? req.query.ownerId.trim() : "";
  if (!ownerId) return { error: "Thiếu ownerId (chủ shop cần đối soát)" };
  const scope: ChannelScope = { userId: ownerId };
  const channelId = typeof req.query.channelId === "string" ? req.query.channelId.trim() : "";
  if (channelId) scope.id = channelId;
  const raw = typeof req.query.channelName === "string" ? req.query.channelName.trim().toUpperCase() : "";
  if (raw in ChannelName) scope.channelName = raw as ChannelName;
  return { scope, range: parseDateRange(req.query) };
}

/**
 * GET /api/admin/ledger/compare?ownerId=&from=&to=&channelId=&channelName=&fresh=1
 * Hai bản tổng cho cùng phạm vi: (1) SUM trong DB trên sổ; (2) đọc đơn gốc, tính
 * lại trong RAM rồi cộng. Trả chênh lệch từng nhóm × cột, thời gian mỗi bên,
 * tình trạng bẩn của phạm vi. `fresh=1` → tính nốt dòng bẩn của kỳ trước khi so.
 */
router.get("/ledger/compare", requirePlatformPermission("hq.health"), async (req: AuthRequest, res, next) => {
  try {
    const parsed = readScope(req);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { scope, range } = parsed;
    const wantFresh = req.query.fresh === "1" || req.query.fresh === "true";
    const result = await compareLedger(scope, range, { fresh: wantFresh });
    res.json({
      scope: {
        ownerId: scope.userId,
        channelId: scope.id ?? null,
        channelName: scope.channelName ?? null,
        from: range?.gte ?? null,
        to: range?.lte ?? null,
      },
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/ledger/audit — chạy đối soát mẫu ngay (chỉ chủ nền tảng). */
router.post("/ledger/audit", requirePlatformAdmin, async (req: AuthRequest, res, next) => {
  try {
    const sample = Math.min(2000, Math.max(20, Number(req.body?.sample ?? 200) || 200));
    // minAgeMs: 0 = lấy cả dòng vừa tính (dùng ngay sau khi dựng sổ).
    const minAgeMs = Math.max(0, Number(req.body?.minAgeMs ?? 3_600_000) || 0);
    const result = await auditLedger(sample, { minAgeMs });
    await writeAuditLog(req, {
      action: "ledger.audit",
      targetLabel: "order_ledger",
      detail: { sample, mismatched: result.mismatched },
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/ledger/maintenance — chạy bảo trì đêm ngay (phân mảnh + quét phiên bản + đối soát). */
router.post("/ledger/maintenance", requirePlatformAdmin, async (req: AuthRequest, res, next) => {
  try {
    await runNightlyMaintenance();
    await writeAuditLog(req, { action: "ledger.maintenance", targetLabel: "order_ledger" });
    res.json(await ledgerStatus());
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/ledger/recompute { ownerId, channelId?, channelName?, from?, to?, reason? }
 * Đánh bẩn toàn bộ dòng của phạm vi để worker tính lại (kể cả tạo dòng nháp
 * cho đơn chưa có trong sổ). Chỉ chủ nền tảng; có nhật ký.
 */
router.post("/ledger/recompute", requirePlatformAdmin, async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fake = { query: body } as unknown as AuthRequest;
    const parsed = readScope(fake);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const reason = typeof body.reason === "string" && body.reason.trim() ? `hq:${body.reason.trim().slice(0, 80)}` : "hq:recompute";
    const r = await markLedgerScope(parsed.scope, parsed.range, reason);
    await writeAuditLog(req, {
      action: "ledger.recompute",
      targetUserId: parsed.scope.userId,
      targetLabel: "order_ledger",
      detail: {
        ...r,
        channelId: typeof parsed.scope.id === "string" ? parsed.scope.id : null,
        channelName: parsed.scope.channelName ?? null,
        from: parsed.range?.gte.toISOString() ?? null,
        to: parsed.range?.lte.toISOString() ?? null,
      },
    });
    res.json(r);
  } catch (err) {
    next(err);
  }
});

export default router;
