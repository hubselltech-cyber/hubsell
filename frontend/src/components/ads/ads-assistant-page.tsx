"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  ChevronRight,
  Megaphone,
  MousePointerClick,
  Percent,
  Sparkles,
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
import {
  DEFAULT_ASSISTANT_CONFIG,
  DEFAULT_CAMPAIGN_OVERRIDES,
  TIKTOK_CAMPAIGN_DETAILS,
  findCampaignDetail,
  summarizeAssistant,
  type AssistantConfig,
  type AssistantRuleSet,
  type CampaignRuleOverrides,
  type VideoDecision,
  type VideoDecisionMap,
} from "@/components/ads/tiktok-assistant";
import { TiktokAssistantConfigTab } from "@/components/ads/tiktok-assistant-config-tab";
import { TiktokCampaignModal } from "@/components/ads/tiktok-campaign-modal";
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
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStoredUser, getToken } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";
import { isAdmin } from "@/lib/permissions";
import { TABLE_HEAD_EMPHASIS, TEXT_NUMBER_STRONG, moneyTone } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRỢ LÝ QUẢNG CÁO — KHUNG GIAO DIỆN GIỮ CHỖ (PREVIEW)
 *
 * Ba trang /ads/{tiktok,shopee,lazada} dùng chung component này, chỉ khác
 * `platform`. Toàn bộ số liệu là MOCK cứng phía client — định hình layout
 * trước, chờ tích hợp Marketing/Ads API của từng sàn. Khi nối API thật, thay
 * PLATFORM_PRESETS bằng dữ liệu fetch là xong, khung UI giữ nguyên.
 *
 * Chỉ ADMIN nhìn thấy (chi phí Ads là dữ liệu tài chính — cùng luật với nhóm
 * Quản lý Tài chính, xem hubsell-phan-quyen).
 */

export type AdsPlatform = "TIKTOK" | "SHOPEE" | "LAZADA";

type AdsTab = "overview" | "budget" | "report" | "assistant";

const TABS: { key: AdsTab; label: string }[] = [
  { key: "overview", label: "Tổng quan chiến dịch" },
  { key: "budget", label: "Quản lý ngân sách" },
  { key: "report", label: "Báo cáo hiệu quả" },
];

/** Tab thứ 4 chỉ TikTok có — nơi đặt luật cho Trợ lý tối ưu GMV Max. */
const ASSISTANT_TAB: { key: AdsTab; label: string } = {
  key: "assistant",
  label: "Cấu hình Trợ lý Tự động",
};

/** Bộ chỉ số tổng quan của một sàn (Tab 1). */
interface AdsOverviewStats {
  /** Tổng chi phí quảng cáo trong kỳ (VND) */
  spend: number;
  /** Doanh thu quy cho quảng cáo (VND) */
  revenue: number;
  clicks: number;
  /** CTR — phần trăm, ví dụ 2.4 = 2,4% */
  ctr: number;
  /** ROAS = doanh thu / chi phí */
  roas: number;
}

/** Một dòng chiến dịch mẫu trong bảng Quản lý ngân sách (Tab 2). */
interface AdsCampaign {
  id: string;
  name: string;
  /** Ngân sách ngày (VND) — người dùng sửa được trong ô nhập (chỉ preview) */
  dailyBudget: number;
  spend: number;
  roas: number;
  enabled: boolean;
}

/** Một điểm dữ liệu ngày cho biểu đồ Báo cáo hiệu quả (Tab 3). */
interface AdsDailyPoint {
  label: string;
  spend: number;
  revenue: number;
}

interface PlatformPreset {
  /** Tên hiển thị trên banner/mô tả — "TikTok Shop", "Shopee"… */
  displayName: string;
  overview: AdsOverviewStats;
  campaigns: AdsCampaign[];
  series: AdsDailyPoint[];
}

/** Sinh 14 ngày mock quanh một biên độ cơ sở — mỗi sàn một nhịp riêng cho đỡ giả. */
function mockSeries(baseSpend: number, baseRoas: number): AdsDailyPoint[] {
  const points: AdsDailyPoint[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    // Dao động tất định theo chỉ số ngày (không dùng Math.random để SSR/CSR khớp nhau)
    const wave = 1 + 0.3 * Math.sin((13 - i) * 1.1);
    const spend = Math.round((baseSpend * wave) / 1000) * 1000;
    points.push({
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      spend,
      revenue: Math.round((spend * baseRoas * (1 + 0.15 * Math.cos(i))) / 1000) * 1000,
    });
  }
  return points;
}

