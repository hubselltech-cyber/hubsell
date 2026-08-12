"use client";

// ============================================================
// QUẢN TRỊ NỀN TẢNG HUBSELL (/admin) — trung tâm làm việc của KHU ĐIỀU HÀNH:
// chủ nền tảng (cờ isPlatformAdmin) + nhân viên điều hành (cây quyền hq.*).
//
// Góc nhìn TOÀN HỆ THỐNG (mọi shop đăng ký), khác hẳn các trang còn lại vốn
// bó theo shop đang đăng nhập:
//   - Tổng quan   : người dùng đăng ký, gian hàng đã nối, đơn, sức khỏe webhook
//   - Khách hàng  : CRM nội bộ GĐ2 — trạng thái chăm sóc, phụ trách, ghi chú
//   - Kế toán     : GĐ3 — Ví Hubsell toàn hệ thống + duyệt lệnh rút hoa hồng
//   - Marketing   : GĐ4 — hiệu quả chương trình giới thiệu
//   - Webhook     : nhật ký hàng đợi webhook Shopee/MISA toàn hệ thống
//   - Nhật ký thao tác: GĐ4 — CHỈ chủ nền tảng, giám sát chính đội điều hành
//
// Tab hiện theo lá hq.* được cấp (khớp requirePlatformPermission backend);
// quyền chặn thật ở backend (403) — trang chỉ phản chiếu.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HeartHandshake, Loader2, RefreshCcw } from "lucide-react";

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
  fetchHqStaff,
  fetchPlatformAuditLogs,
  fetchPlatformFinance,
  fetchPlatformMarketing,
  fetchPlatformStats,
  fetchPlatformUsers,
  fetchPlatformWebhookLogs,
  getStoredUser,
  getToken,
  type HqMember,
  type PlatformAuditLogsResponse,
  type PlatformCareStatus,
  type PlatformFinanceResponse,
  type PlatformMarketingResponse,
  type PlatformStats,
  type PlatformUserRow,
  type PlatformUsersResponse,
  type PlatformWebhookLogsResponse,
  type PlatformWebhookLogRow,
  type PlatformWebhookSource,
} from "@/lib/api";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CareDialog } from "./care-dialog";
import { FinanceTab } from "./finance-tab";
import { MarketingTab } from "./marketing-tab";
import { AuditTab } from "./audit-tab";
import {
  CARE_STATUS_META,
  CARE_STATUSES,
  StatCard,
  formatCount,
  pageCount,
} from "./shared";

type Tab = "overview" | "users" | "finance" | "marketing" | "webhooks" | "audit";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Tổng quan hệ thống" },
  { key: "users", label: "Khách hàng đăng ký" },
  { key: "finance", label: "Kế toán nội bộ" },
  { key: "marketing", label: "Marketing" },
  { key: "webhooks", label: "Nhật ký Webhook" },
  { key: "audit", label: "Nhật ký thao tác" },
];

/**
 * Lá quyền HQ gác từng tab (khớp requirePlatformPermission ở backend/routes/
 * admin.ts). Riêng "audit" KHÔNG có lá — chỉ chủ nền tảng (isPlatformAdmin)
 * thấy: sổ giám sát đội điều hành thì người bị giám sát không tự soát được.
 */
