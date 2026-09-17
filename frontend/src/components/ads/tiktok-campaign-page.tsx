"use client";

// ============================================================
// TRANG SOI VIDEO CỦA MỘT CHIẾN DỊCH GMV MAX — /ads/tiktok/campaign?id=…&days=…
// (days chỉ là khoảng KHỞI ĐẦU mang từ trang Tổng quan sang; trong trang dùng bộ
// lọc thời gian CHUẨN của app — DateRangePicker: phím nhanh + lịch chọn tay.)
//
// Màn làm việc chính của Quảng cáo TikTok: tìm video tiêu tiền mà không hiệu
// quả rồi loại khỏi chiến dịch. Trang riêng (không phải hộp thoại) vì cần chỗ
// cho ảnh bìa, lọc nhanh, sắp xếp theo cột, phân trang, và một địa chỉ gửi
// được cho người chạy quảng cáo.
//
// Dữ liệu: số đọc SỐNG từ báo cáo GMV Max (nhóm video sàn còn phân phối); ảnh
// bìa + kênh + caption lấy từ oEmbed công khai của TikTok, CHỈ cho ~20 video
// của trang đang xem — ảnh là phần phụ, thiếu thì dòng vẫn hiện mã + link.
// Lọc/sắp xếp/phân trang chạy phía trình duyệt trên tập đã tải (vài chục dòng).
//
// LOẠI VIDEO (thủ công, chỉ chủ shop): tick chọn → Loại khỏi chiến dịch → xác
// nhận. TikTok áp dụng sau ~20 phút và không trả kết quả từng video, nên dòng
// vừa thao tác mang nhãn "Đang chờ TikTok áp dụng" (đọc từ sổ hành động) và
// không tick lại được. Video đã loại nằm ở chip "Đã loại", khôi phục bằng đúng
// cách đó. Chiến dịch đang tắt thì sàn không cho thao tác → ẩn ô tick.
//
// BẢNG TRONG HỘP (anh Trung 17/09, cùng khuôn trang Lãi/Lỗ thực hiện): bảng
// cuộn dọc + ngang NGAY TRONG hộp cao gần bằng màn hình, tiêu đề cột bám đỉnh
// hộp; chọn 20/50/100 dòng mỗi trang. Dùng chung 2 hằng PNL_* để hai trang
// luôn cư xử giống nhau (kể cả việc KHÔNG overscroll-contain — bẫy lăn chuột).
// Ảnh bìa hỏi theo lô 20 video để trang 100 dòng không dồn một lượt gọi lớn.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Check, Copy, ExternalLink, ImageOff, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { formatPct, formatRoi } from "@/components/ads/tiktok-ads-format";
import { AccessDenied } from "@/components/shared/access-denied";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { PNL_STICKY_HEAD, PNL_TABLE_SCROLLER } from "@/components/finance/realized-pnl/cells";
import { AppShell } from "@/components/shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  fetchTiktokAdsCampaignVideos,
  fetchTiktokVideoMeta,
  getStoredUser,
  sendTiktokAdsVideoAction,
  type TiktokAdsVideoRow,
} from "@/lib/api";
import { formatRangeLabel, toDateKey, type DateRange } from "@/lib/date-range";
import { formatNumber, formatVND } from "@/lib/format";
import { can, isAdmin } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import { TEXT_NUMBER_STRONG, TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";


const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  DELIVERING: { label: "Đang phân phối", className: "bg-emerald-50 text-emerald-700" },
  LEARNING: { label: "Đang học", className: "bg-sky-50 text-sky-700" },
  IN_QUEUE: { label: "Chờ thử", className: "bg-slate-100 text-slate-500" },
};

type QuickFilter = "all" | "noOrder" | "belowTarget" | "learning" | "excluded";

