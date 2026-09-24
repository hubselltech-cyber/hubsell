"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Rocket, ShieldCheck, Star, X } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/data-table/data-table";
import { HintIcon } from "@/components/finance/hint-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createAdsCampaignFromRecommendation,
  fetchAdsRecommendations,
  refreshAdsRecommendationItem,
  syncAdsRecommendationSignals,
  type AdsRecommendTier,
  type AdsRecommendationRow,
  type AdsRecommendationsResponse,
} from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_NUMBER_STRONG } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * GỢI Ý CHẠY ADS (đợt D, 17/09/2026) — tab của trang Trợ lý quảng cáo Shopee.
 *
 * Trả lời câu "nên chạy quảng cáo sản phẩm nào, đặt thế nào" bằng số của chính
 * shop (biên lãi, tồn, nhịp bán) đặt cạnh số của sàn (dải ROAS quảng cáo tương
 * tự, lượt tìm, đánh giá). Backend chấm 3 tầng (cổng loại → điểm → đề xuất) —
 * xem backend ads-recommend.ts; trang này chỉ hiển thị + MỘT nút tạo chiến dịch.
 * Khách cần đơn giản: mỗi dòng một câu lý do, chi tiết nằm trong hộp thoại.
 */

const TIER_META: Record<AdsRecommendTier, { label: string; badge: string; tile: string }> = {
  run_now: {
    label: "Nên chạy ngay",
    badge: "bg-emerald-500 text-white",
    tile: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  test_small: {
    label: "Thử nhỏ",
    badge: "bg-amber-500 text-white",
    tile: "border-amber-200 bg-amber-50 text-amber-700",
  },
  not_yet: {
    label: "Chưa nên",
    badge: "bg-slate-200 text-slate-700",
    tile: "border-slate-200 bg-slate-50 text-slate-600",
  },
  running: {
    label: "Đang chạy ads",
    badge: "border border-emerald-300 bg-white text-emerald-700",
    tile: "border-slate-200 bg-card text-slate-500",
  },
};

const TARGET_META = {
  push: { label: "Đẩy số", hint: "Mức an toàn thấp nhất — sàn dễ phân phối nhất, lãi mỗi đơn mỏng nhất." },
  balanced: { label: "Cân bằng", hint: "Giữa mức an toàn và mức sàn đang chạy — vừa có lượng vừa giữ lãi." },
  keep: { label: "Giữ lãi", hint: "Bằng mức quảng cáo tương tự trên sàn — ít đơn hơn nhưng lãi mỗi đơn dày." },
} as const;

function toolbarText(count: number, filter: AdsRecommendTier | "all", syncedAt: string | null): string {
  return (
    `${formatNumber(count)} sản phẩm` +
    (filter !== "all" ? ` · đang lọc "${TIER_META[filter].label}"` : "") +
    (syncedAt
      ? ` · số của sàn cập nhật ${new Date(syncedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`
      : "")
  );
}

const roas = (v: number | null) =>
  v == null ? "—" : `${v.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}x`;

export function AdsRecommendTab({
  channelId,
  noChannel,
  adsLinked,
  onCreated,
}: {
  channelId: string;
  noChannel: boolean;
  /** Gian đã nối Hubsell Ads (hoặc Hubsell Ads chưa bật) — mới lấy được số của sàn. */
  adsLinked: boolean;
  /** Tạo chiến dịch xong — trang nạp lại bảng chiến dịch. */
  onCreated: (message: string) => void;
}) {
  const [data, setData] = useState<AdsRecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdsRecommendTier | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [itemLoadingId, setItemLoadingId] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  /** Nút "Cập nhật số của sàn": backend chạy nền, mình hỏi lại mỗi 10s tới khi mốc đổi (tối đa 3'). */
  async function syncSignals() {
    if (!channelId || syncing) return;
    setSyncing(true);
    setError(null);
    const before = data?.signalsSyncedAt ?? null;
    try {
      await syncAdsRecommendationSignals(channelId);
      for (let i = 0; i < 18; i++) {
        await new Promise((r) => setTimeout(r, 10_000));
        const res = await fetchAdsRecommendations(channelId);
        setData(res);
        if (res.signalsSyncedAt && res.signalsSyncedAt !== before) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không cập nhật được số của sàn");
    } finally {
      setSyncing(false);
    }
  }

  /** Mở một SP chưa có dải ROAS của sàn → lấy riêng cho SP đó (3 call), chấm lại cả bảng. */
  function openDetail(row: AdsRecommendationRow) {
    setDetailId(row.itemId);
    const needsMarket = adsLinked && row.tier !== "running" && row.safeRoas != null && row.market?.roiExact == null;
    if (!needsMarket || itemLoadingId) return;
    setItemLoadingId(row.itemId);
    refreshAdsRecommendationItem(channelId, row.itemId, row.safeRoas)
      .then((res) => setData(res))
      .catch(() => undefined) // không có số của sàn thì vẫn xem được bản chấm bằng số Hubsell
      .finally(() => setItemLoadingId(null));
  }

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdsRecommendations(channelId)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Không tải được gợi ý"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        (filter === "all" || r.tier === filter) &&
        (!q ||
          r.productName.toLowerCase().includes(q) ||
          (r.itemSku ?? "").toLowerCase().includes(q) ||
          r.itemId.includes(q))
    );
  }, [data, filter, search]);
  const paged = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const detail = data?.rows.find((r) => r.itemId === detailId) ?? null;

  const columns = useMemo<ColumnDef<AdsRecommendationRow>[]>(
    () => [
      {
        id: "product",
        size: 260,
        meta: { label: "Sản phẩm" },
        header: "Sản phẩm",
        cell: ({ row }) => (
          <>
            <p className="max-w-64 truncate text-sm text-slate-900" title={row.original.productName}>
              {row.original.productName}
            </p>
            <p className="text-xs text-slate-500">
              {row.original.itemSku ?? `#${row.original.itemId}`} · {formatVND(row.original.price)}
            </p>
          </>
        ),
      },
      {
        id: "tier",
        size: 140,
        meta: { label: "Gợi ý" },
        header: "Gợi ý",
        cell: ({ row }) => (
          <Badge className={cn("whitespace-nowrap", TIER_META[row.original.tier].badge)}>
            {TIER_META[row.original.tier].label}
          </Badge>
        ),
      },
      {
        id: "why",
        size: 340,
        meta: { label: "Vì sao" },
        header: "Vì sao",
        cell: ({ row }) => (
          <p className="w-80 text-sm whitespace-normal text-slate-700">{row.original.headline}</p>
        ),
      },
      {
        id: "need",
        size: 110,
        meta: { label: "Cần đạt", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Cần đạt
            <HintIcon hint="ROAS hòa vốn của sản phẩm × hệ số an toàn — chạy từ mức này trở lên mới có lãi thật." />
          </span>
        ),
        cell: ({ row }) => <span className={TEXT_NUMBER_STRONG}>{roas(row.original.safeRoas)}</span>,
      },
      {
        id: "market",
        size: 120,
        meta: { label: "Sàn đang chạy", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Sàn đang chạy
            <HintIcon hint="Mức ROAS mục tiêu mà một nửa số quảng cáo tương tự trên Shopee đang đặt cho sản phẩm cùng loại (số của sàn)." />
          </span>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums text-slate-700">{roas(row.original.market?.roiExact ?? null)}</span>
        ),
      },
      {
        id: "headroom",
        size: 100,
        meta: { label: "Dư địa", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Dư địa
            <HintIcon hint="ROAS sàn đang chạy ÷ hòa vốn của sản phẩm. Trên 1,5 là rộng rãi, dưới 1,1 là gần như không có lãi." />
          </span>
        ),
        cell: ({ row }) => {
          const h = row.original.headroom;
          return (
            <span
              className={cn(
                "tabular-nums font-medium",
                h == null ? "text-slate-400" : h >= 1.5 ? "text-emerald-600" : h >= 1.1 ? "text-amber-600" : "text-red-600"
              )}
            >
              {h == null ? "—" : `${h.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} lần`}
            </span>
          );
        },
      },
      {
        id: "social",
        size: 120,
        meta: { label: "Đánh giá", align: "right" },
        header: "Đánh giá",
        cell: ({ row }) => {
          const m = row.original.market;
          if (!m || m.ratingStar == null) return <span className="text-slate-400">—</span>;
          return (
            <span className="inline-flex items-center gap-1 tabular-nums text-slate-700">
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              {m.ratingStar.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}
              <span className="text-xs text-slate-400">({formatNumber(m.commentCount ?? 0)})</span>
            </span>
          );
        },
      },
      {
        id: "stock",
        size: 110,
        meta: { label: "Tồn đủ", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Tồn đủ
            <HintIcon hint="Số ngày bán được với tồn hiện tại khi quảng cáo đẩy lượng bán lên gấp rưỡi. Dưới 14 ngày thì nhập hàng trước." />
          </span>
        ),
        cell: ({ row }) => {
          const d = row.original.daysOfCover;
          return (
            <span className={cn("tabular-nums", d != null && d < 14 ? "text-red-600" : "text-slate-700")}>
              {d == null ? "—" : `${formatNumber(Math.floor(d))} ngày`}
            </span>
          );
        },
      },
      {
        id: "action",
        size: 130,
        meta: { label: "" },
        header: "",
        cell: ({ row }) =>
          row.original.proposal ? (
            <Button
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openDetail(row.original);
              }}
            >
              <Rocket className="size-4" />
              Chạy ads
            </Button>
          ) : (
            <span className="text-xs text-slate-400">Xem lý do</span>
          ),
      },
    ],
    // openDetail đọc state mới nhất qua closure của lần render hiện tại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adsLinked, channelId, itemLoadingId]
  );

  if (noChannel) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Kết nối gian Shopee để xem gợi ý chạy quảng cáo.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nên chạy quảng cáo sản phẩm nào?</CardTitle>
        <CardDescription>
          Hubsell đặt biên lãi, tồn kho, nhịp bán của shop cạnh số của chính Shopee (mức ROAS quảng
          cáo tương tự đang chạy, lượt tìm kiếm, đánh giá) để xếp hạng. Bấm một dòng để xem căn cứ và
          tạo chiến dịch với mục tiêu, ngân sách đã tính sẵn.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        {loading && !data && <p className="py-6 text-center text-sm text-muted-foreground">Đang chấm điểm sản phẩm…</p>}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(["run_now", "test_small", "not_yet", "running"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setFilter(filter === t ? "all" : t);
                    setPage(0);
                  }}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-shadow hover:shadow-sm",
                    TIER_META[t].tile,
                    filter === t && "ring-2 ring-primary/40"
                  )}
                >
                  <p className="text-2xl font-semibold tabular-nums">{formatNumber(data.counts[t])}</p>
                  <p className="text-sm">{TIER_META[t].label}</p>
                </button>
              ))}
            </div>

            {(data.missingCostCount ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="min-w-0 flex-1">
                  <b>{formatNumber(data.missingCostCount ?? 0)} sản phẩm đang bán chưa có giá vốn</b> nên
                  Hubsell chưa dám gợi ý: thiếu giá vốn thì biên lãi ảo cao, hòa vốn ảo thấp, chạy ads
                  theo số đó là lỗ mà không biết. Nhập giá vốn là gợi ý mở ngay.
                </p>
                <Button size="sm" variant="outline" onClick={() => (window.location.href = "/finance/cost-prices")}>
                  Nhập giá vốn
                </Button>
              </div>
            )}

            {!data.signalsSyncedAt && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                <p className="min-w-0 flex-1">
                  Chưa có số thị trường của Shopee cho gian này — gợi ý đang chấm bằng số của Hubsell
                  (biên lãi, tồn, nhịp bán). Số của sàn tự về mỗi ngày, hoặc bấm lấy ngay.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void syncSignals()}
                  disabled={syncing || !adsLinked}
                  title={adsLinked ? undefined : "Kết nối Hubsell Ads trước"}
                >
                  <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                  {syncing ? "Đang lấy số của sàn…" : "Lấy số của sàn"}
                </Button>
              </div>
            )}

            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Tìm tên sản phẩm / SKU / Item ID…"
              className="max-w-xs"
            />

            <DataTable
              tableId="ads-recommend-shopee"
              columns={columns}
              data={paged}
              getRowId={(r) => r.itemId}
              onRowClick={(r) => openDetail(r)}
              striped={false}
              headerEmphasis
              stickyHeader
              toolbar={
                <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{toolbarText(rows.length, filter, data.signalsSyncedAt)}</span>
                  {data.signalsSyncedAt && (
                    <button
                      type="button"
                      onClick={() => void syncSignals()}
                      disabled={syncing || !adsLinked}
                      className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      <RefreshCw className={cn("size-3", syncing && "animate-spin")} />
                      {syncing ? "Đang cập nhật…" : "Cập nhật số của sàn"}
                    </button>
                  )}
                </span>
              }
            />
            {pageCount > 1 && (
              <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Trước
                </Button>
                Trang {page + 1}/{pageCount}
                <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
                  Sau
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>

      <RecommendDialog
        row={detail}
        loadingMarket={detail != null && itemLoadingId === detail.itemId}
        channelId={channelId}
        onClose={() => setDetailId(null)}
        onCreated={(msg) => {
          setDetailId(null);
          onCreated(msg);
        }}
      />
    </Card>
  );
}

