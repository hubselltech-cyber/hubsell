"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  RULE_WINDOW_LABELS,
  type AssistantRuleSet,
  type RuleTimeWindow,
} from "@/components/ads/tiktok-assistant";

/**
 * CÁC Ô NHẬP LUẬT DÙNG CHUNG cho hai nơi chỉnh bộ luật của Trợ lý:
 *   - Tab "Cấu hình Trợ lý Tự động" (bộ luật MẶC ĐỊNH hệ thống).
 *   - Modal phân tích chiến dịch (bộ luật RIÊNG override).
 * Bố cục CARD-BASED: mỗi nhóm luật một card riêng (tiêu đề + switch trên đầu,
 * các dòng điều kiện xếp dọc, chú giải nằm đáy card) — tránh câu chữ dàn
 * ngang ngắt dòng tự do gây rối mắt.
 */

/** Ô nhập tiền VND: hiện số có chấm ngăn cách + ký hiệu ₫ mờ bên phải. */
export function VndInput({
  value,
  onChange,
  disabled,
  ariaLabel,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("relative inline-block", className)}>
      <Input
        inputMode="numeric"
        value={formatNumber(value)}
        onChange={(e) => {
          const parsed = Number(e.target.value.replace(/\D/g, ""));
          onChange(Number.isNaN(parsed) ? 0 : parsed);
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        className="w-36 pr-8 text-right tabular-nums"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
        ₫
      </span>
    </div>
  );
}

/** Ô nhập số trần (đơn, %, hệ số ROAS) — hẹp hơn ô tiền. */
export function NumberInput({
  value,
  onChange,
  disabled,
  ariaLabel,
  step,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="relative inline-block">
      <Input
        type="number"
        step={step ?? 1}
        min={0}
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          onChange(Number.isNaN(parsed) ? 0 : parsed);
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn("w-24 text-right tabular-nums", suffix && "pr-8")}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
          {suffix}
        </span>
      )}
    </div>
  );
}

/**
 * Ô chọn KHUNG THỜI GIAN tính số liệu cho một nhóm luật — select native cho
 * gọn (đủ 4 lựa chọn tĩnh), style ăn theo Input của design system.
 */
export function WindowSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: RuleTimeWindow;
  onChange: (value: RuleTimeWindow) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as RuleTimeWindow)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "h-8 rounded-lg border border-input bg-card px-2 text-sm text-slate-700",
        "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50"
      )}
    >
      {(Object.keys(RULE_WINDOW_LABELS) as RuleTimeWindow[]).map((w) => (
        <option key={w} value={w}>
          {RULE_WINDOW_LABELS[w]}
        </option>
      ))}
    </select>
  );
}

/**
 * Khoảng mặc định "7 ngày gần nhất" khi Seller vừa chuyển sang Tùy chỉnh —
 * đỡ phải gõ từ ô trống. Dùng lịch LOCAL (sv-SE cho ra yyyy-mm-dd) để không
 * lệch ngày theo UTC.
 */
function seedCustomRange(): { from: string; to: string } {
  const iso = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toLocaleDateString("sv-SE");
  };
  return { from: iso(6), to: iso(0) };
}

/** Một dòng điều kiện: chữ + ô nhập xếp ngang, gap thoáng, wrap theo cụm. */
function ConditionRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
      {children}
    </div>
  );
}

/**
 * CARD của một nhóm luật: tiêu đề đậm bên trái + Switch lề phải, nội dung
 * xếp dọc, chú giải (hint) ghim đáy card. Switch tắt → nội dung mờ và khóa
 * thao tác để thấy rõ trạng thái kích hoạt.
 */
function RuleCard({
  title,
  colorClass,
  note,
  enabled,
  onToggle,
  disabled,
  switchLabel,
  hint,
  hintIcon = "💡",
  children,
}: {
  title: string;
  colorClass: string;
  note?: string;
  /** undefined = nhóm không có switch riêng (Sàn dữ liệu) */
  enabled?: boolean;
  onToggle?: (on: boolean) => void;
  disabled?: boolean;
  switchLabel?: string;
  hint?: string;
  hintIcon?: string;
  children: React.ReactNode;
}) {
  const dimmed = enabled === false;
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className={cn("text-sm font-semibold", colorClass)}>
          {title}
          {note && (
            <span className="ml-2 text-xs text-slate-500">
              {note}
            </span>
          )}
        </p>
        {onToggle && (
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={disabled}
            aria-label={switchLabel}
          />
        )}
      </div>
      <div
        className={cn(
          "mt-3.5 space-y-3 transition-all",
          dimmed && "pointer-events-none opacity-50"
        )}
      >
        {children}
      </div>
      {hint && (
        <span className="mt-3 block text-xs italic text-slate-400">
          {hintIcon} {hint}
        </span>
      )}
    </div>
  );
}

