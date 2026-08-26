"use client";

// ============================================================
// KHÁCH HÀNG ĐĂNG KÝ (/admin/customers — lá hq.customers): CRM nội bộ, khu
// làm việc của SALE/CSKH — danh sách chủ shop, trạng thái chăm sóc, người phụ
// trách, ghi chú. Cố ý KHÔNG có số liệu tiền nong nào ở đây (đó là khu Kế toán).
// ============================================================

import { useCallback, useState } from "react";
import { HeartHandshake } from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { AccessDenied } from "@/components/shared/access-denied";
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
  fetchHqStaff,
  fetchPlatformUsers,
  type HqMember,
  type PlatformCareStatus,
  type PlatformUserRow,
  type PlatformUsersResponse,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CareDialog } from "../care-dialog";
import {
  AdminError,
  AdminPageHeader,
  CARE_STATUS_META,
  CARE_STATUSES,
  formatCount,
  pageCount,
  useAdminPage,
} from "../shared";

interface CustomersData {
  users: PlatformUsersResponse;
  members: HqMember[];
}

export default function PlatformCustomersPage() {
  const [page, setPage] = useState(1);
  const [careFilter, setCareFilter] = useState<"" | PlatformCareStatus>("");
  const [careFor, setCareFor] = useState<PlatformUserRow | null>(null);

  const fetcher = useCallback(async (): Promise<CustomersData> => {
    const [users, staff] = await Promise.all([
      fetchPlatformUsers({
        page,
        pageSize: 20,
        careStatus: careFilter || undefined,
      }),
      fetchHqStaff(),
    ]);
    return { users, members: staff.members };
  }, [page, careFilter]);
  const { data, loading, denied, error, reload } = useAdminPage(fetcher);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const users = data?.users;

  return (
    <AppShell>
      <div className="space-y-4">
        <AdminPageHeader
          description="CRM khách hàng Hubsell: mọi chủ shop đã đăng ký — trạng thái chăm sóc, người phụ trách và ghi chú CSKH."
          loading={loading}
          onReload={reload}
        />

        {error && <AdminError message={error} />}

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
                  setPage(1);
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
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Trước
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        page >= pageCount(users.total, users.pageSize) || loading
                      }
                      onClick={() => setPage((p) => p + 1)}
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

      {careFor && (
        <CareDialog
          customer={careFor}
          members={data?.members ?? []}
          open={true}
          onOpenChange={(o) => {
            if (!o) setCareFor(null);
          }}
          onSaved={reload}
        />
      )}
    </AppShell>
  );
}
