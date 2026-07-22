"use client";

import { useState } from "react";
import { Loader2, Phone } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import { runMockAction } from "./mock-service";
import { TAG_META, type ActionParams, type OpsAlert } from "./types";

/** Rate ship giả lập (đ/kg) để xem trước phí — chỉ minh hoạ. */
const MOCK_SHIP_RATE = 22000;
const WAREHOUSES = [
  { value: "HN", label: "Kho Hà Nội" },
  { value: "HCM", label: "Kho TP.HCM" },
];

/** Hook dùng chung: bọc luồng bấm Xác nhận → loading → gọi mock → onDone. */
function useSubmit(onDone: (summary: string) => void) {
  const [submitting, setSubmitting] = useState(false);
  async function submit(summary: string) {
    setSubmitting(true);
    await runMockAction();
    onDone(summary);
  }
  return { submitting, submit };
}

/** Chân pop-up dùng chung: nút Huỷ + nút Xác nhận có trạng thái loading. */
function ActionFooter({
  submitting,
  disabled,
  confirmLabel = "Xác nhận",
  onCancel,
  onConfirm,
}: {
  submitting: boolean;
  disabled?: boolean;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel} disabled={submitting}>
        Huỷ
      </Button>
      <Button onClick={onConfirm} disabled={submitting || disabled}>
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {confirmLabel}
      </Button>
    </DialogFooter>
  );
}

