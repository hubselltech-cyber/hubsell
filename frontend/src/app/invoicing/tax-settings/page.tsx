"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Percent,
  Save,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ApiError,
  fetchTaxSettings,
  saveTaxSettings,
  type TaxCalculationBase,
  type TaxFilterPeriod,
} from "@/lib/api";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * THUẾ BỔ SUNG — trang cấu hình TINH GỌN 2 khối (đã bỏ khối "Đối tượng chịu
 * thuế" trung gian; chủ shop chọn thẳng cơ sở tính):
 *
 *   1. THUẾ BỔ SUNG ƯỚC TÍNH (trọng tâm): ô nhập %, cơ sở tính
 *      [% Lợi nhuận (mặc định) | % Doanh thu], kỳ áp dụng [Tháng/Quý/Năm].
 *      Lưu về backend để helper tài chính (tax-config.ts) đọc khi tính Lợi
 *      nhuận ròng ở Báo cáo dòng tiền và Lãi/Lỗ Thực Hiện.
 *   2. THUẾ SÀN TMĐT 1.5% (chỉ đọc, dưới cùng): hằng số theo luật, hệ thống
 *      tự trích trên doanh thu gốc — người dùng không cần tương tác.
 */

const BASE_OPTIONS: {
  value: TaxCalculationBase;
  label: string;
  icon: typeof TrendingUp;
  desc: string;
}[] = [
  {
    value: "PROFIT",
    label: "% Lợi nhuận",
    icon: TrendingUp,
    desc: "Nhân % vào lợi nhuận trước thuế của kỳ (kiểu dự phòng thuế TNDN).",
  },
  {
    value: "REVENUE",
    label: "% Doanh thu",
    icon: Wallet,
    desc: "Nhân % vào doanh thu gốc của kỳ (kiểu thuế khoán hộ kinh doanh).",
  },
];

const PERIOD_OPTIONS: { value: TaxFilterPeriod; label: string }[] = [
  { value: "MONTH", label: "Theo Tháng" },
  { value: "QUARTER", label: "Theo Quý" },
  { value: "YEAR", label: "Theo Năm" },
];

export default function TaxSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Giữ dạng CHUỖI khi nhập để không chặn người dùng gõ dở "1." — chỉ ép số lúc lưu.
  const [customPercentInput, setCustomPercentInput] = useState("0");
  const [calculationBase, setCalculationBase] =
    useState<TaxCalculationBase>("PROFIT");
  const [filterPeriod, setFilterPeriod] = useState<TaxFilterPeriod>("MONTH");
  const [platformTaxPercent, setPlatformTaxPercent] = useState(1.5);

  useEffect(() => {
    fetchTaxSettings()
      .then((r) => {
        setCustomPercentInput(String(r.settings.customTaxPercent));
        setCalculationBase(r.settings.calculationBase);
        setFilterPeriod(r.settings.filterPeriod);
        setPlatformTaxPercent(r.settings.platformTaxPercent);
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          toast.error("Không tải được cấu hình thuế");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const customPercent = Number(customPercentInput);
  const customPercentInvalid =
    !Number.isFinite(customPercent) || customPercent < 0 || customPercent > 99.99;

  async function handleSave() {
    if (customPercentInvalid) {
      toast.error("% thuế bổ sung phải là số từ 0 đến 99.99");
      return;
    }
    setSaving(true);
    try {
      const r = await saveTaxSettings({
        customTaxPercent: customPercent,
        calculationBase,
        filterPeriod,
      });
      setCustomPercentInput(String(r.settings.customTaxPercent));
      toast.success(
        "Đã lưu cấu hình thuế — Báo cáo dòng tiền và Lãi/Lỗ Thực Hiện sẽ dùng số mới"
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Không lưu được cấu hình thuế"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsShell
      title="Thuế bổ sung"
      description="Thiết lập mức thuế dự phòng và cơ sở tính — hệ thống tự trích khi tính Lợi nhuận ròng."
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Đang tải cấu hình…
        </div>
      ) : (
        <div className="space-y-6">
          {/* ===== KHỐI 1 (TRỌNG TÂM): THUẾ BỔ SUNG ƯỚC TÍNH ===== */}
          <Card className="max-w-2xl shadow-sm">
            <CardHeader className="border-b pb-3">
              <CardTitle className="flex items-center gap-2">
                <Percent className="size-5 text-slate-500" />
                Thuế bổ sung ước tính
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-5">
              <div className="grid gap-2">
                <Label htmlFor="tax-custom-percent">
                  % thuế ước tính bổ sung
                </Label>
                <div className="relative max-w-48">
                  <Input
                    id="tax-custom-percent"
                    type="number"
                    min={0}
                    max={99.99}
                    step={0.1}
                    inputMode="decimal"
                    placeholder="VD: 20 hoặc 1.5"
                    value={customPercentInput}
                    onChange={(e) => setCustomPercentInput(e.target.value)}
                    aria-invalid={customPercentInvalid}
                    className={cn(
                      "pr-8",
                      customPercentInvalid &&
                        "border-rose-400 focus-visible:ring-rose-300"
                    )}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    %
                  </span>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Cơ sở tính thuế</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {BASE_OPTIONS.map((opt) => {
                    const active = calculationBase === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setCalculationBase(opt.value)}
                        className={cn(
                          "rounded-lg border p-3.5 text-left transition-colors",
                          active
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:border-slate-300 hover:bg-muted/50"
                        )}
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                          <opt.icon
                            className={cn(
                              "size-4",
                              active ? "text-primary" : "text-slate-400"
                            )}
                          />
                          {opt.label}
                        </span>
                        <span className={cn(TEXT_SUB, "mt-1 block")}>
                          {opt.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-2">
                <Label>Kỳ áp dụng</Label>
                <div
                  role="radiogroup"
                  aria-label="Kỳ áp dụng thuế bổ sung"
                  className="inline-flex w-fit rounded-lg border bg-muted/40 p-1"
                >
                  {PERIOD_OPTIONS.map((p) => {
                    const active = filterPeriod === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setFilterPeriod(p.value)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                          active
                            ? "bg-card text-slate-900 shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className={TEXT_SUB}>
                Số % thuế bổ sung sẽ được tự động áp dụng dựa trên Cơ sở tính
                toán và Kỳ áp dụng được chọn để tính toán Lợi nhuận ròng
                (P&amp;L).
              </p>

              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Lưu cấu hình thuế
                </Button>
                <p className={TEXT_SUB}>
                  Lưu xong, Báo cáo dòng tiền &amp; Lãi/Lỗ Thực Hiện tự trích
                  theo số mới.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ===== KHỐI 2 (CHỈ ĐỌC): THUẾ SÀN TMĐT — PHÍ CỨNG THEO LUẬT ===== */}
          <Card className="max-w-2xl shadow-sm">
            <CardHeader className="border-b pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="size-5 text-slate-500" />
                Thuế sàn TMĐT (khấu trừ tại nguồn)
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                  Theo luật — tự động
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-5">
              <div className="flex items-center justify-between gap-4 rounded-lg border bg-slate-50 p-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    GTGT 1% + TNCN 0.5% trên doanh thu gốc của đơn
                  </p>
                  <p className={cn(TEXT_SUB, "mt-0.5")}>
                    Sàn TMĐT tự trích trước khi giải ngân (luật TMĐT hiện
                    hành). Hubsell coi đây là <b>khoản phí cứng giảm trừ doanh
                    thu</b>{" "}
                    khi tính P&amp;L — không cần thao tác gì thêm.
                  </p>
                </div>
                <span className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-lg font-bold tracking-tight text-white">
                  {platformTaxPercent}%
                </span>
              </div>
              <p className={TEXT_SUB}>
                Đơn <b>đã quyết toán</b> dùng số thuế sàn trích THẬT từ dữ liệu
                giải ngân; đơn <b>chưa quyết toán</b> tạm ước tính theo{" "}
                {platformTaxPercent}% để báo cáo không bị hụt.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </SettingsShell>
  );
}