const PLATFORM_PRESETS: Record<AdsPlatform, PlatformPreset> = {
  TIKTOK: {
    displayName: "TikTok Shop",
    overview: { spend: 12_450_000, revenue: 48_760_000, clicks: 38_420, ctr: 2.4, roas: 3.92 },
    campaigns: [
      { id: "tt-1", name: "GMV Max — Túi đeo chéo TC054", dailyBudget: 500_000, spend: 4_820_000, roas: 4.6, enabled: true },
      { id: "tt-2", name: "Video Ads — Áo gió nam (KOL T7)", dailyBudget: 300_000, spend: 3_150_000, roas: 3.1, enabled: true },
      { id: "tt-3", name: "Live Ads — Phiên live tối thứ 6", dailyBudget: 800_000, spend: 2_980_000, roas: 4.2, enabled: false },
      { id: "tt-4", name: "Product Shopping Ads — Tất thể thao", dailyBudget: 150_000, spend: 1_500_000, roas: 1.8, enabled: true },
    ],
    series: mockSeries(850_000, 3.9),
  },
  SHOPEE: {
    displayName: "Shopee",
    overview: { spend: 8_920_000, revenue: 31_540_000, clicks: 27_310, ctr: 1.9, roas: 3.54 },
    campaigns: [
      { id: "sp-1", name: "Đấu thầu từ khóa — \"túi đeo chéo nam\"", dailyBudget: 400_000, spend: 3_620_000, roas: 3.8, enabled: true },
      { id: "sp-2", name: "Quảng cáo Khám phá — TC055", dailyBudget: 250_000, spend: 2_410_000, roas: 3.3, enabled: true },
      { id: "sp-3", name: "Quảng cáo Shop — Hubsell Official", dailyBudget: 200_000, spend: 1_890_000, roas: 2.6, enabled: false },
      { id: "sp-4", name: "Flash Sale Boost — Tất VDT_001", dailyBudget: 120_000, spend: 1_000_000, roas: 4.9, enabled: true },
    ],
    series: mockSeries(620_000, 3.5),
  },
  LAZADA: {
    displayName: "Lazada",
    overview: { spend: 5_310_000, revenue: 15_120_000, clicks: 14_260, ctr: 1.6, roas: 2.85 },
    campaigns: [
      { id: "lz-1", name: "Sponsored Discovery — Áo gió AOGIO_001", dailyBudget: 300_000, spend: 2_240_000, roas: 3.0, enabled: true },
      { id: "lz-2", name: "Sponsored Search — \"túi canvas\"", dailyBudget: 200_000, spend: 1_760_000, roas: 2.9, enabled: true },
      { id: "lz-3", name: "Sponsored Affiliate — Q3 2026", dailyBudget: 150_000, spend: 1_310_000, roas: 2.4, enabled: false },
    ],
    series: mockSeries(380_000, 2.9),
  },
};

