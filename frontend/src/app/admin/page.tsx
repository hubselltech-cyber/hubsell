"use client";

// ============================================================
// QUẢN TRỊ NỀN TẢNG HUBSELL (/admin) — CHỈ tài khoản có cờ isPlatformAdmin.
//
// Góc nhìn CHỦ NỀN TẢNG trên toàn hệ thống (mọi shop đăng ký), khác hẳn các
// trang còn lại vốn bó theo shop đang đăng nhập:
//   - Tổng quan  : người dùng đăng ký, gian hàng đã nối, đơn, sức khỏe webhook
//   - Người dùng : danh sách chủ shop đăng ký mới nhất + quy mô từng shop
//   - Webhook    : nhật ký hàng đợi webhook Shopee/MISA toàn hệ thống
//
// Quyền chặn ở backend (403) — trang chỉ phản chiếu: bị 403 thì hiện màn
// AccessDenied chứ không tự suy diễn từ localStorage (có thể cũ).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { AccessDenied } from "@/components/access-denied";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  fetchPlatformStats,
  fetchPlatformUsers,
  fetchPlatformWebhookLogs,
  getStoredUser,
  getToken,
  type PlatformStats,
  type PlatformUsersResponse,
  type PlatformWebhookLogsResponse,
  type PlatformWebhookLogRow,
  type PlatformWebhookSource,
} from "@/lib/api";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "overview" | "users" | "webhooks";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Tổng quan hệ thống" },
  { key: "users", label: "Người dùng đăng ký" },
  { key: "webhooks", label: "Nhật ký Webhook" },
];

/**
 * Lá quyền HQ gác từng tab (khớp requirePlatformPermission ở backend/routes/
 * admin.ts). Chủ nền tảng qua hết (can() cho ADMIN luôn đúng); nhân viên điều
 * hành chỉ thấy tab được tick — tab đầu tiên nhìn thấy là tab mở mặc định.
 */
const TAB_PERM: Record<Tab, string> = {
  overview: "hq.overview",
  users: "hq.customers",
  webhooks: "hq.webhooks",
};

const PLATFORM_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  LAZADA: "Lazada",
  TIKTOK: "TikTok Shop",
  OFFLINE: "Offline",
};

const STATUS_META: Record<
  PlatformWebhookLogRow["status"],
  { label: string; className: string }
