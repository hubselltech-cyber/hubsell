"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Activity } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchCommandCenterState,
  fetchSyncAlerts,
  postCommandCenterChat,
  postCommandCenterSeen,
  resolveCommandCenterOpsAlert,
  resolveSyncAlert,
  setCommandCenterResolved,
  type InventorySyncAlert,
  type OpsActivityDTO,
  type OpsAlertDTO,
  type OpsChatDTO,
} from "@/lib/api";
import { AlertCard } from "./alert-card";
import { ActionModal } from "./action-modal";
import { ActivityFeed } from "./activity-feed";
import { ChatDrawer } from "./chat-drawer";
import { nextId } from "./mock-service";
import {
  canAct,
  canView,
  ROLE_META,
  visibleTags,
  type ActivityItem,
  type AlertTag,
  type ChatBody,
  type ChatMessage,
  type OpsAlert,
  type OpsRole,
} from "./types";

// ─────────── CẢNH BÁO THẬT từ luồng đồng bộ tồn Shopee ───────────
//
// Khác các thẻ mock demo: đây là bản ghi InventorySyncAlert thật trong DB
// (đẩy tồn thất bại sau 3 lần retry + 3 lượt đối soát). Map về cùng khuôn
// OpsAlert để dùng chung thẻ/chat/nhật ký; nhận diện lại bằng
// action.kind === "force-sync-stock" khi cần xử lý khác mock.

