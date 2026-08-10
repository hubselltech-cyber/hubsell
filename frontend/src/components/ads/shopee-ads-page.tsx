"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Megaphone,
  RefreshCw,
  Scale,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { HintIcon } from "@/components/finance/hint-icon";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  decideShopeeAdsCampaign,
  fetchShopeeAdsDashboard,
  getStoredUser,
  getToken,
  saveShopeeAssistantConfig,
  syncShopeeAdsCampaigns,
  type ShopeeAdsCampaignRow,
  type ShopeeAdsDashboard,
  type ShopeeAssistantConfig,
  type ShopeeAssistantDecision,
} from "@/lib/api";
import {
  AssistantVerdictBadge,
  ShopeeAssistantConfigCard,
  ShopeeAssistantModal,
  assistantBannerText,
} from "@/components/ads/shopee-assistant-panel";
import { formatNumber, formatVND } from "@/lib/format";
import { isAdmin } from "@/lib/permissions";
import { TABLE_HEAD_EMPHASIS, TEXT_NUMBER_STRONG, moneyTone } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRỢ LÝ QUẢNG CÁO SHOPEE — GIAI ĐOẠN 1: DASHBOARD DỮ LIỆU THẬT (READ-ONLY)
 *
 * Khác Seller Center một điểm ăn tiền: mỗi chiến dịch có thêm ROAS HÒA VỐN
 * tính từ P&L thật của chính SKU trong chiến dịch (giá vốn + phí sàn đã đối
 * soát) — ROAS sàn báo dương nhưng dưới ngưỡng này vẫn là đốt tiền. Nguồn số
 * là /api/ads/shopee (sync tự động theo nhịp đối soát + nút Đồng bộ tay).
 *
 * Chỉ ADMIN (chi phí Ads là dữ liệu tài chính). TikTok/Lazada vẫn dùng khung
 * mock ads-assistant-page cho tới khi nối API thật của từng sàn.
 */

/** Nhãn + màu trạng thái campaign theo từ vựng Shopee. */
const STATUS_META: Record<string, { label: string; className: string }> = {
  ongoing: { label: "Đang chạy", className: "bg-emerald-500 text-white" },
  scheduled: { label: "Hẹn giờ", className: "bg-sky-100 text-sky-700" },
  paused: { label: "Tạm dừng", className: "bg-amber-100 text-amber-700" },
  ended: { label: "Đã kết thúc", className: "bg-slate-100 text-slate-500" },
  closed: { label: "Đã đóng", className: "bg-slate-100 text-slate-500" },
  deleted: { label: "Đã xóa", className: "bg-slate-100 text-slate-400" },
};

const AD_TYPE_LABEL: Record<string, string> = {
  auto: "Tự động",
  manual: "Thủ công",
};

const PLACEMENT_LABEL: Record<string, string> = {
  search: "Tìm kiếm",
  discovery: "Khám phá",
  all: "Tất cả vị trí",
};

/** Hệ số an toàn trên ROAS hòa vốn — dưới hòa vốn×1.1 coi là vùng nguy hiểm. */
const DANGER_FACTOR = 1.1;

function roasToneClass(
  roas: number | null,
  breakeven: number | null
): string {
  if (roas == null) return "text-slate-400";
  if (breakeven == null) return "text-slate-700";
  if (roas < breakeven) return "text-red-600";
  if (roas < breakeven * DANGER_FACTOR) return "text-amber-600";
  return "text-emerald-600";
}

