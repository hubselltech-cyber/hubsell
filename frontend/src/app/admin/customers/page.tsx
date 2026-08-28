"use client";

// ============================================================
// KHÁCH HÀNG ĐĂNG KÝ (/admin/customers — lá hq.customers): CRM nội bộ, khu
// làm việc của SALE/CSKH. 2 tab:
//   1. Khách đã đăng ký — mọi chủ shop có tài khoản (chăm sóc, phân công).
//   2. Lead tư vấn — form "Đăng ký tư vấn" từ landing (khách CHƯA có tài
//      khoản); tự match theo email/SĐT để thấy lead đã đăng ký → đang gói nào.
// Cố ý KHÔNG có số liệu tiền nong nào ở đây (đó là khu Kế toán).
// ============================================================

import { useCallback, useState } from "react";
import { HeartHandshake, PhoneCall } from "lucide-react";

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
  fetchConsultLeads,
  fetchHqStaff,
  fetchPlatformUsers,
  type ConsultLeadRow,
  type ConsultLeadStatus,
  type ConsultLeadsResponse,
  type HqMember,
  type PlatformCareStatus,
  type PlatformUserRow,
  type PlatformUsersResponse,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CareDialog } from "../care-dialog";
import { LeadDialog } from "../lead-dialog";
import {
  AdminError,
  AdminPageHeader,
  CARE_STATUS_META,
  CARE_STATUSES,
  LEAD_SOURCE_LABEL,
  LEAD_STATUS_META,
  LEAD_STATUSES,
  formatCount,
  pageCount,
  useAdminPage,
} from "../shared";

interface CustomersData {
  users: PlatformUsersResponse;
  leads: ConsultLeadsResponse;
  members: HqMember[];
}

type ViewTab = "customers" | "leads";