/** Một dòng nhãn — giá trị trong khối tóm tắt của form. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">{children}</span>
    </div>
  );
}

// ───────────────────────── CÁC FORM THEO LOẠI ─────────────────────────

function RestockForm({
  params,
  onCancel,
  onDone,
}: {
  params: Extract<ActionParams, { kind: "restock" }>;
  onCancel: () => void;
  onDone: (s: string) => void;
}) {
  const { submitting, submit } = useSubmit(onDone);
  const [qty, setQty] = useState(String(params.suggestQty));
  const [warehouse, setWarehouse] = useState(WAREHOUSES[0].value);
  const [sync, setSync] = useState(true);

  const n = Number(qty);
  const invalid = !Number.isInteger(n) || n <= 0;
  const whLabel = WAREHOUSES.find((w) => w.value === warehouse)?.label ?? "";

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1">
        <Field label="Mã SKU">
          <span className="font-mono">{params.sku}</span>
        </Field>
        <Field label="Tồn hiện tại">
          <span className="text-rose-600">{params.currentStock}</span>
        </Field>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="restock-qty">Số lượng nhập</Label>
        <Input
          id="restock-qty"
          type="number"
          min="1"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="restock-wh">Kho cần nhập</Label>
        <NativeSelect
          id="restock-wh"
          value={warehouse}
          onChange={(e) => setWarehouse(e.target.value)}
        >
          {WAREHOUSES.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={sync}
          onChange={(e) => setSync(e.target.checked)}
        />
        Đồng bộ tồn mới lên sàn ngay sau khi nhập
      </label>
      <ActionFooter
        submitting={submitting}
        disabled={invalid}
        confirmLabel="Nhập kho"
        onCancel={onCancel}
        onConfirm={() =>
          submit(
            `Nhập ${n} × ${params.sku} vào ${whLabel}${sync ? ", đồng bộ lên sàn" : ""}`
          )
        }
      />
    </>
  );
}

function StockMismatchForm({
  params,
  onCancel,
  onDone,
}: {
  params: Extract<ActionParams, { kind: "stock-mismatch" }>;
  onCancel: () => void;
  onDone: (s: string) => void;
}) {
  const { submitting, submit } = useSubmit(onDone);
  const [source, setSource] = useState<"hubsell" | "channel">("hubsell");
  const diff = params.hubsellStock - params.channelStock;
  const applied =
    source === "hubsell" ? params.hubsellStock : params.channelStock;

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-500">
              <th className="px-3 py-2 font-medium">Nguồn</th>
              <th className="px-3 py-2 text-right font-medium">Tồn</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100">
              <td className="px-3 py-2">Tồn Hubsell (kho thật)</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-900">
                {params.hubsellStock}
              </td>
            </tr>
            <tr className="border-t border-slate-100">
              <td className="px-3 py-2">Tồn trên {params.channel}</td>
              <td className="px-3 py-2 text-right font-semibold text-slate-900">
                {params.channelStock}
              </td>
            </tr>
            <tr className="border-t border-slate-100 bg-rose-50/40">
              <td className="px-3 py-2 text-rose-600">Chênh lệch</td>
              <td className="px-3 py-2 text-right font-semibold text-rose-600">
                {diff > 0 ? `+${diff}` : diff}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid gap-2">
        <Label>Lấy số nào làm chuẩn để đồng bộ</Label>
        <div className="flex gap-1 rounded-lg border border-slate-200 p-1">
          {(
            [
              { key: "hubsell", label: `Theo Hubsell (${params.hubsellStock})` },
              { key: "channel", label: `Theo ${params.channel} (${params.channelStock})` },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSource(opt.key)}
              className={cn(
                "flex-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                source === opt.key
                  ? "bg-primary text-primary-foreground"
                  : "text-slate-500 hover:bg-slate-100"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <ActionFooter
        submitting={submitting}
        confirmLabel="Đồng bộ"
        onCancel={onCancel}
        onConfirm={() =>
          submit(
            `Đồng bộ tồn ${params.sku} theo ${source === "hubsell" ? "Hubsell" : params.channel} (áp ${applied})`
          )
        }
      />
    </>
  );
}

function EditPriceForm({
  params,
  onCancel,
  onDone,
}: {
  params: Extract<ActionParams, { kind: "edit-price" }>;
  onCancel: () => void;
  onDone: (s: string) => void;
}) {
  const { submitting, submit } = useSubmit(onDone);
  const [price, setPrice] = useState(String(params.price));

  const margin = (p: number) => {
    if (p <= 0) return 0;
    const profit = p - params.cost - p * params.feeRate;
    return Math.round((profit / p) * 1000) / 10;
  };
  const oldMargin = margin(params.price);
  const newPrice = Number(price);
  const invalid = !(newPrice > 0);
  const newMargin = invalid ? 0 : margin(newPrice);

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1">
        <Field label="Giá vốn">{formatVND(params.cost)}</Field>
        <Field label="Phí sàn">{Math.round(params.feeRate * 100)}%</Field>
        <Field label="Biên hiện tại">
          <span className={oldMargin < 0 ? "text-rose-600" : "text-slate-900"}>
            {oldMargin}%
          </span>
        </Field>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="edit-price">Giá bán mới (₫)</Label>
        <Input
          id="edit-price"
          type="number"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </div>
      {/* Xem trước P&L: biên lợi nhuận mới, đổi màu theo dương/âm */}
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5">
        <span className="text-sm text-slate-500">Biên lợi nhuận mới</span>
        <span
          className={cn(
            "text-lg font-bold",
            invalid
              ? "text-slate-400"
              : newMargin >= 0
                ? "text-emerald-600"
                : "text-rose-600"
          )}
        >
          {invalid ? "—" : `${newMargin}%`}
        </span>
      </div>
      <ActionFooter
        submitting={submitting}
        disabled={invalid}
        confirmLabel="Cập nhật giá"
        onCancel={onCancel}
        onConfirm={() =>
          submit(
            `Đổi giá ${params.sku}: ${formatVND(params.price)} → ${formatVND(newPrice)}, biên ${newMargin}%`
          )
        }
      />
    </>
  );
}