const rowKey = (v: TiktokAdsVideoRow) => `${v.spuId}-${v.videoId}`;
// SẮP XẾP NGAY TẠI TIÊU ĐỀ CỘT (anh Trung 17/09, thay ô chọn ở lề phải): bấm một
// cột = cao → thấp, bấm lần nữa = thấp → cao. Bằng nhau thì video tốn tiền hơn lên trước.
type SortKey = "cost" | "orders" | "cpa" | "gmv" | "roi" | "ctr" | "cvr";
type SortDir = "desc" | "asc";

// Thứ tự cột (anh Trung 17/09): tiền và đơn trước — Chi phí · Đơn · Chi phí/đơn (CPA, đứng sát
// hai con số sinh ra nó) · Doanh thu · ROI; hai cột TỶ LỆ % dồn về cuối bên phải.
const SORT_COLUMNS: { key: SortKey; label: string; hint?: string }[] = [
  { key: "cost", label: "Chi phí" },
  { key: "orders", label: "Đơn" },
  { key: "cpa", label: "Chi phí / đơn", hint: "CPA = chi phí quảng cáo ÷ số đơn. Video chưa ra đơn thì chưa tính được." },
  { key: "gmv", label: "Doanh thu" },
  { key: "roi", label: "ROI" },
  { key: "ctr", label: "Tỷ lệ bấm" },
  { key: "cvr", label: "Chuyển đổi" },
];

/** Chi phí mỗi đơn; null = chưa ra đơn nên chưa tính được. */
const videoCpa = (v: TiktokAdsVideoRow): number | null => (v.orders > 0 ? v.cost / v.orders : null);

/** null = không có giá trị (CPA của video chưa ra đơn) → LUÔN xếp cuối, dù đang cao→thấp hay thấp→cao. */
const SORT_VALUE: Record<SortKey, (v: TiktokAdsVideoRow) => number | null> = {
  cost: (v) => v.cost,
  orders: (v) => v.orders,
  cpa: videoCpa,
  gmv: (v) => v.gmv,
  ctr: (v) => v.ctr,
  cvr: (v) => v.cvr,
  roi: (v) => v.roi ?? 0,
};

const PAGE_SIZES = [20, 50, 100];
/** Backend nhận tối đa 24 id mỗi lượt hỏi ảnh bìa. */
const META_CHUNK = 20;
const TH = "whitespace-nowrap bg-slate-50 px-3 py-2 font-medium";


