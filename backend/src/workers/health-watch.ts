// ============================================================
// SỨC KHỎE HQ — worker radar sức chứa (docs/HQ-SUC-KHOE.md, 12/09/2026)
//
// Ba nhịp:
//   · 10'  : dấu hiệu quá tải (worker trễ, webhook tồn, cầu dao, DB/RAM/kết nối)
//            → đỏ thì báo (dedupe 6h/loại).
//   · 60'  : chụp snapshot (xu hướng 30 ngày) + kiểm mốc timeline: chạm mốc
//            mới → ghi reachedAt + báo MỘT lần.
//   · 08:00 VN mỗi ngày: dự báo — mốc kế tiếp chạm trong ≤14 ngày → nhắc
//            (tối đa 1 lần/tuần/mốc, warnedAt).
//
// Kênh báo: khu HQ KHÔNG có chuông (app-shell tắt bell cho hqWorkspace), nên
// EMAIL tới mọi user isPlatformAdmin là kênh chạm được anh Trung; vẫn ghi
// notify() để lịch sử nằm trong DB. Tắt bằng HEALTH_WATCH_OFF=1.
// ============================================================

import { prisma } from "../lib/prisma";
import { isMailerConfigured, sendMail } from "../lib/mailer";
import { notify } from "../services/notifications";
import {
  buildTimeline,
  collectHealth,
  evaluateSignals,
  saveSnapshot,
  type HealthMetrics,
} from "../services/platform-health";
import { HEALTH_THRESHOLDS, METRIC_LABEL } from "../config/capacity-plan";

const SIGNAL_INTERVAL_MS = 10 * 60 * 1000;
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000;
/** Cùng loại cảnh báo đỏ không gửi lại trong cửa sổ này. */
const CRIT_DEDUPE_MS = 6 * 60 * 60 * 1000;
/** Nhắc "sắp chạm" tối đa 1 lần/tuần/mốc. */
const WARN_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
const FORECAST_HOUR_VN = 8;

let started = false;
let running = false;
const lastAlertAt = new Map<string, number>();
let lastForecastDay = "";

export function startHealthWatchWorker(): void {
  if (started) return;
  started = true;
  if (process.env.HEALTH_WATCH_OFF === "1") {
    console.log("[Health] TẮT (HEALTH_WATCH_OFF=1)");
    return;
  }
  setTimeout(() => void runHealthWatch("boot"), FIRST_RUN_DELAY_MS).unref();
  setInterval(() => void runHealthWatch("signals"), SIGNAL_INTERVAL_MS).unref();
  setInterval(() => void runHealthWatch("snapshot"), SNAPSHOT_INTERVAL_MS).unref();
  console.log(
    `[Health] BẬT — dấu hiệu mỗi ${SIGNAL_INTERVAL_MS / 60000}', snapshot + mốc mỗi ${SNAPSHOT_INTERVAL_MS / 60000}', dự báo ${FORECAST_HOUR_VN}h VN; email ${isMailerConfigured() ? "bật" : "CHƯA cấu hình SMTP"}`
  );
}

/** Một lượt: "signals" (10'), "snapshot" (60'), "boot" (cả hai). Export để chạy tay. */
export async function runHealthWatch(mode: "signals" | "snapshot" | "boot" = "boot"): Promise<void> {
  if (running) return;
  running = true;
  try {
    const metrics = await collectHealth();
    await checkSignals(metrics);
    if (mode !== "signals") {
      await saveSnapshot(metrics);
      await checkMilestones(metrics);
    }
    await maybeForecast(metrics);
  } catch (err) {
    console.error("[Health] Lỗi vòng quét:", (err as Error).message);
  } finally {
    running = false;
  }
}

// ---------- 1. Dấu hiệu ----------

async function checkSignals(metrics: HealthMetrics): Promise<void> {
  const signals = evaluateSignals(metrics);
  const crit = signals.filter((s) => s.level === "crit");
  if (crit.length === 0) return;
  const now = Date.now();
  const fresh = crit.filter((s) => now - (lastAlertAt.get(`crit:${s.key}`) ?? 0) > CRIT_DEDUPE_MS);
  if (fresh.length === 0) return;
  for (const s of fresh) lastAlertAt.set(`crit:${s.key}`, now);
  await alertPlatformAdmins(
    `🔴 Hubsell quá tải: ${fresh.map((s) => s.label).join(", ")}`,
    fresh.map((s) => `• ${s.label}: ${s.value}${s.hint ? ` → ${s.hint}` : ""}`)
  );
}