function syncAlertToOps(a: InventorySyncAlert): OpsAlert {
  return {
    id: `sync-${a.id}`,
    tag: "channel", // nhãn [SÀN]
    severity: "high",
    title: a.channelSku
      ? `Chưa đẩy được tồn SKU ${a.channelSku} lên "${a.shopName}"`
      : `Gian "${a.shopName}" đang không đồng bộ được`,
    // Dòng 1 của lời cảnh báo = việc cần làm (backend đã dịch ra tiếng người);
    // chi tiết kỹ thuật sau "\n" không đưa lên thẻ.
    summary: a.message.split("\n")[0],
    actionLabel: "Cập nhật tồn",
    action: {
      kind: "force-sync-stock",
      alertDbId: a.id,
      sku: a.channelSku ?? "?",
      channel: a.shopName,
      hubsellStock: a.hubsellAvailable,
    },
    createdAt: new Date(a.createdAt).toISOString(),
  };
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

// ─────────── CẢNH BÁO THẬT từ bảng OpsAlert (detector backend) ───────────
//
// Backend quét dữ liệu thật (cháy hàng, gian mất kết nối, đơn lỗ, chênh phí
// ship) và trả về các dòng OpsAlert đang MỞ. Map về khuôn OpsAlert chung của
// UI; nút xử lý là deep-link (kind "navigate") tới trang chuyên sâu sẵn có.

const UI_TAGS: AlertTag[] = ["inventory", "finance", "channel", "ads", "tax"];

function opsDtoToAlert(dto: OpsAlertDTO): OpsAlert {
  const p = dto.payload as
    | { kind?: string; href?: string; label?: string; source?: string }
    | null;
  const action =
    p?.kind === "navigate" && typeof p.href === "string"
      ? ({ kind: "navigate", href: p.href } as const)
      : ({ kind: "confirm", description: dto.summary } as const);
  return {
    id: `ops-${dto.id}`,
    tag: UI_TAGS.includes(dto.tag as AlertTag) ? (dto.tag as AlertTag) : "channel",
    source: typeof p?.source === "string" ? p.source : undefined,
    severity:
      dto.severity === "high" || dto.severity === "low" ? dto.severity : "medium",
    title: dto.title,
    summary: dto.summary,
    actionLabel: p?.label ?? "Xem chi tiết",
    action,
    createdAt: dto.createdAt,
  };
}

// ─────────── DỮ LIỆU ĐÃ LƯU Ở BACKEND ───────────
//
// 09/09/2026: bỏ hẳn bộ thẻ/chat/nhật ký "mồi" (MOCK_ALERTS/MOCK_CHAT/
// MOCK_ACTIVITY) và bộ chuyển vai trò giả lập — khối này giờ CHỈ hiện cảnh báo
// thật (đồng bộ tồn Shopee + bảng OpsAlert) và những gì người dùng đã thao tác.
// Production không còn thẻ trình diễn nào đứng cạnh sự cố thật.

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

/** Tin đã lưu gom theo alertId (thứ tự thời gian tăng dần). */
function mergeChat(persisted: OpsChatDTO[]): Record<string, ChatMessage[]> {
  const map: Record<string, ChatMessage[]> = {};
  for (const dto of persisted) {
    (map[dto.alertId] ??= []).push(chatDtoToMessage(dto));
  }
  return map;
}

function activityDtoToItem(dto: OpsActivityDTO): ActivityItem {
  return { id: dto.id, tag: dto.tag as AlertTag, message: dto.message, at: dto.at };
}

/** Nhật ký đã lưu, sắp mới nhất lên đầu. */
function mergeActivities(persisted: OpsActivityDTO[]): ActivityItem[] {
  return persisted.map(activityDtoToItem).sort((a, b) => b.at.localeCompare(a.at));
}

export function CommandCenter() {
  const router = useRouter();
  // Vai trò vận hành: khối này chỉ hiện với chủ shop (seesFinancials) nên cố
  // định ADMIN; phân quyền nhân viên thật nằm ở cây quyền auth, không ở đây.
  const role: OpsRole = "ADMIN";
  // Cảnh báo THẬT từ luồng đồng bộ tồn Shopee.
  const [syncAlerts, setSyncAlerts] = useState<OpsAlert[]>([]);
  // Cảnh báo THẬT từ bảng OpsAlert (detector cháy hàng / mất kết nối / đơn lỗ /
  // chênh phí ship) — backend tự đóng khi điều kiện hết.
  const [opsAlerts, setOpsAlerts] = useState<OpsAlert[]>([]);
  // Mốc lần mở TRƯỚC — cảnh báo phát sinh sau mốc này được gắn nhãn "Mới".
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [chat, setChat] = useState<Record<string, ChatMessage[]>>({});
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityFilter, setActivityFilter] = useState<AlertTag | "all">("all");
  const [openAlertId, setOpenAlertId] = useState<string | null>(null);
  // Cảnh báo đang mở pop-up xử lý nhanh
  const [actionAlertId, setActionAlertId] = useState<string | null>(null);

  // Nạp trạng thái đã lưu (đã xử lý / chat / nhật ký / cảnh báo OpsAlert).
  // Cũng dùng để hoà giải lại khi một thao tác ghi backend thất bại.
  const reloadState = useCallback(async () => {
    try {
      const s = await fetchCommandCenterState();
      setResolved(new Set(s.resolvedAlertIds));
      setChat(mergeChat(s.chat));
      setActivities(mergeActivities(s.activities));
      setOpsAlerts((s.opsAlerts ?? []).map(opsDtoToAlert));
      setLastSeenAt(s.lastSeenAt ?? null);
    } catch {
      // Không tải được thì giữ nguyên danh sách đang hiển thị — không làm vỡ Dashboard.
    }
  }, []);

  const loadSyncAlerts = useCallback(async () => {
    try {
      const list = await fetchSyncAlerts();
      setSyncAlerts(list.map(syncAlertToOps));
    } catch {
      // Lỗi tải cảnh báo tồn không được làm vỡ khối — giữ danh sách cũ.
    }
  }, []);

  useEffect(() => {
    // Đọc mốc "Mới" cũ TRƯỚC rồi mới dời mốc — thứ tự này quyết định nhãn đúng.
    void (async () => {
      await reloadState();
      postCommandCenterSeen().catch(() => {}); // fire-and-forget, hỏng cũng không sao
    })();
    loadSyncAlerts();
  }, [reloadState, loadSyncAlerts]);

  const tags = visibleTags(role);

  const allAlerts = [...syncAlerts, ...opsAlerts];

  /** Cảnh báo phát sinh SAU lần mở trước → nhãn "Mới" (mốc null = lần đầu, bỏ qua). */
  const isNewAlert = (a: OpsAlert) =>
    lastSeenAt !== null && a.createdAt > lastSeenAt;

  // Chưa xử lý lên trước, rồi mức độ, rồi mới nhất.
  const alerts = allAlerts.filter((a) => canView(role, a.tag)).sort((a, b) => {
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
    ? allAlerts.find((a) => a.id === openAlertId && canView(role, a.tag)) ??
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
    ? allAlerts.find(
        (a) =>
          a.id === actionAlertId && canView(role, a.tag) && canAct(role, a.tag)
      ) ?? null
    : null;

  /** Bấm nút xử lý: deep-link thì điều hướng thẳng, còn lại mở pop-up. */
  function handleAction(a: OpsAlert) {
    if (a.action.kind === "navigate") {
      if (/^https?:\/\//.test(a.action.href)) {
        // Link NGOÀI (VD Shopee Seller Center) — mở tab mới, giữ nguyên Dashboard.
        window.open(a.action.href, "_blank", "noopener");
      } else {
        router.push(a.action.href);
      }
      return;
    }
    setActionAlertId(a.id);
  }

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
    toast.success(summary);
    setActionAlertId(null);

    if (a.action.kind === "force-sync-stock") {
      // Cảnh báo THẬT: backend đã đè tồn + đóng cảnh báo + ghi nhật ký vận
      // hành rồi — chỉ cần tải lại để thẻ biến mất và nhật ký hiện dòng mới.
      loadSyncAlerts();
      reloadState();
      return;
    }

    const message = `${ROLE_META[role].label}: ${summary}`;
    setResolved((prev) => new Set(prev).add(a.id));
    logActivityLocal(a.tag, message);
    persistResolve(a.id, true, { tag: a.tag, message });
  }

  function toggleResolved(alertId: string) {
    const alert = allAlerts.find((a) => a.id === alertId);
    if (!alert) return;

    if (alertId.startsWith("ops-")) {
      // Cảnh báo THẬT (OpsAlert): đóng MỘT CHIỀU — backend ẩn nó cho tới khi
      // điều kiện hết hẳn rồi tái phát mới mở lại như cảnh báo mới.
      const dbId = alertId.slice("ops-".length);
      const message = `${ROLE_META[role].label} đánh dấu ĐÃ XỬ LÝ: ${alert.title}`;
      setOpsAlerts((prev) => prev.filter((a) => a.id !== alertId));
      logActivityLocal(alert.tag, message);
      resolveCommandCenterOpsAlert(dbId, { tag: alert.tag, message }).catch(() => {
        toast.error("Không lưu được trạng thái — đang tải lại.");
        reloadState();
      });
      return;
    }

    if (alert.action.kind === "force-sync-stock") {
      // Cảnh báo THẬT đóng MỘT CHIỀU trong DB (không bỏ đánh dấu lại được).
      const dbId = alert.action.alertDbId;
      setSyncAlerts((prev) => prev.filter((a) => a.id !== alertId));
      logActivityLocal(
        "channel",
        `${ROLE_META[role].label} đánh dấu ĐÃ XỬ LÝ: ${alert.title}`
      );
      resolveSyncAlert(dbId)
        .catch(() => toast.error("Không đóng được cảnh báo — đang tải lại."))
        .finally(() => loadSyncAlerts());
      return;
    }

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
      {/* Đầu khối */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">
          Trung tâm điều hành
        </h2>
        <p className="text-sm text-slate-500">
          Sự cố cần xử lý từ đồng bộ tồn, đơn hàng và kết nối sàn — kèm nhật ký
          ai đã làm gì.
        </p>
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
                Không có sự cố nào cần xử lý — các gian hàng đang đồng bộ bình
                thường.
              </p>
            ) : (
              alerts.map((a) => (
                <AlertCard
                  key={a.id}
                  alert={a}
                  role={role}
                  resolved={resolved.has(a.id)}
                  chatCount={chat[a.id]?.length ?? 0}
                  isNew={isNewAlert(a)}
                  demo={a.id.startsWith("al-")}
                  onAction={() => handleAction(a)}
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