function EditShippingForm({
  params,
  onCancel,
  onDone,
}: {
  params: Extract<ActionParams, { kind: "edit-shipping" }>;
  onCancel: () => void;
  onDone: (s: string) => void;
}) {
  const { submitting, submit } = useSubmit(onDone);
  const [weight, setWeight] = useState(String(params.weightKg));
  const [l, setL] = useState(String(params.lengthCm));
  const [w, setW] = useState(String(params.widthCm));
  const [h, setH] = useState(String(params.heightCm));

  const nums = [weight, l, w, h].map(Number);
  const invalid = nums.some((x) => !(x > 0));
  // Trọng lượng quy đổi (thể tích) so với cân thật, lấy số lớn hơn để tính phí
  const volumetric = invalid ? 0 : (Number(l) * Number(w) * Number(h)) / 6000;
  const chargeable = invalid ? 0 : Math.max(Number(weight), volumetric);
  const estFee = Math.round(chargeable * MOCK_SHIP_RATE);

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="ship-weight">Cân nặng thực (kg)</Label>
        <Input
          id="ship-weight"
          type="number"
          min="0"
          step="0.1"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-2">
          <Label htmlFor="ship-l">Dài (cm)</Label>
          <Input id="ship-l" type="number" min="0" value={l} onChange={(e) => setL(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ship-w">Rộng (cm)</Label>
          <Input id="ship-w" type="number" min="0" value={w} onChange={(e) => setW(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ship-h">Cao (cm)</Label>
          <Input id="ship-h" type="number" min="0" value={h} onChange={(e) => setH(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5">
        <span className="text-sm text-slate-500">Phí ship ước tính</span>
        <span className="text-lg font-bold text-slate-900">
          {invalid ? "—" : formatVND(estFee)}
        </span>
      </div>
      <ActionFooter
        submitting={submitting}
        disabled={invalid}
        confirmLabel="Cập nhật"
        onCancel={onCancel}
        onConfirm={() =>
          submit(
            `Cập nhật ${params.sku}: ${weight}kg · ${l}×${w}×${h}cm`
          )
        }
      />
    </>
  );
}

function CustomerRefusalForm({
  params,
  onCancel,
  onDone,
}: {
  params: Extract<ActionParams, { kind: "customer-refusal" }>;
  onCancel: () => void;
  onDone: (s: string) => void;
}) {
  const { submitting, submit } = useSubmit(onDone);
  const [called, setCalled] = useState(false);
  const [blacklist, setBlacklist] = useState(false);

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1">
        <Field label="Khách hàng">{params.customer}</Field>
        <Field label="Số điện thoại">
          <span className="font-mono">{params.phone}</span>
        </Field>
        <Field label="Số đơn đã bom">
          <span className="text-rose-600">{params.refusedOrders}</span>
        </Field>
      </div>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => setCalled(true)}
      >
        <Phone className="size-4" />
        {called ? "Đã gọi xác minh" : "Gọi nhanh xác minh"}
      </Button>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700">
        <input
          type="checkbox"
          className="size-4 accent-rose-500"
          checked={blacklist}
          onChange={(e) => setBlacklist(e.target.checked)}
        />
        Thêm số này vào Blacklist của shop (chặn đặt đơn COD)
      </label>
      <ActionFooter
        submitting={submitting}
        confirmLabel="Hoàn tất"
        onCancel={onCancel}
        onConfirm={() =>
          submit(
            `Xử lý khách bom ${params.customer}${called ? " · đã gọi" : ""}${blacklist ? " · thêm Blacklist" : ""}`
          )
        }
      />
    </>
  );
}

function RoasForm({
  params,
  onCancel,
  onDone,
}: {
  params: Extract<ActionParams, { kind: "roas" }>;
  onCancel: () => void;
  onDone: (s: string) => void;
}) {
  const { submitting, submit } = useSubmit(onDone);
  const [mode, setMode] = useState<"pause" | "reduce">("pause");
  const newBudget = Math.round(params.dailyBudget * 0.7);

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1">
        <Field label="Chiến dịch">{params.campaign}</Field>
        <Field label="ROAS hiện tại">
          <span className="text-rose-600">{params.roas}</span>
        </Field>
        <Field label="Ngân sách/ngày">{formatVND(params.dailyBudget)}</Field>
      </div>
      <div className="grid gap-2">
        {(
          [
            { key: "pause", label: "Tạm dừng chiến dịch", note: "Ngưng chi tiêu ngay lập tức" },
            {
              key: "reduce",
              label: "Giảm 30% ngân sách",
              note: `${formatVND(params.dailyBudget)} → ${formatVND(newBudget)}/ngày`,
            },
          ] as const
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setMode(opt.key)}
            className={cn(
              "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors",
              mode === opt.key
                ? "border-primary bg-primary/5"
                : "border-slate-200 hover:bg-slate-50"
            )}
          >
            <span>
              <span className="block text-sm font-medium text-slate-900">
                {opt.label}
              </span>
              <span className="block text-xs text-slate-500">{opt.note}</span>
            </span>
            <span
              className={cn(
                "size-4 shrink-0 rounded-full border-2",
                mode === opt.key
                  ? "border-primary bg-primary"
                  : "border-slate-300"
              )}
            />
          </button>
        ))}
      </div>
      <ActionFooter
        submitting={submitting}
        confirmLabel="Áp dụng qua API"
        onCancel={onCancel}
        onConfirm={() =>
          submit(
            mode === "pause"
              ? `Tạm dừng chiến dịch ${params.campaign}`
              : `Giảm 30% ngân sách ${params.campaign}: ${formatVND(params.dailyBudget)} → ${formatVND(newBudget)}/ngày`
          )
        }
      />
    </>
  );
}