> = {
  PENDING: { label: "Chờ xử lý", className: "border-slate-200 bg-slate-50 text-slate-600" },
  PROCESSING: { label: "Đang chạy", className: "border-sky-200 bg-sky-50 text-sky-700" },
  VERIFYING: { label: "Đang đối soát", className: "border-amber-200 bg-amber-50 text-amber-700" },
  SUCCESS: { label: "Thành công", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  FAILED: { label: "Thất bại", className: "border-rose-200 bg-rose-50 text-rose-700" },
};

const WEBHOOK_STATUS_FILTERS = ["", "PENDING", "SUCCESS", "FAILED"] as const;

function formatCount(n: number): string {
  return n.toLocaleString("vi-VN");
}

/** Thẻ số liệu to — dùng cho tab Tổng quan. */
function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-sm text-muted-foreground">{props.label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight">{props.value}</p>
        {props.hint && (
          <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PlatformAdminPage() {
  const router = useRouter();
  // tab = null cho tới khi biết người xem được cấp những tab nào — nhân viên
  // chỉ có "Khách hàng đăng ký" mà cứ nạp tab Tổng quan mặc định là dính 403
  // rồi AccessDenied oan cả trang.
  const [tab, setTab] = useState<Tab | null>(null);
  const [visibleTabs, setVisibleTabs] = useState<typeof TABS>(TABS);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [users, setUsers] = useState<PlatformUsersResponse | null>(null);
  const [usersPage, setUsersPage] = useState(1);
  const [logs, setLogs] = useState<PlatformWebhookLogsResponse | null>(null);
  const [logSource, setLogSource] = useState<PlatformWebhookSource>("shopee");
  const [logStatus, setLogStatus] = useState<string>("");
  const [logsPage, setLogsPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Nạp dữ liệu của tab đang mở. 403 = không phải quản trị nền tảng → AccessDenied.
  const load = useCallback(async () => {
    if (!tab) return; // chưa chốt tab mặc định theo quyền
    setLoading(true);
    setError(null);
    try {
      if (tab === "overview") setStats(await fetchPlatformStats());
      else if (tab === "users")
        setUsers(await fetchPlatformUsers({ page: usersPage, pageSize: 20 }));
      else
        setLogs(
          await fetchPlatformWebhookLogs({
            source: logSource,
            status: logStatus || undefined,
            page: logsPage,
            pageSize: 20,
          })
        );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : "Chưa kết nối được máy chủ (backend). Hãy chắc chắn backend đang chạy ở cổng 4000."
      );
    } finally {
      setLoading(false);
    }
  }, [tab, usersPage, logSource, logStatus, logsPage, router]);

  // Chốt danh sách tab theo quyền của người xem (đọc localStorage nên phải nằm
  // trong effect, không chạy lúc prerender). Không được tab nào → AccessDenied.
  useEffect(() => {
    const u = getStoredUser();
    const tabs = u ? TABS.filter((t) => can(u, TAB_PERM[t.key])) : TABS;
    setVisibleTabs(tabs);
    if (tabs.length === 0) {
      setDenied(true);
      return;
    }
    setTab((cur) => cur ?? tabs[0].key);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    load();
  }, [load, router]);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const pageCount = (total: number, pageSize: number) =>
    Math.max(1, Math.ceil(total / pageSize));

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Khu điều hành Hubsell: số liệu vận hành trên TOÀN BỘ hệ thống (mọi
            shop đã đăng ký) — dành cho chủ nền tảng và nhân viên điều hành.
          </p>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
            Tải lại
          </Button>
        </div>

        {/* Thanh tab — chỉ những tab người xem có quyền */}
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <Card>
            <CardContent>
              <p className="py-6 text-center text-sm text-amber-700">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* ================= TAB TỔNG QUAN ================= */}
        {tab === "overview" && !error && (
          <div className="space-y-6">
            {loading && !stats ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải dữ liệu…
              </p>
            ) : stats ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="Chủ shop đã đăng ký"
                    value={formatCount(stats.users.totalOwners)}
                    hint={`+${formatCount(stats.users.newOwners7d)} trong 7 ngày · +${formatCount(stats.users.newOwners30d)} trong 30 ngày`}
                  />
                  <StatCard
                    label="Tài khoản nhân viên"
                    value={formatCount(stats.users.totalStaff)}
                    hint="Do các chủ shop tự tạo"
                  />
                  <StatCard
                    label="Đơn hàng toàn hệ thống"
                    value={formatCount(stats.orders.total)}
                    hint={`+${formatCount(stats.orders.last24h)} trong 24 giờ qua`}
                  />
                  <StatCard
                    label="Gian hàng đã kết nối"
                    value={formatCount(
                      stats.channelsByPlatform.reduce((s, c) => s + c.count, 0)
                    )}
                    hint={stats.channelsByPlatform
                      .map(
                        (c) =>
                          `${PLATFORM_LABEL[c.platform] ?? c.platform}: ${c.count}`
                      )
                      .join(" · ")}
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {(
                    [
                      ["Hàng đợi webhook Shopee", stats.webhooks.shopee],
                      ["Hàng đợi webhook MISA", stats.webhooks.misa],
                    ] as const
                  ).map(([title, rows]) => (
                    <Card key={title}>
                      <CardContent className="py-5">
                        <p className="mb-3 text-sm font-semibold">{title}</p>
                        {rows.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Chưa nhận sự kiện nào.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {rows.map((r) => {
                              const meta =
                                STATUS_META[
                                  r.status as PlatformWebhookLogRow["status"]
                                ];
                              return (
                                <span
                                  key={r.status}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                                    meta?.className
                                  )}
                                >
                                  {meta?.label ?? r.status}
                                  <span className="opacity-70">
                                    {formatCount(r.count)}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}

        {/* ================= TAB NGƯỜI DÙNG ================= */}
        {tab === "users" && !error && (
          <Card>
            <CardContent className="p-0">
              {loading && !users ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Đang tải dữ liệu…
                </p>
              ) : users && users.users.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Chưa có chủ shop nào đăng ký.
                </p>
              ) : users ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Đăng ký lúc</TableHead>
                        <TableHead>Chủ shop</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Số điện thoại</TableHead>
                        <TableHead className="text-center">Quốc gia</TableHead>
                        <TableHead className="text-center">Google</TableHead>
                        <TableHead className="text-center">Gian hàng</TableHead>
                        <TableHead className="text-center">Nhân viên</TableHead>
                        <TableHead className="text-center">Sản phẩm</TableHead>
                        <TableHead className="text-center">Đơn hàng</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDateTime(u.createdAt)}
                          </TableCell>
                          <TableCell>
                            <p className="text-sm font-medium">{u.fullName}</p>
                            {u.username && (
                              <p className="font-mono text-xs text-muted-foreground">
                                @{u.username}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">{u.email}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-sm">
                            {u.phone ?? "—"}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {u.country}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {u.hasGoogle ? "✓" : "—"}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {formatCount(u.channelCount)}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {formatCount(u.staffCount)}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {formatCount(u.productCount)}
                          </TableCell>
                          <TableCell className="text-center text-sm">
                            {formatCount(u.orderCount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                    <span>
                      {formatCount(users.total)} chủ shop · trang {users.page}/
                      {pageCount(users.total, users.pageSize)}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={usersPage <= 1 || loading}
                        onClick={() => setUsersPage((p) => p - 1)}
                      >
                        Trước
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          usersPage >= pageCount(users.total, users.pageSize) ||
                          loading
                        }
                        onClick={() => setUsersPage((p) => p + 1)}
                      >
                        Sau
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* ================= TAB WEBHOOK ================= */}
        {tab === "webhooks" && !error && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Chọn nguồn: Shopee / MISA (Lazada xử lý trực tiếp, chưa ghi log) */}
              <div className="flex items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
                {(["shopee", "misa"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setLogSource(s);
                      setLogsPage(1);
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium uppercase transition-colors",
                      logSource === s
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    {s === "shopee" ? "Shopee" : "MISA"}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
                {WEBHOOK_STATUS_FILTERS.map((s) => (
                  <button
                    key={s || "all"}
                    type="button"
                    onClick={() => {
                      setLogStatus(s);
                      setLogsPage(1);
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      logStatus === s
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    {s === "" ? "Tất cả" : s}
                  </button>
                ))}
              </div>
            </div>

            <Card>
              <CardContent className="p-0">
                {loading && !logs ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Đang tải dữ liệu…
                  </p>
                ) : logs && logs.logs.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Không có bản ghi nào khớp bộ lọc.
                  </p>
                ) : logs ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Thời gian</TableHead>
                          <TableHead>Sự kiện</TableHead>
                          <TableHead>Tham chiếu</TableHead>
                          <TableHead className="text-center">Trạng thái</TableHead>
                          <TableHead className="text-center">Lượt</TableHead>
                          <TableHead>Lỗi gần nhất</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logs.logs.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {formatDateTime(row.createdAt)}
                            </TableCell>
                            <TableCell className="text-sm">
                              {logs.source === "shopee"
                                ? `Code ${row.eventCode}`
                                : row.eventType}
                              {logs.source === "shopee" && row.shopId && (
                                <p className="font-mono text-xs text-muted-foreground">
                                  shop {row.shopId}
                                </p>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {logs.source === "shopee"
                                ? row.orderSn ?? "—"
                                : row.invoiceNo ?? row.orderCode ?? "—"}
                            </TableCell>
                            <TableCell className="text-center">
                              <span
                                className={cn(
                                  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                  STATUS_META[row.status].className
                                )}
                              >
                                {STATUS_META[row.status].label}
                              </span>
                            </TableCell>
                            <TableCell className="text-center text-sm">
                              {row.attempts}
                            </TableCell>
                            <TableCell className="max-w-[240px] truncate text-sm text-rose-600">
                              {row.lastError ?? ""}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                      <span>
                        {formatCount(logs.total)} bản ghi · trang {logs.page}/
                        {pageCount(logs.total, logs.pageSize)}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={logsPage <= 1 || loading}
                          onClick={() => setLogsPage((p) => p - 1)}
                        >
                          Trước
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            logsPage >= pageCount(logs.total, logs.pageSize) ||
                            loading
                          }
                          onClick={() => setLogsPage((p) => p + 1)}
                        >
                          Sau
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
