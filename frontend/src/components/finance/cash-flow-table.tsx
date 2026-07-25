"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Plus, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  createWithdrawal,
  fetchCashFlow,
  type CashFlowRow,
  type ChannelName,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { cn } from "@/lib/utils";

/** yyyy-mm-dd hôm nay theo giờ máy — mặc định cho ô ngày rút. */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * BẢNG PHÂN BỔ DÒNG TIỀN THEO GIAN HÀNG
 *
 * Bóc dòng tiền của TỪNG gian hàng theo trạng thái vòng đời (đi đường → chờ đối
 * soát → đã đối soát → đã thu về). Dòng được map ĐỘNG từ danh sách gian hàng API
 * trả về (kết nối thêm gian là tự có thêm dòng); hàng TỔNG CỘNG cộng dồn bằng
 * reduce theo đúng các dòng đang lọc. Cột tiền căn phải, cột chữ căn trái.
 */

/** Thứ tự sàn cố định để dropdown & bảng ổn định. */
const PLATFORM_ORDER: ChannelName[] = ["SHOPEE", "LAZADA", "TIKTOK", "OFFLINE"];

/**
 * Ô tiền: 0 vẫn hiển thị "0 ₫" nhưng LÀM MỜ (xám nhạt, opacity 50%) để bảng
 * thẳng hàng theo cột tiền mà không rối mắt; khác 0 hiển thị số bình thường.
 */
function Cash({ value, className }: { value: number; className?: string }) {
  if (!value)
    return <Money value={0} className={cn("text-slate-400 opacity-50", className)} />;
  return <Money value={value} className={className} />;
}

/**
 * Ô số ở hàng TỔNG CỘNG: in đậm, MÀU CHỮ MẶC ĐỊNH (đen) — chỉ ô ÂM mới tô đỏ +
 * icon cảnh báo để chủ shop nhận ra ngay điểm dòng tiền lệch pha cần đối soát.
 */
function TotalCell({ value }: { value: number }) {
  if (value < 0)
    return (
      <span className="inline-flex items-center justify-end gap-1 text-rose-600">
        <TriangleAlert className="size-3.5 shrink-0" />
        <Money value={Math.abs(value)} negative className="font-bold" />
      </span>
    );
  return <Money value={value} className="font-bold" />;
}