export function TiktokCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaignRowId = searchParams.get("id") ?? "";
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [range, setRange] = useState<DateRange>(() => {
    const d = Number(searchParams.get("days"));
    const days = [1, 7, 14, 30].includes(d) ? d : 7;
    const to = new Date();
    to.setHours(0, 0, 0, 0);
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    return { from, to };
  });
  const fromKey = toDateKey(range.from);
  const toKey = toDateKey(range.to);
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cost", dir: "desc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const queryClient = useQueryClient();
  const [owner, setOwner] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyVideoId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      toast.error("Trình duyệt không cho sao chép. Hãy bôi đen mã video rồi Ctrl+C.");
    }
  }

  useEffect(() => {
    const u = getStoredUser();
    setAllowed(can(u, "ads.tiktok"));
    setOwner(isAdmin(u));
  }, []);

  const q = useApiQuery({
    queryKey: qk.tiktokAdsVideos(campaignRowId, fromKey, toKey),
    queryFn: () => fetchTiktokAdsCampaignVideos(campaignRowId, { from: fromKey, to: toKey }),
    enabled: allowed === true && campaignRowId !== "",
    staleTime: 5 * 60_000,
  });
  const data = q.data;
  const c = data?.campaign;
  const target = c?.roasTarget ?? null;

  // Chỉ video CÓ tiêu tiền mới đáng soi; phần còn lại sàn chưa phân phối đồng nào.
  const spending = useMemo(() => (data?.videos ?? []).filter((v) => v.cost > 0 && !v.excluded), [data?.videos]);
  // Video đã loại: hiện TẤT CẢ (kể cả không còn chi phí trong khoảng ngày) để còn khôi phục được.
  const excludedRows = useMemo(() => (data?.videos ?? []).filter((v) => v.excluded), [data?.videos]);
  const isBelowTarget = (v: TiktokAdsVideoRow) => target != null && v.orders > 0 && v.roi != null && v.roi < target;
  const counts = {
    all: spending.length,
    noOrder: spending.filter((v) => v.noOrder).length,
    belowTarget: spending.filter(isBelowTarget).length,
    learning: spending.filter((v) => v.deliveryStatus === "LEARNING").length,
    excluded: excludedRows.length,
  };

  const rows = useMemo(() => {
    const list = (quick === "excluded" ? excludedRows : spending).filter((v) => {
      if (quick === "excluded") return true;
      if (quick === "noOrder") return v.noOrder;
      if (quick === "belowTarget") return target != null && v.orders > 0 && v.roi != null && v.roi < target;
      if (quick === "learning") return v.deliveryStatus === "LEARNING";
      return true;
    });
    const val = SORT_VALUE[sort.key];
    const sign = sort.dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null || y == null) return x == null && y == null ? b.cost - a.cost : x == null ? 1 : -1;
      return sign * (x - y) || b.cost - a.cost;
    });
  }, [spending, excludedRows, quick, sort, target]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // Ảnh bìa + kênh theo LÔ 20 video: ảnh hiện dần từ trên xuống, lô nào hỏng thì chỉ lô đó thiếu ảnh.
  const metaChunks = useMemo(() => {
    const ids = pageRows.map((v) => v.videoId);
    const out: string[][] = [];
    for (let i = 0; i < ids.length; i += META_CHUNK) out.push(ids.slice(i, i + META_CHUNK));
    return out;
  }, [pageRows]);
  const metaQs = useQueries({
    queries: metaChunks.map((ids) => ({
      queryKey: qk.tiktokVideoMeta(ids),
      queryFn: () => fetchTiktokVideoMeta(ids),
      staleTime: 60 * 60_000,
    })),
  });
  const meta = Object.assign({}, ...metaQs.map((x) => x.data?.items ?? {})) as Record<
    string,
    { author: string; caption: string; thumbnailUrl: string }
  >;
  const metaLoading = metaQs.some((x) => x.isPending);

  // Sàn chỉ cho loại/khôi phục khi chiến dịch đang bật; nhân viên chỉ xem.
  const canAct = owner && c?.status === "ongoing";
  const restoring = quick === "excluded";
  const pickable = (v: TiktokAdsVideoRow) => canAct && v.pending == null;
  const pickedRows = rows.filter((v) => picked.has(rowKey(v)) && pickable(v));
  const pagePickable = pageRows.filter(pickable);
  const allPagePicked = pagePickable.length > 0 && pagePickable.every((v) => picked.has(rowKey(v)));

  function togglePick(v: TiktokAdsVideoRow) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey(v))) next.delete(rowKey(v));
      else next.add(rowKey(v));
      return next;
    });
  }
  function togglePage() {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const v of pagePickable) {
        if (allPagePicked) next.delete(rowKey(v));
        else next.add(rowKey(v));
      }
      return next;
    });
  }
  function changeQuick(k: QuickFilter) {
    setQuick(k);
    setPage(0);
    setPicked(new Set()); // Loại và Khôi phục là hai lệnh khác nhau — không mang lựa chọn qua chip khác.
  }

  async function runAction() {
    if (pickedRows.length === 0) return;
    setSending(true);
    try {
      const r = await sendTiktokAdsVideoAction(
        campaignRowId,
        restoring ? "ADD" : "REMOVE",
        pickedRows.map((v) => ({ videoId: v.videoId, spuId: v.spuId, cost: v.cost, orders: v.orders }))
      );
      toast.success(r.message);
      setPicked(new Set());
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["tiktok-ads-videos", campaignRowId] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gửi được lệnh lên TikTok");
    } finally {
      setSending(false);
    }
  }

  if (allowed === false || q.denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const t = data?.totals;
  const wastePct = t && t.videoSpend > 0 ? Math.round((t.noOrderSpend / t.videoSpend) * 100) : 0;
  const campaignRoi = c && c.spend > 0 ? c.gmv / c.spend : null;
  const backHref = c ? `/ads/tiktok?channelId=${c.channelId}` : "/ads/tiktok";

  const chips: { key: QuickFilter; label: string; count: number; hidden?: boolean }[] = [
    { key: "all", label: "Tất cả", count: counts.all },
    { key: "noOrder", label: "Chưa ra đơn", count: counts.noOrder },
    { key: "belowTarget", label: "Có đơn, ROI dưới mục tiêu", count: counts.belowTarget, hidden: target == null },
    { key: "learning", label: "Đang học", count: counts.learning },
    { key: "excluded", label: "Đã loại", count: counts.excluded, hidden: counts.excluded === 0 },
  ];

  return (
    <AppShell>
      <div className="space-y-5 pb-10">
        {/* ===== ĐẦU TRANG ===== */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
              <ArrowLeft className="size-4" />
              Quảng cáo TikTok{c ? ` · ${c.shopName}` : ""}
            </Link>
            <h1 className="mt-1 flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
              <span className="min-w-0 truncate">{c?.name || (q.loading ? "Đang tải…" : "Chiến dịch")}</span>
              {c &&
                (c.status === "ongoing" ? (
                  <Badge className="bg-emerald-500 text-white">Đang chạy</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700">Tạm dừng</Badge>
                ))}
            </h1>
            {c && (
              <p className="text-sm text-muted-foreground">
                {target != null ? `ROI mục tiêu ${formatRoi(target)}` : "Phân phối tối đa"} · ROI thực{" "}
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    target != null && campaignRoi != null && campaignRoi < target ? "text-red-500" : "text-slate-900"
                  )}
                >
                  {formatRoi(campaignRoi)}
                </span>{" "}
                · chi {formatVND(c.spend)} · {formatNumber(c.orders)} đơn
              </p>
            )}
          </div>
          <div className="ml-auto">
            <DateRangePicker
              value={range}
              onChange={(r) => {
                setRange(r);
                setPage(0);
                setPicked(new Set());
              }}
            />
          </div>
        </div>

        {!campaignRowId && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
            Thiếu mã chiến dịch.{" "}
            <button className="underline" onClick={() => router.push("/ads/tiktok")}>
              Về trang Quảng cáo TikTok
            </button>
          </div>
        )}
        {q.error && <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">{q.error}</div>}

        {/* ===== BA CON SỐ KẾT LUẬN ===== */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="py-4">
              <p className={TEXT_SUB}>Video đang tiêu tiền</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                {t ? formatNumber(t.spendingCount) : "—"}
                {t && <span className="ml-1.5 text-sm font-normal text-slate-500">/ {formatNumber(t.videoCount)} video đang phân phối</span>}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className={TEXT_SUB}>Tiêu tiền, chưa ra đơn</p>
              <p className={cn("mt-1 text-2xl font-bold tabular-nums", t && t.noOrderCount > 0 ? "text-red-500" : "text-slate-900")}>
                {t ? `${formatNumber(t.noOrderCount)} video` : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className={TEXT_SUB}>Tiền vào các video đó</p>
              <p className={cn("mt-1 text-2xl font-bold tabular-nums", t && t.noOrderSpend > 0 ? "text-red-500" : "text-slate-900")}>
                {t ? formatVND(t.noOrderSpend) : "—"}
                {wastePct > 0 && <span className="ml-1.5 text-sm font-normal text-slate-500">· {wastePct}% chi cho video</span>}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ===== BẢNG VIDEO ===== */}
        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              {chips
                .filter((x) => !x.hidden)
                .map((x) => (
                  <button
                    key={x.key}
                    onClick={() => changeQuick(x.key)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                      quick === x.key
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                        : "border-slate-200 bg-card text-slate-600 hover:bg-muted"
                    )}
                  >
                    {x.label}
                    <span className={cn("ml-1.5 tabular-nums", quick === x.key ? "opacity-80" : "text-slate-400")}>
                      {formatNumber(x.count)}
                    </span>
                  </button>
                ))}
            </div>

            {pickedRows.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-900">
                  Đã chọn <span className="font-semibold tabular-nums">{formatNumber(pickedRows.length)}</span> video
                  {!restoring && (
                    <span className="text-slate-500">
                      {" "}
                      · đã tiêu {formatVND(pickedRows.reduce((s, v) => s + v.cost, 0))} trong {formatRangeLabel(range).toLowerCase()}
                    </span>
                  )}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                    Bỏ chọn
                  </Button>
                  {restoring ? (
                    <Button size="sm" onClick={() => setConfirmOpen(true)}>
                      <RotateCcw className="size-4" />
                      Khôi phục vào chiến dịch
                    </Button>
                  ) : (
                    <Button size="sm" className="bg-red-600 text-white hover:bg-red-700" onClick={() => setConfirmOpen(true)}>
                      <Trash2 className="size-4" />
                      Loại khỏi chiến dịch
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!data && !q.error && campaignRowId && (
              <p className="py-12 text-center text-sm text-muted-foreground">Đang đọc số từ TikTok…</p>
            )}
            {data && rows.length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {spending.length === 0 ? "Chưa có video nào tiêu tiền trong khoảng ngày này." : "Không có video nào khớp bộ lọc."}
              </p>
            )}

            {pageRows.length > 0 && (
              <div className={cn("min-w-0 rounded-lg border", PNL_TABLE_SCROLLER)}>
                <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
                  <thead className={PNL_STICKY_HEAD}>
                    <tr className={cn(TEXT_TABLE_HEAD, "text-left")}>
                      {canAct && (
                        <th className="w-10 border-b border-slate-200 bg-slate-50 px-3 py-2">
                          <input
                            type="checkbox"
                            className="size-4 cursor-pointer accent-slate-900"
                            checked={allPagePicked}
                            onChange={togglePage}
                            aria-label="Chọn tất cả video của trang này"
                          />
                        </th>
                      )}
                      <th className={cn(TH, "border-b border-slate-200")}>Video</th>
                      <th className={cn(TH, "border-b border-slate-200")}>Trạng thái</th>
                      {SORT_COLUMNS.map((col) => {
                        const active = sort.key === col.key;
                        const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
                        return (
                          <th
                            key={col.key}
                            className={cn(TH, "border-b border-slate-200 text-right")}
                            aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setSort(active ? { key: col.key, dir: sort.dir === "desc" ? "asc" : "desc" } : { key: col.key, dir: "desc" });
                                setPage(0);
                              }}
                              title={
                                col.hint && !active
                                  ? col.hint
                                  : active
                                  ? sort.dir === "desc"
                                    ? "Đang xếp cao → thấp. Bấm để xếp thấp → cao"
                                    : "Đang xếp thấp → cao. Bấm để xếp cao → thấp"
                                  : `Xếp theo ${col.label.toLowerCase()}, cao → thấp`
                              }
                              className={cn(
                                "inline-flex items-center gap-1 font-medium hover:text-slate-900",
                                active && "text-slate-900"
                              )}
                            >
                              {col.label}
                              <Icon className={cn("size-3.5", active ? "text-slate-900" : "text-slate-400")} />
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((v) => {
                      const st = STATUS_LABEL[v.deliveryStatus];
                      const m = meta[v.videoId];
                      const bad = v.noOrder || isBelowTarget(v);
                      const href = `https://www.tiktok.com/@${m?.author ?? ""}/video/${v.videoId}`;
                      return (
                        <tr key={rowKey(v)} className={cn("[&>td]:border-b [&>td]:border-slate-200/80", v.noOrder && !v.excluded && "bg-rose-50/60")}>
                          {canAct && (
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="size-4 cursor-pointer accent-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                                checked={picked.has(rowKey(v))}
                                disabled={!pickable(v)}
                                onChange={() => togglePick(v)}
                                aria-label={`Chọn video ${v.videoId}`}
                              />
                            </td>
                          )}
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-3">
                              <a
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                title="Mở video trên TikTok"
                                className="flex h-16 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-400"
                              >
                                {m?.thumbnailUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element -- ảnh CDN TikTok có hạn, không qua tối ưu ảnh của Next
                                  <img src={m.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
                                ) : (
                                  <ImageOff className="size-4" />
                                )}
                              </a>
                              <div className="min-w-0">
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Mở video trên TikTok"
                                  className="flex items-center gap-1 text-sm text-slate-900 hover:underline"
                                >
                                  <span className="truncate">{m?.author ? `@${m.author}` : "Video TikTok"}</span>
                                  <ExternalLink className="size-3.5 shrink-0 text-slate-400" />
                                </a>
                                <p className="max-w-72 truncate text-xs text-slate-500">
                                  {m?.caption || (metaLoading ? "Đang lấy thông tin video…" : "Không lấy được tên video")}
                                </p>
                                {/* Mã video LUÔN hiện + sao chép một chạm (anh Trung 17/09): cần để tra trên
                                    Seller Center / gửi người chạy quảng cáo; bôi đen 19 chữ số trong bảng rất khó. */}
                                <button
                                  type="button"
                                  onClick={() => void copyVideoId(v.videoId)}
                                  title="Sao chép mã video"
                                  className="group mt-0.5 inline-flex items-center gap-1 rounded text-xs tabular-nums text-slate-500 hover:text-slate-900"
                                >
                                  {v.videoId}
                                  {copiedId === v.videoId ? (
                                    <Check className="size-3.5 text-emerald-500" />
                                  ) : (
                                    <Copy className="size-3.5 text-slate-400 group-hover:text-slate-900" />
                                  )}
                                </button>
                                {data && data.products.length > 1 && (
                                  <p className="max-w-72 truncate text-xs text-slate-400">
                                    {data.products.find((p) => p.spuId === v.spuId)?.name}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {v.pending ? (
                              <Badge
                                className="bg-amber-100 text-amber-700"
                                title="Lệnh đã gửi lên TikTok. Sàn cần khoảng 20 phút để áp dụng."
                              >
                                {v.pending === "REMOVE" ? "Đang chờ TikTok loại" : "Đang chờ TikTok khôi phục"}
                              </Badge>
                            ) : v.excluded ? (
                              <Badge className="bg-slate-100 text-slate-500">Đã loại</Badge>
                            ) : (
                              <Badge className={st?.className ?? "bg-slate-100 text-slate-500"}>{st?.label ?? v.deliveryStatus}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={v.cost} className="text-slate-900" />
                          </td>
                          <td className={cn("px-3 py-2 text-right tabular-nums", v.noOrder ? "text-red-500" : "text-slate-900")}>
                            {formatNumber(v.orders)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {videoCpa(v) == null ? (
                              <span className="text-slate-400">—</span>
                            ) : (
                              <Money value={videoCpa(v) as number} className="text-slate-900" />
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Money value={v.gmv} className="text-slate-900" />
                          </td>
                          <td className={cn("px-3 py-2 text-right", TEXT_NUMBER_STRONG, bad ? "text-red-500" : "text-slate-900")}>
                            {formatRoi(v.roi)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatPct(v.ctr)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatPct(v.cvr)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Hiển thị</span>
                  <NativeSelect
                    className="w-20"
                    aria-label="Số dòng mỗi trang"
                    value={String(pageSize)}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(0);
                    }}
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                  <span className="text-sm text-muted-foreground">
                    dòng/trang · {formatNumber(rows.length)} video · trang {safePage + 1}/{pageCount}
                  </span>
                </div>
                {pageCount > 1 && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                      Trước
                    </Button>
                    <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
                      Sau
                    </Button>
                  </div>
                )}
              </div>
            )}
            {rows.length > 0 && (
              <p className={TEXT_SUB}>Chi phí từng video TikTok cập nhật trễ tới 11 giờ; ROI gồm cả đơn tự nhiên.</p>
            )}
            {owner && c && c.status !== "ongoing" && (
              <p className={TEXT_SUB}>Chiến dịch đang tạm dừng — TikTok chỉ cho loại hoặc khôi phục video khi chiến dịch đang bật.</p>
            )}
          </CardContent>
        </Card>

        {/* ===== LỊCH SỬ THAO TÁC VIDEO — từng lệnh: giờ, lý do (thủ công / tự động + căn cứ),
            kết quả sàn, và MÃ từng video kèm số liệu lúc thao tác (anh Trung 17/09). ===== */}
        {(data?.actions.length ?? 0) > 0 && (
          <Card>
            <CardContent className="space-y-2 py-4">
              <p className="text-sm font-semibold text-slate-900">Lịch sử loại / khôi phục video</p>
              <ul className="divide-y divide-slate-200/80 text-sm">
                {data?.actions.map((a) => {
                  const removing = a.action === "exclude_video";
                  return (
                    <li key={a.id} className="space-y-1.5 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="w-28 shrink-0 tabular-nums text-slate-500">
                          {new Date(a.createdAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                        </span>
                        <span className="font-medium text-slate-900">
                          {removing ? "Loại" : "Khôi phục"} {formatNumber(a.videos.length)} video
                        </span>
                        <Badge className={a.source === "manual" ? "bg-slate-100 text-slate-500" : "bg-violet-50 text-violet-700"}>
                          {a.source === "manual"
                            ? removing
                              ? "Loại thủ công"
                              : "Khôi phục thủ công"
                            : removing
                              ? "Trợ lý tự động loại"
                              : "Trợ lý tự động khôi phục"}
                        </Badge>
                        {a.status === "SUCCESS" ? (
                          <Badge className="bg-emerald-50 text-emerald-700">Đã gửi lên TikTok</Badge>
                        ) : (
                          <Badge className="bg-rose-50 text-red-500">TikTok từ chối</Badge>
                        )}
                      </div>
                      {a.grounds.length > 0 && (
                        <ul className="space-y-0.5 text-xs text-slate-500 sm:pl-[7.75rem]">
                          {a.grounds.map((g, i) => (
                            <li key={i}>Căn cứ: {g}</li>
                          ))}
                        </ul>
                      )}
                      <ul className="space-y-0.5 sm:pl-[7.75rem]">
                        {a.videos.map((x) => (
                          <li key={x.videoId} className="flex flex-wrap items-center gap-x-2 text-xs">
                            <button
                              type="button"
                              onClick={() => void copyVideoId(x.videoId)}
                              title="Sao chép mã video"
                              className="group inline-flex items-center gap-1 tabular-nums text-slate-900 hover:underline"
                            >
                              {x.videoId}
                              {copiedId === x.videoId ? (
                                <Check className="size-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="size-3.5 text-slate-400 group-hover:text-slate-900" />
                              )}
                            </button>
                            {x.note && <span className="text-slate-500">{x.note}</span>}
                          </li>
                        ))}
                      </ul>
                      {a.status === "FAILED" && a.error && <p className="text-xs text-red-500 sm:pl-[7.75rem]">{a.error}</p>}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => !sending && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {restoring ? "Khôi phục" : "Loại"} {formatNumber(pickedRows.length)} video {restoring ? "vào" : "khỏi"} chiến dịch{" "}
              {c?.name}?
            </DialogTitle>
            <DialogDescription>
              {restoring
                ? "TikTok sẽ đưa các video này trở lại chiến dịch và có thể phân phối tiếp."
                : "TikTok sẽ ngừng dùng các video này để quảng cáo trong chiến dịch. Video trên kênh không bị ảnh hưởng."}{" "}
              Lệnh có hiệu lực sau khoảng 20 phút{restoring ? "." : " và khôi phục được bất cứ lúc nào ở mục Đã loại."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>
              Hủy
            </Button>
            <Button
              onClick={() => void runAction()}
              disabled={sending}
              className={restoring ? undefined : "bg-red-600 text-white hover:bg-red-700"}
            >
              {sending ? "Đang gửi…" : restoring ? "Khôi phục" : "Loại video"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
