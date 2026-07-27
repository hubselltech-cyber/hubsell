"use client";

import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { AssistantRuleSet } from "@/components/ads/tiktok-assistant";

/**
 * CÁC Ô NHẬP LUẬT DÙNG CHUNG cho hai nơi chỉnh bộ luật của Trợ lý:
 *   - Tab "Cấu hình Trợ lý Tự động" (bộ luật MẶC ĐỊNH hệ thống — bọc Card riêng).
 *   - Modal phân tích chiến dịch (bộ luật RIÊNG override — bản compact).
 * Cùng một khuôn nhập để hai chỗ không bao giờ lệch nhau về UX lẫn đơn vị.
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

/** Một dòng luật: câu chữ tự nhiên với ô nhập chèn giữa — Seller đọc là hiểu luật. */
export function RuleRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-slate-100 py-3 text-sm text-slate-700 last:border-b-0 last:pb-0">
      {children}
    </div>
  );
}

/**
 * BẢN COMPACT đủ 3 nhóm luật của một AssistantRuleSet — dùng trong modal khi
 * chiến dịch bật "Quy tắc riêng". Chỉ khung chữ + ô nhập, không Card chrome.
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
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Sàn dữ liệu — chưa đủ thì không phán xét
        </p>
        <RuleRow>
          <span>Chỉ xét video đã tiêu tối thiểu</span>
          <VndInput
            value={rules.dataFloor.minSpend}
            onChange={(minSpend) =>
              onChange({ ...rules, dataFloor: { ...rules.dataFloor, minSpend } })
            }
            disabled={disabled}
            ariaLabel="Sàn chi tiêu tối thiểu (quy tắc riêng)"
          />
          <span>và đã chạy đủ</span>
          <NumberInput
            value={rules.dataFloor.minHours}
            onChange={(minHours) =>
              onChange({ ...rules, dataFloor: { ...rules.dataFloor, minHours } })
            }
            disabled={disabled}
            ariaLabel="Số giờ chạy tối thiểu (quy tắc riêng)"
            suffix="giờ"
          />
        </RuleRow>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
          Quy tắc 1 — Tự động loại trừ thẳng tay
        </p>
        <RuleRow>
          <span>Chi tiêu vượt</span>
          <VndInput
            value={rules.hard.spendNoOrder}
            onChange={(spendNoOrder) =>
              onChange({ ...rules, hard: { ...rules.hard, spendNoOrder } })
            }
            disabled={disabled}
            ariaLabel="Ngưỡng chi tiêu khi chưa có đơn (quy tắc riêng)"
          />
          <span>
            mà vẫn <b>0 đơn hàng</b>
          </span>
        </RuleRow>
        <RuleRow>
          <span>ROAS thấp hơn</span>
          <NumberInput
            value={rules.hard.minRoas}
            onChange={(minRoas) =>
              onChange({ ...rules, hard: { ...rules.hard, minRoas } })
            }
            disabled={disabled}
            ariaLabel="ROAS tối thiểu (quy tắc riêng)"
            step={0.1}
            suffix="x"
          />
        </RuleRow>
        <RuleRow>
          <span>Chi phí mỗi đơn (CPA) vượt trần</span>
          <VndInput
            value={rules.hard.maxCpa}
            onChange={(maxCpa) =>
              onChange({ ...rules, hard: { ...rules.hard, maxCpa } })
            }
            disabled={disabled}
            ariaLabel="Trần chi phí mỗi đơn (quy tắc riêng)"
          />
        </RuleRow>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
          Quy tắc 2 — Gửi cảnh báo chờ phê duyệt
        </p>
        <RuleRow>
          <span>Video có từ</span>
          <NumberInput
            value={rules.review.minOrders}
            onChange={(minOrders) =>
              onChange({ ...rules, review: { ...rules.review, minOrders } })
            }
            disabled={disabled}
            ariaLabel="Số đơn tối thiểu để coi là chuyển đổi tốt (quy tắc riêng)"
            suffix="đơn"
          />
          <span>trở lên, nhưng CPA vượt</span>
          <NumberInput
            value={rules.review.overPct}
            onChange={(overPct) =>
              onChange({ ...rules, review: { ...rules.review, overPct } })
            }
            disabled={disabled}
            ariaLabel="Phần trăm vượt CPA mục tiêu (quy tắc riêng)"
            suffix="%"
          />
          <span>so với CPA mục tiêu</span>
          <VndInput
            value={rules.review.targetCpa}
            onChange={(targetCpa) =>
              onChange({ ...rules, review: { ...rules.review, targetCpa } })
            }
            disabled={disabled}
            ariaLabel="CPA mục tiêu (quy tắc riêng)"
          />
        </RuleRow>
      </div>
    </div>
  );
}