// ---------- Hộp thoại căn cứ + tạo chiến dịch MỘT nút ----------

function RecommendDialog({
  row,
  loadingMarket,
  channelId,
  onClose,
  onCreated,
}: {
  row: AdsRecommendationRow | null;
  /** Đang lấy dải ROAS / ngân sách / từ khóa của sàn cho riêng SP này. */
  loadingMarket: boolean;
  channelId: string;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [target, setTarget] = useState<"push" | "balanced" | "keep">("balanced");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mỗi lần mở một SP khác: nạp lại lựa chọn đề xuất của SP đó.
  useEffect(() => {
    setError(null);
    if (row?.proposal) {
      setTarget(row.proposal.recommended);
      setBudget(String(row.proposal.dailyBudget));
    }
  }, [row]);

  const p = row?.proposal ?? null;
  const budgetNum = Number(budget.replace(/\D/g, ""));
  const failed = row?.gates.filter((g) => !g.ok) ?? [];

  async function create() {
    if (!row || !p || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createAdsCampaignFromRecommendation({
        channelId,
        itemId: row.itemId,
        roasTarget: p.targets[target],
        dailyBudget: budgetNum,
        snapshot: {
          tier: row.tier,
          score: row.score,
          headline: row.headline,
          breakevenRoas: row.breakevenRoas,
          safeRoas: row.safeRoas,
          headroom: row.headroom,
          chosenTarget: target,
          targets: p.targets,
          proposedBudget: p.dailyBudget,
          chosenBudget: budgetNum,
        },
      });
      onCreated(`${r.message}: "${row.productName}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo chiến dịch thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="min-w-0 truncate">{row?.productName}</span>
            {row && <Badge className={TIER_META[row.tier].badge}>{TIER_META[row.tier].label}</Badge>}
            {row && <span className="text-sm font-normal text-muted-foreground">{row.score}/100 điểm</span>}
          </DialogTitle>
          <DialogDescription>{row?.headline}</DialogDescription>
        </DialogHeader>

        {row && (
          <div className="min-w-0 space-y-5">
            {loadingMarket && (
              <p className="rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-sm text-sky-800">
                Đang lấy số của Shopee cho sản phẩm này (mức ROAS quảng cáo tương tự, lượt tìm, ngân sách
                gợi ý) — điểm và đề xuất sẽ tự cập nhật sau vài giây.
              </p>
            )}
            {/* Việc cần làm trước — chỉ khi trượt cổng */}
            {failed.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-semibold">Việc cần làm trước khi chạy quảng cáo</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {failed.map((g) => (
                    <li key={g.key}>{g.todo ?? g.text}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Điều kiện */}
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-slate-900">Điều kiện</p>
              <ul className="space-y-1 text-sm text-slate-700">
                {row.gates.map((g) => (
                  <li key={g.key} className="flex items-start gap-2">
                    {g.ok ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-red-500" />
                    )}
                    <span>{g.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Điểm từng yếu tố */}
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-900">Chấm điểm</p>
              {row.factors.map((f) => (
                <div key={f.key} className="grid grid-cols-[9.5rem_1fr] items-start gap-x-3 gap-y-0.5 text-sm">
                  <div>
                    <p className="text-slate-700">{f.label}</p>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn("h-full rounded-full", f.points < 0 ? "bg-red-400" : "bg-emerald-500")}
                        style={{ width: `${Math.min(100, (Math.abs(f.points) / f.max) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-slate-600">
                    <span className="tabular-nums font-medium text-slate-900">
                      {f.points}/{f.max}
                    </span>{" "}
                    · {f.text}
                  </p>
                </div>
              ))}
            </div>

            {/* Thiết lập đề xuất + MỘT nút */}
            {p && (
              <div className="space-y-3 border-t pt-4">
                <p className="text-sm font-semibold text-slate-900">Thiết lập đề xuất</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["push", "balanced", "keep"] as const)
                    .filter((k, i, arr) => arr.findIndex((o) => p.targets[o] === p.targets[k]) === i)
                    .map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTarget(k)}
                        title={TARGET_META[k].hint}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          target === k ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                        )}
                      >
                        <p className="text-xs text-muted-foreground">
                          {TARGET_META[k].label}
                          {p.recommended === k && " · đề xuất"}
                        </p>
                        <p className="text-xl font-semibold tabular-nums">{roas(p.targets[k])}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{TARGET_META[k].hint}</p>
                      </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Ngân sách mỗi ngày (₫)</span>
                    <Input
                      inputMode="numeric"
                      value={budgetNum ? formatNumber(budgetNum) : ""}
                      onChange={(e) => setBudget(e.target.value)}
                      className="w-44 tabular-nums"
                    />
                  </label>
                  <p className="min-w-0 flex-1 text-xs text-slate-500">
                    {p.budgetNote} Tiền thử tối đa 7 ngày: <b>{formatVND(budgetNum * 7)}</b>.
                  </p>
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => void create()} disabled={busy || budgetNum <= 0}>
                    <Rocket className="size-4" />
                    {busy ? "Đang tạo trên Shopee…" : "Tạo chiến dịch"}
                  </Button>
                  <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-500">
                    <ShieldCheck className="size-4 shrink-0 text-emerald-600" />
                    Đấu thầu tự động theo mục tiêu đã chọn. Tạo xong Trợ lý gác ngay bằng các quy tắc đang bật.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