function ConfirmForm({
  params,
  onCancel,
  onDone,
  actionLabel,
}: {
  params: Extract<ActionParams, { kind: "confirm" }>;
  onCancel: () => void;
  onDone: (s: string) => void;
  actionLabel: string;
}) {
  const { submitting, submit } = useSubmit(onDone);
  return (
    <>
      <p className="text-sm leading-relaxed text-slate-600">
        {params.description}
      </p>
      <ActionFooter
        submitting={submitting}
        confirmLabel={actionLabel}
        onCancel={onCancel}
        onConfirm={() => submit(`Đã ${actionLabel.toLowerCase()}`)}
      />
    </>
  );
}

// ───────────────────────── VỎ POP-UP CHUNG ─────────────────────────

/**
 * Pop-up xử lý nhanh dùng chung. Chọn form theo `alert.action.kind`. Mỗi form
 * tự quản lý state + nút Xác nhận (loading), khi xong gọi onDone(tóm tắt) để
 * component cha đánh dấu Đã xử lý và ghi nhật ký.
 */
export function ActionModal({
  alert,
  onCancel,
  onDone,
}: {
  alert: OpsAlert;
  onCancel: () => void;
  onDone: (summary: string) => void;
}) {
  const action = alert.action;
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                TAG_META[alert.tag].className
              )}
            >
              {TAG_META[alert.tag].label}
            </span>
            Xử lý nhanh
          </DialogTitle>
          <DialogDescription>{alert.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {action.kind === "restock" && (
            <RestockForm params={action} onCancel={onCancel} onDone={onDone} />
          )}
          {action.kind === "stock-mismatch" && (
            <StockMismatchForm params={action} onCancel={onCancel} onDone={onDone} />
          )}
          {action.kind === "edit-price" && (
            <EditPriceForm params={action} onCancel={onCancel} onDone={onDone} />
          )}
          {action.kind === "edit-shipping" && (
            <EditShippingForm params={action} onCancel={onCancel} onDone={onDone} />
          )}
          {action.kind === "customer-refusal" && (
            <CustomerRefusalForm params={action} onCancel={onCancel} onDone={onDone} />
          )}
          {action.kind === "roas" && (
            <RoasForm params={action} onCancel={onCancel} onDone={onDone} />
          )}
          {action.kind === "confirm" && (
            <ConfirmForm
              params={action}
              onCancel={onCancel}
              onDone={onDone}
              actionLabel={alert.actionLabel}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
