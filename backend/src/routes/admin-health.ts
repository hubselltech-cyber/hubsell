// ============================================================
// HQ — SỨC KHỎE (docs/HQ-SUC-KHOE.md): radar sức chứa + timeline nâng cấp.
// Router con gắn cùng cửa /api/admin (như admin-plans). Lá quyền `hq.health`.
// Chỉ đọc + tick checklist mốc; không có nút nào gọi sàn hay đổi cấu hình.
// ============================================================

import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requirePlatformPermission, type AuthRequest } from "../middleware/auth";
import { writeAuditLog } from "../services/platform-audit";
import {
  buildSuggestions,
  buildTimeline,
  collectHealth,
  dailyTrends,
  evaluateSignals,
} from "../services/platform-health";
import { CAPACITY_MILESTONES, HEALTH_THRESHOLDS } from "../config/capacity-plan";

const router = Router();

/** GET /api/admin/health — toàn bộ số cho trang Sức khỏe (tươi, không cache). */
router.get("/health", requirePlatformPermission("hq.health"), async (_req: AuthRequest, res, next) => {
  try {
    const metrics = await collectHealth();
    const [timeline, trends] = await Promise.all([buildTimeline(metrics), dailyTrends(30)]);
    const signals = evaluateSignals(metrics);
    res.json({
      metrics,
      signals,
      suggestions: buildSuggestions(signals, timeline),
      timeline,
      trends,
      thresholds: HEALTH_THRESHOLDS,
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/health/milestones/:key/done — tick "đã làm" (ghi audit). */
router.post(
  "/health/milestones/:key/done",
  requirePlatformPermission("hq.health"),
  async (req: AuthRequest, res, next) => {
    try {
      const key = String(req.params.key);
      if (!CAPACITY_MILESTONES.some((m) => m.key === key)) {
        res.status(404).json({ error: "Không có mốc này" });
        return;
      }
      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null;
      const actor = await prisma.user.findUnique({
        where: { id: req.userId! },
        select: { email: true, staffUsername: true, fullName: true },
      });
      const doneBy = actor?.email ?? actor?.staffUsername ?? actor?.fullName ?? "HQ";
      const row = await prisma.platformCapacityMilestone.upsert({
        where: { key },
        update: { doneAt: new Date(), doneBy, note },
        create: { key, doneAt: new Date(), doneBy, note, reachedAt: new Date() },
      });
      await writeAuditLog(req, {
        action: "health.milestone.done",
        targetLabel: key,
        detail: note ? { note } : undefined,
      });
      res.json({ ok: true, milestone: row });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/admin/health/milestones/:key/undone — bỏ tick. */
router.post(
  "/health/milestones/:key/undone",
  requirePlatformPermission("hq.health"),
  async (req: AuthRequest, res, next) => {
    try {
      const key = String(req.params.key);
      const row = await prisma.platformCapacityMilestone.upsert({
        where: { key },
        update: { doneAt: null, doneBy: null },
        create: { key },
      });
      await writeAuditLog(req, { action: "health.milestone.undone", targetLabel: key });
      res.json({ ok: true, milestone: row });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