export default function PlatformCustomersPage() {
  const [tab, setTab] = useState<ViewTab>("customers");
  const [page, setPage] = useState(1);
  const [careFilter, setCareFilter] = useState<"" | PlatformCareStatus>("");
  const [careFor, setCareFor] = useState<PlatformUserRow | null>(null);
  const [leadPage, setLeadPage] = useState(1);
  const [leadFilter, setLeadFilter] = useState<"" | ConsultLeadStatus>("");
  const [leadFor, setLeadFor] = useState<ConsultLeadRow | null>(null);

  // Nạp cả 2 tab một lượt — bảng còn nhỏ, đổi tab là thấy ngay không chờ,
  // và badge "n chưa gọi" luôn đúng kể cả đang đứng ở tab khách hàng.
  const fetcher = useCallback(async (): Promise<CustomersData> => {
    const [users, leads, staff] = await Promise.all([
      fetchPlatformUsers({
        page,
        pageSize: 20,
        careStatus: careFilter || undefined,
      }),
      fetchConsultLeads({
        page: leadPage,
        pageSize: 20,
        status: leadFilter || undefined,
      }),
      fetchHqStaff(),
    ]);
    return { users, leads, members: staff.members };
  }, [page, careFilter, leadPage, leadFilter]);
  const { data, loading, denied, error, reload } = useAdminPage(fetcher);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const users = data?.users;
  const leads = data?.leads;

  return (
    <AppShell>
      <div className="space-y-4">
        <AdminPageHeader
          description="CRM khách hàng Hubsell: chủ shop đã đăng ký + lead tư vấn từ landing — trạng thái, người phụ trách và ghi chú."
          loading={loading}
          onReload={reload}
        />

        {error && <AdminError message={error} />}

        {/* Tab lớn: Khách đã đăng ký / Lead tư vấn (badge lead chưa gọi) */}
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["customers", "Khách đã đăng ký", HeartHandshake],
              ["leads", "Lead tư vấn", PhoneCall],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors",
                tab === value
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-slate-200 bg-card text-slate-600 hover:bg-slate-50"
              )}
            >
              <Icon className="size-4" />
              {label}
              {value === "leads" && (leads?.newCount ?? 0) > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none",
                    tab === "leads"
                      ? "bg-white/20 text-white"
                      : "bg-orange-100 text-orange-700"
                  )}
                >
                  {formatCount(leads!.newCount)} chưa gọi
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "customers" ? (
          <>
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
          </>
        ) : (
          <>
            {/* Lọc theo trạng thái lead */}
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200/80 bg-card p-1">
              {([["", "Tất cả"]] as [string, string][])
                .concat(LEAD_STATUSES.map((s) => [s, LEAD_STATUS_META[s].label]))
                .map(([value, label]) => (
                  <button
                    key={value || "all"}
                    type="button"
                    onClick={() => {
                      setLeadFilter(value as "" | ConsultLeadStatus);
                      setLeadPage(1);
                    }}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      leadFilter === value
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
                {loading && !leads ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Đang tải dữ liệu…
                  </p>
                ) : leads && leads.leads.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Chưa có lead nào khớp bộ lọc — form &quot;Đăng ký tư vấn&quot;
                    trên landing sẽ đổ về đây.
                  </p>
                ) : leads ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Gửi lúc</TableHead>
                          <TableHead>Khách</TableHead>
                          <TableHead>Liên hệ</TableHead>
                          <TableHead>Nguồn</TableHead>
                          <TableHead>Tài khoản / Gói</TableHead>
                          <TableHead>Trạng thái</TableHead>
                          <TableHead>Phụ trách</TableHead>
                          <TableHead className="text-right">Xử lý</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {leads.leads.map((l) => {
                          const meta = LEAD_STATUS_META[l.status];
                          return (
                            <TableRow key={l.id}>
                              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                {formatDateTime(l.createdAt)}
                              </TableCell>
                              <TableCell>
                                <p className="text-sm font-medium">{l.name}</p>
                              </TableCell>
                              <TableCell className="text-sm">
                                {l.email}
                                <p className="font-mono text-xs text-muted-foreground">
                                  {l.phone}
                                </p>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                {LEAD_SOURCE_LABEL[l.source] ?? l.source}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-sm">
                                {/* Gói ở đây là gói THẬT đang dùng (match email/SĐT) —
                                    lead hỏi Enterprise nhưng chốt Pro thì hiện Pro. */}
                                {l.account ? (
                                  <>
                                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                                      {l.account.planName ?? "Đã đăng ký"}
                                      {l.account.isTrial ? " (dùng thử)" : ""}
                                    </span>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {l.account.fullName}
                                    </p>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground">
                                    Chưa đăng ký
                                  </span>
                                )}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={cn(
                                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                    meta.className
                                  )}
                                >
                                  {meta.label}
                                </span>
                                {l.note && (
                                  <p
                                    className="mt-1 max-w-[180px] truncate text-xs text-muted-foreground"
                                    title={l.note}
                                  >
                                    {l.note}
                                  </p>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-sm">
                                {l.assignee?.fullName ?? (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setLeadFor(l)}
                                >
                                  <PhoneCall className="size-4" />
                                  Xử lý
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-muted-foreground">
                      <span>
                        {formatCount(leads.total)} lead · trang {leads.page}/
                        {pageCount(leads.total, leads.pageSize)}
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={leadPage <= 1 || loading}
                          onClick={() => setLeadPage((p) => p - 1)}
                        >
                          Trước
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            leadPage >= pageCount(leads.total, leads.pageSize) ||
                            loading
                          }
                          onClick={() => setLeadPage((p) => p + 1)}
                        >
                          Sau
                        </Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </>
        )}
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
      {leadFor && (
        <LeadDialog
          lead={leadFor}
          members={data?.members ?? []}
          open={true}
          onOpenChange={(o) => {
            if (!o) setLeadFor(null);
          }}
          onSaved={reload}
        />
      )}
    </AppShell>
  );
}
