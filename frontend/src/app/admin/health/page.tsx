"use client";

import { useCallback, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AccessDenied } from "@/components/shared/access-denied";
import { AppShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  fetchPlatformHealth,
  markPlatformMilestone,
  type HealthLevel,
  type HealthTimelineItem,
  type PlatformHealthResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { AdminError, AdminPageHeader, StatCard, formatCount, useAdminPage } from "../shared";

/**
 * HQ → SỨC KHỎE (docs/HQ-SUC-KHOE.md, 12/09/2026)
 *
 * "Làm sao anh nhớ được lên 1.000 gian mà nâng cấp?" — trang này + worker
 * health-watch nhớ hộ: KPI hôm nay, dấu hiệu quá tải, timeline mốc tăng
 * trưởng với ngày dự báo chạm, checklist tick được, và gợi ý hôm nay.
 * Chỉ đọc + tick; không nút nào gọi sàn hay đổi cấu hình.
 */

const LEVEL_META: Record<HealthLevel, { label: string; className: string; dot: string }> = {
  ok: { label: "Ổn", className: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  warn: { label: "Chú ý", className: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  crit: { label: "Nguy hiểm", className: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("vi-VN");
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d} ngày ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`;
}

export default function AdminHealthPage() {
  const fetcher = useCallback(() => fetchPlatformHealth(), []);
  const { data, loading, denied, error, reload } = useAdminPage<PlatformHealthResponse>(fetcher);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function toggleDone(item: HealthTimelineItem) {
    setBusyKey(item.milestone.key);
    try {
      await markPlatformMilestone(item.milestone.key, !item.doneAt);
      await reload();
    } finally {
      setBusyKey(null);
    }
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const m = data?.metrics;
  const worst = data?.signals.reduce<HealthLevel>((acc, s) => (s.level === "crit" ? "crit" : s.level === "warn" && acc !== "crit" ? "warn" : acc), "ok") ?? "ok";

  return (
    <AppShell>
      <div className="space-y-6">
        <AdminPageHeader
          description="Radar sức chứa: đang ở đâu trên đường tăng trưởng, sắp chạm mốc nào, phải nâng gì. Worker kiểm tra mỗi 10 phút và email khi có dấu hiệu đỏ hoặc chạm mốc."
          loading={loading}
          onReload={reload}
        />
        {error && <AdminError message={error} />}

        {m && data && (
          <>
            {/* ---- KPI hôm nay ---- */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <StatCard
                label="Gian hoạt động"
                value={formatCount(m.growth.channelsActive)}
                hint={Object.entries(m.growth.channelsByPlatform)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ") || "chưa có gian"}
              />
              <StatCard
                label="Chủ shop"
                value={formatCount(m.growth.ownersTotal)}
                hint={`${m.growth.ownersActive30d} có đơn 30 ngày · +${m.growth.ownersNew7d} tuần này`}
              />
              <StatCard
                label="Đơn / ngày (7 ngày)"
                value={formatCount(m.growth.ordersPerDay7d)}
                hint={`đỉnh 30 ngày ${formatCount(m.growth.ordersPeakDay30d)} · webhook ${formatCount(m.growth.webhooksPerDay7d)}/ngày`}
              />
              <StatCard
                label="Worker"
                value={m.worker.overdueFast15 === 0 ? "Đúng nhịp" : `${m.worker.overdueFast15} gian trễ`}
                hint={`${m.growth.channelsAds} gian chạy ads · webhook chờ ${m.worker.webhookPending}${m.worker.breakersPaused.length ? " · CẦU DAO ĐÓNG" : ""}`}
              />
              <StatCard
                label="Database"
                value={m.infra.dbSizeMb != null ? `${m.infra.dbSizeMb} MB` : "—"}
                hint={m.infra.dbPct != null ? `${m.infra.dbPct}% gói ${m.infra.plan.dbPlan}` : "không đọc được dung lượng"}
              />
              <StatCard
                label="RAM tiến trình"
                value={`${m.infra.ramMb} MB`}
                hint={`${m.infra.ramPct}% gói · uptime ${fmtUptime(m.infra.uptimeSec)} · vai ${m.infra.role}${m.infra.gitSha ? ` · ${m.infra.gitSha}` : ""}`}
              />
            </div>

            {/* ---- Gợi ý hôm nay ---- */}
            <Card className={cn("border", worst === "crit" ? "border-red-200" : worst === "warn" ? "border-amber-200" : "")}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Việc nên làm hôm nay</CardTitle>
                <CardDescription>
                  Sinh từ dấu hiệu đỏ/vàng và mốc kế tiếp. Trống là tốt.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.suggestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Không có việc gấp. Hệ thống đang trong ngưỡng.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.suggestions.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-5">
              {/* ---- Timeline ---- */}
              <Card className="lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Timeline sức chứa</CardTitle>
                  <CardDescription>
                    Đang ở <b>{data.timeline.current.key}</b>
                    {data.timeline.next && (
                      <>
                        {" "}· mốc kế tiếp <b>{data.timeline.next.key}</b>
                        {data.timeline.nextEta?.days != null
                          ? ` ≈ ${data.timeline.nextEta.days} ngày nữa`
                          : " (chưa đủ dữ liệu 7 ngày để dự báo)"}
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="relative space-y-6 border-l border-border pl-6">
                    {data.timeline.milestones.map((item) => {
                      const isCurrent = item.milestone.key === data.timeline.current.key;
                      const isNext = item.milestone.key === data.timeline.next?.key;
                      const done = Boolean(item.doneAt);
                      return (
                        <li key={item.milestone.key} className="relative">
                          <span
                            className={cn(
                              "absolute -left-[31px] top-1 size-3 rounded-full border-2 border-background",
                              done ? "bg-emerald-500" : isCurrent ? "bg-primary" : item.reached ? "bg-amber-500" : "bg-slate-300"
                            )}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{item.milestone.key}</span>
                            <span className="text-sm">{item.milestone.title}</span>
                            {isCurrent && <Badge>Đang ở</Badge>}
                            {isNext && <Badge variant="outline">Kế tiếp</Badge>}
                            {done && <Badge className="bg-emerald-600">Đã làm {fmtDate(item.doneAt)}</Badge>}
                            {!done && item.reached && !isCurrent && item.milestone.key !== "M0" && (
                              <Badge variant="outline" className="border-amber-300 text-amber-700">Đã chạm, chưa làm</Badge>
                            )}
                          </div>
                          {item.progress.length > 0 && (
                            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                              {item.progress.map((p) => `${p.label} ${formatCount(p.current)}/${formatCount(p.target)}`).join(" · ")}
                            </p>
                          )}
                          {item.milestone.upgrades.length > 0 && (
                            <p className="mt-1 text-xs">
                              <span className="text-muted-foreground">Nâng gói: </span>
                              {item.milestone.upgrades.map((u) => `${u.what} (~$${u.usdPerMonth}/th)`).join("; ")}
                            </p>
                          )}
                          <ul className="mt-2 space-y-1 text-sm">
                            {item.milestone.checklist.map((c) => (
                              <li key={c} className="flex gap-2">
                                <span className={cn("mt-0.5 shrink-0", done ? "text-emerald-600" : "text-muted-foreground")}>{done ? "☑" : "☐"}</span>
                                <span className={cn(done && "text-muted-foreground line-through")}>{c}</span>
                              </li>
                            ))}
                          </ul>
                          {(isCurrent || item.reached) && (
                            <Button
                              size="sm"
                              variant={done ? "outline" : "default"}
                              className="mt-2"
                              disabled={busyKey === item.milestone.key}
                              onClick={() => void toggleDone(item)}
                            >
                              {done ? "Bỏ đánh dấu" : "Đã làm xong mốc này"}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>

              {/* ---- Dấu hiệu + xu hướng ---- */}
              <div className="space-y-6 lg:col-span-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Dấu hiệu vận hành</CardTitle>
                    <CardDescription>Ngưỡng trong config/capacity-plan.ts.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3">
                      {data.signals.map((s) => (
                        <li key={s.key} className="flex items-start gap-3">
                          <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", LEVEL_META[s.level].dot)} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{s.label}</span>
                              <Badge variant="outline" className={cn("text-[11px]", LEVEL_META[s.level].className)}>
                                {LEVEL_META[s.level].label}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground tabular-nums">{s.value}</p>
                            {s.level !== "ok" && s.hint && <p className="text-xs text-amber-700">{s.hint}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Xu hướng 30 ngày</CardTitle>
                    <CardDescription>Snapshot cuối mỗi ngày; cần ≥7 ngày để dự báo.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(
                      [
                        ["channels", "Gian hoạt động"],
                        ["ordersPerDay", "Đơn / ngày"],
                        ["dbSizeMb", "DB (MB)"],
                      ] as const
                    ).map(([key, label]) => {
                      const series = data.trends[key].map((p) => ({
                        d: new Date(p.t).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
                        v: p.v,
                      }));
                      return (
                        <div key={key}>
                          <p className="mb-1 text-xs text-muted-foreground">
                            {label} · {series.length} điểm
                          </p>
                          <div className="h-16">
                            {series.length >= 2 ? (
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                                  <XAxis dataKey="d" hide />
                                  <YAxis hide domain={["auto", "auto"]} />
                                  <Tooltip formatter={(v) => formatCount(Number(v))} labelFormatter={(l) => String(l)} />
                                  <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            ) : (
                              <p className="text-xs text-muted-foreground">Chưa đủ dữ liệu — worker chụp mỗi giờ.</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {m.infra.dbTopTables.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Bảng lớn nhất</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm tabular-nums">
                        {m.infra.dbTopTables.map((t) => (
                          <li key={t.table} className="flex justify-between">
                            <span className="font-mono text-xs">{t.table}</span>
                            <span>{t.mb} MB</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
