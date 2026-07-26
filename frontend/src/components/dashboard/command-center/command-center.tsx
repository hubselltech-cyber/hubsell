"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Activity, ShieldCheck } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  fetchCommandCenterState,
  postCommandCenterChat,
  setCommandCenterResolved,
  type OpsActivityDTO,
  type OpsChatDTO,
} from "@/lib/api";
import { AlertCard } from "./alert-card";
import { ActionModal } from "./action-modal";
import { ActivityFeed } from "./activity-feed";
import { ChatDrawer } from "./chat-drawer";
import {
  MOCK_ACTIVITY,
  MOCK_ALERTS,
  MOCK_CHAT,
  nextId,
} from "./mock-service";
import {
  canAct,
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

// ─────────── HỢP NHẤT SEED (mock) VỚI DỮ LIỆU ĐÃ LƯU Ở BACKEND ───────────
//
// Cảnh báo + tin/nhật ký "mồi" là nội dung demo cố định, sống ở frontend. Backend
// chỉ trả về những gì NGƯỜI DÙNG tạo thêm. Khi load/F5 ta ghép hai nguồn lại để
// vừa giữ khung demo, vừa khôi phục đúng thao tác đã lưu.

function chatDtoToMessage(dto: OpsChatDTO): ChatMessage {
  return {
    id: dto.id,
    alertId: dto.alertId,
    author: dto.author,
    role: dto.role as OpsRole,
    body: dto.body as ChatBody,
    at: dto.at,
  };
}

/** seed chat + tin đã lưu (đã lưu xếp sau seed, theo thứ tự thời gian tăng dần). */
function mergeChat(persisted: OpsChatDTO[]): Record<string, ChatMessage[]> {
  const map = seedChat();
  for (const dto of persisted) {
    (map[dto.alertId] ??= []).push(chatDtoToMessage(dto));
  }
  return map;
}

function activityDtoToItem(dto: OpsActivityDTO): ActivityItem {
  return { id: dto.id, tag: dto.tag as AlertTag, message: dto.message, at: dto.at };
}

/** nhật ký đã lưu + seed, sắp mới nhất lên đầu (đã lưu có mốc thật nên tự lên trên). */
function mergeActivities(persisted: OpsActivityDTO[]): ActivityItem[] {
  return [...persisted.map(activityDtoToItem), ...MOCK_ACTIVITY].sort((a, b) =>
    b.at.localeCompare(a.at)
  );
}

export function CommandCenter() {
  // Vai trò vận hành giả lập — bộ chuyển ở góc để thử nghiệm RBAC.
  const [role, setRole] = useState<OpsRole>("ADMIN");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [chat, setChat] = useState<Record<string, ChatMessage[]>>(seedChat);
  const [activities, setActivities] = useState<ActivityItem[]>(MOCK_ACTIVITY);
  const [activityFilter, setActivityFilter] = useState<AlertTag | "all">("all");
  const [openAlertId, setOpenAlertId] = useState<string | null>(null);
  // Cảnh báo đang mở pop-up xử lý nhanh
  const [actionAlertId, setActionAlertId] = useState<string | null>(null);

  // Nạp trạng thái đã lưu (đã xử lý / chat / nhật ký) rồi ghép vào seed demo.
  // Cũng dùng để hoà giải lại khi một thao tác ghi backend thất bại.
  const reloadState = useCallback(async () => {
    try {
      const s = await fetchCommandCenterState();
      setResolved(new Set(s.resolvedAlertIds));
      setChat(mergeChat(s.chat));
      setActivities(mergeActivities(s.activities));
    } catch {
      // Không tải được thì giữ nguyên seed đang hiển thị — không làm vỡ Dashboard.
    }
  }, []);

  useEffect(() => {
    reloadState();
  }, [reloadState]);

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

  // Ghi nhật ký NGAY trên giao diện (optimistic). Bản lưu bền vững do backend tạo
  // khi ta gọi /resolve hoặc /chat kèm `activity`; lần F5 sau đọc lại bản đó.
  function logActivityLocal(tag: AlertTag, message: string) {
    setActivities((prev) => [
      { id: nextId("ac"), tag, message, at: new Date().toISOString() },
      ...prev,
    ]);
  }

  // Pop-up chỉ mở với cảnh báo mà vai trò vừa XEM được vừa được THAO TÁC
  const actionAlert = actionAlertId
    ? MOCK_ALERTS.find(
        (a) =>
          a.id === actionAlertId && canView(role, a.tag) && canAct(role, a.tag)
      ) ?? null
    : null;

  /** Lưu trạng thái đã-xử-lý xuống backend; hỏng thì hoà giải lại từ server. */
  async function persistResolve(
    alertId: string,
    nextResolved: boolean,
    activity?: { tag: AlertTag; message: string }
  ) {
    try {
      await setCommandCenterResolved({
        alertId,
        resolved: nextResolved,
        byRole: role,
        activity,
      });
    } catch {
      toast.error("Không lưu được trạng thái — đang tải lại.");
      reloadState();
    }
  }

  /** Xác nhận pop-up thành công → đánh dấu Đã xử lý + ghi nhật ký. */
  function completeAction(summary: string) {
    if (!actionAlert) return;
    const a = actionAlert;
    const message = `${ROLE_META[role].label}: ${summary}`;
    setResolved((prev) => new Set(prev).add(a.id));
    logActivityLocal(a.tag, message);
    toast.success(summary);
    setActionAlertId(null);
    persistResolve(a.id, true, { tag: a.tag, message });
  }

  function toggleResolved(alertId: string) {
    const alert = MOCK_ALERTS.find((a) => a.id === alertId);
    if (!alert) return;
    const nextResolved = !resolved.has(alertId);

    setResolved((prev) => {
      const next = new Set(prev);
      if (nextResolved) next.add(alertId);
      else next.delete(alertId);
      return next;
    });

    // Chỉ ghi nhật ký khi chuyển SANG đã xử lý (bỏ đánh dấu là thao tác thầm lặng).
    const activity = nextResolved
      ? {
          tag: alert.tag,
          message: `${ROLE_META[role].label} đánh dấu ĐÃ XỬ LÝ: ${alert.title}`,
        }
      : undefined;
    if (activity) logActivityLocal(activity.tag, activity.message);

    persistResolve(alertId, nextResolved, activity);
  }

  async function sendMessage(body: ChatBody) {
    if (!openAlert) return;
    const a = openAlert;
    const optimistic: ChatMessage = {
      id: nextId("ms"),
      alertId: a.id,
      author: "Bạn",
      role,
      body,
      at: new Date().toISOString(),
    };
    setChat((prev) => ({
      ...prev,
      [a.id]: [...(prev[a.id] ?? []), optimistic],
    }));
    const activityMessage = `${ROLE_META[role].label} vừa trao đổi trong sự cố: ${a.title}`;
    logActivityLocal(a.tag, activityMessage);

    try {
      await postCommandCenterChat({
        alertId: a.id,
        role,
        body,
        author: "Bạn",
        activity: { tag: a.tag, message: activityMessage },
      });
    } catch {
      toast.error("Không gửi được tin — đang tải lại.");
      reloadState();
    }
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
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-red-500">
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
                  onAction={() => setActionAlertId(a.id)}
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

      {actionAlert && (
        <ActionModal
          alert={actionAlert}
          onCancel={() => setActionAlertId(null)}
          onDone={completeAction}
        />
      )}
    </section>
  );
}
