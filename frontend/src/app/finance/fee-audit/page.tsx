"use client";

/**
 * KIỂM TOÁN PHÍ SÀN — /finance/fee-audit (30/08/2026)
 *
 * "Kiểm toán tự động + báo cáo đòi tiền" (fee audit / money-back report):
 * sau mỗi nhịp đối soát, hệ thống tự lọc ra ba rổ tiền mất để chủ shop đi
 * khiếu nại, thay vì bắt ai đó nhớ vào màn đối soát mà lọc tay:
 *
 *   #1 TRUY THU PHÍ SHIP — sàn trừ phí vận chuyển nhiều hơn phần đã được
 *      khách trả + sàn trợ (shippingFeeDiff). Cùng nguồn số với trang
 *      "Đối soát phí ship" bên Quản lý Kho — kho thao tác khiếu nại theo kiện,
 *      tài chính nhìn theo tiền; một nguồn số, hai góc nhìn.
 *   #2 SÀN TRẢ THIẾU — tiền giải ngân thật thấp hơn số CHÍNH SÀN tự ước tính
 *      trước đó (snapshot expectedPayout). Chỉ Shopee: Lazada không cấp API
 *      số ước tính — "sổ đối soát không bịa số" thì không có mẫu số để soi.
 *   #3 CHỜ SÀN TRẢ TIỀN QUÁ HẠN — đơn giao thành công (không hoàn) đã lâu mà
 *      chưa thấy sàn giải ngân đồng nào.
 *
 * Số liệu 100% từ đối soát thật — trang này KHÔNG ước lượng gì từ % phí kênh.
 */

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Hourglass,
  Loader2,
  SearchCheck,
  Truck,
} from "lucide-react";

import { AppShell } from "@/components/shell/app-shell";
import { DataTable } from "@/components/data-table/data-table";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { AccessDenied } from "@/components/shared/access-denied";
import { Refreshing } from "@/components/shared/refreshing";
import {
  ALL_CHANNELS,
  ChannelFilter,
  shopOnlyName,
  type ChannelFilterValue,
} from "@/components/shared/channel-filter";
import { HintIcon, HintText } from "@/components/finance/hint-icon";
import { Money } from "@/components/ui/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  channelFilterToQuery,
  fetchFeeAudit,
  fetchShippingDiscrepancies,
  getStoredUser,
  getToken,
  updateFeeAuditStatus,
  updateShippingDisputeStatus,
  type FeeAuditPayoutItem,
  type FeeAuditPendingItem,
  type FeeAuditStatus,
  type PayoutShortfallDetailItem,
  type ShippingDiscrepancy,
  type ShippingDisputeStatus,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { can } from "@/lib/permissions";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatDateTime, formatNumber } from "@/lib/format";
