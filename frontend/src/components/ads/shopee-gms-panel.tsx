"use client";

// ============================================================
// TAB "GMV MAX CẤP SHOP" (GMS) của trang Trợ lý quảng cáo Shopee.
//
// 24/09: chỉ đọc (trạng thái + 2 cửa sổ 7d/30d + từng SP so hòa vốn SP).
// 25/09: LỆNH GHI — task Shopee Open Platform "Integrate Shop GMV Max Ads API" (Auto Check cần
// ≥1 call create_gms_product_campaign thành công): bật GMV Max từ Hubsell, tạm dừng / bật lại,
// đổi ngân sách, đổi mục tiêu ROAS, loại SP lỗ khỏi GMV Max / đưa lại.
//
// Khẩu vị anh Trung: luồng khách = MỘT nút, thông tin phụ ngắn; rào = cảnh báo nêu số, không khóa
// cứng. Shopee KHÔNG có API đọc cấu hình GMS → mọi số ngân sách/mục tiêu ở đây là "số Hubsell nhớ"
// từ lệnh đã gửi; đặt trên Seller Center thì có thể lệch — nói thẳng trên UI.
// ============================================================

import { useEffect, useState } from "react";
import { AlertCircle, Info, Pause, Play, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  createShopeeGms,
  editShopeeGms,
  editShopeeGmsItems,
  fetchShopeeGmsExcluded,
  fetchShopeeGmsItems,
  type ShopeeGmsExcludedResponse,
  type ShopeeGmsItemsResponse,
  type ShopeeGmsOverview,
} from "@/lib/api";
import { formatDayVN } from "@/lib/date-range";
import { formatNumber, formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Trên hòa vốn nhưng chưa quá 10% = vàng (cùng hệ số với bảng chiến dịch). */
const DANGER_FACTOR = 1.1;

/** Mục tiêu an toàn = hòa vốn × 1,1, cắt 1 số lẻ như Shopee. */
function safeTarget(breakeven: number): number {
  return Math.floor(breakeven * DANGER_FACTOR * 10) / 10;
}

export function roasToneClass(roas: number | null, breakeven: number | null): string {
  if (roas == null) return "text-slate-400";
  if (breakeven == null) return "text-slate-700";
  if (roas < breakeven) return "text-red-600";
  if (roas < breakeven * DANGER_FACTOR) return "text-amber-600";
  return "text-emerald-600";
}

export function formatRoas(v: number | null): string {
  if (v == null) return "—";
  return `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}x`;
}

function digitsToNumber(s: string): number {
  const n = Number(s.replace(/\D/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const ACTION_LABEL: Record<string, string> = {
  create: "Bật GMV Max",
  pause: "Tạm dừng",
  resume: "Bật lại",
  change_budget: "Đổi ngân sách",
  change_roas_target: "Đổi mục tiêu ROAS",
  remove_items: "Loại sản phẩm",
  add_items: "Đưa lại sản phẩm",
};

export function ShopeeGmsPanel({
  channelId,
  gms,
  onChanged,
  notify,
  formatSyncTime,
}: {
  channelId: string;
  gms: ShopeeGmsOverview | null;
  /** Nạp lại dashboard sau lệnh ghi (trạng thái + số nhớ). */
  onChanged: () => Promise<void>;
  notify: (msg: string) => void;
  formatSyncTime: (iso: string) => string;
}) {
  const active = gms?.status === "active";
  const mem = gms?.campaign ?? null;
  const [busy, setBusy] = useState(false);

  // ----- Bật GMV Max (khi đủ điều kiện) -----
  const [budget, setBudget] = useState("");
  const [mode, setMode] = useState<"auto" | "custom">("custom");
  const [roas, setRoas] = useState("");
  const be = gms?.shopBreakevenRoas ?? null;
  // Gợi ý mục tiêu = hòa vốn cấp shop × 1,1 (mức an toàn, cùng hệ số bảng chiến dịch) — chỉ điền sẵn, seller sửa được.
  useEffect(() => {
    if (!roas && be != null && be > 0) setRoas(String(safeTarget(be)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be]);
  const budgetNum = digitsToNumber(budget);
  const roasNum = mode === "custom" ? Number(roas.replace(",", ".")) : 0;

  async function run(label: string, fn: () => Promise<{ message: string }>) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      notify(`${r.message}.`);
      await onChanged();
    } catch (err) {
      notify(`${label} lỗi: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // ----- Sửa khi đang chạy -----
  const [editBudget, setEditBudget] = useState("");
  const [editRoas, setEditRoas] = useState("");
  const [editMode, setEditMode] = useState<"auto" | "custom">("custom");
  useEffect(() => {
    setEditBudget(mem?.dailyBudget ? String(mem.dailyBudget) : "");
    setEditRoas(mem?.roasTarget ? String(mem.roasTarget) : "");
    setEditMode(mem?.roasTarget ? "custom" : "auto");
  }, [mem?.dailyBudget, mem?.roasTarget]);

  // ----- Từng SP (7 ngày trọn, DB) + SP đã loại (đọc sống) -----
  const [items, setItems] = useState<{ channelId: string; data: ShopeeGmsItemsResponse } | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !channelId) return;
    if (items?.channelId === channelId) return;
    let cancelled = false;
    setItemsLoading(true);
    setItemsError(null);
    fetchShopeeGmsItems(channelId)
      .then((res) => {
        if (!cancelled) setItems({ channelId, data: res });
      })
      .catch((err) => {
        if (!cancelled) setItemsError(`Không tải được từng sản phẩm GMV Max: ${(err as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, channelId, items]);

  const [excluded, setExcluded] = useState<ShopeeGmsExcludedResponse | null>(null);
  const [excludedLoading, setExcludedLoading] = useState(false);
  const [excludedError, setExcludedError] = useState<string | null>(null);
  async function loadExcluded() {
    setExcludedLoading(true);
    setExcludedError(null);
    try {
      setExcluded(await fetchShopeeGmsExcluded(channelId));
    } catch (err) {
      setExcludedError((err as Error).message);
    } finally {
      setExcludedLoading(false);
    }
  }
  const excludedSet = new Set(excluded?.rows.map((r) => r.itemId) ?? []);

  async function editItems(action: "add" | "remove", itemId: string) {
    await run(action === "remove" ? "Loại sản phẩm" : "Đưa lại sản phẩm", () =>
      editShopeeGmsItems({ channelId, action, itemIds: [itemId] })
    );
    if (excluded) await loadExcluded();
  }

  // ===================== CHƯA CHẠY =====================
  if (!active) {
    const st = gms?.status ?? null;
    const box =
      st == null
        ? {
            tone: "border-amber-200 bg-amber-50 text-amber-900",
            icon: <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />,
            title: "Chưa có trạng thái",
            text: "Hubsell đang hỏi Shopee xem gian có chạy GMV Max không. Quay lại sau vài phút.",
          }
        : st === "eligible"
          ? {
              tone: "border-sky-200 bg-sky-50 text-sky-900",
              icon: <Info className="mt-0.5 size-5 shrink-0 text-sky-600" />,
              title: "Gian chưa bật GMV Max cấp shop",
              text: "Shopee cho phép gian này chạy. Bật ngay bên dưới, hoặc bật trên Seller Center thì số cũng sẽ hiện ở đây.",
            }
          : st === "not_whitelisted"
            ? {
                tone: "border-slate-200 bg-slate-50 text-slate-800",
                icon: <AlertCircle className="mt-0.5 size-5 shrink-0 text-slate-500" />,
                title: "Shopee chưa mở cho gian này",
                text: "GMV Max cấp shop đang mở theo đợt; gian này chưa nằm trong danh sách được chạy.",
              }
            : st === "not_have_enough_sku"
              ? {
                  tone: "border-amber-200 bg-amber-50 text-amber-900",
                  icon: <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />,
                  title: "Gian chưa đủ sản phẩm",
                  text: "Shopee yêu cầu gian có đủ sản phẩm hợp lệ mới cho chạy GMV Max cấp shop.",
                }
              : st === "exclusive_with_other_campaign"
                ? {
                    tone: "border-amber-200 bg-amber-50 text-amber-900",
                    icon: <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />,
                    title: "Gian đang ở chương trình khác",
                    text: "Gian đang tham gia chương trình quảng cáo tự động khác của Shopee nên không chạy GMV Max cấp shop cùng lúc.",
                  }
                : {
                    tone: "border-red-200 bg-red-50 text-red-800",
                    icon: <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" />,
                    title: "Không đọc được từ Shopee",
                    text: `Shopee trả lỗi khi hỏi trạng thái GMV Max (${st}). Hubsell sẽ hỏi lại ở lượt sau.`,
                  };
    return (
      <Card>
        <CardHeader>
          <CardTitle>GMV Max cấp shop (GMS)</CardTitle>
          <CardDescription className="mt-1.5">
            Shopee tự chọn sản phẩm và chạy quảng cáo cho cả gian theo ngân sách ngày và mục tiêu ROAS. Tiền tiêu ở
            đây không nằm trong bảng chiến dịch ở tab Tổng quan, chỉ có trong tổng chi cấp shop.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={cn("flex items-start gap-3 rounded-lg border p-3.5 text-sm", box.tone)}>
            {box.icon}
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{box.title}</p>
              <p className="mt-0.5">{box.text}</p>
              {gms?.checkedAt && (
                <p className="mt-1 text-xs opacity-70">Hỏi Shopee lúc {formatSyncTime(gms.checkedAt)}.</p>
              )}
            </div>
          </div>

          {st === "eligible" && (
            <div className="space-y-3 rounded-lg border p-3.5">
              <p className="text-sm font-semibold text-slate-900">Bật GMV Max cấp shop từ Hubsell</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Ngân sách mỗi ngày (₫)</span>
                  <Input
                    inputMode="numeric"
                    value={budgetNum ? formatNumber(budgetNum) : ""}
                    onChange={(e) => setBudget(e.target.value)}
                    className="w-44 tabular-nums"
                    placeholder="100.000"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">Cách đấu thầu</span>
                  <NativeSelect className="w-52" value={mode} onChange={(e) => setMode(e.target.value as "auto" | "custom")}>
                    <option value="custom">Theo mục tiêu ROAS</option>
                    <option value="auto">Shopee tự đấu thầu</option>
                  </NativeSelect>
                </label>
                {mode === "custom" && (
                  <label className="space-y-1 text-sm">
                    <span className="text-muted-foreground">Mục tiêu ROAS (x)</span>
                    <Input
                      inputMode="decimal"
                      value={roas}
                      onChange={(e) => setRoas(e.target.value)}
                      className="w-28 tabular-nums"
                      placeholder="7.5"
                    />
                  </label>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {be != null ? (
                  <>
                    Hòa vốn cấp shop <b>{formatRoas(be)}</b> — mục tiêu nên từ <b>{formatRoas(safeTarget(be))}</b> trở lên
                    để còn lãi.{" "}
                  </>
                ) : (
                  <>Chưa tính được hòa vốn cấp shop (thiếu giá vốn) — chọn mục tiêu theo kinh nghiệm hoặc để Shopee tự đấu thầu. </>
                )}
                Shopee lấy 1 số lẻ (7,25 → 7,2). Chạy liên tục từ hôm nay, không hẹn ngày tắt; tạm dừng lúc nào cũng được.
              </p>
              {mode === "custom" && roasNum > 0 && be != null && roasNum < be && (
                <p className="text-sm text-red-600">
                  Mục tiêu {formatRoas(roasNum)} thấp hơn hòa vốn {formatRoas(be)} — Shopee sẽ tối ưu về mức lỗ. Vẫn bật được nếu anh/chị chủ
                  ý.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() =>
                    void run("Bật GMV Max", () =>
                      createShopeeGms({ channelId, dailyBudget: budgetNum, roasTarget: mode === "custom" ? roasNum : 0 })
                    )
                  }
                  disabled={busy || budgetNum <= 0 || (mode === "custom" && !(roasNum > 0))}
                >
                  <Rocket className="size-4" />
                  {busy ? "Đang bật trên Shopee…" : "Bật GMV Max"}
                </Button>
                <p className="min-w-0 flex-1 text-xs text-slate-500">
                  Tối đa <b>{formatVND(budgetNum)}</b>/ngày, Shopee bắt đầu chạy ngay hôm nay.
                </p>
              </div>
              {mem?.lastError && <p className="text-xs text-red-600">Lần gửi trước Shopee từ chối: {mem.lastError}</p>}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ===================== ĐANG CHẠY =====================
  const paused = mem?.state === "paused";
  return (
    <Card>
      <CardHeader>
        <CardTitle>GMV Max cấp shop (GMS)</CardTitle>
        <CardDescription className="mt-1.5">
          Shopee tự chạy quảng cáo cho cả gian. Tiền tiêu ở đây không nằm trong bảng chiến dịch ở tab Tổng quan, chỉ
          có trong tổng chi cấp shop. Shopee chỉ báo số theo cửa sổ 7 và 30 ngày, không có từng ngày.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Điều khiển — số nhớ + 4 lệnh */}
        <div className="rounded-lg border p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              {mem ? (
                <>
                  <p className="font-semibold text-slate-900">
                    {paused ? "Đang tạm dừng (theo lệnh từ Hubsell)" : "Đang chạy"} ·{" "}
                    {mem.dailyBudget != null ? `${formatVND(mem.dailyBudget)}/ngày` : "ngân sách chưa rõ"} ·{" "}
                    {mem.roasTarget ? `mục tiêu ${formatRoas(mem.roasTarget)}` : "Shopee tự đấu thầu"}
                  </p>
                  <p className="text-xs text-slate-500">
                    Số Hubsell nhớ từ lệnh gửi gần nhất
                    {mem.lastActionAt && ` (${ACTION_LABEL[mem.lastAction ?? ""] ?? mem.lastAction} lúc ${formatSyncTime(mem.lastActionAt)})`}
                    . Shopee không có API đọc lại cấu hình, đổi trên Seller Center thì số này lệch.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold text-slate-900">Đang chạy (bật trên Seller Center)</p>
                  <p className="text-xs text-slate-500">
                    Shopee không có API đọc cấu hình nên Hubsell chưa biết ngân sách và mục tiêu hiện tại — vẫn tạm dừng hay
                    đổi được từ đây, sau đó Hubsell sẽ nhớ số mới.
                  </p>
                </>
              )}
              {mem?.lastError && <p className="mt-1 text-xs text-red-600">Lần gửi gần nhất Shopee từ chối: {mem.lastError}</p>}
            </div>
            <Button
              variant={paused ? "default" : "outline"}
              onClick={() => void run(paused ? "Bật lại" : "Tạm dừng", () => editShopeeGms({ channelId, action: paused ? "resume" : "pause" }))}
              disabled={busy}
            >
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {paused ? "Bật lại GMV Max" : "Tạm dừng GMV Max"}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3 border-t pt-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Ngân sách mỗi ngày (₫)</span>
              <Input
                inputMode="numeric"
                value={digitsToNumber(editBudget) ? formatNumber(digitsToNumber(editBudget)) : ""}
                onChange={(e) => setEditBudget(e.target.value)}
                className="w-40 tabular-nums"
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || digitsToNumber(editBudget) <= 0 || digitsToNumber(editBudget) === (mem?.dailyBudget ?? -1)}
              onClick={() =>
                void run("Đổi ngân sách", () => editShopeeGms({ channelId, action: "change_budget", dailyBudget: digitsToNumber(editBudget) }))
              }
            >
              Đổi ngân sách
            </Button>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Cách đấu thầu</span>
              <NativeSelect className="w-48" value={editMode} onChange={(e) => setEditMode(e.target.value as "auto" | "custom")}>
                <option value="custom">Theo mục tiêu ROAS</option>
                <option value="auto">Shopee tự đấu thầu</option>
              </NativeSelect>
            </label>
            {editMode === "custom" && (
              <label className="space-y-1 text-sm">
                <span className="text-muted-foreground">Mục tiêu ROAS (x)</span>
                <Input inputMode="decimal" value={editRoas} onChange={(e) => setEditRoas(e.target.value)} className="w-24 tabular-nums" />
              </label>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || (editMode === "custom" && !(Number(editRoas.replace(",", ".")) > 0))}
              onClick={() =>
                void run("Đổi mục tiêu ROAS", () =>
                  editShopeeGms({
                    channelId,
                    action: "change_roas_target",
                    roasTarget: editMode === "custom" ? Number(editRoas.replace(",", ".")) : 0,
                  })
                )
              }
            >
              Đổi mục tiêu
            </Button>
            {be != null && (
              <p className="basis-full text-xs text-slate-500">
                Hòa vốn cấp shop <b>{formatRoas(be)}</b> — mục tiêu dưới mức này là Shopee tối ưu về mức lỗ.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {gms!.reports.map((r) => (
            <div key={r.windowKey} className="rounded-lg border p-3.5">
              <p className="text-xs text-muted-foreground">
                {r.windowKey === "7d" ? "7 ngày trọn" : "30 ngày trọn"} · {formatDayVN(new Date(`${r.startKey}T00:00:00`))} –{" "}
                {formatDayVN(new Date(`${r.endKey}T00:00:00`))}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Chi phí</p>
                  <p className="font-semibold tabular-nums text-red-600">{formatVND(r.expense)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">GMV</p>
                  <p className="font-semibold tabular-nums text-emerald-600">{formatVND(r.broadGmv)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Đơn</p>
                  <p className="font-semibold tabular-nums">{formatNumber(r.broadOrder)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ROAS · hòa vốn shop</p>
                  <p className={cn("font-semibold tabular-nums", roasToneClass(r.roasBroad, be))}>
                    {formatRoas(r.roasBroad)}
                    <span className="ml-1 font-normal text-slate-500">· {formatRoas(be)}</span>
                  </p>
                </div>
              </div>
              {r.roasBroad != null && be != null && r.roasBroad < be && (
                <p className="mt-2 text-xs text-red-600">Đang lỗ trong cửa sổ này — xem bảng sản phẩm bên dưới để biết SP nào kéo xuống.</p>
              )}
            </div>
          ))}
          {gms!.reports.length === 0 && (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Chưa có số — Shopee chỉ trả báo cáo cho ngày đã trọn, Hubsell kéo ở lượt kế tiếp (≤ 6 giờ).
            </p>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">Từng sản phẩm trong GMV Max</p>
              <p className="text-xs text-muted-foreground">
                {items?.data.startKey && items.data.endKey
                  ? `7 ngày trọn ${formatDayVN(new Date(`${items.data.startKey}T00:00:00`))} – ${formatDayVN(new Date(`${items.data.endKey}T00:00:00`))}, chỉ SP có số. `
                  : ""}
                ROAS đỏ = dưới hòa vốn của chính sản phẩm. SP lỗ thì bấm Loại — Shopee ngừng chạy SP đó trong GMV Max, đưa lại được.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadExcluded()} disabled={excludedLoading}>
              {excludedLoading ? "Đang hỏi Shopee…" : excluded ? "Tải lại SP đã loại" : "Xem SP đã loại"}
            </Button>
          </div>
          {itemsLoading && <p className="mt-2 text-sm text-muted-foreground">Đang tải…</p>}
          {itemsError && <p className="mt-2 text-sm text-amber-700">{itemsError}</p>}
          {items && items.data.rows.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">Chưa có sản phẩm nào có số trong cửa sổ này.</p>
          )}
          {items && items.data.rows.length > 0 && (
            <div className="mt-2 min-w-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Sản phẩm</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Chi phí</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Đơn</th>
                    <th className="py-1.5 pr-3 text-right font-medium">GMV</th>
                    <th className="py-1.5 pr-3 text-right font-medium">ROAS</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Hòa vốn SP</th>
                    <th className="py-1.5 text-right font-medium">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {items.data.rows.slice(0, 100).map((it) => {
                    const losing = it.roasBroad != null && it.breakevenRoas != null && it.roasBroad < it.breakevenRoas;
                    const isExcluded = excludedSet.has(it.itemId);
                    return (
                      <tr key={it.itemId} className={cn("border-b last:border-0", losing && "bg-red-50/60")}>
                        <td className="max-w-72 py-1.5 pr-3">
                          <span className="block truncate text-slate-900">{it.name || `#${it.itemId}`}</span>
                          <span className="text-xs text-slate-500">
                            #{it.itemId}
                            {it.lossBeforeAds && <span className="text-red-600"> · lỗ trước ads</span>}
                            {isExcluded && <span className="text-slate-500"> · đã loại</span>}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatVND(it.expense)}</td>
                        <td className={cn("py-1.5 pr-3 text-right tabular-nums", it.expense > 0 && it.broadOrder === 0 && "font-semibold text-red-600")}>
                          {formatNumber(it.broadOrder)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{formatVND(it.broadGmv)}</td>
                        <td className={cn("py-1.5 pr-3 text-right font-semibold tabular-nums", roasToneClass(it.roasBroad, it.breakevenRoas))}>
                          {formatRoas(it.roasBroad)}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{formatRoas(it.breakevenRoas)}</td>
                        <td className="py-1.5 text-right">
                          {isExcluded ? (
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void editItems("add", it.itemId)}>
                              Đưa lại
                            </Button>
                          ) : (
                            <Button
                              variant={losing ? "destructive" : "ghost"}
                              size="sm"
                              disabled={busy}
                              onClick={() => void editItems("remove", it.itemId)}
                            >
                              Loại
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {excludedError && <p className="mt-2 text-sm text-amber-700">Không đọc được SP đã loại: {excludedError}</p>}
          {excluded && (
            <div className="mt-3 rounded-lg border bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">
                Sản phẩm đã loại khỏi GMV Max: {formatNumber(excluded.total)}
                {excluded.rows.length < excluded.total && ` (hiện ${excluded.rows.length} đầu)`}
              </p>
              {excluded.rows.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">Chưa loại sản phẩm nào — Shopee đang chạy mọi SP hợp lệ của gian.</p>
              ) : (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {excluded.rows.map((r) => (
                    <li key={r.itemId} className="flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-xs">
                      <span className="max-w-56 truncate">{r.name || `#${r.itemId}`}</span>
                      <button
                        type="button"
                        className="text-sky-700 hover:underline disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void editItems("add", r.itemId)}
                      >
                        Đưa lại
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {mem && mem.history.length > 0 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none">Lệnh đã gửi lên Shopee ({mem.history.length} gần nhất)</summary>
            <ul className="mt-1.5 space-y-0.5">
              {[...mem.history].reverse().map((h, i) => (
                <li key={i} className={cn(h.status === "FAILED" && "text-red-600")}>
                  {formatSyncTime(h.at)} · {ACTION_LABEL[h.action] ?? h.action}
                  {h.payload.daily_budget != null && ` ${formatVND(Number(h.payload.daily_budget))}/ngày`}
                  {h.payload.roas_target != null && ` ROAS ${String(h.payload.roas_target)}x`}
                  {Array.isArray(h.payload.item_id_list) && ` ${(h.payload.item_id_list as unknown[]).length} SP`}
                  {h.status === "FAILED" && ` — Shopee từ chối: ${h.error ?? ""}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
