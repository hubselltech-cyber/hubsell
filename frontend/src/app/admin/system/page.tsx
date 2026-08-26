"use client";

// ============================================================
// HỆ THỐNG & KỸ THUẬT (/admin/system): khu kỹ thuật của khu điều hành —
//  - Nhật ký Webhook (lá hq.webhooks): hàng đợi webhook Shopee/MISA toàn hệ thống
//  - Nhật ký thao tác (CHỈ chủ nền tảng): sổ giám sát đội điều hành — người bị
//    giám sát không tự soát sổ, nên không có lá quyền nào mở được phần này.
// ============================================================

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { AccessDenied } from "@/components/shared/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchPlatformAuditLogs,
  fetchPlatformWebhookLogs,
  getStoredUser,
  type PlatformAuditLogsResponse,
  type PlatformWebhookLogsResponse,
  type PlatformWebhookLogRow,
  type PlatformWebhookSource,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AuditTab } from "../audit-tab";
import {
  AdminError,
  AdminPageHeader,
  formatCount,
  pageCount,
  useAdminPage,
} from "../shared";

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

type Tab = "webhooks" | "audit";

export default function PlatformSystemPage() {
  const [tab, setTab] = useState<Tab>("webhooks");
  // Nhật ký thao tác chỉ dành cho chủ nền tảng — đọc localStorage trong effect.
  const [showAudit, setShowAudit] = useState(false);
  useEffect(() => {
    setShowAudit(getStoredUser()?.isPlatformAdmin === true);
  }, []);

  const [logSource, setLogSource] = useState<PlatformWebhookSource>("shopee");
  const [logStatus, setLogStatus] = useState<string>("");
  const [logsPage, setLogsPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [audit, setAudit] = useState<PlatformAuditLogsResponse | null>(null);

  const fetcher = useCallback(async (): Promise<PlatformWebhookLogsResponse> => {
    return fetchPlatformWebhookLogs({
      source: logSource,
      status: logStatus || undefined,
      page: logsPage,
      pageSize: 20,
    });
  }, [logSource, logStatus, logsPage]);
  const { data: logs, loading, denied, error, reload } = useAdminPage(fetcher);

  // Nhật ký thao tác nạp riêng (chỉ khi được xem và đang mở tab đó).
  const [auditLoading, setAuditLoading] = useState(false);
  const loadAudit = useCallback(async () => {
    if (!showAudit) return;
    setAuditLoading(true);
    try {
      setAudit(await fetchPlatformAuditLogs({ page: auditPage, pageSize: 20 }));
    } catch {
      // 403/lỗi mạng: để trống — tab webhook vẫn dùng bình thường.
    } finally {
      setAuditLoading(false);
    }
  }, [showAudit, auditPage]);
  useEffect(() => {
    if (tab === "audit") loadAudit();
  }, [tab, loadAudit]);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <AdminPageHeader
          description="Khu kỹ thuật: sức khỏe hàng đợi webhook toàn hệ thống — và sổ giám sát thao tác của đội điều hành (chỉ chủ nền tảng)."
          loading={loading}
          onReload={tab === "webhooks" ? reload : loadAudit}
        />

        {error && <AdminError message={error} />}

        {showAudit && (
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
            {(
              [
                ["webhooks", "Nhật ký Webhook"],
                ["audit", "Nhật ký thao tác"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === key
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === "audit" && showAudit ? (
          <AuditTab
            data={audit}
            loading={auditLoading}
            page={auditPage}
            onPageChange={setAuditPage}
          />
        ) : (
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