import { MONEY_NEGATIVE, TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

const PAGE_SIZE_OPTIONS = [20, 50, 100];

type AuditTab = "ship" | "payout" | "pending";

const TABS: { key: AuditTab; label: string }[] = [
  { key: "ship", label: "Truy thu phí ship" },
  { key: "payout", label: "Sàn trả thiếu" },
  { key: "pending", label: "Chờ sàn trả tiền" },
];

/** Trạng thái khiếu nại rổ #1 — dùng chung enum với trang Đối soát phí ship. */
const SHIP_STATUS_META: Record<
  ShippingDisputeStatus,
  { label: string; className: string }
> = {
  CHO_KHIEU_NAI: {
    label: "Chờ khiếu nại",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  DANG_KHIEU_NAI: {
    label: "Đang khiếu nại",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  DA_DOI_SOAT: {
    label: "Đã đối soát",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
};

const PAYOUT_STATUS_META: Record<
  FeeAuditStatus,
  { label: string; className: string }
> = {
  CHO_XU_LY: {
    label: "Chờ xử lý",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  DANG_KHIEU_NAI: {
    label: "Đang khiếu nại",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  DA_XU_LY: {
    label: "Đã xử lý",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  BO_QUA: {
    label: "Bỏ qua",
    className: "bg-zinc-50 text-zinc-600 border-zinc-200",
  },
};

/** Huy hiệu sàn nhỏ trước mã đơn — cùng kiểu trang Đơn hàng. */
function ChannelBadge({ channelName }: { channelName: keyof typeof CHANNEL_META }) {
  const meta = CHANNEL_META[channelName];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}

/** Ô "Mã đơn" dùng chung 3 tab: badge sàn + mã + dòng phụ (ngày · tên gian). */
function OrderCell({
  channelName,
  shopName,
  orderCode,
  subDate,
}: {
  channelName: keyof typeof CHANNEL_META;
  shopName: string;
  orderCode: string;
  subDate: string | null;
}) {
  const shop = shopOnlyName(channelName, shopName);
  return (
    <>
      <div className="flex items-center gap-2">
        <ChannelBadge channelName={channelName} />
        <span className="font-semibold tracking-tight">{orderCode}</span>
      </div>
      <p className={cn(TEXT_SUB, "mt-1")}>
        {subDate ? formatDateTime(subDate) : "—"}
        {shop && <> · {shop}</>}
      </p>
    </>
  );
}

/**
 * Dòng phụ "trả thiếu VÌ ĐÂU" dưới số tiền — liệt kê các loại phí bị thu vượt
 * so với chính sàn ước tính; hover ra bảng diff đầy đủ, kể cả khoản KHÔNG bị
 * buộc tội (hoa hồng affiliate, thuế thu hộ...) để chủ shop hiểu vì sao số
 * "trả thiếu" nhỏ hơn mức tụt tổng. Đơn cũ tính theo chế độ tương thích không
 * có bảng diff → không hiện gì.
 */
function ShortfallBreakdown({
  detail,
}: {
  detail: PayoutShortfallDetailItem[] | null;
}) {
  if (!detail || detail.length === 0) return null;
  const accused = detail.filter((d) => d.accused);
  if (accused.length === 0) return null;
  return (
    <HintText
      className="mt-1 block max-w-64 truncate"
      hint={
        <div className="space-y-1">
          {detail.map((d) => (
            <p key={d.key}>
              <b>{d.label}</b>
              {d.expected !== 0 || d.actual !== 0 ? (
                <>
                  {" "}
                  {formatNumber(d.expected)} → {formatNumber(d.actual)}
                </>
              ) : null}{" "}
              ({d.lost > 0 ? "+" : ""}
              {formatNumber(d.lost)} đ)
              {!d.accused && (
                <span className="opacity-80">
                  {" "}
                  — không tính{d.note ? `: ${d.note}` : ""}
                </span>
              )}
            </p>
          ))}
        </div>
      }
    >
      {accused
        .map((d) => `${d.label} +${formatNumber(d.lost)}`)
        .join(" · ")}
    </HintText>
  );
}

export default function FeeAuditPage() {
  const router = useRouter();
  const [tab, setTab] = useState<AuditTab>("ship");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [channelFilter, setChannelFilter] =
    useState<ChannelFilterValue>(ALL_CHANNELS);
  const [shipStatus, setShipStatus] = useState("");
  const [payoutStatus, setPayoutStatus] = useState("");
  /** Đơn đang chờ PATCH trạng thái — khóa đúng một ô select thay vì cả bảng. */
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  // Deep-link từ chuông cảnh báo: /finance/fee-audit?tab=payout|pending.
  // Đặt tab trong effect (không phải useState initializer) để bản render đầu
  // giống hệt server — tránh lệch hydration vì window chỉ có ở client.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "ship" || t === "payout" || t === "pending") setTab(t);
  }, []);

  const allowed = can(getStoredUser(), "finance.fee-audit");
  const invalidate = useInvalidate();

  // ===== QUERIES =====
  // fee-audit luôn chạy: nó mang summary cả 3 rổ cho hàng thẻ KPI. Khi đang ở
  // tab "ship" thì phần items của nó không hiển thị — ghim tham số về mặc định
  // (trang 1, không lọc trạng thái) để cache key trùng với prefetch hover.
  const onAuditTab = tab !== "ship";
  const auditParams = {
    tab: (tab === "pending" ? "pending" : "payout") as "payout" | "pending",
    page: onAuditTab ? page : 1,
    pageSize: onAuditTab ? pageSize : 20,
    status: tab === "payout" ? payoutStatus : "",
  };
  const auditQ = useApiQuery({
    queryKey: qk.feeAudit({
      ...auditParams,
      channel: channelFilterToQuery(channelFilter),
    }),
    queryFn: () =>
      fetchFeeAudit({
        ...auditParams,
        status: auditParams.status || undefined,
        channel: channelFilter,
      }),
    enabled: allowed,
  });

  // Rổ #1 tái dùng endpoint của trang Đối soát phí ship — chỉ gọi khi mở tab.
  const shipQ = useApiQuery({
    queryKey: qk.shippingDiscrepancies({
      page,
      pageSize,
      status: shipStatus,
      channel: channelFilterToQuery(channelFilter),
    }),
    queryFn: () =>
      fetchShippingDiscrepancies({
        page,
        pageSize,
        status: shipStatus || undefined,
        channel: channelFilter,
      }),
    enabled: allowed && tab === "ship",
  });

  useEffect(() => {
    const msg = auditQ.error ?? shipQ.error;
    if (msg) toast.error("Không tải được dữ liệu kiểm toán phí sàn");
  }, [auditQ.error, shipQ.error]);

  const summary = auditQ.data?.summary;

  const activeQ = tab === "ship" ? shipQ : auditQ;
  const pageCount =
    (tab === "ship" ? shipQ.data?.pageCount : auditQ.data?.pageCount) ?? 0;
  const loading = activeQ.refreshing;

  const shipItems: ShippingDiscrepancy[] =
    tab === "ship" ? (shipQ.data?.items ?? []) : [];
  const payoutItems: FeeAuditPayoutItem[] =
    tab === "payout" && auditQ.data?.tab === "payout" ? auditQ.data.items : [];
  const pendingItems: FeeAuditPendingItem[] =
    tab === "pending" && auditQ.data?.tab === "pending" ? auditQ.data.items : [];
  const rowCount =
    tab === "ship"
      ? shipItems.length
      : tab === "payout"
        ? payoutItems.length
        : pendingItems.length;

  const refreshAll = () => invalidate(["fee-audit"], ["shipping-discrepancies"]);

  async function changeShipStatus(id: string, status: ShippingDisputeStatus) {
    setBusyId(id);
    try {
      await updateShippingDisputeStatus(id, status);
      await refreshAll();
    } catch {
      toast.error("Không đổi được trạng thái khiếu nại");
    } finally {
      setBusyId(null);
    }
  }

  async function changePayoutStatus(id: string, status: FeeAuditStatus) {
    setBusyId(id);
    try {
      await updateFeeAuditStatus(id, status);
      await refreshAll();
    } catch {
      toast.error("Không đổi được trạng thái xử lý");
    } finally {
      setBusyId(null);
    }
  }

  // ===== CỘT 3 BẢNG (Tầng 2 — DataTable) =====
  const shipColumns = useMemo<ColumnDef<ShippingDiscrepancy>[]>(
    () => [
      {
        id: "order",
        size: 250,
        meta: { label: "Mã đơn" },
        header: "Mã đơn",
        cell: ({ row }) => (
          <OrderCell
            channelName={row.original.channelName}
            shopName={row.original.shopName}
            orderCode={row.original.orderCode}
            subDate={row.original.settledAt ?? row.original.createdAt}
          />
        ),
      },
      {
        id: "quoted",
        meta: { label: "Phí ship sàn báo", align: "right" },
        header: "Sàn báo",
        cell: ({ row }) => <Money value={row.original.shippingFeeQuoted} />,
      },
      {
        id: "actual",
        meta: { label: "Phí ship thực trừ", align: "right" },
        header: "Thực trừ",
        cell: ({ row }) => <Money value={row.original.shippingFeeActual} />,
      },
      {
        id: "diff",
        meta: { label: "Bị trừ thêm", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Bị trừ thêm
            <HintIcon hint="Phần phí vận chuyển shop THỰC CHỊU sau khi trừ phần khách trả + sàn trợ giá. Dương là tiền có thể khiếu nại đòi lại — thường do khai sai cân nặng/kích thước kiện." />
          </span>
        ),
        cell: ({ row }) => (
          <span className={cn("font-semibold", MONEY_NEGATIVE)}>
            <Money value={row.original.discrepancy} />
          </span>
        ),
      },
      {
        id: "status",
        size: 170,
        meta: { label: "Trạng thái" },
        header: "Trạng thái",
        cell: ({ row }) => (
          <NativeSelect
            className="w-40"
            aria-label="Trạng thái khiếu nại"
            value={row.original.status}
            disabled={busyId === row.original.id}
            onChange={(e) =>
              changeShipStatus(
                row.original.id,
                e.target.value as ShippingDisputeStatus
              )
            }
          >
            {(
              Object.keys(SHIP_STATUS_META) as ShippingDisputeStatus[]
            ).map((s) => (
              <option key={s} value={s}>
                {SHIP_STATUS_META[s].label}
              </option>
            ))}
          </NativeSelect>
        ),
      },
    ],
    // changeShipStatus dùng qua closure — chỉ busyId đổi mới cần dựng lại cột
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId]
  );

  const payoutColumns = useMemo<ColumnDef<FeeAuditPayoutItem>[]>(
    () => [
      {
        id: "order",
        size: 250,
        meta: { label: "Mã đơn" },
        header: "Mã đơn",
        cell: ({ row }) => (
          <OrderCell
            channelName={row.original.channelName}
            shopName={row.original.shopName}
            orderCode={row.original.orderCode}
            subDate={row.original.settledAt}
          />
        ),
      },
      {
        id: "expected",
        meta: { label: "Sàn tự ước tính", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Sàn tự ước tính
            <HintIcon hint="Số tiền Shopee TỰ ước tính sẽ trả cho đơn này trước khi giải ngân (khớp màn 'Doanh thu đơn hàng ước tính' trên Seller Center) — Hubsell chụp lại làm mẫu số so sánh." />
          </span>
        ),
        cell: ({ row }) => <Money value={row.original.expectedPayout} />,
      },
      {
        id: "actual",
        meta: { label: "Thực nhận về ví", align: "right" },
        header: "Thực nhận",
        cell: ({ row }) => <Money value={row.original.actualPayout} />,
      },
      {
        id: "shortfall",
        meta: { label: "Trả thiếu", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Trả thiếu
            <HintIcon hint="So TỪNG LOẠI PHÍ với số chính sàn ước tính: chỉ tính phần phí bị thu VƯỢT lời hứa. Khoản chỉ chốt lúc quyết toán (hoa hồng Tiếp thị liên kết, thuế thu hộ, voucher shop tự chi) và đơn có hoàn tiền không bị tính. Đây là NGHI VẤN cần đối chiếu — mở chi tiết quyết toán đơn trên Seller Center kiểm tra lại trước khi gửi khiếu nại." />
          </span>
        ),
        cell: ({ row }) => (
          <>
            <span className={cn("font-semibold", MONEY_NEGATIVE)}>
              <Money value={row.original.shortfall} negative />
            </span>
            <ShortfallBreakdown detail={row.original.detail} />
          </>
        ),
      },
      {
        id: "status",
        size: 170,
        meta: { label: "Trạng thái" },
        header: "Trạng thái",
        cell: ({ row }) => (
          <NativeSelect
            className="w-40"
            aria-label="Trạng thái xử lý"
            value={row.original.status}
            disabled={busyId === row.original.id}
            onChange={(e) =>
              changePayoutStatus(
                row.original.id,
                e.target.value as FeeAuditStatus
              )
            }
          >
            {(Object.keys(PAYOUT_STATUS_META) as FeeAuditStatus[]).map((s) => (
              <option key={s} value={s}>
                {PAYOUT_STATUS_META[s].label}
              </option>
            ))}
          </NativeSelect>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId]
  );

  const pendingColumns = useMemo<ColumnDef<FeeAuditPendingItem>[]>(
    () => [
      {
        id: "order",
        size: 250,
        meta: { label: "Mã đơn" },
        header: "Mã đơn",
        cell: ({ row }) => (
          <OrderCell
            channelName={row.original.channelName}
            shopName={row.original.shopName}
            orderCode={row.original.orderCode}
            subDate={row.original.createdAt}
          />
        ),
      },
      {
        id: "deliveredAt",
        meta: { label: "Giao thành công" },
        header: "Giao thành công",
        cell: ({ row }) =>
          row.original.deliveredAt ? (
            formatDateTime(row.original.deliveredAt)
          ) : (
            <span className={TEXT_SUB}>— (đơn cũ, tính từ ngày đặt)</span>
          ),
      },
      {
        id: "days",
        meta: { label: "Đã chờ", align: "right" },
        header: "Đã chờ",
        cell: ({ row }) => (
          <span className="font-semibold text-amber-600">
            {formatNumber(row.original.daysWaiting)} ngày
          </span>
        ),
      },
      {
        id: "amount",
        meta: { label: "Tiền đang treo", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Tiền đang treo
            <HintIcon hint="Số sàn tự ước tính sẽ trả nếu Hubsell đã chụp được; chưa có thì tạm lấy giá trị đơn. Đơn hoàn/hủy không nằm trong rổ này." />
          </span>
        ),
        cell: ({ row }) => (
          <span className="font-semibold">
            <Money value={row.original.amountWaiting} />
          </span>
        ),
      },
    ],
    []
  );

  if (!allowed || auditQ.denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-5 pb-10">
        {/* ── Hàng thẻ KPI: 3 rổ tiền — nhìn một phát biết sàn "nợ" bao nhiêu ── */}
        <div className="grid gap-4 md:grid-cols-3">
          <DashboardCard
            title={
              <span className="inline-flex items-center gap-1">
                Truy thu phí ship
                <HintIcon hint="Tổng phí vận chuyển shop bị trừ THÊM so với phần khách trả + sàn trợ. Khiếu nại được — thường do sai cân nặng/kích thước." />
              </span>
            }
            value={<Money value={summary?.ship.totalMissing ?? 0} />}
            subtitle={`${formatNumber(summary?.ship.orders ?? 0)} đơn · ${formatNumber(summary?.ship.pendingCount ?? 0)} chờ khiếu nại`}
            icon={Truck}
            tone="negative"
            featured={(summary?.ship.totalMissing ?? 0) > 0}
          />
          <DashboardCard
            title={
              <span className="inline-flex items-center gap-1">
                Sàn trả thiếu
                <HintIcon hint="Tiền giải ngân thật thấp hơn số CHÍNH SÀN tự ước tính, so theo từng loại phí (đã loại đơn hoàn tiền và khoản chỉ chốt lúc quyết toán). Đây là nghi vấn cần đối chiếu trên Seller Center trước khi khiếu nại. Mới theo dõi được Shopee — Lazada không cấp API số ước tính nên không soi mò." />
              </span>
            }
            value={<Money value={summary?.payout.totalMissing ?? 0} />}
            subtitle={`${formatNumber(summary?.payout.orders ?? 0)} đơn · ${formatNumber(summary?.payout.pendingCount ?? 0)} chờ xử lý`}
            icon={CircleDollarSign}
            tone="negative"
            featured={(summary?.payout.totalMissing ?? 0) > 0}
          />
          <DashboardCard
            title={
              <span className="inline-flex items-center gap-1">
                Chờ sàn trả tiền
                <HintIcon hint="Đơn giao thành công (không hoàn) đã quá hạn mà sàn chưa giải ngân đồng nào — tiền của anh đang nằm bên sàn. Chỉ tính Shopee/Lazada (sàn Hubsell đã đối soát thật)." />
              </span>
            }
            value={<Money value={summary?.pending.totalWaiting ?? 0} />}
            subtitle={`${formatNumber(summary?.pending.orders ?? 0)} đơn quá hạn đang treo`}
            icon={Hourglass}
            tone="warning"
          />
        </div>

        {/* ── Thanh tab 3 rổ + bộ lọc ── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map((t) => (
              <Button
                key={t.key}
                variant={tab === t.key ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setTab(t.key);
                  setPage(1);
                }}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tab === "ship" && (
              <NativeSelect
                className="w-44"
                aria-label="Lọc trạng thái khiếu nại"
                value={shipStatus}
                onChange={(e) => {
                  setShipStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Mọi trạng thái</option>
                {(
                  Object.keys(SHIP_STATUS_META) as ShippingDisputeStatus[]
                ).map((s) => (
                  <option key={s} value={s}>
                    {SHIP_STATUS_META[s].label}
                  </option>
                ))}
              </NativeSelect>
            )}
            {tab === "payout" && (
              <NativeSelect
                className="w-44"
                aria-label="Lọc trạng thái xử lý"
                value={payoutStatus}
                onChange={(e) => {
                  setPayoutStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Mọi trạng thái</option>
                {(Object.keys(PAYOUT_STATUS_META) as FeeAuditStatus[]).map(
                  (s) => (
                    <option key={s} value={s}>
                      {PAYOUT_STATUS_META[s].label}
                    </option>
                  )
                )}
              </NativeSelect>
            )}
            <ChannelFilter
              value={channelFilter}
              onChange={(v) => {
                setChannelFilter(v);
                setPage(1);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void refreshAll()}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Làm mới"
              )}
            </Button>
          </div>
        </div>

        {/* ── Bảng của tab đang mở ── */}
        <Card className="shadow-sm">
          <CardContent className="p-0">
            {loading && rowCount === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải dữ liệu…
              </p>
            ) : rowCount === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <SearchCheck className="mx-auto mb-2 size-8" />
                {tab === "ship" &&
                  "Không có đơn nào bị truy thu phí ship — phí vận chuyển đang được sàn trừ đúng."}
                {tab === "payout" &&
                  "Chưa phát hiện đơn nào bị trả thiếu. Hubsell bắt đầu chụp số ước tính của sàn từ khi tính năng lên sóng — đơn mới sẽ được soi tự động ở mỗi nhịp đối soát."}
                {tab === "pending" &&
                  "Không có đơn giao xong nào quá hạn chờ tiền — sàn đang giải ngân đúng nhịp."}
              </div>
            ) : (
              <Refreshing active={loading}>
                {tab === "ship" && (
                  <DataTable
                    tableId="fee-audit-ship"
                    columns={shipColumns}
                    data={shipItems}
                    getRowId={(o) => o.id}
                    toolbar={`${formatNumber(summary?.ship.orders ?? 0)} đơn bị truy thu`}
                  />
                )}
                {tab === "payout" && (
                  <DataTable
                    tableId="fee-audit-payout"
                    columns={payoutColumns}
                    data={payoutItems}
                    getRowId={(o) => o.id}
                    toolbar={`${formatNumber(summary?.payout.orders ?? 0)} đơn sàn trả thiếu`}
                  />
                )}
                {tab === "pending" && (
                  <DataTable
                    tableId="fee-audit-pending"
                    columns={pendingColumns}
                    data={pendingItems}
                    getRowId={(o) => o.id}
                    toolbar={`${formatNumber(summary?.pending.orders ?? 0)} đơn đang chờ tiền`}
                  />
                )}
              </Refreshing>
            )}
          </CardContent>
        </Card>

        {/* ── Phân trang ── */}
        {rowCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hiển thị</span>
              <NativeSelect
                className="w-20"
                aria-label="Số đơn mỗi trang"
                value={String(pageSize)}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-sm text-muted-foreground">
                đơn/trang · trang {page}/{Math.max(1, pageCount)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
                Trang trước
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Trang sau
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Chú thích nguồn số — cùng tinh thần bảng Lãi/Lỗ ── */}
        <div className={cn(TEXT_SUB, "space-y-1")}>
          <p>
            · Mọi con số lấy từ <b>đối soát thật</b> của sàn (escrow Shopee, sao
            kê Finance Lazada) — trang này không ước lượng gì từ % phí kênh.
          </p>
          <p>
            · Rổ <b>Truy thu phí ship</b> dùng chung nguồn số với trang &ldquo;Đối
            soát phí ship&rdquo; bên Quản lý Kho — đổi trạng thái ở đâu cũng đồng
            bộ.
          </p>
          <p>
            · Rổ <b>Sàn trả thiếu</b> so số giải ngân thật với số{" "}
            <b>chính Shopee tự ước tính</b> trước đó, bóc theo <b>từng loại phí</b>:
            chỉ phí bị thu vượt lời hứa mới bị tính; hoa hồng Tiếp thị liên kết,
            thuế thu hộ, voucher shop tự chi và đơn hoàn tiền không bị báo oan.
            Lazada chưa có vì sàn không cấp API số ước tính.
          </p>
          <p>
            · Con số rổ này là <b>nghi vấn để đối chiếu</b>, chưa phải kết luận:
            hãy mở chi tiết quyết toán đơn trên Seller Center kiểm tra khớp chênh
            từng loại phí trước khi gửi khiếu nại cho sàn.
          </p>
          <p>
            · Cảnh báo tự đẩy lên chuông thông báo sau mỗi nhịp đối soát (mỗi
            giờ) — không cần mở trang này canh.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