const TAB_PERM: Record<Exclude<Tab, "audit">, string> = {
  overview: "hq.overview",
  users: "hq.customers",
  finance: "hq.finance",
  marketing: "hq.marketing",
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
  const [careFilter, setCareFilter] = useState<"" | PlatformCareStatus>("");
  const [hqMembers, setHqMembers] = useState<HqMember[] | null>(null);
  const [careFor, setCareFor] = useState<PlatformUserRow | null>(null);
  const [finance, setFinance] = useState<PlatformFinanceResponse | null>(null);
  const [marketing, setMarketing] = useState<PlatformMarketingResponse | null>(null);
  const [audit, setAudit] = useState<PlatformAuditLogsResponse | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [logs, setLogs] = useState<PlatformWebhookLogsResponse | null>(null);
  const [logSource, setLogSource] = useState<PlatformWebhookSource>("shopee");
  const [logStatus, setLogStatus] = useState<string>("");
  const [logsPage, setLogsPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Nạp dữ liệu của tab đang mở. 403 = không có quyền tab này → AccessDenied.
  const load = useCallback(async () => {
    if (!tab) return; // chưa chốt tab mặc định theo quyền
    setLoading(true);
    setError(null);
    try {
      if (tab === "overview") setStats(await fetchPlatformStats());
      else if (tab === "users") {
        const [u, members] = await Promise.all([
          fetchPlatformUsers({
            page: usersPage,
            pageSize: 20,
            careStatus: careFilter || undefined,
          }),
          // Danh sách thành viên HQ chỉ cần nạp một lần cho dropdown phụ trách.
          hqMembers === null ? fetchHqStaff() : Promise.resolve(null),
        ]);
        setUsers(u);
        if (members) setHqMembers(members.members);
      } else if (tab === "finance") setFinance(await fetchPlatformFinance());
      else if (tab === "marketing") setMarketing(await fetchPlatformMarketing());
      else if (tab === "audit")
        setAudit(await fetchPlatformAuditLogs({ page: auditPage, pageSize: 20 }));
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
  }, [tab, usersPage, careFilter, hqMembers, auditPage, logSource, logStatus, logsPage, router]);

  // Chốt danh sách tab theo quyền của người xem (đọc localStorage nên phải nằm
  // trong effect, không chạy lúc prerender). Không được tab nào → AccessDenied.
  useEffect(() => {
    const u = getStoredUser();
    const tabs = u
      ? TABS.filter((t) =>
          t.key === "audit" ? u.isPlatformAdmin === true : can(u, TAB_PERM[t.key])
        )
      : TABS.filter((t) => t.key !== "audit");
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

        {/* ================= TAB KHÁCH HÀNG (CRM GĐ2) ================= */}
        {tab === "users" && !error && (
          <div className="space-y-4">
            {/* Lọc theo trạng thái chăm sóc */}
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
              {([["", "Tất cả"]] as [string, string][])
                .concat(CARE_STATUSES.map((s) => [s, CARE_STATUS_META[s].label]))
                .map(([value, label]) => (
                  <button
                    key={value || "all"}
                    type="button"
                    onClick={() => {
                      setCareFilter(value as "" | PlatformCareStatus);
                      setUsersPage(1);
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      careFilter === value
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    {label}
                  </button>
                ))}
            </div>

            <Card>
              <CardContent className="p-0">
                {loading && !users ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Đang tải dữ liệu…
                  </p>
                ) : users && users.users.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Không có khách hàng nào khớp bộ lọc.
                  </p>
                ) : users ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Đăng ký lúc</TableHead>
                          <TableHead>Chủ shop</TableHead>
                          <TableHead>Liên hệ</TableHead>
                          <TableHead>Quy mô</TableHead>
                          <TableHead>Hoạt động gần nhất</TableHead>
                          <TableHead>Trạng thái</TableHead>
                          <TableHead>Phụ trách</TableHead>
                          <TableHead className="text-right">CSKH</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {users.users.map((u) => {
                          const care = CARE_STATUS_META[u.care?.status ?? "NEW"];
                          return (
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
                              <TableCell className="text-sm">
                                {u.email}
                                {u.phone && (
                                  <p className="font-mono text-xs text-muted-foreground">
                                    {u.phone}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                {formatCount(u.channelCount)} gian ·{" "}
                                {formatCount(u.productCount)} SP ·{" "}
                                {formatCount(u.orderCount)} đơn
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                {u.lastOrderAt ? formatDateTime(u.lastOrderAt) : "—"}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={cn(
                                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                    care.className
                                  )}
                                >
                                  {care.label}
                                </span>
                                {u.care?.note && (
                                  <p
                                    className="mt-1 max-w-[180px] truncate text-xs text-muted-foreground"
                                    title={u.care.note}
                                  >
                                    {u.care.note}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-sm">
                                {u.care?.assignee?.fullName ?? (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setCareFor(u)}
                                >
                                  <HeartHandshake className="size-4" />
                                  Chăm sóc
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                      <span>
                        {formatCount(users.total)} khách hàng · trang {users.page}/
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
          </div>
        )}

        {/* ================= TAB KẾ TOÁN NỘI BỘ (GĐ3) ================= */}
        {tab === "finance" && !error && (
          <FinanceTab data={finance} loading={loading} onChanged={load} />
        )}

        {/* ================= TAB MARKETING (GĐ4) ================= */}
        {tab === "marketing" && !error && (
          <MarketingTab data={marketing} loading={loading} />
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

        {/* ================= TAB NHẬT KÝ THAO TÁC (GĐ4, chỉ chủ nền tảng) ================= */}
        {tab === "audit" && !error && (
          <AuditTab
            data={audit}
            loading={loading}
            page={auditPage}
            onPageChange={setAuditPage}
          />
        )}
      </div>

      {careFor && (
        <CareDialog
          customer={careFor}
          members={hqMembers ?? []}
          open={true}
          onOpenChange={(o) => {
            if (!o) setCareFor(null);
          }}
          onSaved={load}
        />
      )}
    </AppShell>
  );
}