export function CashFlowTable() {
  const [rows, setRows] = useState<CashFlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [platform, setPlatform] = useState<ChannelName | "">("");

  // Form "xác nhận đã rút ví" (nhập tay cho kế toán)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wChannelId, setWChannelId] = useState("");
  const [wAmount, setWAmount] = useState(""); // chuỗi chữ số thô
  const [wDate, setWDate] = useState(todayKey());
  const [wNote, setWNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetchCashFlow();
      setRows(res.rows);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Các sàn THỰC SỰ có trong dữ liệu → dropdown động, không hardcode.
  const platformsPresent = useMemo(
    () =>
      PLATFORM_ORDER.filter((p) => rows.some((r) => r.channelName === p)),
    [rows]
  );

  // Đổi sàn → ẩn các sàn khác ngay lập tức (lọc phía client).
  const shown = platform
    ? rows.filter((r) => r.channelName === platform)
    : rows;

  // Hàng TỔNG CỘNG: reduce động trên đúng các dòng đang hiển thị.
  const totals = shown.reduce(
    (acc, r) => ({
      inTransit: acc.inTransit + r.inTransit,
      pendingSettle: acc.pendingSettle + r.pendingSettle,
      settled: acc.settled + r.settled,
      withdrawn: acc.withdrawn + r.withdrawn,
      total: acc.total + r.total,
    }),
    { inTransit: 0, pendingSettle: 0, settled: 0, withdrawn: 0, total: 0 }
  );

  function openWithdrawDialog() {
    setWChannelId(shown[0]?.channelId ?? rows[0]?.channelId ?? "");
    setWAmount("");
    setWDate(todayKey());
    setWNote("");
    setFormError(null);
    setDialogOpen(true);
  }

  async function submitWithdraw() {
    if (!wChannelId) {
      setFormError("Vui lòng chọn gian hàng");
      return;
    }
    const amount = Number(wAmount);
    if (!amount || amount <= 0) {
      setFormError("Số tiền rút phải là số dương");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await createWithdrawal({
        channelId: wChannelId,
        amount,
        transactionTime: wDate,
        note: wNote.trim() || undefined,
      });
      setDialogOpen(false);
      await load(); // đồng bộ lại bảng: Ví sàn giảm, Ngân hàng tăng
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Không lưu được lệnh rút ví"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const COLS = [
    "Tiền đơn hàng đang giao",
    "Tiền chờ đối soát",
    "Tiền trên Ví sàn",
    "Tiền về Ngân hàng",
    "Tổng dòng tiền dự kiến",
  ];

  return (
    <>
      <Card className="shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b">
        <div>
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <Banknote className="size-6 text-slate-400" />
            Phân bổ dòng tiền theo gian hàng
          </CardTitle>
          <CardDescription className="mt-1">
            Ảnh chụp dòng tiền hiện tại — tổng hợp mọi đơn chưa hủy theo từng gian
            hàng.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {/* Bộ lọc theo sàn — góc phải bảng */}
          <NativeSelect
            className="w-44"
            aria-label="Lọc theo sàn"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as ChannelName | "")}
          >
            <option value="">Tất cả sàn</option>
            {platformsPresent.map((p) => (
              <option key={p} value={p}>
                {CHANNEL_META[p].label}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            onClick={openWithdrawDialog}
            disabled={loading || rows.length === 0}
          >
            <Plus className="size-4" />
            Xác nhận đã rút ví
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Làm mới
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading && rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Đang tải dòng tiền…
          </p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Không tải được dữ liệu dòng tiền.
          </p>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Chưa có gian hàng nào để phân bổ dòng tiền.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="border-b border-slate-200 bg-slate-50 px-5 py-3.5 text-left text-sm font-semibold text-slate-800">
                    Kênh &amp; Gian hàng
                  </th>
                  {COLS.map((c, i) => (
                    <th
                      key={c}
                      className={cn(
                        "border-b border-slate-200 bg-slate-50 px-5 py-3.5 text-right text-sm font-semibold text-slate-800",
                        // Cột cuối (quan trọng nhất): khoảng thở phải + đậm hơn nữa
                        i === COLS.length - 1 && "pr-6 font-bold text-slate-900"
                      )}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {shown.map((r) => {
                  const meta = CHANNEL_META[r.channelName];
                  // py-3.5 cho hàng đủ "thở"; text-sm để số dễ đọc hơn.
                  const cell = "border-t border-slate-100 px-5 py-3.5 text-sm";
                  return (
                    <tr
                      key={r.channelId}
                      className="transition-colors hover:bg-primary/[0.05]"
                    >
                      <td className={cn(cell, "text-left")}>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                              meta.className
                            )}
                          >
                            {meta.label}
                          </span>
                          <span className="font-medium text-slate-800">
                            {r.shopName}
                          </span>
                        </span>
                      </td>
                      <td className={cn(cell, "text-right font-medium text-slate-800")}>
                        <Cash value={r.inTransit} />
                      </td>
                      <td className={cn(cell, "text-right font-medium text-amber-700")}>
                        <Cash value={r.pendingSettle} />
                      </td>
                      <td
                        className={cn(
                          cell,
                          "text-right font-medium",
                          r.settled < 0 ? "text-rose-600" : "text-emerald-700"
                        )}
                      >
                        {r.settled < 0 ? (
                          // Ví sàn ÂM = đã rút vượt tiền quyết toán → lệch pha, cần đối soát.
                          <span
                            className="inline-flex items-center justify-end gap-1"
                            title="Số đã rút vượt tiền đã quyết toán — kiểm tra lại đối soát"
                          >
                            <TriangleAlert className="size-3.5 shrink-0" />
                            <Money value={Math.abs(r.settled)} negative className="font-medium" />
                          </span>
                        ) : (
                          <Cash value={r.settled} />
                        )}
                      </td>
                      <td className={cn(cell, "text-right font-medium text-slate-800")}>
                        <Cash value={r.withdrawn} />
                      </td>
                      <td className={cn(cell, "pr-6 text-right font-semibold text-slate-900")}>
                        <Cash value={r.total} className="font-semibold" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {/* HÀNG TỔNG CỘNG — cộng dồn động bằng reduce, nền nhẹ + in đậm */}
                <tr className="bg-slate-100 font-bold text-slate-900">
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 text-left">
                    TỔNG CỘNG {platform ? `(${CHANNEL_META[platform].label})` : ""}
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 text-right">
                    <TotalCell value={totals.inTransit} />
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 text-right">
                    <TotalCell value={totals.pendingSettle} />
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 text-right">
                    <TotalCell value={totals.settled} />
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 text-right">
                    <TotalCell value={totals.withdrawn} />
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 pr-6 text-right">
                    <TotalCell value={totals.total} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Ghi chú luồng rút ví */}
        {!loading && !error && shown.length > 0 && (
          <p className="px-4 py-2.5 text-left text-xs italic text-slate-500">
            “Tiền về Ngân hàng” ghi nhận khi tiền rời ví sàn về bank (đồng bộ từ
            sàn hoặc bấm “Xác nhận đã rút ví”). Ví sàn hiện màu{" "}
            <span className="font-medium text-rose-600">đỏ</span> nếu số đã rút
            vượt tiền đã quyết toán — dấu hiệu lệch pha cần đối soát.
          </p>
        )}
      </CardContent>
      </Card>

      {/* FORM NHẬP TAY: kế toán xác nhận đã rút ví về ngân hàng */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xác nhận đã rút ví về ngân hàng</DialogTitle>
            <DialogDescription>
              Ghi nhận một lần tiền rời ví sàn về tài khoản ngân hàng. Số tiền sẽ
              được TRỪ khỏi “Tiền trên Ví sàn” và CỘNG vào “Tiền về Ngân hàng”.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="w-channel">Gian hàng</Label>
              <NativeSelect
                id="w-channel"
                value={wChannelId}
                onChange={(e) => setWChannelId(e.target.value)}
              >
                {rows.map((r) => (
                  <option key={r.channelId} value={r.channelId}>
                    {CHANNEL_META[r.channelName].label} · {r.shopName}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="w-amount">Số tiền rút (₫)</Label>
              <CurrencyInput
                id="w-amount"
                value={wAmount}
                onValueChange={setWAmount}
                placeholder="Ví dụ: 5.000.000"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="w-date">Ngày rút</Label>
              <Input
                id="w-date"
                type="date"
                value={wDate}
                max={todayKey()}
                onChange={(e) => setWDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="w-note">Ghi chú (tuỳ chọn)</Label>
              <Input
                id="w-note"
                value={wNote}
                onChange={(e) => setWNote(e.target.value)}
                placeholder="Vd: rút về Vietcombank ****1234"
              />
            </div>

            {formError && (
              <p className="text-sm font-medium text-rose-600">{formError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={submitting}
            >
              Huỷ
            </Button>
            <Button onClick={submitWithdraw} disabled={submitting}>
              {submitting ? "Đang lưu…" : "Xác nhận đã rút"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
