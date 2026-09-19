"use client";

// ============================================================
// TRỢ LÝ QUẢNG CÁO TIKTOK — GMV MAX (TikTok Marketing API, số thật, chỉ đọc)
//
// Khác Shopee/Lazada ở gốc: thứ được nối là TÀI KHOẢN QUẢNG CÁO (có thể do
// người chạy thuê giữ, chạy cho nhiều shop của nhiều seller) — backend tự dò và
// chỉ nối gian TikTok của chính chủ shop. Trang này:
//   · tab "Kết nối": bảng "gian → tài khoản quảng cáo", mỗi gian một dòng, nút
//     Kết nối đứng ngay sau tên gian (3 gian có thể là 3 tài khoản quảng cáo
//     khác nhau). Tách tab riêng (anh Trung 17/09): kết nối là việc MỘT LẦN, bày
//     chung thì khách nhiều gian bị rối cả trang. Chưa nối gian nào → mở thẳng
//     tab này; đã nối → mở Tổng quan, gian chưa nối chỉ còn con số vàng trên tab.
//   · đã nối    → thẻ số + biểu đồ + bảng campaign (ROI thực so ROI mục tiêu),
//                 bấm một campaign để soi video tiêu tiền không ra đơn.
// Chưa có ROAS hòa vốn: lợi nhuận đơn TikTok đã trừ phí GMV Max trong quyết
// toán, biên lãi "chưa trừ ads" phải bóc riêng (đợt sau).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, Link2, Megaphone, RefreshCw, ShoppingBag, Target, TrendingUp, Unlink, Wallet } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { formatRoi } from "@/components/ads/tiktok-ads-format";
import { TiktokBreakevenValue } from "@/components/ads/tiktok-breakeven";
import { AUTO_MODE_BADGE } from "@/components/ads/tiktok-campaign-page";
import { TiktokProductBreakevenTab } from "@/components/ads/tiktok-product-breakeven-tab";
import { AccessDenied } from "@/components/shared/access-denied";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { AppShell } from "@/components/shell/app-shell";
import { DataTable } from "@/components/data-table/data-table";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { TIKTOK_AUTO_MODE_LABEL } from "@/lib/api";
import {
  ApiError,
  fetchTiktokAdsDashboard,
  getStoredUser,
  getTiktokAdsAuthUrl,
  requestTiktokAdsRefresh,
  unlinkTiktokAds,
  type TiktokAdsCampaignRow,
} from "@/lib/api";
import { RANGE_PRESETS, formatRangeLabel, toDateKey, type DateRange } from "@/lib/date-range";
import { formatNumber, formatVND } from "@/lib/format";
import { can } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { TEXT_NUMBER_STRONG, TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

const CAMPAIGN_COLUMNS: ColumnDef<TiktokAdsCampaignRow>[] = [
  {
    id: "name",
    size: 240,
    meta: { label: "Chiến dịch" },
    header: "Chiến dịch",
    cell: ({ row }) => {
      const c = row.original;
      return (
        <>
          <p className="max-w-60 truncate text-sm text-slate-900">{c.name || `Chiến dịch #${c.campaignId}`}</p>
          <p className="text-xs text-slate-500">
            GMV Max · {c.biddingMethod === "max_delivery" ? "phân phối tối đa" : "ROI mục tiêu"}
            {c.budget > 0 && ` · ngân sách ${formatVND(c.budget)}/ngày`}
          </p>
        </>
      );
    },
  },
  {
    id: "status",
    size: 110,
    meta: { label: "Trạng thái" },
    header: "Trạng thái",
    cell: ({ row }) =>
      row.original.status === "ongoing" ? (
        <Badge className="bg-emerald-500 text-white">Đang chạy</Badge>
      ) : (
        <Badge className="bg-amber-100 text-amber-700">Tạm dừng</Badge>
      ),
  },
  {
    id: "auto",
    size: 120,
    meta: { label: "Tự động" },
    header: "Tự động",
    cell: ({ row }) => {
      const a = row.original.auto;
      const mode = a?.mode ?? "off";
      return (
        <Badge
          className={AUTO_MODE_BADGE[mode]}
          title={a?.lastRunOn ? `Lượt gần nhất ${a.lastRunOn.slice(8, 10)}/${a.lastRunOn.slice(5, 7)}: ${a.lastRunError ?? a.lastRunSkipped ?? a.lastRunSummary ?? ""}` : "Mở chiến dịch để cấu hình tự động loại video"}
        >
          {TIKTOK_AUTO_MODE_LABEL[mode]}
        </Badge>
      );
    },
  },
  {
    id: "spend",
    size: 130,
    meta: { label: "Chi phí", align: "right" },
    header: "Chi phí",
    cell: ({ row }) => <Money value={row.original.spend} className="text-slate-700" />,
  },
  {
    id: "orders",
    size: 80,
    meta: { label: "Đơn", align: "right" },
    header: "Đơn",
    cell: ({ row }) => <span className="tabular-nums text-slate-700">{formatNumber(row.original.orders)}</span>,
  },
  {
    id: "gmv",
    size: 140,
    meta: { label: "Doanh thu", align: "right" },
    header: "Doanh thu",
    cell: ({ row }) => <Money value={row.original.gmv} className="text-slate-700" />,
  },
  {
    id: "cpo",
    size: 120,
    meta: { label: "Chi phí / đơn", align: "right" },
    header: "Chi phí / đơn",
    cell: ({ row }) =>
      row.original.costPerOrder == null ? (
        <span className="text-slate-400">—</span>
      ) : (
        <Money value={row.original.costPerOrder} className="text-slate-700" />
      ),
  },
  {
    id: "target",
    size: 110,
    meta: { label: "ROI mục tiêu", align: "right" },
    header: "ROI mục tiêu",
    cell: ({ row }) => <span className="tabular-nums text-slate-500">{formatRoi(row.original.roasTarget)}</span>,
  },
  {
    id: "breakeven",
    size: 100,
    meta: { label: "Hòa vốn", align: "right" },
    header: "Hòa vốn",
    cell: ({ row }) => <TiktokBreakevenValue breakeven={row.original.breakeven} />,
  },
  {
    id: "roi",
    size: 100,
    meta: { label: "ROI thực", align: "right" },
    header: "ROI thực",
    cell: ({ row }) => {
      const c = row.original;
      const be = c.breakeven?.roi ?? null;
      // Dưới HÒA VỐN = đang lỗ thật (nặng hơn "dưới mục tiêu") → cũng tô đỏ, lời nhắc nói rõ mốc nào.
      const losing = c.roi != null && c.spend > 0 && (c.breakeven?.negativeMargin === true || (be != null && c.roi < be));
      return (
        <span
          className={cn(
            TEXT_NUMBER_STRONG,
            c.roi == null ? "text-slate-400" : c.belowTarget || losing ? "text-red-500" : "text-slate-900"
          )}
          title={
            losing
              ? be != null
                ? `Dưới ROI hòa vốn ${formatRoi(be)} — quảng cáo đang ăn vào vốn`
                : "Sản phẩm đang lỗ trước cả quảng cáo"
              : c.belowTarget
                ? `Thấp hơn ROI mục tiêu ${formatRoi(c.roasTarget)} đã đặt trên TikTok`
                : undefined
          }
        >
          {formatRoi(c.roi)}
        </span>
      );
    },
  },
];

export function TiktokAdsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [channelId, setChannelId] = useState(searchParams.get("channelId") ?? "");
  // Bộ lọc thời gian CHUẨN của app (phím nhanh + lịch chọn tay), mở trang ở 7 ngày qua.
  const [range, setRange] = useState<DateRange>(() => RANGE_PRESETS.find((p) => p.key === "last7")!.resolve());
  const fromKey = toDateKey(range.from);
  const toKey = toDateKey(range.to);
  const rangeLabel = formatRangeLabel(range).toLowerCase();
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Gỡ kết nối: id gian đang chờ xác nhận (null = hộp đóng).
  const [unlinkId, setUnlinkId] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  // null = chưa tự chọn tab → mặc định theo tình trạng kết nối (xem `tab` bên dưới).
  const [tabPick, setTabPick] = useState<"overview" | "breakeven" | "connect" | null>(null);

  useEffect(() => setAllowed(can(getStoredUser(), "ads.tiktok")), []);

  const q = useApiQuery({
    queryKey: qk.tiktokAds({ channelId, from: fromKey, to: toKey }),
    queryFn: () => fetchTiktokAdsDashboard({ channelId: channelId || undefined, from: fromKey, to: toKey }),
    enabled: allowed === true,
  });
  const data = q.data;
  const selectedId = data?.selectedChannelId ?? "";
  const linked = data?.link?.linked === true;
  const linkBroken = linked && data?.link?.status !== "ACTIVE";

  // Gian đang chọn chưa nối mà có gian khác đã nối → nhảy sang gian có số.
  useEffect(() => {
    if (!data || linked) return;
    const firstOk = data.channels.find((c) => c.ads?.status === "ACTIVE") ?? data.channels.find((c) => c.ads != null);
    if (firstOk && firstOk.id !== selectedId) setChannelId(firstOk.id);
  }, [data, linked, selectedId]);

  // Worker đang kéo số (vừa nối / số cũ) → tự nạp lại, khỏi bắt chủ shop bấm.
  const waiting = linked && !linkBroken && (data?.adsRefreshing || !data?.adsSyncedAt);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["tiktok-ads"] }), 20_000);
    return () => clearTimeout(t);
  }, [waiting, data, queryClient]);

  const series = useMemo(
    () => (data?.series ?? []).map((p) => ({ ...p, label: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}` })),
    [data?.series]
  );

  async function openAuthorize(forChannelId: string, invite: boolean) {
    setConnecting(true);
    try {
      const { url } = await getTiktokAdsAuthUrl(forChannelId, invite);
      if (invite) {
        await navigator.clipboard.writeText(url);
        toast.success("Đã sao chép link. Gửi cho người đang giữ tài khoản quảng cáo — link dùng được trong 7 ngày.");
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không tạo được link kết nối");
    } finally {
      setConnecting(false);
    }
  }

  async function runUnlink() {
    if (!unlinkId) return;
    setUnlinking(true);
    try {
      const r = await unlinkTiktokAds(unlinkId);
      toast.success(r.message);
      setUnlinkId(null);
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gỡ được kết nối");
    } finally {
      setUnlinking(false);
    }
  }

  async function runRefresh() {
    if (!selectedId) return;
    setRefreshing(true);
    try {
      const r = await requestTiktokAdsRefresh(selectedId);
      toast.message(r.message);
      if (r.queued) setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["tiktok-ads"] }), 25_000);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không làm mới được");
    } finally {
      setRefreshing(false);
    }
  }

  if (allowed === false || q.denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  // Gian đã có kết nối quảng cáo (kể cả đang hỏng — vẫn còn số cũ để xem).
  const adsChannels = (data?.channels ?? []).filter((c) => c.ads != null);
  // Gian còn phải làm gì đó ở tab Kết nối: chưa nối hoặc kết nối hỏng.
  const pendingCount = (data?.channels ?? []).filter((c) => c.ads?.status !== "ACTIVE").length;
  const tab = tabPick ?? (adsChannels.length > 0 ? "overview" : "connect");

  const summary = data?.summary ?? null;
  const campaigns = data?.campaigns ?? [];
  const noChannel = !!data && data.channels.length === 0;

  return (
    <AppShell>
      <div className="space-y-5 pb-10">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              Trợ lý quảng cáo TikTok
              <span className="rounded-md border border-slate-300 bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-white dark:bg-slate-200 dark:text-slate-900">
                GMV Max
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Số thật từ TikTok: chiến dịch nào đang dưới mục tiêu, video nào tiêu tiền mà không ra đơn.
            </p>
          </div>
          {tab === "overview" && linked && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {/* Chỉ liệt kê gian ĐÃ nối quảng cáo — gian chưa nối nằm ở tab Kết nối. */}
              <NativeSelect
                value={selectedId}
                onChange={(e) => setChannelId(e.target.value)}
                aria-label="Chọn gian hàng TikTok"
                className="w-52"
              >
                {adsChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shopName}
                  </option>
                ))}
              </NativeSelect>
              <DateRangePicker value={range} onChange={setRange} />
              <Button variant="outline" size="sm" onClick={() => void runRefresh()} disabled={refreshing || linkBroken}>
                <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
                Làm mới
              </Button>
            </div>
          )}
        </div>

        {q.error && !q.denied && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{q.error}</div>
        )}

        {/* ===== CHƯA BẬT / CHƯA CÓ GIAN ===== */}
        {data && (!data.configured || noChannel) && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <Megaphone className="size-6" />
              </div>
              {!data.configured ? (
                <>
                  <p className="text-base font-semibold text-slate-900">Trợ lý quảng cáo TikTok sắp ra mắt</p>
                  <p className={cn(TEXT_SUB, "max-w-md")}>
                    Hubsell đang hoàn tất kết nối dữ liệu quảng cáo GMV Max với TikTok.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-base font-semibold text-slate-900">Chưa có gian TikTok Shop</p>
                  <p className={cn(TEXT_SUB, "max-w-md")}>
                    Kết nối gian TikTok Shop trước, sau đó quay lại đây để nối quảng cáo của gian.
                  </p>
                  <Button onClick={() => router.push("/channels")}>Tới trang Kênh bán</Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {data?.configured && !noChannel && (
          <div role="tablist" className="flex flex-wrap gap-1 border-b">
            {(
              [
                { key: "overview", label: "Tổng quan chiến dịch", chip: 0 },
                { key: "breakeven", label: "Hòa vốn sản phẩm", chip: 0 },
                { key: "connect", label: "Kết nối tài khoản quảng cáo", chip: pendingCount },
              ] as const
            ).map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTabPick(t.key)}
                  className={cn(
                    "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                  )}
                >
                  {t.label}
                  {t.chip > 0 && (
                    <span
                      className="rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums"
                      title="Số gian chưa kết nối quảng cáo hoặc cần kết nối lại"
                    >
                      {formatNumber(t.chip)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* ===== GIAN HÀNG → TÀI KHOẢN QUẢNG CÁO (anh Trung 17/09): mỗi gian có thể
            chạy ads bằng một tài khoản TikTok khác nhau → mỗi gian MỘT DÒNG, tên
            gian đứng ngay trước nút để khách biết mình đang nối cho gian nào. ===== */}
        {data?.configured && !noChannel && tab === "connect" && (
          <Card>
            <CardHeader>
              <CardTitle>Tài khoản quảng cáo của từng gian</CardTitle>
              <CardDescription className="mt-1.5">
                Mỗi gian có thể chạy quảng cáo bằng một tài khoản TikTok riêng. Bấm Kết nối ở đúng dòng của gian, rồi
                đăng nhập tài khoản TikTok đang chạy GMV Max cho gian đó. Hubsell chỉ đọc số của gian anh/chị đã kết nối.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-slate-200/80 rounded-lg border border-slate-200/80">
                {data.channels.map((c) => {
                  const ok = c.ads?.status === "ACTIVE";
                  const broken = c.ads != null && !ok;
                  return (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                    >
                      <span className="w-full truncate text-sm font-semibold text-slate-900 sm:w-56" title={c.shopName}>
                        {c.shopName}
                      </span>
                      <ArrowRight className="hidden size-4 shrink-0 text-slate-400 sm:block" aria-hidden />
                      {ok ? (
                        <>
                          <span className="flex min-w-0 items-center gap-2 text-sm text-slate-900">
                            <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                            <span className="truncate">{c.ads?.advertiserName || "Đã kết nối"}</span>
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setChannelId(c.id);
                              setTabPick("overview");
                            }}
                          >
                            Xem số
                          </Button>
                          {/* Ủy quyền lại khi gian đang nối khỏe (vd. app được TikTok cấp thêm quyền — token cũ không tự có quyền
                              mới). Backend chỉ thay token trên dòng nối: cấu hình tự loại, sổ lệnh, số liệu GIỮ nguyên — khác Gỡ kết nối. */}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto text-slate-500"
                            title="Ủy quyền lại tài khoản quảng cáo. Cấu hình tự động loại, lịch sử và số liệu giữ nguyên."
                            onClick={() => void openAuthorize(c.id, false)}
                            disabled={connecting}
                          >
                            <RefreshCw className="size-4" />
                            Kết nối lại
                          </Button>
                          <Button size="sm" variant="ghost" className="text-slate-500 hover:text-red-600" onClick={() => setUnlinkId(c.id)}>
                            <Unlink className="size-4" />
                            Gỡ kết nối
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" onClick={() => void openAuthorize(c.id, false)} disabled={connecting}>
                            <Link2 className="size-4" />
                            {broken ? "Kết nối lại TikTok Ads" : "Kết nối TikTok Ads"}
                          </Button>
                          {broken && (
                            <Button size="sm" variant="ghost" className="ml-auto text-slate-500 hover:text-red-600" onClick={() => setUnlinkId(c.id)}>
                              <Unlink className="size-4" />
                              Gỡ kết nối
                            </Button>
                          )}
                          {/* Dòng phụ thẳng cột với nút: 14rem tên gian + mũi tên + 2 khe 0.75rem. */}
                          <div className="w-full space-y-1 sm:pl-[16.5rem]">
                            {broken && <p className="text-xs text-red-500">{c.ads?.problem}</p>}
                            <button
                              type="button"
                              onClick={() => void openAuthorize(c.id, true)}
                              disabled={connecting}
                              className="text-left text-xs text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
                            >
                              Người khác giữ tài khoản quảng cáo? Sao chép link gửi họ
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ===== HÒA VỐN TỪNG SẢN PHẨM — từ Lãi/Lỗ thực hiện, không cần nối quảng cáo (anh Trung 18/09) ===== */}
        {data?.configured && !noChannel && tab === "breakeven" && <TiktokProductBreakevenTab initialChannelId={selectedId} />}

        {data?.configured && !noChannel && tab === "overview" && !linked && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <Megaphone className="size-6" />
              </div>
              <p className="text-base font-semibold text-slate-900">Chưa có gian nào kết nối quảng cáo</p>
              <p className={cn(TEXT_SUB, "max-w-md")}>Kết nối tài khoản quảng cáo TikTok của gian để xem số GMV Max tại đây.</p>
              <Button onClick={() => setTabPick("connect")}>
                <Link2 className="size-4" />
                Kết nối tài khoản quảng cáo
              </Button>
            </CardContent>
          </Card>
        )}

        {tab === "overview" && linked && (
          <>
            {linkBroken && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
                <span>
                  {data?.link?.status === "NO_ACCESS" && data.link.lastSyncError
                    ? data.link.lastSyncError
                    : "Kết nối quảng cáo của gian đã hết hiệu lực (tài khoản TikTok đã hủy ủy quyền)."}{" "}
                  Số bên dưới dừng ở lần cập nhật cuối.
                </span>
                <Button size="sm" variant="outline" onClick={() => setTabPick("connect")}>
                  Kết nối lại
                </Button>
              </div>
            )}
            {/* Lần nối đầu Hubsell chỉ kéo lùi được 30 ngày → khoảng xem sớm hơn ngày có số thì nói rõ, đừng để khách tưởng tháng đó không tiêu tiền. */}
            {data?.dataFrom && fromKey < data.dataFrom && (
              <p className={TEXT_SUB}>
                Hubsell có số quảng cáo của gian từ {data.dataFrom.slice(8, 10)}/{data.dataFrom.slice(5, 7)}/{data.dataFrom.slice(0, 4)}.
                Các ngày trước đó không nằm trong tổng bên dưới.
              </p>
            )}
            {waiting && campaigns.length === 0 && (
              <p className="text-sm text-muted-foreground">Đang kéo số 30 ngày từ TikTok, bảng sẽ tự hiện sau ít giây…</p>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Chi phí quảng cáo"
                value={<Money value={summary?.spend ?? 0} />}
                icon={Wallet}
                tone="negative"
                colorValue
                subtitle={`${rangeLabel} · ${formatNumber(summary?.liveCampaigns ?? 0)} chiến dịch đang chạy`}
              />
              <StatCard
                label="Doanh thu GMV Max"
                value={<Money value={summary?.gmv ?? 0} />}
                icon={TrendingUp}
                tone="positive"
                colorValue
                subtitle="Gồm cả đơn tự nhiên của sản phẩm trong chiến dịch"
              />
              <StatCard
                label="ROI"
                value={formatRoi(summary?.roi ?? null)}
                icon={Target}
                tone={(summary?.belowTargetCount ?? 0) > 0 ? "negative" : "accent"}
                subtitle={
                  (summary?.belowTargetCount ?? 0) > 0
                    ? `${summary?.belowTargetCount} chiến dịch dưới ROI mục tiêu`
                    : "Doanh thu ÷ chi phí"
                }
              />
              <StatCard
                label="Đơn hàng"
                value={formatNumber(summary?.orders ?? 0)}
                icon={ShoppingBag}
                tone="neutral"
                subtitle={
                  summary?.costPerOrder != null ? `Chi phí mỗi đơn ${formatVND(summary.costPerOrder)}` : "Chưa có đơn"
                }
              />
            </div>

            {series.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Chi phí và doanh thu GMV Max ({rangeLabel})</CardTitle>
                  <CardDescription>Số theo ngày của TikTok, gộp mọi chiến dịch của gian đang chọn.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={series}>
                        <defs>
                          <linearGradient id="gradTiktokAdsGmv" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                          </linearGradient>
                          <linearGradient id="gradTiktokAdsSpend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f87171" stopOpacity={0.45} />
                            <stop offset="95%" stopColor="#f87171" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" fontSize={12} tickLine={false} />
                        <YAxis fontSize={11} tickLine={false} width={110} tickFormatter={(v: number) => formatVND(v)} />
                        <Tooltip
                          formatter={(value, name) => [formatVND(Number(value)), name === "gmv" ? "Doanh thu" : "Chi phí"]}
                        />
                        <Legend formatter={(value) => (value === "gmv" ? "Doanh thu" : "Chi phí")} />
                        <Area type="monotone" dataKey="gmv" stroke="#10b981" strokeWidth={2} fill="url(#gradTiktokAdsGmv)" />
                        <Area type="monotone" dataKey="spend" stroke="#f87171" strokeWidth={2} fill="url(#gradTiktokAdsSpend)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Chiến dịch GMV Max</CardTitle>
                <CardDescription className="mt-1.5">
                  ROI thực <span className="text-red-500">đỏ</span> là đang thấp hơn ROI mục tiêu đã đặt trên TikTok hoặc thấp hơn
                  hòa vốn (mốc bắt đầu lỗ, tính từ Lãi/Lỗ thực hiện của các đơn đã đối soát — trỏ vào số để xem căn cứ). Bấm
                  một chiến dịch để soi từng video: video nào đang tiêu tiền mà không ra đơn.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {campaigns.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {q.loading || waiting ? "Đang tải…" : "Gian chưa có chiến dịch GMV Max nào."}
                  </p>
                ) : (
                  <div className="min-w-0">
                    <DataTable
                      tableId="ads-campaigns-tiktok"
                      columns={CAMPAIGN_COLUMNS}
                      data={campaigns}
                      getRowId={(c) => c.id}
                      onRowClick={(c) => router.push(`/ads/tiktok/campaign?id=${c.id}&from=${fromKey}&to=${toKey}`)}
                      striped={false}
                      headerEmphasis
                      stickyHeader
                      toolbar={`${formatNumber(campaigns.length)} chiến dịch · ${data?.link?.advertiserName ?? ""}`}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ===== XÁC NHẬN GỠ KẾT NỐI — nói rõ cái gì dừng, cái gì được giữ ===== */}
      <Dialog open={unlinkId != null} onOpenChange={(open) => !unlinking && !open && setUnlinkId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gỡ tài khoản quảng cáo khỏi gian {data?.channels.find((c) => c.id === unlinkId)?.shopName}?</DialogTitle>
            <DialogDescription>
              Hubsell sẽ ngừng đọc số GMV Max và ngừng mọi lượt chấm, loại video tự động của gian này. Quảng cáo trên TikTok vẫn chạy bình thường —
              Hubsell không tắt hay sửa gì bên TikTok.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 marker:text-slate-400">
            <li>Số liệu cũ, cấu hình tự động loại và lịch sử lệnh được giữ nguyên.</li>
            <li>Chiến dịch đang bật Tự loại thật sẽ chuyển về Diễn tập — kết nối lại thì máy không tự loại video thật cho tới khi anh/chị bật lại.</li>
            <li>Muốn dùng tài khoản quảng cáo khác cho gian: gỡ xong bấm Kết nối ở đúng dòng này.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinkId(null)} disabled={unlinking}>
              Hủy
            </Button>
            <Button className="bg-red-600 text-white hover:bg-red-700" onClick={() => void runUnlink()} disabled={unlinking}>
              {unlinking ? "Đang gỡ…" : "Gỡ kết nối"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