// ---------- 2. Mốc timeline ----------

async function checkMilestones(metrics: HealthMetrics): Promise<void> {
  const tl = await buildTimeline(metrics);
  const now = new Date();
  let newest: (typeof tl.milestones)[number] | null = null;
  for (const m of tl.milestones) {
    if (!m.reached || m.reachedAt || m.milestone.key === "M0") continue;
    await prisma.platformCapacityMilestone.upsert({
      where: { key: m.milestone.key },
      update: { reachedAt: now },
      create: { key: m.milestone.key, reachedAt: now },
    });
    newest = m;
  }
  if (!newest) return;
  const ms = newest.milestone;
  const progress = newest.progress
    .filter((p) => p.current >= p.target)
    .map((p) => `${p.label} ${p.current}/${p.target}`)
    .join(", ");
  await alertPlatformAdmins(
    `📈 Hubsell chạm mốc ${ms.key}: ${ms.title}`,
    [
      `Điều kiện đã chạm: ${progress || "—"}.`,
      `Nâng gói: ${ms.upgrades.map((u) => `${u.what} (~$${u.usdPerMonth}/tháng)`).join("; ") || "—"}.`,
      "Việc phải làm:",
      ...ms.checklist.map((c) => `  ☐ ${c}`),
    ]
  );
}

// ---------- 3. Dự báo ----------

async function maybeForecast(metrics: HealthMetrics): Promise<void> {
  const vnNow = new Date(Date.now() + 7 * 3600_000);
  const day = vnNow.toISOString().slice(0, 10);
  if (vnNow.getUTCHours() !== FORECAST_HOUR_VN || lastForecastDay === day) return;
  lastForecastDay = day;
  const tl = await buildTimeline(metrics);
  if (!tl.next || !tl.nextEta || tl.nextEta.days == null || !tl.nextEta.by) return;
  if (tl.nextEta.days > HEALTH_THRESHOLDS.etaWarnDays) return;
  const state = await prisma.platformCapacityMilestone.findUnique({ where: { key: tl.next.key } });
  if (state?.warnedAt && Date.now() - state.warnedAt.getTime() < WARN_REPEAT_MS) return;
  await prisma.platformCapacityMilestone.upsert({
    where: { key: tl.next.key },
    update: { warnedAt: new Date() },
    create: { key: tl.next.key, warnedAt: new Date() },
  });
  const by = tl.nextEta.by;
  await alertPlatformAdmins(
    `📅 Còn ≈${tl.nextEta.days} ngày Hubsell chạm mốc ${tl.next.key}`,
    [
      `${tl.next.title}.`,
      `Theo xu hướng 30 ngày, ${METRIC_LABEL[by.metric]} sẽ đạt ${by.gte} trong ≈${tl.nextEta.days} ngày.`,
      `Chuẩn bị: ${tl.next.upgrades.map((u) => `${u.what} (~$${u.usdPerMonth}/tháng)`).join("; ")}.`,
      "Xem chi tiết tại HQ → Sức khỏe.",
    ]
  );
}

// ---------- Kênh báo ----------

/** Chuông (DB) + email cho mọi platform admin. Không ném lỗi. */
export async function alertPlatformAdmins(subject: string, lines: string[]): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { isPlatformAdmin: true },
    select: { id: true, email: true, fullName: true },
  });
  const body = lines.join("\n");
  await Promise.allSettled(
    admins.map((a) =>
      notify(a.id, { type: "platform-health", title: subject, body, link: "/admin/health" })
    )
  );
  console.warn(`[Health] ${subject}\n${body}`);
  if (!isMailerConfigured()) return;
  const html = `<p><b>${escapeHtml(subject)}</b></p><pre style="font:14px/1.5 system-ui;white-space:pre-wrap">${escapeHtml(body)}</pre><p><a href="${process.env.APP_FRONTEND_URL ?? ""}/admin/health">Mở HQ → Sức khỏe</a></p>`;
  const results = await Promise.allSettled(
    admins.filter((a) => a.email).map((a) => sendMail({ to: a.email!, subject: `[Hubsell HQ] ${subject}`, html }))
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) console.error(`[Health] ${failed}/${results.length} email cảnh báo gửi lỗi`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
