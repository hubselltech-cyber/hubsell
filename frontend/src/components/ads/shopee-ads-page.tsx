"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

import type { ColumnDef } from "@tanstack/react-table";

import { AccessDenied } from "@/components/shared/access-denied";
import { AdsRecommendTab } from "@/components/ads/ads-recommend-tab";
import { HubsellAdsLink } from "@/components/ads/hubsell-ads-link";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { AppShell } from "@/components/shell/app-shell";
import { DataTable } from "@/components/data-table/data-table";
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
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeaderBand, PageTabs } from "@/components/ui/page-tabs";
import { Switch } from "@/components/ui/switch";
import {
  decideShopeeAdsCampaign,
  fetchAdsAssistantScorecard,
  fetchShopeeAdsDashboard,
  fetchShopeeProductBreakeven,
  getStoredUser,
  getToken,
  saveShopeeAssistantConfig,
  requestAdsRefresh,
  restoreShopeeAdsBudget,
  pauseShopeeAdsCampaign,
  resumeShopeeAdsCampaign,
  setShopeeAdsRoasTarget,
  type AdsAssistantScorecard,
  type ShopeeAdsCampaignRow,
  type ShopeeAdsDashboard,
  type ShopeeAssistantConfig,
  type ShopeeAssistantDecision,
  type ShopeeProductBreakevenResponse,
  type ShopeeProductBreakevenRow,
} from "@/lib/api";
import {
  RANGE_PRESETS,
  formatDayVN,
  formatRangePhrase,
  rangeDayCount,
  type DateRange,
} from "@/lib/date-range";
import {
  AssistantVerdictBadge,
  ShopeeActionLogCard,
  ShopeeAssistantConfigCard,
  ShopeeAssistantModal,
  assistantBannerText,
} from "@/components/ads/shopee-assistant-panel";
import { ShopeeGmsPanel, formatRoas, roasToneClass } from "@/components/ads/shopee-gms-panel";
import { formatNumber, formatVND } from "@/lib/format";
import { can } from "@/lib/permissions";
import { TEXT_NUMBER_STRONG, moneyTone } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TRỢ LÝ QUẢNG CÁO — DASHBOARD DỮ LIỆU THẬT (READ-ONLY) + RULE ENGINE
 *
 * 12/08/2026: trang DÙNG CHUNG cho Shopee lẫn Lazada qua prop `platform`
 * (backend /api/quang-cao/{shopee|lazada} trả payload y hệt — bảng AdsCampaign trung
 * lập sàn). Tên file/component giữ "Shopee" vì Shopee đặt nền và để không xáo
 * import đang chạy production; PLATFORM_META gom mọi khác biệt nhãn/quyền.
 * Khác biệt chức năng giữa hai sàn (17/09/2026): Shopee có SỐ DƯ ví ads, Lazada chỉ có
 * cờ hết tiền; chỉ Shopee có nút Kết nối Hubsell Ads, tab "Gợi ý chạy ads" (đợt D) và nút
 * "Nâng mục tiêu ROAS" (đợt A). Tự thực thi + Sổ hành động dùng chung hai sàn.
 *
 * Khác Seller Center một điểm ăn tiền: mỗi chiến dịch có thêm ROAS HÒA VỐN
 * tính từ P&L thật của chính SKU trong chiến dịch (giá vốn + phí sàn đã đối
 * soát) — ROAS sàn báo dương nhưng dưới ngưỡng này vẫn là đốt tiền.
 *
 * Chỉ ADMIN (chi phí Ads là dữ liệu tài chính). TikTok vẫn dùng khung mock
 * ads-assistant-page cho tới khi nối API thật.
 */

/** Mọi khác biệt giữa hai sàn gom một chỗ — thêm sàn mới chỉ thêm một dòng. */
const PLATFORM_META: Record<
  "shopee" | "lazada",
  {
    label: string;
    perm: "ads.shopee" | "ads.lazada";
    description: string;
    /** Tooltip cột Đơn — định nghĩa rổ broad của từng sàn. */
    broadHint: string;
    /** Nhãn đếm đơn làm mẫu biên lãi — Lazada chỉ tính đơn ĐÃ đối soát. */
    marginOrdersLabel: string;
    /** Câu chốt nguồn biên lãi, nối vào tooltip hòa vốn — mỗi sàn một nguồn phí. */
    marginBasisHint: string;
    /** Huy hiệu nhận diện sàn cạnh tiêu đề — CÙNG bảng màu SOURCE_META của
     *  Trung tâm điều hành (Shopee cam / Lazada chàm / TikTok đen) để seller
     *  liếc màu là biết đang thao tác cho sàn nào (góp ý anh Trung 12/08). */
    badgeClass: string;
    /** Ghi chú nguồn "tổng chi ads toàn shop" (bảng AdSpend) — Shopee lấy số
     *  cấp shop từ sàn, Lazada cộng từ chiến dịch (không có API cấp shop). */
    adSpendLabel: string;
  }
> = {
  shopee: {
    label: "Shopee",
    perm: "ads.shopee",
    description:
      "Dữ liệu thật từ Shopee Ads API — kèm ROAS hòa vốn tính từ lãi/lỗ thực tế của shop.",
    broadHint:
      "Đơn broad: mọi đơn của shop trong 7 ngày sau khi khách bấm quảng cáo (định nghĩa Shopee).",
    marginOrdersLabel: "đơn P&L",
    marginBasisHint:
      "Biên lãi tính cả đơn chờ đối soát — phí trên các đơn này đã là số ước tính của chính Shopee.",
    badgeClass: "border-orange-200 bg-orange-50 text-orange-600",
    adSpendLabel: "Tổng chi ads toàn shop (số cấp shop từ Shopee, gồm cả ads ngoài campaign sản phẩm)",
  },
  lazada: {
    label: "Lazada",
    perm: "ads.lazada",
    description:
      "Dữ liệu thật từ Lazada Sponsored Solutions API — kèm ROAS hòa vốn tính từ lãi/lỗ đã đối soát của shop.",
    broadHint:
      "Đơn store: mọi đơn của gian trong 30 ngày sau khi khách bấm quảng cáo, tính về ngày bấm (định nghĩa Lazada) — số các ngày gần nhất còn tiếp tục tăng.",
    marginOrdersLabel: "đơn đã đối soát",
    marginBasisHint:
      "Biên lãi CHỈ tính các đơn Lazada ĐÃ đối soát (có sao kê phí thật) — đơn chưa đối soát bị loại vì sàn chưa báo phí, tính vào sẽ làm hòa vốn thấp giả tạo.",
    badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-600",
    adSpendLabel:
      "Tổng chi ads toàn gian đưa vào Báo cáo dòng tiền (cộng từ chiến dịch Sponsored Solutions; gian trả tiền ads bằng cách trừ vào doanh thu thì phí đã nằm trong sao kê từng đơn, không cộng lần hai)",
  },
};

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
  // Lazada: productType J = Sponsored Product (N = Sponsored Search → "search").
  product: "Sản phẩm",
};

function defaultAdsRange(): DateRange {
  return RANGE_PRESETS.find((p) => p.key === "last7")!.resolve();
}