function formatRoas(v: number | null): string {
  if (v == null) return "—";
  return `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;
}

export function ShopeeAdsPage() {
  const router = useRouter();
  const [denied, setDenied] = useState(false);
  const [data, setData] = useState<ShopeeAdsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string>("");
  const [days, setDays] = useState<7 | 30>(7);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // Phân trang bảng chiến dịch — shop thật có hàng trăm campaign (DarkMan: 142).
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  // ----- Trợ lý (GĐ2): modal chi tiết + lọc cần-xử-lý + lưu cấu hình -----
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [onlyNeedsAction, setOnlyNeedsAction] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!isAdmin(getStoredUser()?.role)) setDenied(true);
  }, [router]);

  const load = useCallback(async (cid: string, d: 7 | 30) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchShopeeAdsDashboard({
        channelId: cid || undefined,
        days: d,
      });
      setData(res);
      if (res.selectedChannelId) setChannelId(res.selectedChannelId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(channelId, days);
    // channelId đổi qua chính load() (server chọn gian đầu) — chỉ nghe người dùng đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeChannel(cid: string) {
    setChannelId(cid);
    setPage(0); // đổi gian là bộ campaign khác — về trang đầu
    void load(cid, days);
  }

  function changeDays(d: 7 | 30) {
    setDays(d);
    setPage(0);
    void load(channelId, d);
  }

  async function runSync() {
    if (!channelId || syncing) return;
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await syncShopeeAdsCampaigns(channelId);
      setSyncNote(
        `Đã đồng bộ ${formatNumber(res.campaignsUpserted)} chiến dịch, ${formatNumber(res.perfDaysUpserted)} dòng hiệu suất ngày.`
      );
      await load(channelId, days);
    } catch (err) {
      setSyncNote(`Đồng bộ lỗi: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  const summary = data?.summary ?? null;
  const wallet = data?.wallet ?? null;

  // Cảnh báo ví ads sắp cạn: dưới 2 ngày chi tiêu trung bình của kỳ đang xem.
  const walletLow = useMemo(() => {
    if (!wallet || !summary || summary.spend <= 0) return false;
    const avgDaily = summary.spend / days;
    return wallet.balance < avgDaily * 2;
  }, [wallet, summary, days]);

  const series = useMemo(
    () =>
      (data?.series ?? []).map((p) => {
        const d = new Date(`${p.date}T00:00:00Z`);
        return {
          ...p,
          label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`,
        };
      }),
    [data?.series]
  );

  const assistant = data?.assistant ?? null;

  async function decideCampaign(decision: ShopeeAssistantDecision) {
    const campaign = data?.campaigns.find((c) => c.id === detailId);
    if (!campaign || deciding) return;
    setDeciding(true);
    try {
      await decideShopeeAdsCampaign(
        campaign.id,
        decision,
        campaign.assistant.verdict ?? ""
      );
      setDetailId(null);
      await load(channelId, days);
    } catch (err) {
      setSyncNote(`Ghi nhận quyết định lỗi: ${(err as Error).message}`);
    } finally {
      setDeciding(false);
    }
  }

  async function saveConfig(config: ShopeeAssistantConfig) {
    if (!channelId || savingConfig) return;
    setSavingConfig(true);
    try {
      await saveShopeeAssistantConfig(channelId, config);
      await load(channelId, days);
    } catch (err) {
      setSyncNote(`Lưu cấu hình lỗi: ${(err as Error).message}`);
    } finally {
      setSavingConfig(false);
    }
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const campaigns = data?.campaigns ?? [];
  const noChannel = !loading && (data?.channels.length ?? 0) === 0;

  // Lọc "chỉ cần xử lý": cảnh báo nặng chưa được quyết (spike/dừng/duyệt/công thần).
  const visibleCampaigns = onlyNeedsAction
    ? campaigns.filter(
        (c) =>
          !c.assistant.decisionActive &&
          (c.assistant.verdict === "spike" ||
            c.assistant.verdict === "pause_now" ||
            c.assistant.verdict === "review" ||
            c.assistant.verdict === "grace")
      )
    : campaigns;

  // Phân trang client-side: API trả trọn bộ (đã sort theo chi tiêu giảm dần),
  // bảng chỉ hiện PAGE_SIZE dòng một trang. Kẹp page khi dữ liệu co lại.
  const pageCount = Math.max(1, Math.ceil(visibleCampaigns.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedCampaigns = visibleCampaigns.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE
  );
  const detailCampaign = campaigns.find((c) => c.id === detailId) ?? null;

  return (
    <AppShell>
      <div className="space-y-5 pb-10">
        {/* ===== THANH ĐIỀU KHIỂN: chọn gian + cửa sổ + đồng bộ ===== */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Trợ lý quảng cáo Shopee
            </h1>
            <p className="text-sm text-muted-foreground">
              Dữ liệu thật từ Shopee Ads API — kèm ROAS hòa vốn tính từ lãi/lỗ
              thực tế của shop.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {(data?.channels.length ?? 0) > 1 && (
              <NativeSelect
                value={channelId}
                onChange={(e) => changeChannel(e.target.value)}
                aria-label="Chọn gian hàng Shopee"
                className="w-52"
              >
                {data?.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shopName}
                  </option>
                ))}
              </NativeSelect>
            )}
            <div className="flex overflow-hidden rounded-lg border">
              {([7, 30] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => changeDays(d)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium transition-colors",
                    days === d
                      ? "bg-slate-900 text-white"
                      : "bg-card text-slate-600 hover:bg-muted"
                  )}
                >
                  {d} ngày
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runSync()}
              disabled={syncing || !channelId}
            >
              <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
              {syncing ? "Đang đồng bộ…" : "Đồng bộ"}
            </Button>
          </div>
        </div>

        {syncNote && (
          <p className="text-sm text-muted-foreground">{syncNote}</p>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ===== ĐỀ XUẤT TỪ TRỢ LÝ (GĐ2 — verdict rule engine, chưa ai quyết) ===== */}
        {assistant && assistant.needsAction > 0 && (
          <div className="flex flex-wrap items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                Trợ lý phát hiện {formatNumber(assistant.needsAction)} chiến dịch
                cần xử lý
              </p>
              <p className="mt-0.5 text-red-600">
                {assistantBannerText(assistant.counts)} — bấm badge ở cột Trợ lý
                để xem căn cứ và quyết định.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-100 hover:text-red-800"
              onClick={() => {
                setOnlyNeedsAction(true);
                setPage(0);
              }}
            >
              Lọc cần xử lý
            </Button>
          </div>
        )}
        {walletLow && wallet && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
            <Wallet className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <p>
              Ví quảng cáo chỉ còn <b>{formatVND(wallet.balance)}</b> — thấp hơn
              2 ngày chi tiêu trung bình. Nạp thêm để chiến dịch không bị dừng
              giữa chừng.
            </p>
          </div>
        )}

        {/* ===== THẺ TỔNG QUAN ===== */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Chi phí Ads"
            value={<Money value={summary?.spend ?? 0} />}
            icon={Wallet}
            tone="negative"
            colorValue
            subtitle={`${days} ngày · campaign sản phẩm`}
          />
          <StatCard
            label="GMV từ Ads"
            value={<Money value={summary?.broadGmv ?? 0} />}
            icon={TrendingUp}
            tone="positive"
            colorValue
            subtitle={`Direct: ${formatVND(summary?.directGmv ?? 0)}`}
          />
          <StatCard
            label="ROAS"
            value={formatRoas(summary?.roasBroad ?? null)}
            icon={Target}
            tone="accent"
            subtitle={`Direct: ${formatRoas(summary?.roasDirect ?? null)}`}
          />
          <StatCard
            label="ROAS hòa vốn"
            value={formatRoas(summary?.shopBreakevenRoas ?? null)}
            icon={Scale}
            tone="neutral"
            subtitle={
              summary?.shopMargin != null
                ? `Biên lãi ròng shop ${(summary.shopMargin * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
                : "Chưa đủ dữ liệu P&L"
            }
          />
          <StatCard
            label="Lãi/lỗ ước tính"
            value={<Money value={summary?.estProfit ?? 0} />}
            icon={Megaphone}
            tone={(summary?.estProfit ?? 0) >= 0 ? "positive" : "negative"}
            colorValue
            subtitle="GMV direct × biên lãi − chi phí"
          />
        </div>

        {/* ===== BIỂU ĐỒ CHI PHÍ vs GMV ===== */}
        {series.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Chi phí vs GMV từ Ads ({days} ngày)</CardTitle>
              <CardDescription>
                Số thật theo ngày, gộp mọi chiến dịch của gian đang chọn.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
                    <defs>
                      <linearGradient id="gradShopeeAdsGmv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gradShopeeAdsSpend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f87171" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#f87171" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={12} tickLine={false} />
                    <YAxis
                      fontSize={11}
                      tickLine={false}
                      width={110}
                      tickFormatter={(v: number) => formatVND(v)}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatVND(Number(value)),
                        name === "broadGmv" ? "GMV từ Ads" : "Chi phí Ads",
                      ]}
                    />
                    <Legend
                      formatter={(value) =>
                        value === "broadGmv" ? "GMV từ Ads" : "Chi phí Ads"
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="broadGmv"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#gradShopeeAdsGmv)"
                    />
                    <Area
                      type="monotone"
                      dataKey="spend"
                      stroke="#f87171"
                      strokeWidth={2}
                      fill="url(#gradShopeeAdsSpend)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== BẢNG CHIẾN DỊCH ===== */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Chiến dịch quảng cáo</CardTitle>
                <CardDescription className="mt-1.5">
                  ROAS tô màu theo ROAS hòa vốn của chính SKU trong chiến dịch —{" "}
                  <span className="text-emerald-600">xanh</span> là có lãi thật,{" "}
                  <span className="text-amber-600">vàng</span> là sát ngưỡng,{" "}
                  <span className="text-red-600">đỏ</span> là đang lỗ dù ROAS dương.
                  Bấm một dòng để xem căn cứ của Trợ lý.
                </CardDescription>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
                <Switch
                  checked={onlyNeedsAction}
                  onCheckedChange={(v) => {
                    setOnlyNeedsAction(v);
                    setPage(0);
                  }}
                  aria-label="Chỉ hiện chiến dịch cần xử lý"
                />
                Chỉ cần xử lý
              </label>
            </div>
          </CardHeader>
          <CardContent>
            {noChannel ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Chưa có gian Shopee nào được kết nối.
              </p>
            ) : campaigns.length === 0 && !loading ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Chưa có dữ liệu chiến dịch. Bấm Đồng bộ để kéo từ Shopee về
                  (worker cũng tự chạy mỗi giờ).
                </p>
                <Button className="mt-4" onClick={() => void runSync()} disabled={syncing}>
                  <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                  Đồng bộ ngay
                </Button>
              </div>
            ) : visibleCampaigns.length === 0 && !loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Không còn chiến dịch nào cần xử lý 🎉 — tắt bộ lọc để xem toàn bộ.
              </p>
            ) : (
              <div className="min-w-0 overflow-x-auto">
                <Table>
                  <TableHeader className={TABLE_HEAD_EMPHASIS}>
                    <TableRow>
                      <TableHead>Chiến dịch</TableHead>
                      <TableHead className="w-36">Trợ lý</TableHead>
                      <TableHead className="w-28">Trạng thái</TableHead>
                      <TableHead className="w-32 text-right">Ngân sách</TableHead>
                      <TableHead className="w-32 text-right">Chi phí</TableHead>
                      <TableHead className="w-20 text-right">
                        <span className="inline-flex items-center gap-1">
                          Đơn
                          <HintIcon hint="Đơn broad: mọi đơn của shop trong 7 ngày sau khi khách bấm quảng cáo (định nghĩa Shopee)." />
                        </span>
                      </TableHead>
                      <TableHead className="w-32 text-right">GMV</TableHead>
                      <TableHead className="w-24 text-right">ROAS</TableHead>
                      <TableHead className="w-28 text-right">
                        <span className="inline-flex items-center gap-1">
                          Hòa vốn
                          <HintIcon hint="ROAS hòa vốn = 1 / biên lãi ròng của chính SKU trong chiến dịch (giá vốn + phí sàn thật, chưa gồm ads). ROAS dưới số này là đốt tiền dù sàn báo dương." />
                        </span>
                      </TableHead>
                      <TableHead className="w-32 text-right">
                        <span className="inline-flex items-center gap-1">
                          Lãi/lỗ ước tính
                          <HintIcon hint="GMV direct × biên lãi ròng − chi phí ads trong kỳ. Thận trọng: không tính đơn broad." />
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedCampaigns.map((c) => (
                      <CampaignRow key={c.id} c={c} onOpen={() => setDetailId(c.id)} />
                    ))}
                  </TableBody>
                </Table>
                {visibleCampaigns.length > PAGE_SIZE && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Hiển thị {formatNumber(safePage * PAGE_SIZE + 1)}–
                      {formatNumber(
                        Math.min((safePage + 1) * PAGE_SIZE, visibleCampaigns.length)
                      )}{" "}
                      trong {formatNumber(visibleCampaigns.length)} chiến dịch
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(Math.max(0, safePage - 1))}
                        disabled={safePage === 0}
                      >
                        Trước
                      </Button>
                      <span className="text-xs tabular-nums text-slate-600">
                        Trang {formatNumber(safePage + 1)}/{formatNumber(pageCount)}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPage(Math.min(pageCount - 1, safePage + 1))
                        }
                        disabled={safePage >= pageCount - 1}
                      >
                        Sau
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== CẤU HÌNH TRỢ LÝ (GĐ2) ===== */}
        {assistant && !noChannel && (
          <ShopeeAssistantConfigCard
            config={assistant.config}
            onSave={(config) => void saveConfig(config)}
            saving={savingConfig}
          />
        )}

        {/* ===== MODAL CĂN CỨ + QUYẾT ĐỊNH ===== */}
        <ShopeeAssistantModal
          campaign={detailCampaign}
          onDecide={(d) => void decideCampaign(d)}
          onClose={() => setDetailId(null)}
          deciding={deciding}
        />

        {/* ===== GHI CHÚ NGUỒN SỐ ===== */}
        {summary && (
          <p className="text-center text-xs text-muted-foreground">
            Biên lãi tính từ {formatNumber(summary.pnlOrders)} đơn P&L{" "}
            {summary.marginWindowDays} ngày gần nhất (SSOT computePnlRow, chưa
            trừ ads).
            {summary.missingCostOrders > 0 && (
              <span className="text-amber-600">
                {" "}
                ⚠ {formatNumber(summary.missingCostOrders)} đơn còn SKU thiếu giá
                vốn — nhập đủ giá vốn để ROAS hòa vốn chính xác hơn.
              </span>
            )}{" "}
            Tổng chi ads toàn shop (AdSpend): {formatVND(summary.adSpendTotal)}.
          </p>
        )}
      </div>
    </AppShell>
  );
}