export function AdsAssistantPage({ platform }: { platform: AdsPlatform }) {
  const router = useRouter();
  const preset = PLATFORM_PRESETS[platform];
  const isTiktok = platform === "TIKTOK";

  const [tab, setTab] = useState<AdsTab>("overview");
  const [denied, setDenied] = useState(false);
  // Bảng Tab 2 sửa được tại chỗ (bật/tắt, ngân sách) nhưng CHỈ trong phiên xem
  // trước — không gọi API, đổi trang là về mock gốc.
  const [campaigns, setCampaigns] = useState<AdsCampaign[]>(preset.campaigns);

  // ----- Trạng thái Trợ lý tối ưu (chỉ TikTok dùng, khai báo vô điều kiện
  // để không phạm luật hook). Logic quét nằm ở tiktok-assistant.ts. -----
  const [assistantConfig, setAssistantConfig] = useState<AssistantConfig>(
    DEFAULT_ASSISTANT_CONFIG
  );
  // Quy tắc RIÊNG theo chiến dịch (override) — có trong map là ưu tiên hơn
  // cấu hình mặc định. Mock sẵn TC054 (hàng giá trị cao, trần CPA 150k).
  const [ruleOverrides, setRuleOverrides] = useState<CampaignRuleOverrides>(
    DEFAULT_CAMPAIGN_OVERRIDES
  );
  const [decisions, setDecisions] = useState<VideoDecisionMap>({});
  const [detailCampaignId, setDetailCampaignId] = useState<string | null>(null);

  const assistantSummary = useMemo(
    () =>
      summarizeAssistant(
        TIKTOK_CAMPAIGN_DETAILS,
        assistantConfig,
        ruleOverrides,
        decisions
      ),
    [assistantConfig, ruleOverrides, decisions]
  );

  /** Bật/sửa (rules) hoặc tắt (null) quy tắc riêng của chiến dịch đang mở modal. */
  function changeOverride(campaignId: string, rules: AssistantRuleSet | null) {
    setRuleOverrides((prev) => {
      const next = { ...prev };
      if (rules === null) delete next[campaignId];
      else next[campaignId] = rules;
      return next;
    });
  }
  const flaggedCount = assistantSummary.autoExclude + assistantSummary.needsReview;

  function decideVideo(videoId: string, decision: VideoDecision | null) {
    setDecisions((prev) => {
      const next = { ...prev };
      if (decision === null) delete next[videoId];
      else next[videoId] = decision;
      return next;
    });
  }

  function bulkExclude(videoIds: string[]) {
    setDecisions((prev) => {
      const next = { ...prev };
      videoIds.forEach((id) => (next[id] = "EXCLUDED"));
      return next;
    });
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!isAdmin(getStoredUser()?.role)) setDenied(true);
  }, [router]);

  function toggleCampaign(id: string, enabled: boolean) {
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, enabled } : c)));
  }

  function changeBudget(id: string, raw: string) {
    const value = Number(raw.replace(/\D/g, ""));
    setCampaigns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, dailyBudget: Number.isNaN(value) ? 0 : value } : c))
    );
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const { overview, series } = preset;
  const visibleTabs = isTiktok ? [...TABS, ASSISTANT_TAB] : TABS;

  return (
    <AppShell>
      <div className="space-y-5 pb-10">
        {/* ===== BANNER TRẠNG THÁI: TÍNH NĂNG ĐANG PHÁT TRIỂN ===== */}
        <div className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3.5 text-sm text-violet-800">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-violet-600" />
          <div>
            <p className="font-semibold">
              Tính năng Trợ lý quảng cáo thông minh đang được phát triển.
            </p>
            <p className="mt-0.5 text-violet-700">
              Dữ liệu dưới đây là bản xem trước (Preview) cho kênh{" "}
              <b>{preset.displayName}</b> — khung giao diện chuẩn bị cho tích hợp
              Marketing/Ads API, chưa phản ánh số liệu thật.
            </p>
          </div>
        </div>

        {/* ===== ĐỀ XUẤT TỪ TRỢ LÝ HUBSELL (chỉ TikTok, khi có video bị gắn cờ) ===== */}
        {isTiktok && assistantConfig.enabled && flaggedCount > 0 && (
          <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
            <BellRing className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Đề xuất từ Trợ lý Hubsell</p>
              <ul className="mt-1 space-y-1 text-amber-700">
                {assistantSummary.needsReview > 0 && (
                  <li>
                    Phát hiện <b>{formatNumber(assistantSummary.needsReview)} video</b>{" "}
                    có tỷ lệ chuyển đổi tốt nhưng chi phí mỗi đơn (CPA) vượt ngưỡng{" "}
                    {formatNumber(assistantConfig.review.overPct)}%. Vui lòng bấm
                    &quot;Xem &amp; quyết định&quot; để giữ lại hay loại trừ.
                  </li>
                )}
                {assistantSummary.autoExclude > 0 && (
                  <li>
                    <b>{formatNumber(assistantSummary.autoExclude)} video</b> kém hiệu
                    quả (vi phạm Quy tắc 1) đang chờ loại trừ tự động.
                  </li>
                )}
              </ul>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
              onClick={() =>
                setDetailCampaignId(assistantSummary.firstFlaggedCampaignId)
              }
            >
              Xem &amp; quyết định
            </Button>
          </div>
        )}

        {/* ===== TABLIST ===== */}
        <div role="tablist" className="flex flex-wrap gap-1 border-b">
          {visibleTabs.map((t) => {
            const active = tab === t.key;
            const chip =
              t.key === "assistant" && assistantConfig.enabled ? flaggedCount : 0;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {t.label}
                {chip > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white tabular-nums">
                    {formatNumber(chip)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ===== TAB 1: TỔNG QUAN CHIẾN DỊCH ===== */}
        {tab === "overview" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Chi phí Ads"
                value={<Money value={overview.spend} />}
                icon={Wallet}
                tone="negative"
                colorValue
                subtitle="14 ngày gần nhất"
              />
              <StatCard
                label="Doanh thu từ Ads"
                value={<Money value={overview.revenue} />}
                icon={TrendingUp}
                tone="positive"
                colorValue
                subtitle="Quy cho quảng cáo"
              />
              <StatCard
                label="Lượt click"
                value={formatNumber(overview.clicks)}
                icon={MousePointerClick}
                tone="info"
                subtitle="Tổng lượt nhấp vào quảng cáo"
              />
              <StatCard
                label="CTR"
                value={`${overview.ctr.toLocaleString("vi-VN")}%`}
                icon={Percent}
                tone="neutral"
                subtitle="Tỷ lệ nhấp / hiển thị"
              />
              <StatCard
                label="ROAS"
                value={`${overview.roas.toLocaleString("vi-VN")}x`}
                icon={Target}
                tone="accent"
                subtitle="Doanh thu trên 1đ chi phí"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Chiến dịch đang chạy</CardTitle>
                <CardDescription>
                  {isTiktok
                    ? "Bấm vào một chiến dịch để mở Phân tích kế hoạch quảng cáo 3 tầng (Chiến dịch → Sản phẩm → Video)."
                    : "Xếp theo ROAS — trợ lý sẽ tự đề xuất tăng/giảm ngân sách khi nối API thật."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {[...campaigns]
                    .sort((a, b) => b.roas - a.roas)
                    .map((c) => (
                      <div
                        key={c.id}
                        // TikTok: cả dòng là nút mở modal phân tích 3 tầng
                        role={isTiktok ? "button" : undefined}
                        tabIndex={isTiktok ? 0 : undefined}
                        onClick={
                          isTiktok ? () => setDetailCampaignId(c.id) : undefined
                        }
                        onKeyDown={
                          isTiktok
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setDetailCampaignId(c.id);
                                }
                              }
                            : undefined
                        }
                        className={cn(
                          "flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0",
                          isTiktok &&
                            "-mx-2 cursor-pointer rounded-lg px-2 transition-colors hover:bg-muted/60"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                            <Megaphone className="size-4.5" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">
                              {c.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              Đã chi <Money value={c.spend} className="text-slate-700" />
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              TEXT_NUMBER_STRONG,
                              moneyTone(c.roas >= 2 ? 1 : -1)
                            )}
                          >
                            ROAS {c.roas.toLocaleString("vi-VN")}x
                          </span>
                          <Badge variant={c.enabled ? "default" : "outline"}>
                            {c.enabled ? "Đang chạy" : "Tạm dừng"}
                          </Badge>
                          {isTiktok && (
                            <ChevronRight className="size-4 shrink-0 text-slate-400" />
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===== TAB 2: QUẢN LÝ NGÂN SÁCH ===== */}
        {tab === "budget" && (
          <Card>
            <CardHeader>
              <CardTitle>Ngân sách theo chiến dịch</CardTitle>
              <CardDescription>
                Bật/tắt chiến dịch và đặt ngân sách ngày. Thao tác trong bản xem
                trước không được lưu.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader className={TABLE_HEAD_EMPHASIS}>
                  <TableRow>
                    <TableHead>Chiến dịch</TableHead>
                    <TableHead className="w-32">Trạng thái</TableHead>
                    <TableHead className="w-48">Ngân sách ngày</TableHead>
                    <TableHead className="w-36 text-right">Đã chi</TableHead>
                    <TableHead className="w-28 text-right">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium text-slate-900">
                        {c.name}
                      </TableCell>
                      <TableCell>
                        <label className="flex items-center gap-2">
                          <Switch
                            checked={c.enabled}
                            onCheckedChange={(checked) =>
                              toggleCampaign(c.id, checked)
                            }
                            aria-label={`Bật/tắt chiến dịch ${c.name}`}
                          />
                          <span className="text-xs text-slate-500">
                            {c.enabled ? "Bật" : "Tắt"}
                          </span>
                        </label>
                      </TableCell>
                      <TableCell>
                        <div className="relative">
                          <Input
                            inputMode="numeric"
                            value={formatNumber(c.dailyBudget)}
                            onChange={(e) => changeBudget(c.id, e.target.value)}
                            disabled={!c.enabled}
                            className="pr-8 text-right tabular-nums"
                            aria-label={`Ngân sách ngày của ${c.name}`}
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                            ₫
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={c.spend} className="text-slate-700" />
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right",
                          TEXT_NUMBER_STRONG,
                          moneyTone(c.roas >= 2 ? 1 : -1)
                        )}
                      >
                        {c.roas.toLocaleString("vi-VN")}x
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* ===== TAB 3: BÁO CÁO HIỆU QUẢ ===== */}
        {tab === "report" && (
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Chi phí vs Doanh thu từ Ads (14 ngày)</CardTitle>
                <CardDescription>
                  Số liệu mẫu — khi nối API sẽ lấy report thật theo từng chiến
                  dịch của {preset.displayName}.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={series}>
                      <defs>
                        <linearGradient id="gradAdsRevenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="gradAdsSpend" x1="0" y1="0" x2="0" y2="1">
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
                          name === "revenue" ? "Doanh thu từ Ads" : "Chi phí Ads",
                        ]}
                      />
                      <Legend
                        formatter={(value) =>
                          value === "revenue" ? "Doanh thu từ Ads" : "Chi phí Ads"
                        }
                      />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#gradAdsRevenue)"
                      />
                      <Area
                        type="monotone"
                        dataKey="spend"
                        stroke="#f87171"
                        strokeWidth={2}
                        fill="url(#gradAdsSpend)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Hiệu quả theo chiến dịch</CardTitle>
                <CardDescription>
                  Bảng đối chiếu chi phí – doanh thu – ROAS của từng chiến dịch
                  trong kỳ.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader className={TABLE_HEAD_EMPHASIS}>
                    <TableRow>
                      <TableHead>Chiến dịch</TableHead>
                      <TableHead className="text-right">Chi phí</TableHead>
                      <TableHead className="text-right">Doanh thu ước tính</TableHead>
                      <TableHead className="w-28 text-right">ROAS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium text-slate-900">
                          {c.name}
                        </TableCell>
                        <TableCell className="text-right">
                          <Money value={c.spend} className="text-slate-700" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Money
                            value={Math.round((c.spend * c.roas) / 1000) * 1000}
                            className="text-slate-900"
                          />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right",
                            TEXT_NUMBER_STRONG,
                            moneyTone(c.roas >= 2 ? 1 : -1)
                          )}
                        >
                          {c.roas.toLocaleString("vi-VN")}x
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ===== TAB 4 (chỉ TikTok): CẤU HÌNH TRỢ LÝ TỰ ĐỘNG ===== */}
        {tab === "assistant" && isTiktok && (
          <TiktokAssistantConfigTab
            config={assistantConfig}
            onChange={setAssistantConfig}
            summary={assistantSummary}
            customCampaignNames={campaigns
              .filter((c) => Boolean(ruleOverrides[c.id]))
              .map((c) => c.name)}
          />
        )}

        {/* ===== MODAL PHÂN TÍCH KẾ HOẠCH QUẢNG CÁO 3 TẦNG (chỉ TikTok) ===== */}
        {isTiktok && (
          <TiktokCampaignModal
            open={detailCampaignId !== null}
            campaignName={
              campaigns.find((c) => c.id === detailCampaignId)?.name ?? ""
            }
            detail={detailCampaignId ? findCampaignDetail(detailCampaignId) : null}
            config={assistantConfig}
            override={
              detailCampaignId ? (ruleOverrides[detailCampaignId] ?? null) : null
            }
            onOverrideChange={(rules) => {
              if (detailCampaignId) changeOverride(detailCampaignId, rules);
            }}
            decisions={decisions}
            onDecide={decideVideo}
            onBulkExclude={bulkExclude}
            onClose={() => setDetailCampaignId(null)}
          />
        )}

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Ads · Trợ lý quảng cáo {preset.displayName} (Preview)
        </p>
      </div>
    </AppShell>
  );
}