/**
 * TRỌN BỘ LUẬT của một AssistantRuleSet: Sàn dữ liệu + Quy tắc 1–4, mỗi quy
 * tắc một card + Switch riêng. Dùng ở tab Cấu hình (bộ luật mặc định hệ
 * thống) và trong modal chiến dịch (bộ luật override).
 */
export function AssistantRuleFields({
  rules,
  onChange,
  disabled,
}: {
  rules: AssistantRuleSet;
  onChange: (next: AssistantRuleSet) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("space-y-4", disabled && "pointer-events-none opacity-50")}>
      <RuleCard
        title="Sàn dữ liệu — chưa đủ thì không phán xét"
        colorClass="text-slate-700"
        hint="GMV Max luôn cần thời gian test video mới — đặt sàn để trợ lý không giết nhầm video chưa kịp có dữ liệu."
      >
        <ConditionRow>
          <span>Chỉ xét video đã tiêu tối thiểu</span>
          <VndInput
            value={rules.dataFloor.minSpend}
            onChange={(minSpend) =>
              onChange({ ...rules, dataFloor: { ...rules.dataFloor, minSpend } })
            }
            disabled={disabled}
            ariaLabel="Sàn chi tiêu tối thiểu"
          />
          <span>và đã chạy đủ</span>
          <NumberInput
            value={rules.dataFloor.minHours}
            onChange={(minHours) =>
              onChange({ ...rules, dataFloor: { ...rules.dataFloor, minHours } })
            }
            disabled={disabled}
            ariaLabel="Số giờ chạy tối thiểu"
            suffix="giờ"
          />
        </ConditionRow>
      </RuleCard>

      <RuleCard
        title="Quy tắc 1 — Tự động loại trừ thẳng tay"
        colorClass="text-red-500"
        enabled={rules.hard.enabled}
        onToggle={(enabled) =>
          onChange({ ...rules, hard: { ...rules.hard, enabled } })
        }
        disabled={disabled}
        switchLabel="Bật Quy tắc 1 — tự động loại trừ"
        hint="Video tổng đẹp nhưng vài ngày gần đây bão hòa sẽ lộ khi soi khung thời gian ngắn."
      >
        <ConditionRow>
          <span className="text-slate-600">
            Tính số liệu trên khung
          </span>
          <WindowSelect
            value={rules.hard.window}
            onChange={(window) =>
              onChange({
                ...rules,
                hard: {
                  ...rules.hard,
                  window,
                  // Vừa chuyển sang Tùy chỉnh mà chưa có khoảng → seed 7 ngày
                  customRange:
                    window === "custom" && !rules.hard.customRange
                      ? seedCustomRange()
                      : rules.hard.customRange,
                },
              })
            }
            disabled={disabled || !rules.hard.enabled}
            ariaLabel="Khung thời gian tính số liệu Quy tắc 1"
          />
          {rules.hard.window === "custom" && (
            <>
              <span className="text-xs text-slate-500">từ</span>
              <Input
                type="date"
                value={rules.hard.customRange?.from ?? ""}
                onChange={(e) =>
                  onChange({
                    ...rules,
                    hard: {
                      ...rules.hard,
                      customRange: {
                        from: e.target.value,
                        to: rules.hard.customRange?.to ?? "",
                      },
                    },
                  })
                }
                disabled={disabled || !rules.hard.enabled}
                aria-label="Từ ngày (Quy tắc 1)"
                className="h-8 w-36 px-2 text-sm"
              />
              <span className="text-xs text-slate-500">đến</span>
              <Input
                type="date"
                value={rules.hard.customRange?.to ?? ""}
                onChange={(e) =>
                  onChange({
                    ...rules,
                    hard: {
                      ...rules.hard,
                      customRange: {
                        from: rules.hard.customRange?.from ?? "",
                        to: e.target.value,
                      },
                    },
                  })
                }
                disabled={disabled || !rules.hard.enabled}
                aria-label="Đến ngày (Quy tắc 1)"
                className="h-8 w-36 px-2 text-sm"
              />
            </>
          )}
        </ConditionRow>
        <ConditionRow>
          <span>Chi tiêu vượt</span>
          <VndInput
            value={rules.hard.spendNoOrder}
            onChange={(spendNoOrder) =>
              onChange({ ...rules, hard: { ...rules.hard, spendNoOrder } })
            }
            disabled={disabled || !rules.hard.enabled}
            ariaLabel="Ngưỡng chi tiêu khi chưa có đơn"
          />
          <span>
            mà vẫn <b>0 đơn hàng</b>
          </span>
        </ConditionRow>
        <ConditionRow>
          <span>ROAS thấp hơn</span>
          <NumberInput
            value={rules.hard.minRoas}
            onChange={(minRoas) =>
              onChange({ ...rules, hard: { ...rules.hard, minRoas } })
            }
            disabled={disabled || !rules.hard.enabled}
            ariaLabel="ROAS tối thiểu"
            step={0.1}
            suffix="x"
          />
        </ConditionRow>
        <ConditionRow>
          <span>Chi phí mỗi đơn (CPA) vượt trần</span>
          <VndInput
            value={rules.hard.maxCpa}
            onChange={(maxCpa) =>
              onChange({ ...rules, hard: { ...rules.hard, maxCpa } })
            }
            disabled={disabled || !rules.hard.enabled}
            ariaLabel="Trần chi phí mỗi đơn"
          />
        </ConditionRow>
      </RuleCard>

      <RuleCard
        title="Quy tắc 2 — Gửi cảnh báo chờ phê duyệt"
        colorClass="text-amber-600"
        enabled={rules.review.enabled}
        onToggle={(enabled) =>
          onChange({ ...rules, review: { ...rules.review, enabled } })
        }
        disabled={disabled}
        switchLabel="Bật Quy tắc 2 — cảnh báo chờ phê duyệt"
        hint="Trợ lý KHÔNG tự loại nhóm này — chỉ gắn cờ chờ Seller quyết định giữ lại hay loại trừ."
      >
        <ConditionRow>
          <span className="text-slate-600">
            Tính số liệu trên khung
          </span>
          <WindowSelect
            value={rules.review.window}
            onChange={(window) =>
              onChange({
                ...rules,
                review: {
                  ...rules.review,
                  window,
                  customRange:
                    window === "custom" && !rules.review.customRange
                      ? seedCustomRange()
                      : rules.review.customRange,
                },
              })
            }
            disabled={disabled || !rules.review.enabled}
            ariaLabel="Khung thời gian tính số liệu Quy tắc 2"
          />
          {rules.review.window === "custom" && (
            <>
              <span className="text-xs text-slate-500">từ</span>
              <Input
                type="date"
                value={rules.review.customRange?.from ?? ""}
                onChange={(e) =>
                  onChange({
                    ...rules,
                    review: {
                      ...rules.review,
                      customRange: {
                        from: e.target.value,
                        to: rules.review.customRange?.to ?? "",
                      },
                    },
                  })
                }
                disabled={disabled || !rules.review.enabled}
                aria-label="Từ ngày (Quy tắc 2)"
                className="h-8 w-36 px-2 text-sm"
              />
              <span className="text-xs text-slate-500">đến</span>
              <Input
                type="date"
                value={rules.review.customRange?.to ?? ""}
                onChange={(e) =>
                  onChange({
                    ...rules,
                    review: {
                      ...rules.review,
                      customRange: {
                        from: rules.review.customRange?.from ?? "",
                        to: e.target.value,
                      },
                    },
                  })
                }
                disabled={disabled || !rules.review.enabled}
                aria-label="Đến ngày (Quy tắc 2)"
                className="h-8 w-36 px-2 text-sm"
              />
            </>
          )}
        </ConditionRow>
        <ConditionRow>
          <span>Video có từ</span>
          <NumberInput
            value={rules.review.minOrders}
            onChange={(minOrders) =>
              onChange({ ...rules, review: { ...rules.review, minOrders } })
            }
            disabled={disabled || !rules.review.enabled}
            ariaLabel="Số đơn tối thiểu để coi là chuyển đổi tốt"
            suffix="đơn"
          />
          <span>trở lên, nhưng CPA vượt</span>
          <NumberInput
            value={rules.review.overPct}
            onChange={(overPct) =>
              onChange({ ...rules, review: { ...rules.review, overPct } })
            }
            disabled={disabled || !rules.review.enabled}
            ariaLabel="Phần trăm vượt CPA mục tiêu"
            suffix="%"
          />
          <span>so với CPA mục tiêu</span>
          <VndInput
            value={rules.review.targetCpa}
            onChange={(targetCpa) =>
              onChange({ ...rules, review: { ...rules.review, targetCpa } })
            }
            disabled={disabled || !rules.review.enabled}
            ariaLabel="CPA mục tiêu"
          />
        </ConditionRow>
      </RuleCard>

      <RuleCard
        title="Quy tắc 3 — Phát hiện đột biến chi phí"
        colorClass="text-red-600"
        note="(bỏ qua Sàn dữ liệu 24 giờ)"
        enabled={rules.spike.enabled}
        onToggle={(enabled) =>
          onChange({ ...rules, spike: { ...rules.spike, enabled } })
        }
        disabled={disabled}
        switchLabel="Bật Quy tắc 3 — chặn đột biến chi phí"
        hint="TikTok có lúc dồn traffic cực lớn vào một video chỉ trong vài giờ đầu ngày — đợi đủ 24 giờ thì ngân sách đã cháy sạch, nên luật này quét cả video mới đăng."
        hintIcon="⚠️"
      >
        <ConditionRow>
          <span>Nếu video tiêu vượt quá</span>
          <VndInput
            value={rules.spike.spend}
            onChange={(spend) =>
              onChange({ ...rules, spike: { ...rules.spike, spend } })
            }
            disabled={disabled || !rules.spike.enabled}
            ariaLabel="Ngưỡng chi tiêu đột biến"
          />
          <span>trong vòng</span>
          <NumberInput
            value={rules.spike.hours}
            onChange={(hours) =>
              onChange({ ...rules, spike: { ...rules.spike, hours } })
            }
            disabled={disabled || !rules.spike.enabled}
            ariaLabel="Cửa sổ giờ phát hiện đột biến"
            suffix="giờ"
          />
          <span>
            gần nhất mà vẫn <b>0 đơn hàng</b>
          </span>
        </ConditionRow>
        <ConditionRow>
          <span className="text-slate-500">→</span>
          <span>
            Đổi trạng thái sang{" "}
            <b className="text-red-600">Loại trừ ngay</b>
            {" "}để bảo vệ ngân sách.
          </span>
        </ConditionRow>
      </RuleCard>

      <RuleCard
        title="Quy tắc 4 — Bảo vệ công thần"
        colorClass="text-violet-700"
        note="(bảo vệ video bán chạy)"
        enabled={rules.grace.enabled}
        onToggle={(enabled) =>
          onChange({ ...rules, grace: { ...rules.grace, enabled } })
        }
        disabled={disabled}
        switchLabel="Bật Quy tắc 4 — bảo vệ công thần"
        hint="Video 50+ đơn là tài sản của shop — chỉ số xấu tạm thời (hết flash sale, đổi thầu…) không đáng để chém ngay. Hết ân hạn mà vẫn vi phạm thì cờ gốc của Quy tắc 1/2 mới được thả ra."
      >
        {/* Vế 1: điều kiện công thần */}
        <ConditionRow>
          <span>Nếu video đã tích lũy từ</span>
          <NumberInput
            value={rules.grace.minOrders}
            onChange={(minOrders) =>
              onChange({ ...rules, grace: { ...rules.grace, minOrders } })
            }
            disabled={disabled || !rules.grace.enabled}
            ariaLabel="Số đơn tích lũy tối thiểu để được ân hạn"
            suffix="đơn"
          />
          <span>trở lên (tính tổng thời gian), khi vi phạm</span>
          <span>
            <b>Quy tắc 1</b> hoặc <b>Quy tắc 2</b> sẽ <b>KHÔNG</b> bị loại
            trừ/cảnh báo ngay.
          </span>
        </ConditionRow>
        {/* Vế 2: thời gian & chi phí ân hạn — hai ô nhập song song */}
        <ConditionRow>
          <span className="text-slate-500">→</span>
          <span>
            Tự động chuyển sang{" "}
            <b className="text-violet-700">Ân hạn</b>
            : theo dõi thêm
          </span>
          <NumberInput
            value={rules.grace.hours}
            onChange={(hours) =>
              onChange({ ...rules, grace: { ...rules.grace, hours } })
            }
            disabled={disabled || !rules.grace.enabled}
            ariaLabel="Số giờ ân hạn tối đa"
            suffix="giờ"
          />
          <span>tiếp theo hoặc tiêu thêm tối đa</span>
          <VndInput
            value={rules.grace.maxExtraSpend}
            onChange={(maxExtraSpend) =>
              onChange({ ...rules, grace: { ...rules.grace, maxExtraSpend } })
            }
            disabled={disabled || !rules.grace.enabled}
            ariaLabel="Chi tiêu thêm tối đa trong thời gian ân hạn"
          />
        </ConditionRow>
      </RuleCard>
    </div>
  );
}