export function ShopeeAdsPage({
  platform = "shopee",
}: {
  platform?: "shopee" | "lazada";
} = {}) {
  const meta = PLATFORM_META[platform];
  const router = useRouter();
  // Deep-link từ Trung tâm điều hành: ?channelId= chọn gian, ?campaign_id=
  // prefill ô tìm kiếm + tự mở modal chi tiết, ?needs_action=1 bật lọc cần xử lý.
  // (Trang này được bọc <Suspense> ở app/ads/shopee/page.tsx theo yêu cầu của
  // useSearchParams khi prerender.)
  const searchParams = useSearchParams();
  const [denied, setDenied] = useState(false);
  const [data, setData] = useState<ShopeeAdsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string>(
    () => searchParams.get("channelId") ?? ""
  );
  const [range, setRange] = useState<DateRange>(defaultAdsRange);
  // Campaign đích của deep-link — chờ dữ liệu về rồi mở modal đúng một lần.
  const [pendingCampaignId, setPendingCampaignId] = useState<string | null>(
    () => searchParams.get("campaign_id")
  );
  // Tab trong trang (khuôn giống trang TikTok): dashboard / bảng hòa vốn SP /
  // cấu hình Trợ lý.
  const [tab, setTab] = useState<"overview" | "recommend" | "breakeven" | "gms" | "config">("overview");
  // Bảng ROAS hòa vốn theo SP — nạp lười khi mở tab, cache theo gian đang chọn.
  const [breakeven, setBreakeven] = useState<{
    channelId: string;
    data: ShopeeProductBreakevenResponse;
  } | null>(null);
  const [breakevenLoading, setBreakevenLoading] = useState(false);
  const [breakevenError, setBreakevenError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  // Phân trang bảng chiến dịch — shop thật có hàng trăm campaign (DarkMan: 142).
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  // ----- Trợ lý (GĐ2): modal chi tiết + lọc cần-xử-lý + lưu cấu hình -----
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  // Bảng điểm Trợ lý (bước 6, 14/09): máy phán đúng/sai trên số của chính gian —
  // nạp riêng, không chặn dashboard; nạp lại khi số ads đổi mốc.
  const [scorecard, setScorecard] = useState<AdsAssistantScorecard | null>(null);
  const adsSyncedAtKey = data?.adsSyncedAt ?? null;
  useEffect(() => {
    if (!channelId) {
      setScorecard(null);
      return;
    }
    let alive = true;
    fetchAdsAssistantScorecard(channelId, range, platform)
      .then((s) => {
        if (alive) setScorecard(s);
      })
      .catch(() => {
        if (alive) setScorecard(null);
      });
    return () => {
      alive = false;
    };
  }, [channelId, range, platform, adsSyncedAtKey]);
  const [savingConfig, setSavingConfig] = useState(false);
  const [onlyNeedsAction, setOnlyNeedsAction] = useState(
    () => searchParams.get("needs_action") === "1"
  );
  // Bộ lọc bảng: tìm theo tên/mã campaign + lọc trạng thái (client-side).
  // campaign_id từ deep-link prefill luôn ô tìm kiếm → bảng chỉ còn campaign đó.
  const [search, setSearch] = useState(() => searchParams.get("campaign_id") ?? "");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!can(getStoredUser(), meta.perm)) setDenied(true);
  }, [router, meta.perm]);

  const load = useCallback(async (cid: string, r: DateRange, opts?: { silent?: boolean }) => {
    // silent: nạp lại nền sau khi worker kéo tươi — không nháy spinner, không xóa bảng đang xem.
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetchShopeeAdsDashboard({
        channelId: cid || undefined,
        range: r,
        platform,
      });
      setData(res);
      if (res.selectedChannelId) setChannelId(res.selectedChannelId);
    } catch (err) {
      if (!opts?.silent) setError((err as Error).message);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    void load(channelId, range);
    // channelId đổi qua chính load() (server chọn gian đầu) — chỉ nghe người dùng đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Số ads cũ >30' → backend đã nudge worker kéo tươi (12/09); nạp lại nền
  // sau 45s để bảng tự cập nhật mà seller không phải F5. Dừng khi số đã tươi.
  useEffect(() => {
    if (!data?.adsRefreshing) return;
    const t = setTimeout(() => void load(channelId, range, { silent: true }), 45_000);
    return () => clearTimeout(t);
  }, [data?.adsRefreshing, channelId, range, load]);

  // Nạp bảng hòa vốn SP khi mở tab (hoặc đổi gian trong lúc đang ở tab).
  useEffect(() => {
    if (tab !== "breakeven" || !channelId) return;
    if (breakeven?.channelId === channelId) return;
    let cancelled = false;
    setBreakevenLoading(true);
    setBreakevenError(null);
    fetchShopeeProductBreakeven(channelId, platform)
      .then((res) => {
        if (!cancelled) setBreakeven({ channelId, data: res });
      })
      .catch((err) => {
        if (!cancelled) setBreakevenError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setBreakevenLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, channelId, breakeven, platform]);

  // Deep-link ?campaign_id=: dữ liệu về thì mở modal chi tiết đúng một lần.
  // Không thấy campaign (đã xoá / thuộc gian khác / chưa sync) → báo nhẹ ở
  // syncNote thay vì để người dùng đối diện bảng trống không lời giải thích.
  useEffect(() => {
    if (!pendingCampaignId || !data) return;
    const target = data.campaigns.find((c) => c.campaignId === pendingCampaignId);
    if (target) {
      setDetailId(target.id);
    } else {
      setSyncNote(
        `Không tìm thấy chiến dịch #${pendingCampaignId} trong gian này — có thể đã bị xoá hoặc thuộc gian khác. Xoá ô tìm kiếm để xem toàn bộ.`
      );
    }
    setPendingCampaignId(null);
  }, [pendingCampaignId, data]);

  function changeChannel(cid: string) {
    setChannelId(cid);
    setPage(0); // đổi gian là bộ campaign khác — về trang đầu
    void load(cid, range);
  }

  function changeRange(r: DateRange) {
    setRange(r);
    setPage(0);
    void load(channelId, r);
  }

  // LÀM MỚI (12/09): không gọi sàn trong request — backend kéo hạn ads của gian
  // về ngay, worker chạy đủ chi phí + campaign + Trợ lý. Trang poll nền mỗi 8s
  // tới khi mốc adsSyncedAt đổi (tối đa ~3 phút) rồi báo "Đã cập nhật".
  const REFRESH_POLL_MS = 8_000;
  const REFRESH_POLL_MAX = 22;
  async function runSync() {
    if (!channelId || syncing) return;
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await requestAdsRefresh(channelId, platform);
      if (!res.queued) {
        setSyncNote(res.message);
        await load(channelId, range, { silent: true });
        return;
      }
      setSyncNote("Đang kéo số mới từ sàn, bảng sẽ tự cập nhật trong khoảng một phút…");
      const before = res.adsSyncedAt;
      for (let i = 0; i < REFRESH_POLL_MAX; i++) {
        await new Promise((r) => setTimeout(r, REFRESH_POLL_MS));
        const fresh = await fetchShopeeAdsDashboard({ channelId, range, platform });
        if (fresh.adsSyncedAt && fresh.adsSyncedAt !== before) {
          setData(fresh);
          setSyncNote(`Đã cập nhật số quảng cáo lúc ${formatSyncTime(fresh.adsSyncedAt)}.`);
          return;
        }
      }
      setSyncNote("Sàn phản hồi chậm — số sẽ tự cập nhật khi worker kéo xong, anh/chị có thể mở lại trang sau ít phút.");
    } catch (err) {
      setSyncNote(`Làm mới lỗi: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  function formatSyncTime(iso: string): string {
    const d = new Date(iso);
    const sameDay = d.toDateString() === new Date().toDateString();
    const hm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    return sameDay ? hm : `${hm} ${d.toLocaleDateString("vi-VN")}`;
  }

  const summary = data?.summary ?? null;
  // Hubsell Ads (app Ads riêng) đã bật mà gian chưa nối → chưa gọi được Ads
  // API: khoá nút Làm mới, khối HubsellAdsLink bên dưới mời kết nối.
  const adsApp = data?.adsApp ?? null;
  const adsLinked = !adsApp?.required || adsApp.status === "ACTIVE";
  const selectedShopName =
    data?.channels.find((c) => c.id === channelId)?.shopName ?? "";
  const wallet = data?.wallet ?? null;

  // Cảnh báo ví ads sắp cạn: dưới 2 ngày chi tiêu trung bình của kỳ đang xem.
  const walletLow = useMemo(() => {
    if (!wallet || !summary || summary.spend <= 0) return false;
    const avgDaily = summary.spend / rangeDayCount(range);
    return wallet.balance < avgDaily * 2;
  }, [wallet, summary, range]);

  // Cụm từ khoảng ngày cho tiêu đề/câu chữ: "7 ngày qua" | "tháng này" |
  // "ngày 12/09/2026" | "từ … đến …"; rangeIn = bản ghép sau động từ ("trong 7 ngày qua").
  const rangePhrase = formatRangePhrase(range);
  const rangeIn = /^(từ|ngày) /.test(rangePhrase) ? rangePhrase : `trong ${rangePhrase}`;

  // GMS = GMV Max cấp shop: tab riêng, toàn bộ UI + nạp từng SP nằm trong ShopeeGmsPanel (25/09).
  const gms = data?.gms ?? null;

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
  // Cả kỳ không có đồng chi phí/GMV nào → nói thẳng thay vì vẽ trục "4 ₫, 3 ₫…".
  const seriesEmpty = series.length > 0 && series.every((p) => !p.spend && !p.broadGmv);

  async function decideCampaign(decision: ShopeeAssistantDecision) {
    const campaign = data?.campaigns.find((c) => c.id === detailId);
    if (!campaign || deciding) return;
    setDeciding(true);
    try {
      await decideShopeeAdsCampaign(
        campaign.id,
        decision,
        campaign.assistant.verdict ?? "",
        platform
      );
      setDetailId(null);
      await load(channelId, range);
    } catch (err) {
      setSyncNote(`Ghi nhận quyết định lỗi: ${(err as Error).message}`);
    } finally {
      setDeciding(false);
    }
  }

  /** Đợt A: nâng mục tiêu ROAS của campaign đang mở modal — lệnh thật lên sàn. */
  async function setRoasTarget(target: number) {
    const campaign = data?.campaigns.find((c) => c.id === detailId);
    if (!campaign || deciding) return;
    setDeciding(true);
    try {
      const r = await setShopeeAdsRoasTarget(campaign.id, target, platform);
      setDetailId(null);
      setSyncNote(`${r.message} — chiến dịch "${campaign.name}".`);
      await load(channelId, range);
    } catch (err) {
      setSyncNote(`Đổi mục tiêu ROAS lỗi: ${(err as Error).message}`);
    } finally {
      setDeciding(false);
    }
  }

  /** 25/09: chủ shop TẠM DỪNG campaign đang chạy ngay trong Hubsell — modal đã hỏi xác nhận, lệnh thật lên sàn. */
  async function pauseCampaign() {
    const campaign = data?.campaigns.find((c) => c.id === detailId);
    if (!campaign || deciding) return;
    setDeciding(true);
    try {
      await pauseShopeeAdsCampaign(campaign.id, platform);
      setDetailId(null);
      setSyncNote(`Đã tạm dừng chiến dịch "${campaign.name}" trên ${meta.label}.`);
      await load(channelId, range);
    } catch (err) {
      setSyncNote(`Tạm dừng lỗi: ${(err as Error).message}`);
    } finally {
      setDeciding(false);
    }
  }

  /** Bật lại NGAY campaign đã tạm dừng (Trợ lý hoặc người dừng) — lệnh thật lên sàn (sự cố 14/09). */
  async function resumeCampaign() {
    const campaign = data?.campaigns.find((c) => c.id === detailId);
    if (!campaign || deciding) return;
    setDeciding(true);
    try {
      await resumeShopeeAdsCampaign(campaign.id, platform);
      setDetailId(null);
      setSyncNote(`Đã bật lại chiến dịch "${campaign.name}" trên ${meta.label}.`);
      await load(channelId, range);
    } catch (err) {
      setSyncNote(`Bật lại lỗi: ${(err as Error).message}`);
    } finally {
      setDeciding(false);
    }
  }

  // Đợt B: trả lại ngân sách gốc cho campaign Trợ lý đã hạ (lệnh thật, chỉ Shopee).
  async function restoreBudget() {
    const campaign = data?.campaigns.find((c) => c.id === detailId);
    if (!campaign || deciding) return;
    setDeciding(true);
    try {
      const r = await restoreShopeeAdsBudget(campaign.id, platform);
      setDetailId(null);
      setSyncNote(
        `Đã trả lại ngân sách chiến dịch "${campaign.name}" về ${r.budget != null && r.budget > 0 ? formatVND(r.budget) : "không giới hạn"}.`
      );
      await load(channelId, range);
    } catch (err) {
      setSyncNote(`Trả lại ngân sách lỗi: ${(err as Error).message}`);
    } finally {
      setDeciding(false);
    }
  }

  async function saveConfig(config: ShopeeAssistantConfig) {
    if (!channelId || savingConfig) return;
    setSavingConfig(true);
    try {
      await saveShopeeAssistantConfig(channelId, config, platform);
      await load(channelId, range);
    } catch (err) {
      setSyncNote(`Lưu cấu hình lỗi: ${(err as Error).message}`);
    } finally {
      setSavingConfig(false);
    }
  }

  // Cột bảng chiến dịch — build theo sàn (tooltip khác nhau), không đổi runtime.
  // Phải đứng TRƯỚC early-return denied (rules-of-hooks).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- meta suy ra từ platform, prop cố định của trang
  const campaignColumns = useMemo(() => buildCampaignColumns(meta), [platform]);

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  const campaigns = data?.campaigns ?? [];
  const noChannel = !loading && (data?.channels.length ?? 0) === 0;

  // Chuỗi lọc: trạng thái → tìm kiếm → "chỉ cần xử lý". Áp trước phân trang.
  const searchLower = search.trim().toLowerCase();
  const visibleCampaigns = campaigns.filter((c) => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (
      searchLower &&
      !c.name.toLowerCase().includes(searchLower) &&
      !c.campaignId.includes(searchLower)
    )
      return false;
    if (onlyNeedsAction) {
      return (
        !c.assistant.decisionActive &&
        (c.assistant.verdict === "spike" ||
          c.assistant.verdict === "pause_now" ||
          c.assistant.verdict === "review" ||
          c.assistant.verdict === "grace")
      );
    }
    return true;
  });

  // Phân trang client-side: API trả trọn bộ (đã sort trạng thái Đang chạy →
  // Tạm dừng → Đã kết thúc, trong cùng trạng thái theo chi tiêu giảm dần),
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
        {/* ===== DẢI ĐẦU TRANG: thanh điều khiển + ghi chú / lỗi + hàng tab ===== */}
        <PageHeaderBand className="space-y-3">
          {/* ===== THANH ĐIỀU KHIỂN: chọn gian + cửa sổ + đồng bộ ===== */}
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                Trợ lý quảng cáo {meta.label}
                <span
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
                    meta.badgeClass
                  )}
                  title={`Đang thao tác trên sàn ${meta.label}`}
                >
                  {meta.label}
                </span>
              </h1>
              <p className="text-sm text-muted-foreground">{meta.description}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {/* Luôn hiện ô chọn gian (kể cả tài khoản một gian) — seller phải thấy mình đang
                  xem gian nào; mọi tab bên dưới, gồm Gợi ý chạy ads, ăn theo ô này (anh Trung 17/09). */}
              {(data?.channels.length ?? 0) >= 1 && (
                <NativeSelect
                  value={channelId}
                  onChange={(e) => changeChannel(e.target.value)}
                  aria-label={`Chọn gian hàng ${meta.label}`}
                  className="w-52"
                >
                  {data?.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shopName}
                    </option>
                  ))}
                </NativeSelect>
              )}
              {/* Bộ lọc khoảng ngày chuẩn của app (Hôm nay / Hôm qua / 7 / 30 ngày /
                  Tháng này / Tháng trước + lịch chọn tay) — cùng khuôn TikTok Ads
                  và các trang báo cáo (anh Trung 24/09: 4 nút cũ "cơ bản quá"). */}
              <DateRangePicker value={range} onChange={changeRange} />
              {/* Hubsell Ads (app Ads riêng): MỘT nút cho gian đang chọn — chỉ hiện
                  khi backend đã bật; đã nối thì thành dòng mờ (anh Trung 17/09). */}
              {platform === "shopee" && channelId && (
                <HubsellAdsLink
                  channelId={channelId}
                  shopName={selectedShopName}
                  status={adsApp}
                  adsSyncedAt={data?.adsSyncedAt ?? null}
                  onChanged={() => void load(channelId, range)}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runSync()}
                disabled={syncing || !channelId || !adsLinked}
                title={adsLinked ? "Kéo số chi phí + chiến dịch mới nhất từ sàn" : "Kết nối Hubsell Ads trước khi làm mới"}
              >
                <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                {syncing ? "Đang làm mới…" : "Làm mới"}
              </Button>
            </div>
          </div>

          {syncNote && (
            <p className="text-sm text-muted-foreground">{syncNote}</p>
          )}
          {/* Nói thật về giới hạn số: chọn xa hơn ngày gian bắt đầu kéo số hoặc
              dài hơn trần backend thì bảng thiếu số — ghi rõ thay vì để trống im lặng. */}
          {data && !loading && (data.rangeClamped || (data.perfSince && data.from < data.perfSince)) && (
            <p className="text-sm text-amber-700">
              {data.rangeClamped &&
                `Chỉ xem được tối đa ${data.rangeMaxDays} ngày một lần — đang hiện từ ${formatDayVN(new Date(`${data.from}T00:00:00`))}. `}
              {data.perfSince && data.from < data.perfSince &&
                `Hubsell chỉ có số quảng cáo của gian này từ ${formatDayVN(new Date(`${data.perfSince}T00:00:00`))} (ngày bắt đầu kéo số); trước đó chưa có số.`}
            </p>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ===== TABLIST (khuôn giống trang TikTok) ===== */}
          <PageTabs
            ariaLabel={`Khu vực quảng cáo ${meta.label}`}
            className="border-b-0"
            tabs={
              [
                { key: "overview", label: "Tổng quan chiến dịch" },
                // Đợt D (17/09): gợi ý SP nên chạy ads + tạo chiến dịch một nút — chỉ Shopee.
                ...(platform === "shopee"
                  ? ([{ key: "recommend", label: "Gợi ý chạy ads" }] as const)
                  : []),
                { key: "breakeven", label: "ROAS hòa vốn sản phẩm" },
                // GMS (24/09): tab riêng, chỉ khi gian đang chạy GMV Max cấp shop — không chen vào Tổng quan.
                // Tab luôn có với gian Shopee đã nối Ads (anh Trung 24/09 "chưa thấy GMS ở đâu") — nội dung
                // nói rõ trạng thái: đang chạy / đủ điều kiện chưa chạy / không đủ điều kiện / chưa hỏi sàn.
                ...(platform === "shopee" && adsLinked && channelId
                  ? ([{ key: "gms", label: "GMV Max cấp shop" }] as const)
                  : []),
                {
                  key: "config",
                  label: "Cấu hình Trợ lý Tự động",
                  count: assistant?.needsAction ?? 0,
                  countTone: "attention",
                },
              ] as const
            }
            value={tab}
            onChange={setTab}
            // Mốc số ads dời từ thanh công cụ xuống mép phải hàng tab (anh Trung
            // 17/09: thanh công cụ chật, dòng này chỉ là thông tin phụ).
            trailing={
              data?.adsSyncedAt && (
                <span
                  className="text-xs text-muted-foreground tabular-nums"
                  title="Lần kéo số quảng cáo từ sàn gần nhất"
                >
                  Cập nhật lúc {formatSyncTime(data.adsSyncedAt)}
                </span>
              )
            }
          />
        </PageHeaderBand>

        {tab === "overview" && (
          <>
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
        {/* ===== ĐỢT A: campaign ĐANG CHẠY đặt mục tiêu ROAS dưới hòa vốn ===== */}
        {(assistant?.targetBelowCount ?? 0) > 0 && (
          <div className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
            <Target className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {formatNumber(assistant?.targetBelowCount ?? 0)} chiến dịch đang đặt mục tiêu ROAS
                thấp hơn hòa vốn
              </p>
              <p className="mt-0.5 text-amber-700">
                {meta.label} sẽ tối ưu về đúng mức mục tiêu — đạt mục tiêu vẫn lỗ. Xem
                cột Mục tiêu (đỏ), bấm vào dòng để nâng lên mức an toàn ngay tại đây.
              </p>
            </div>
          </div>
        )}
        {/* ===== ĐỢT E: campaign ĐANG LÃI nhưng bị ngân sách chặn / mục tiêu bó — có thể thêm đơn ===== */}
        {(assistant?.deliveryCount ?? 0) > 0 && (
          <div className="flex flex-wrap items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3.5 text-sm text-sky-900">
            <TrendingUp className="mt-0.5 size-5 shrink-0 text-sky-600" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {formatNumber(assistant?.deliveryCount ?? 0)} chiến dịch đang lãi nhưng bị chặn phân
                phối — có thể thêm đơn
              </p>
              <p className="mt-0.5 text-sky-800">
                Ngân sách ngày tiêu gần hết, hoặc mục tiêu ROAS đặt cao hơn mức đang đạt. Xem nhãn xanh
                ở cột Trợ lý, bấm vào dòng để đọc căn cứ và mức nên đặt; sửa trên Seller Center.
              </p>
            </div>
          </div>
        )}
        {walletLow && wallet && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
            <Wallet className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <p>
              Ví quảng cáo chỉ còn <b>{formatVND(wallet.balance)}</b> — thấp hơn
              2 ngày chi tiêu trung bình.{" "}
              {wallet.autoTopUp === true
                ? `Gian đang bật tự nạp trên ${meta.label} nên sàn sẽ tự bù — chỉ cần chắc nguồn tiền nạp còn đủ.`
                : wallet.autoTopUp === false
                  ? `Gian KHÔNG bật tự nạp — hết ví là quảng cáo ngừng hiển thị. Nạp thêm hoặc bật tự nạp trên ${meta.label}.`
                  : "Nạp thêm để chiến dịch không bị dừng giữa chừng."}
            </p>
          </div>
        )}
        {/* Lazada không có API số dư — sàn chỉ báo cờ HẾT TIỀN trên campaign
            đang bật (xung 60' ghi DB). Cùng sự kiện với thẻ "ví cạn" ở Trung
            tâm điều hành, hiện tại chỗ seller đang nhìn. */}
        {data?.walletEmpty && (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
            <Wallet className="mt-0.5 size-5 shrink-0 text-red-500" />
            <p>
              <b>Ví {meta.label} Ads đã hết số dư</b> — các chiến dịch đang bật
              không thể hiển thị cho tới khi nạp thêm tiền vào ví Ads trên
              Seller Center. Nạp xong, bấm Làm mới để Hubsell kiểm tra lại.
            </p>
          </div>
        )}

        {/* ===== THẺ TỔNG QUAN ===== */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <StatCard
            label="Chi phí Ads"
            value={<Money value={summary?.spend ?? 0} />}
            icon={Wallet}
            tone="negative"
            colorValue
            subtitle={`${rangePhrase} · campaign sản phẩm`}
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
            subtitle="GMV từ Ads × biên lãi − chi phí"
          />
        </div>

        {/* ===== BIỂU ĐỒ CHI PHÍ vs GMV ===== */}
        {series.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Chi phí vs GMV từ Ads ({rangePhrase})</CardTitle>
              <CardDescription>
                Số thật theo ngày, gộp mọi chiến dịch của gian đang chọn.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {seriesEmpty ? (
                <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                  Chưa có chi tiêu quảng cáo {rangeIn} — bật chiến
                  dịch trên Shopee rồi bấm Làm mới để xem biểu đồ.
                </div>
              ) : (
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
              )}
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
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Tìm tên / mã chiến dịch…"
                  className="w-52"
                  aria-label="Tìm chiến dịch"
                />
                <NativeSelect
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(0);
                  }}
                  aria-label="Lọc trạng thái chiến dịch"
                  className="w-40"
                >
                  <option value="">Mọi trạng thái</option>
                  <option value="ongoing">Đang chạy</option>
                  <option value="scheduled">Hẹn giờ</option>
                  <option value="paused">Tạm dừng</option>
                  <option value="ended">Đã kết thúc</option>
                  <option value="closed">Đã đóng</option>
                  <option value="deleted">Đã xóa</option>
                </NativeSelect>
                <label className="flex items-center gap-2 text-sm text-slate-600">
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
            </div>
          </CardHeader>
          <CardContent>
            {noChannel ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Chưa có gian {meta.label} nào được kết nối.
              </p>
            ) : campaigns.length === 0 && !loading ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  Chưa có dữ liệu chiến dịch. Bấm Làm mới để kéo từ {meta.label}{" "}
                  về (Hubsell cũng tự kiểm tra mỗi 30 phút khi campaign đang chạy).
                </p>
                <Button className="mt-4" onClick={() => void runSync()} disabled={syncing}>
                  <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
                  Làm mới ngay
                </Button>
              </div>
            ) : visibleCampaigns.length === 0 && !loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {onlyNeedsAction && !searchLower && !statusFilter
                  ? "Không còn chiến dịch nào cần xử lý 🎉 — tắt bộ lọc để xem toàn bộ."
                  : "Không có chiến dịch nào khớp bộ lọc — thử đổi từ khóa/trạng thái."}
              </p>
            ) : (
              <div className="min-w-0">
                {/* Bảng chuẩn ERP (Tầng 2): ẩn/hiện + ghim + kéo đổi vị trí
                    cột, chế độ xem lưu cả bộ lọc — tableId tách theo sàn để
                    Shopee/Lazada nhớ cấu hình riêng */}
                <DataTable
                  tableId={`ads-campaigns-${platform}`}
                  columns={campaignColumns}
                  data={pagedCampaigns}
                  getRowId={(c) => c.id}
                  onRowClick={(c) => setDetailId(c.id)}
                  rowClassName={campaignRowDanger}
                  striped={false}
                  headerEmphasis
                  stickyHeader
                  toolbar={`${formatNumber(visibleCampaigns.length)} chiến dịch khớp bộ lọc`}
                  viewExtras={{
                    get: () => ({ search, statusFilter, onlyNeedsAction }),
                    apply: (ex) => {
                      if (typeof ex.search === "string") setSearch(ex.search);
                      if (typeof ex.statusFilter === "string")
                        setStatusFilter(ex.statusFilter);
                      if (typeof ex.onlyNeedsAction === "boolean")
                        setOnlyNeedsAction(ex.onlyNeedsAction);
                      setPage(0);
                    },
                  }}
                />
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

        {/* ===== GHI CHÚ NGUỒN SỐ ===== */}
        {summary && (
          <p className="text-center text-xs text-muted-foreground">
            Biên lãi tính từ {formatNumber(summary.pnlOrders)}{" "}
            {meta.marginOrdersLabel} trong {summary.marginWindowDays} ngày gần
            nhất (SSOT computePnlRow, chưa trừ ads).
            {summary.missingCostOrders > 0 && (
              <span className="text-amber-600">
                {" "}
                ⚠ {formatNumber(summary.missingCostOrders)} đơn còn SKU thiếu giá
                vốn — nhập đủ giá vốn để ROAS hòa vốn chính xác hơn.
              </span>
            )}{" "}
            {meta.adSpendLabel}: {formatVND(summary.adSpendTotal)}.
          </p>
        )}
          </>
        )}

        {/* ===== TAB ROAS HÒA VỐN THEO SẢN PHẨM ===== */}
        {tab === "recommend" && platform === "shopee" && (
          <AdsRecommendTab
            channelId={channelId}
            noChannel={noChannel}
            adsLinked={adsLinked}
            onCreated={(msg) => {
              setSyncNote(msg);
              setTab("overview");
              void load(channelId, range);
            }}
          />
        )}

        {/* ===== TAB GMV MAX CẤP SHOP (GMS) — tách file shopee-gms-panel.tsx (25/09: thêm lệnh ghi
            bật / tạm dừng / đổi ngân sách / đổi ROAS / loại SP theo task Shopee Open Platform). ===== */}
        {tab === "gms" && channelId && (
          <ShopeeGmsPanel
            channelId={channelId}
            gms={gms}
            onChanged={() => load(channelId, range, { silent: true })}
            notify={setSyncNote}
            formatSyncTime={formatSyncTime}
          />
        )}

        {tab === "breakeven" && (
          <ProductBreakevenTab
            data={breakeven?.data ?? null}
            loading={breakevenLoading}
            error={breakevenError}
            noChannel={noChannel}
            platform={platform}
          />
        )}

        {/* ===== TAB CẤU HÌNH TRỢ LÝ TỰ ĐỘNG (+ sổ hành động GĐ3) ===== */}
        {tab === "config" &&
          (assistant && !noChannel ? (
            <>
              <ShopeeAssistantConfigCard
                config={assistant.config}
                onSave={(config) => void saveConfig(config)}
                saving={savingConfig}
                platformLabel={meta.label}
              />
              <ShopeeActionLogCard
                channelId={channelId}
                platform={platform}
                scorecard={scorecard}
                rangePhrase={rangePhrase}
              />
            </>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Kết nối gian {meta.label} để cấu hình Trợ lý.
            </p>
          ))}

        {/* ===== MODAL CĂN CỨ + QUYẾT ĐỊNH ===== */}
        <ShopeeAssistantModal
          campaign={detailCampaign}
          onDecide={(d) => void decideCampaign(d)}
          onResume={() => void resumeCampaign()}
          onPause={() => void pauseCampaign()}
          onRestoreBudget={() => void restoreBudget()}
          onSetTarget={(t) => void setRoasTarget(t)}
          onClose={() => setDetailId(null)}
          deciding={deciding}
          platform={platform}
          range={range}
        />
      </div>
    </AppShell>
  );
}

/**
 * Bảng ROAS hòa vốn theo SẢN PHẨM — công cụ tra cứu TRƯỚC khi tạo campaign:
 * vào Seller Center đặt ROAS mục tiêu là mở tab này lấy số. Khác bảng chiến
 * dịch (hòa vốn chỉ có SAU khi campaign đã chạy), bảng này phủ MỌI sản phẩm
 * của gian, kể cả chưa từng chạy ads. Cùng SSOT computePnlRow — không lệch số.
 */
function ProductBreakevenTab({
  data,
  loading,
  error,
  noChannel,
  platform,
}: {
  data: ShopeeProductBreakevenResponse | null;
  loading: boolean;
  error: string | null;
  noChannel: boolean;
  platform: "shopee" | "lazada";
}) {
  const meta = PLATFORM_META[platform];
  const platformLabel = meta.label;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(
      (r) =>
        r.productName.toLowerCase().includes(q) ||
        r.itemId.includes(q) ||
        (r.itemSku != null && r.itemSku.toLowerCase().includes(q)) ||
        r.sellerSkus.some((s) => s.toLowerCase().includes(q))
    );
  }, [data, search]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Cột bảng hòa vốn — tooltip/ô SKU khác nhau theo sàn, hệ số an toàn lấy từ
  // cấu hình Trợ lý (safeRoasFactor) nên thuộc deps.
  const safeFactor = data?.safeRoasFactor ?? 1;
  const breakevenColumns = useMemo<ColumnDef<ShopeeProductBreakevenRow>[]>(
    () => [
      {
        id: "product",
        size: 280,
        meta: { label: "Sản phẩm" },
        header: "Sản phẩm",
        cell: ({ row }) => (
          <>
            <p className="max-w-72 truncate text-sm text-slate-900">
              {row.original.productName}
            </p>
            <p className="text-xs text-slate-500">
              #{row.original.itemId}
              {row.original.skuCount > 1 &&
                ` · ${formatNumber(row.original.skuCount)} phân loại`}
            </p>
          </>
        ),
      },
      {
        id: "sku",
        size: 140,
        meta: { label: "SKU" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            SKU
            <HintIcon
              hint={
                platform === "lazada"
                  ? "Lazada không có SKU tổng cấp sản phẩm — sản phẩm 1 phân loại hiện trọn SKU seller đặt; nhiều phân loại hiện đủ danh sách SKU phân loại (rê chuột xem hết). Ô tìm kiếm bắt được mọi SKU."
                  : "SKU TỔNG của sản phẩm (cấp item trên sàn, không phải SKU phân loại). Gạch ngang = chưa đặt SKU tổng trên sàn. Ô tìm kiếm vẫn bắt được cả SKU phân loại."
              }
            />
          </span>
        ),
        cell: ({ row }) => {
          const r = row.original;
          if (r.itemSku)
            return (
              <span
                className="block max-w-32 truncate text-sm text-slate-700"
                title={
                  r.sellerSkus.length > 0
                    ? `SKU phân loại: ${r.sellerSkus.join(", ")}`
                    : undefined
                }
              >
                {r.itemSku}
              </span>
            );
          // Lazada không có SKU tổng — QUYẾT ĐỊNH anh Trung 12/08: hiện NGUYÊN
          // VĂN đủ danh sách SKU phân loại seller đặt, không suy đoán/cắt gọt.
          if (platform === "lazada" && r.sellerSkus.length > 0)
            return (
              <span
                className="block max-w-32 truncate text-sm text-slate-700"
                title={`SKU phân loại: ${r.sellerSkus.join(", ")}`}
              >
                {r.sellerSkus.join(", ")}
              </span>
            );
          return (
            <span
              className="text-slate-400"
              title={
                r.sellerSkus.length > 0
                  ? `Chưa đặt SKU tổng — SKU phân loại: ${r.sellerSkus.join(", ")}`
                  : undefined
              }
            >
              —
            </span>
          );
        },
      },
      {
        id: "orders",
        size: 110,
        meta: { label: "Đơn 30d", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Đơn 30d
            <HintIcon
              hint={`Số ${meta.marginOrdersLabel} 30 ngày có chứa sản phẩm — cỡ mẫu của biên lãi. Dưới 5 đơn thì số hòa vốn chỉ mang tính tham khảo.`}
            />
          </span>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums text-slate-700">
            {formatNumber(row.original.orders)}
            {row.original.orders > 0 && row.original.orders < 5 && (
              <span
                className="ml-1 text-xs text-amber-600"
                title="Dưới 5 đơn — số hòa vốn chỉ mang tính tham khảo"
              >
                (mỏng)
              </span>
            )}
          </span>
        ),
      },
      {
        id: "revenue",
        size: 130,
        meta: { label: "Doanh thu 30d", align: "right" },
        header: "Doanh thu 30d",
        cell: ({ row }) => (
          <Money value={row.original.revenue} className="text-slate-700" />
        ),
      },
      {
        id: "margin",
        size: 110,
        meta: { label: "Biên lãi", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Biên lãi
            <HintIcon hint="Lợi nhuận ròng / doanh thu thực nhận (giá vốn + phí sàn thật, CHƯA trừ ads). Đơn ghép nhiều SP phân bổ theo tỷ trọng giá trị." />
          </span>
        ),
        cell: ({ row }) => {
          const m = row.original.margin;
          return (
            <span
              className={cn(
                "tabular-nums",
                m == null
                  ? "text-slate-400"
                  : m <= 0
                    ? "text-red-600"
                    : "text-slate-700"
              )}
            >
              {m != null
                ? `${(m * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
                : "—"}
            </span>
          );
        },
      },
      {
        id: "breakevenRoas",
        size: 130,
        meta: { label: "ROAS hòa vốn", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            ROAS hòa vốn
            <HintIcon
              hint={`1 / biên lãi ròng — chạy ads tới đúng ROAS này thì hòa vốn. Đây là số để đối chiếu khi đặt ROAS mục tiêu. ${meta.marginBasisHint}`}
            />
          </span>
        ),
        cell: ({ row }) =>
          row.original.lossBeforeAds ? (
            <span
              className={cn(TEXT_NUMBER_STRONG, "text-red-600")}
              title="Bán đã lỗ chưa tính ads — không ROAS nào cứu được, xem lại giá/giá vốn trước"
            >
              Lỗ trước ads
            </span>
          ) : (
            <span className={TEXT_NUMBER_STRONG}>
              {formatRoas(row.original.breakevenRoas)}
            </span>
          ),
      },
      {
        id: "safeTarget",
        size: 140,
        meta: { label: "Mục tiêu an toàn", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Mục tiêu an toàn
            <HintIcon
              hint={`ROAS hòa vốn × ${safeFactor.toLocaleString("vi-VN")} (hệ số vùng an toàn trong cấu hình Trợ lý) — đặt ROAS mục tiêu từ mức này trở lên để có lãi thật.`}
            />
          </span>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums text-emerald-600">
            {row.original.breakevenRoas != null
              ? `≥ ${formatRoas(row.original.breakevenRoas * safeFactor)}`
              : "—"}
          </span>
        ),
      },
      {
        id: "targetSet",
        size: 120,
        meta: { label: "Đang đặt", align: "right" },
        header: () => (
          <span className="inline-flex items-center gap-1">
            Đang đặt
            <HintIcon hint="ROAS mục tiêu THẤP NHẤT đang đặt trên các chiến dịch đấu thầu tự động đang chạy có sản phẩm này. Đỏ = thấp hơn hòa vốn của chính sản phẩm." />
          </span>
        ),
        cell: ({ row }) => {
          const chk = row.original.roasTargetCheck;
          if (!chk) return <span className="text-slate-400">—</span>;
          const tone =
            chk.status === "below"
              ? "text-red-600"
              : chk.status === "tight"
                ? "text-amber-600"
                : "text-slate-700";
          return (
            <span
              className={cn("tabular-nums font-medium", tone)}
              title={
                chk.status === "below"
                  ? `Thấp hơn hòa vốn ${formatRoas(chk.breakevenRoas)} — nên đặt ≥ ${formatRoas(chk.safeTarget)}`
                  : undefined
              }
            >
              {formatRoas(chk.target)}
            </span>
          );
        },
      },
      {
        id: "ads",
        size: 110,
        meta: { label: "Ads" },
        header: "Ads",
        cell: ({ row }) =>
          row.original.runningAds ? (
            <Badge className="bg-emerald-500 text-white">Đang chạy ads</Badge>
          ) : null,
      },
    ],
    [platform, meta, safeFactor]
  );

  if (noChannel) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Kết nối gian {platformLabel} để tra cứu ROAS hòa vốn sản phẩm.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ROAS hòa vốn theo sản phẩm</CardTitle>
        <CardDescription>
          Số để mang đi đặt ROAS mục tiêu TRƯỚC khi tạo chiến dịch: ROAS ads
          dưới cột hòa vốn là chạy lỗ dù sàn báo dương. Biên lãi tính từ{" "}
          {meta.marginOrdersLabel} trong{" "}
          {data ? `${formatNumber(data.marginWindowDays)} ngày` : "30 ngày"} (giá
          vốn + phí sàn, chưa gồm ads) của chính sản phẩm.
          {platform === "lazada" &&
            " Đơn chưa đối soát được bỏ ra ngoài — sàn chưa báo phí, tính vào sẽ làm số hòa vốn thấp giả tạo."}
        </CardDescription>
        <div className="pt-1">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Tìm tên sản phẩm / SKU / item ID…"
            className="max-w-xs"
          />
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
            {error}
          </div>
        ) : loading || !data ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Đang tính biên lãi từng sản phẩm…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {search
              ? "Không có sản phẩm nào khớp từ khóa."
              : "Chưa có sản phẩm nào đồng bộ từ gian này."}
          </p>
        ) : (
          <div className="min-w-0">
            {/* Bảng chuẩn ERP (Tầng 2) — cấu hình cột nhớ riêng theo sàn */}
            <DataTable
              tableId={`ads-breakeven-${platform}`}
              columns={breakevenColumns}
              data={paged}
              getRowId={(r) => r.itemId}
              rowClassName={(r) =>
                r.lossBeforeAds ? "bg-red-50/50" : undefined
              }
              striped={false}
              headerEmphasis
              stickyHeader
              toolbar={`${formatNumber(rows.length)} sản phẩm khớp bộ lọc`}
              viewExtras={{
                get: () => ({ search }),
                apply: (ex) => {
                  if (typeof ex.search === "string") setSearch(ex.search);
                  setPage(0);
                },
              }}
            />
            {rows.length > PAGE_SIZE && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Hiển thị {formatNumber(safePage * PAGE_SIZE + 1)}–
                  {formatNumber(Math.min((safePage + 1) * PAGE_SIZE, rows.length))}{" "}
                  trong {formatNumber(rows.length)} sản phẩm
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
                    onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                    disabled={safePage >= pageCount - 1}
                  >
                    Sau
                  </Button>
                </div>
              </div>
            )}
            {data.shop.missingCostOrders > 0 && (
              <p className="mt-3 text-xs text-amber-600">
                ⚠ {formatNumber(data.shop.missingCostOrders)} đơn trong mẫu còn
                SKU thiếu giá vốn — biên lãi các sản phẩm liên quan đang lạc
                quan hơn thật, nhập đủ giá vốn để số hòa vốn chính xác.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Toàn gian: biên lãi{" "}
              {data.shop.margin != null
                ? `${(data.shop.margin * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`
                : "—"}{" "}
              · ROAS hòa vốn {formatRoas(data.shop.breakevenRoas)} (từ{" "}
              {formatNumber(data.shop.pnlOrders)} {meta.marginOrdersLabel}) —
              sản phẩm chưa đủ đơn có thể tạm dùng số toàn gian này.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/**
 * ĐỊNH NGHĨA CỘT bảng Chiến dịch cho DataTable (Tầng 2) — factory theo sàn vì
 * tooltip cột Đơn/Hòa vốn khác nhau giữa Shopee và Lazada. Click dòng mở modal
 * do DataTable `onRowClick` lo, dòng nguy hiểm tô đỏ qua `rowClassName`.
 */
function buildCampaignColumns(
  meta: (typeof PLATFORM_META)[keyof typeof PLATFORM_META]
): ColumnDef<ShopeeAdsCampaignRow>[] {
  return [
    {
      id: "name",
      size: 260,
      meta: { label: "Chiến dịch" },
      header: "Chiến dịch",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <>
            {/* Tên dài bị cắt → tooltip tên đầy đủ + mã (anh Trung 24/09: "chưa có tooltip khá khó xem cho seller"). */}
            <p
              className="max-w-64 truncate text-sm text-slate-900"
              title={`${c.name || "(không tên)"} · mã chiến dịch ${c.campaignId}`}
            >
              {c.name || `Chiến dịch #${c.campaignId}`}
            </p>
            <p className="text-xs text-slate-500">
              {AD_TYPE_LABEL[c.adType] ?? c.adType}
              {c.placement && ` · ${PLACEMENT_LABEL[c.placement] ?? c.placement}`}
              {c.itemCount > 0 && ` · ${formatNumber(c.itemCount)} SP`}
              {c.roasTarget != null && ` · mục tiêu ${formatRoas(c.roasTarget)}`}
            </p>
          </>
        );
      },
    },
    {
      id: "assistant",
      size: 150,
      meta: { label: "Trợ lý" },
      header: "Trợ lý",
      cell: ({ row }) => <AssistantVerdictBadge c={row.original} />,
    },
    {
      id: "status",
      size: 130,
      meta: { label: "Trạng thái" },
      header: "Trạng thái",
      cell: ({ row }) => {
        const c = row.original;
        // Cờ nguồn dừng (14/09): Trợ lý dừng thì nói rõ là Hubsell, kèm lý do +
        // giờ trong tooltip; "Tạm dừng" trơn = người hoặc sàn tắt.
        const status = c.hubsellPause
          ? {
              label: "Hubsell tạm dừng",
              className: "bg-violet-600 text-white",
              title: `Trợ lý tạm dừng lúc ${new Date(c.hubsellPause.at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}. ${c.hubsellPause.reasons.join(" ")} Sẽ tự bật lại khi ROAS đạt; bấm vào dòng để bật lại ngay.`,
            }
          : {
              label: STATUS_META[c.status]?.label ?? (c.status || "—"),
              className: STATUS_META[c.status]?.className ?? "bg-slate-100 text-slate-500",
              title: undefined as string | undefined,
            };
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge className={status.className} title={status.title}>
              {status.label}
            </Badge>
            {c.lossBeforeAds && (
              <Badge variant="outline" className="border-rose-300 text-rose-600">
                SKU lỗ trước ads
              </Badge>
            )}
            {/* Đợt B: Trợ lý đã hạ ngân sách ngày — bấm dòng để xem số gốc / trả lại. */}
            {c.hubsellBudgetCut && (
              <Badge
                variant="outline"
                className="border-violet-300 text-violet-700"
                title={`Trợ lý hạ ngân sách ngày ${c.hubsellBudgetCut.before > 0 ? formatVND(c.hubsellBudgetCut.before) : "không giới hạn"} → ${formatVND(c.hubsellBudgetCut.cut)} vì đang lỗ. Bấm vào dòng để trả lại.`}
              >
                Hubsell đã hạ ngân sách
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: "budget",
      size: 130,
      meta: { label: "Ngân sách", align: "right" },
      header: "Ngân sách",
      cell: ({ row }) =>
        row.original.budget > 0 ? (
          <Money value={row.original.budget} className="text-slate-700" />
        ) : (
          <span className="text-slate-700">Không giới hạn</span>
        ),
    },
    {
      id: "spend",
      size: 130,
      meta: { label: "Chi phí", align: "right" },
      header: "Chi phí",
      cell: ({ row }) => (
        <Money value={row.original.spend} className="text-slate-700" />
      ),
    },
    {
      id: "orders",
      size: 90,
      meta: { label: "Đơn", align: "right" },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Đơn
          <HintIcon hint={meta.broadHint} />
        </span>
      ),
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-700">
          {formatNumber(row.original.broadOrder)}
        </span>
      ),
    },
    {
      id: "cpo",
      size: 120,
      meta: { label: "CP/đơn", align: "right" },
      header: () => (
        <span className="inline-flex items-center gap-1">
          CP/đơn
          <HintIcon hint="Chi phí quảng cáo trung bình để có 1 đơn = chi phí ÷ đơn broad trong kỳ. So với lãi gộp mỗi đơn để biết còn dư bao nhiêu." />
        </span>
      ),
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-700">
          {row.original.broadOrder > 0
            ? formatVND(row.original.spend / row.original.broadOrder)
            : "—"}
        </span>
      ),
    },
    {
      id: "gmv",
      size: 130,
      meta: { label: "GMV", align: "right" },
      header: "GMV",
      cell: ({ row }) => (
        <Money value={row.original.broadGmv} className="text-slate-900" />
      ),
    },
    {
      id: "roas",
      size: 100,
      meta: { label: "ROAS", align: "right" },
      header: "ROAS",
      cell: ({ row }) => (
        <span
          className={cn(
            TEXT_NUMBER_STRONG,
            roasToneClass(row.original.roasBroad, row.original.breakevenRoas)
          )}
        >
          {formatRoas(row.original.roasBroad)}
        </span>
      ),
    },
    {
      id: "breakeven",
      size: 120,
      meta: { label: "Hòa vốn", align: "right" },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Hòa vốn
          <HintIcon
            hint={`ROAS hòa vốn = 1 / biên lãi ròng của chính SKU trong chiến dịch (giá vốn + phí sàn thật, chưa gồm ads). ROAS dưới số này là đốt tiền dù sàn báo dương. ${meta.marginBasisHint}`}
          />
        </span>
      ),
      cell: ({ row }) => (
        <span className="tabular-nums text-slate-700">
          {formatRoas(row.original.breakevenRoas)}
          {row.original.marginSource === "shop" && (
            <span
              className="ml-1 text-xs text-slate-400"
              title="Chiến dịch chưa đủ đơn khớp SKU — dùng biên lãi toàn shop"
            >
              (shop)
            </span>
          )}
        </span>
      ),
    },
    {
      id: "roasTarget",
      size: 120,
      meta: { label: "Mục tiêu", align: "right" },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Mục tiêu
          <HintIcon hint="ROAS mục tiêu anh/chị đặt trên sàn cho chiến dịch đấu thầu tự động — sàn tối ưu về đúng mức này. Đỏ = thấp hơn hòa vốn (đạt mục tiêu vẫn lỗ), vàng = trên hòa vốn nhưng chưa tới vùng an toàn. Đấu thầu thủ công không có mục tiêu." />
        </span>
      ),
      cell: ({ row }) => {
        const c = row.original;
        if (c.roasTarget == null) return <span className="text-slate-400">—</span>;
        const chk = c.roasTargetCheck;
        const tone =
          chk?.status === "below"
            ? "text-red-600"
            : chk?.status === "tight"
              ? "text-amber-600"
              : "text-slate-700";
        const title =
          chk?.status === "below"
            ? `Mục tiêu ${formatRoas(chk.target)} thấp hơn hòa vốn ${formatRoas(chk.breakevenRoas)} — đạt mục tiêu vẫn lỗ. Nên đặt ≥ ${formatRoas(chk.safeTarget)}.`
            : chk?.status === "tight"
              ? `Mục tiêu ${formatRoas(chk.target)} trên hòa vốn ${formatRoas(chk.breakevenRoas)} nhưng chưa tới vùng an toàn ${formatRoas(chk.safeTarget)} — lãi mỏng.`
              : undefined;
        return (
          <span className={cn(TEXT_NUMBER_STRONG, tone)} title={title}>
            {formatRoas(c.roasTarget)}
          </span>
        );
      },
    },
    {
      id: "estProfit",
      size: 140,
      meta: { label: "Lãi/lỗ ước tính", align: "right" },
      header: () => (
        <span className="inline-flex items-center gap-1">
          Lãi/lỗ ước tính
          <HintIcon hint="GMV × biên lãi ròng − chi phí ads trong kỳ. Cùng rổ đơn broad với ROAS: ROAS trên hòa vốn thì số này dương, dưới thì âm." />
        </span>
      ),
      cell: ({ row }) => {
        const c = row.original;
        return (
          <span
            className={cn(
              TEXT_NUMBER_STRONG,
              c.estProfit != null
                ? moneyTone(c.estProfit >= 0 ? 1 : -1)
                : "text-slate-400"
            )}
          >
            {c.estProfit != null ? formatVND(c.estProfit) : "—"}
          </span>
        );
      },
    },
  ];
}

/** Dòng chiến dịch NGUY HIỂM: đang chạy mà ROAS thật dưới hòa vốn → nền đỏ. */
function campaignRowDanger(c: ShopeeAdsCampaignRow): string | undefined {
  const danger =
    c.status === "ongoing" &&
    c.spend > 0 &&
    c.roasBroad != null &&
    c.breakevenRoas != null &&
    c.roasBroad < c.breakevenRoas;
  return danger ? "bg-red-50/50" : undefined;
}
