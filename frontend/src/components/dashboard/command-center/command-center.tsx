"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Activity, ShieldCheck } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertCard } from "./alert-card";
import { ActivityFeed } from "./activity-feed";
import { ChatDrawer } from "./chat-drawer";
import {
  MOCK_ACTIVITY,
  MOCK_ALERTS,
  MOCK_CHAT,
  nextId,
} from "./mock-service";
import {
  canView,
  OPS_ROLES,
  ROLE_META,
  visibleTags,
  type ActivityItem,
  type AlertTag,
  type ChatBody,
  type ChatMessage,
  type OpsRole,
} from "./types";

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Gom seed chat theo alertId để tra cứu nhanh. */
function seedChat(): Record<string, ChatMessage[]> {
  const map: Record<string, ChatMessage[]> = {};
  for (const m of MOCK_CHAT) (map[m.alertId] ??= []).push(m);
  return map;
}

export function CommandCenter() {
  // Vai trò vận hành giả lập — bộ chuyển ở góc để thử nghiệm RBAC.
  const [role, setRole] = useState<OpsRole>("ADMIN");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [chat, setChat] = useState<Record<string, ChatMessage[]>>(seedChat);
  const [activities, setActivities] = useState<ActivityItem[]>(MOCK_ACTIVITY);
  const [activityFilter, setActivityFilter] = useState<AlertTag | "all">("all");
  const [openAlertId, setOpenAlertId] = useState<string | null>(null);

  const tags = visibleTags(role);

  // Cảnh báo trong tầm nhìn của vai trò: chưa xử lý lên trước, rồi tới mức độ.
  const alerts = MOCK_ALERTS.filter((a) => canView(role, a.tag)).sort((a, b) => {
    const byResolved =
      Number(resolved.has(a.id)) - Number(resolved.has(b.id));
    if (byResolved !== 0) return byResolved;
    const bySev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySev !== 0) return bySev;
    return b.createdAt.localeCompare(a.createdAt);
  });

  // Nhật ký chỉ hiện hoạt động của tag được xem; lọc nhanh chồng lên trên đó.
  const feed = activities.filter((it) => canView(role, it.tag));
  const effectiveFilter =
    activityFilter !== "all" && !tags.includes(activityFilter)
      ? "all"
      : activityFilter;

  // Drawer chỉ mở được với cảnh báo vai trò có quyền xem (contextual privacy)
  const openAlert = openAlertId
    ? MOCK_ALERTS.find((a) => a.id === openAlertId && canView(role, a.tag)) ??
      null
    : null;

  function logActivity(tag: AlertTag, message: string) {
    setActivities((prev) => [
      { id: nextId("ac"), tag, message, at: new Date().toISOString() },
      ...prev,
    ]);
  }

  function handleAction(alertId: string) {
    const alert = MOCK_ALERTS.find((a) => a.id === alertId);
    if (!alert) return;
    toast.success(`${alert.actionLabel} · ${alert.title}`);
    logActivity(
      alert.tag,
      `${ROLE_META[role].label} đã thao tác "${alert.actionLabel}" cho: ${alert.title}`
    );
  }

  function toggleResolved(alertId: string) {
    const alert = MOCK_ALERTS.find((a) => a.id === alertId);
    if (!alert) return;
    setResolved((prev) => {
      const next = new Set(prev);
      if (next.has(alertId)) next.delete(alertId);
      else {
        next.add(alertId);
        logActivity(
          alert.tag,
          `${ROLE_META[role].label} đánh dấu ĐÃ XỬ LÝ: ${alert.title}`
        );
      }
      return next;
    });
  }

  function sendMessage(body: ChatBody) {
    if (!openAlert) return;
    const message: ChatMessage = {
      id: nextId("ms"),
      alertId: openAlert.id,
      author: "Bạn",
      role,
      body,
      at: new Date().toISOString(),
    };
    setChat((prev) => ({
      ...prev,
      [openAlert.id]: [...(prev[openAlert.id] ?? []), message],
    }));
    logActivity(
      openAlert.tag,
      `${ROLE_META[role].label} vừa trao đổi trong sự cố: ${openAlert.title}`
    );
  }

  const unresolvedCount = alerts.filter((a) => !resolved.has(a.id)).length;

  return (
    <section className="space-y-3">
      {/* Đầu khối: tiêu đề + bộ chuyển vai trò giả lập */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Trung tâm điều hành
          </h2>
          <p className="text-sm text-slate-500">
            Cảnh báo &amp; nhật ký vận hành, lọc theo vai trò phụ trách.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 text-xs text-slate-400 sm:flex">
            <ShieldCheck className="size-3.5" /> Vai trò (demo)
          </span>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
            {OPS_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  role === r
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                {ROLE_META[r].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Split view 70/30 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[7fr_3fr] lg:items-stretch">
        {/* CỘT TRÁI — bảng cảnh báo */}
        <Card className="flex flex-col lg:h-[560px]">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle className="flex items-center gap-2">
              Cảnh báo cần xử lý
              {unresolvedCount > 0 && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600">
                  {unresolvedCount}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-3 overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="pt-16 text-center text-sm text-slate-400">
                Không có cảnh báo nào thuộc phạm vi của vai trò này.
              </p>
            ) : (
              alerts.map((a) => (
                <AlertCard
                  key={a.id}
                  alert={a}
                  role={role}
                  resolved={resolved.has(a.id)}
                  chatCount={chat[a.id]?.length ?? 0}
                  onAction={() => handleAction(a.id)}
                  onToggleResolved={() => toggleResolved(a.id)}
                  onDiscuss={() => setOpenAlertId(a.id)}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* CỘT PHẢI — nhật ký vận hành */}
        <Card className="flex flex-col lg:h-[560px]">
          <CardHeader className="border-b border-slate-100 pb-3">
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-slate-400" />
              Nhật ký vận hành
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            <ActivityFeed
              items={feed}
              tags={tags}
              filter={effectiveFilter}
              onFilter={setActivityFilter}
            />
          </CardContent>
        </Card>
      </div>

      {openAlert && (
        <ChatDrawer
          alert={openAlert}
          messages={chat[openAlert.id] ?? []}
          onSend={sendMessage}
          onClose={() => setOpenAlertId(null)}
        />
      )}
    </section>
  );
}