function CampaignRow({
  c,
  onOpen,
}: {
  c: ShopeeAdsCampaignRow;
  onOpen: () => void;
}) {
  const status = STATUS_META[c.status] ?? {
    label: c.status || "—",
    className: "bg-slate-100 text-slate-500",
  };
  const danger =
    c.status === "ongoing" &&
    c.spend > 0 &&
    c.roasBroad != null &&
    c.breakevenRoas != null &&
    c.roasBroad < c.breakevenRoas;

  return (
    <TableRow
      className={cn("cursor-pointer", danger && "bg-red-50/50")}
      onClick={onOpen}
    >
      <TableCell>
        <p className="max-w-64 truncate text-sm font-medium text-slate-900">
          {c.name || `Chiến dịch #${c.campaignId}`}
        </p>
        <p className="text-xs text-slate-500">
          {AD_TYPE_LABEL[c.adType] ?? c.adType}
          {c.placement && ` · ${PLACEMENT_LABEL[c.placement] ?? c.placement}`}
          {c.itemCount > 0 && ` · ${formatNumber(c.itemCount)} SP`}
          {c.roasTarget != null && ` · mục tiêu ${formatRoas(c.roasTarget)}`}
        </p>
      </TableCell>
      <TableCell>
        <AssistantVerdictBadge c={c} />
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge className={status.className}>{status.label}</Badge>
          {c.lossBeforeAds && (
            <Badge variant="outline" className="border-rose-300 text-rose-600">
              SKU lỗ trước ads
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right text-slate-700">
        {c.budget > 0 ? <Money value={c.budget} /> : "Không giới hạn"}
      </TableCell>
      <TableCell className="text-right">
        <Money value={c.spend} className="text-slate-700" />
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-700">
        {formatNumber(c.broadOrder)}
      </TableCell>
      <TableCell className="text-right">
        <Money value={c.broadGmv} className="text-slate-900" />
      </TableCell>
      <TableCell
        className={cn(
          "text-right",
          TEXT_NUMBER_STRONG,
          roasToneClass(c.roasBroad, c.breakevenRoas)
        )}
      >
        {formatRoas(c.roasBroad)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-slate-700">
        {formatRoas(c.breakevenRoas)}
        {c.marginSource === "shop" && (
          <span
            className="ml-1 text-xs text-slate-400"
            title="Chiến dịch chưa đủ đơn khớp SKU — dùng biên lãi toàn shop"
          >
            (shop)
          </span>
        )}
      </TableCell>
      <TableCell
        className={cn(
          "text-right",
          TEXT_NUMBER_STRONG,
          c.estProfit != null ? moneyTone(c.estProfit >= 0 ? 1 : -1) : "text-slate-400"
        )}
      >
        {c.estProfit != null ? formatVND(c.estProfit) : "—"}
      </TableCell>
    </TableRow>
  );
}
