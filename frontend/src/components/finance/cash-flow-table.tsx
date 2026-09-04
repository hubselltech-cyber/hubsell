"use client";

import { useEffect, useMemo, useState } from "react";
import { Banknote, Plus, RefreshCw } from "lucide-react";

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
import { HintIcon } from "@/components/finance/hint-icon";
import {
  ApiError,
  createWithdrawal,
  fetchCashFlow,
  refreshCashFlow,
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
 * BẢNG PHÂN BỔ DÒNG TIỀN THEO GIAN HÀNG (thiết kế lại 14/08 — chốt chủ shop)
 *
 * Mỗi cột trả lời "tiền đang ở đâu", KHÔNG mô phỏng:
 *   đang giao (đơn đã bàn giao VC) → chờ đối soát (đã giao, chưa quyết toán)
 *   → Số dư Ví sàn (SỐ THẬT từ API — sàn không có ví thì "—")
 *   → Về Ngân hàng 30 ngày (đối chiếu sổ bank theo tháng).
 * Tổng doanh thu DỰ KIẾN = 3 cột đầu — tiền còn nằm ngoài ngân hàng, sẽ về
 * tay chủ shop; tiền đã về bank là quá khứ đã cầm chắc, không thuộc "dự kiến".
 * Dòng được map ĐỘNG từ danh sách gian hàng API trả về (kết nối thêm gian là
 * tự có thêm dòng); hàng TỔNG CỘNG cộng dồn bằng reduce theo đúng các dòng
 * đang lọc. Cột tiền căn phải, cột chữ căn trái.
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

/** "cập nhật 14:05 14/08" cho tooltip số dư ví — null thì chuỗi rỗng. */
function syncedLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `cập nhật ${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

export function CashFlowTable() {
  const [rows, setRows] = useState<CashFlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [platform, setPlatform] = useState<ChannelName | "">("");
  // Gian sync ví lỗi ở lần "Làm mới" gần nhất (token hết hạn, app thiếu quyền…)
  const [syncErrors, setSyncErrors] = useState<string[]>([]);

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

  /** "Làm mới" = kéo số dư ví/kỳ chi tiền MỚI NHẤT từ sàn rồi tải lại bảng. */
  async function refresh() {
    setLoading(true);
    try {
      const r = await refreshCashFlow();
      setSyncErrors(r.errors);
    } catch {
      // Sync sàn lỗi toàn phần vẫn tải lại bảng — số cũ trong DB vẫn dùng được.
    }
    await load();
  }

  useEffect(() => {
    load(); // hiện ngay số đã sync trong DB — không bắt người dùng chờ sàn
    // REAL-TIME (chốt chủ shop 14/08): mở bảng là kéo số dư ví/kỳ chi tiền mới
    // nhất từ sàn chạy NGẦM (không bật spinner), xong tự thay số trên bảng.
    (async () => {
      try {
        const r = await refreshCashFlow();
        setSyncErrors(r.errors);
        const res = await fetchCashFlow();
        setRows(res.rows);
      } catch {
        // Sàn lỗi/chậm thì giữ nguyên số đã sync — cron giờ vẫn đuổi kịp.
      }
    })();
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
  // Ví sàn null (sàn không có ví) không đóng góp vào tổng.
  const totals = shown.reduce(
    (acc, r) => ({
      inTransit: acc.inTransit + r.inTransit,
      pendingSettle: acc.pendingSettle + r.pendingSettle,
      wallet: acc.wallet + (r.walletBalance ?? 0),
      withdrawn30d: acc.withdrawn30d + r.withdrawn30d,
      totalExpected: acc.totalExpected + r.totalExpected,
    }),
    { inTransit: 0, pendingSettle: 0, wallet: 0, withdrawn30d: 0, totalExpected: 0 }
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

  // 3 cột đầu là các chặng tiền CHƯA về tay; cột 4 là số đối chiếu sổ bank.
  // Tooltip viết NGÔN NGỮ ĐỜI THƯỜNG cho chủ shop — không thuật ngữ kỹ thuật.
  const COLS: { label: string; tip: string }[] = [
    {
      label: "Doanh thu đang giao",
      tip: "Tiền của các đơn đã đưa cho bên vận chuyển, hàng đang trên đường đến khách. Đơn còn nằm trong kho chưa tính vì vẫn có thể bị hủy.",
    },
    {
      label: "Doanh thu chờ đối soát",
      tip: "Đơn đã giao xong cho khách, đang chờ sàn tính toán và cộng tiền vào ví cho mình.",
    },
    {
      label: "Số dư Ví sàn",
      tip: "Số tiền đang nằm trong ví trên sàn — đọc thẳng từ sàn nên là số thật. Sàn nào không có ví giữ tiền thì hiện dấu —.",
    },
    {
      label: "Về Ngân hàng (30 ngày)",
      tip: "Tiền đã rút từ ví sàn về tài khoản ngân hàng trong 30 ngày gần nhất — để đối chiếu với sổ ngân hàng hằng tháng.",
    },
    {
      label: "Tổng doanh thu dự kiến",
      tip: "Đang giao + Chờ đối soát + Ví sàn = tổng số tiền sắp về tay anh/chị. Tiền đã về ngân hàng không tính nữa vì đã cầm chắc rồi.",
    },
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
            Tiền của từng gian đang ở đâu: đang giao → chờ đối soát → Ví sàn (số
            dư THẬT từ API) → về Ngân hàng. Tổng dự kiến = tiền chưa về tay.
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
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
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
                  <th className="border-b border-slate-300 bg-slate-50 px-5 py-3.5 text-left text-sm font-semibold text-slate-800">
                    Kênh &amp; Gian hàng
                  </th>
                  {COLS.map((c, i) => (
                    <th
                      key={c.label}
                      className={cn(
                        "border-b border-slate-300 bg-slate-50 px-5 py-3.5 text-right text-sm font-semibold text-slate-800",
                        // Cột cuối (quan trọng nhất): khoảng thở phải + đậm hơn nữa
                        i === COLS.length - 1 && "pr-6 font-bold text-slate-900"
                      )}
                    >
                      {/* Dấu hỏi nhỏ cạnh tiêu đề — pattern tooltip chung của app */}
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        <HintIcon hint={c.tip} />
                      </span>
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
                          <span className="text-slate-900">
                            {r.shopName}
                          </span>
                          {r.disconnected && (
                            // Gian đã ngắt: số đóng băng, còn hiển thị 30 ngày
                            // cho tiền về nốt rồi tự ẩn khỏi bảng.
                            <span
                              className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
                              title="Gian đã ngắt kết nối — số không cập nhật nữa, sẽ ẩn khỏi bảng sau 30 ngày"
                            >
                              Đã ngắt
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={cn(cell, "text-right text-slate-900")}>
                        <Cash value={r.inTransit} />
                      </td>
                      <td className={cn(cell, "text-right font-medium text-amber-700")}>
                        <Cash value={r.pendingSettle} />
                      </td>
                      <td className={cn(cell, "text-right font-medium text-emerald-700")}>
                        {r.walletBalance == null ? (
                          // Sàn không có ví giữ tiền (TikTok/Offline) hoặc chưa
                          // sync được số dư — "—" chứ không phải 0đ.
                          <span
                            className="text-slate-400"
                            title="Sàn không có ví giữ tiền hoặc chưa đồng bộ được số dư"
                          >
                            —
                          </span>
                        ) : (
                          <span title={syncedLabel(r.walletSyncedAt) || undefined}>
                            <Cash value={r.walletBalance} />
                          </span>
                        )}
                      </td>
                      <td className={cn(cell, "text-right text-slate-900")}>
                        <Cash value={r.withdrawn30d} />
                      </td>
                      <td className={cn(cell, "pr-6 text-right font-semibold text-slate-900")}>
                        <Cash value={r.totalExpected} className="font-semibold" />
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
                    <Money value={totals.inTransit} className="font-bold" />
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 text-right">
                    <Money value={totals.pendingSettle} className="font-bold" />
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 text-right">
                    <Money value={totals.wallet} className="font-bold" />
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 text-right">
                    <Money value={totals.withdrawn30d} className="font-bold" />
                  </td>
                  <td className="border-t-2 border-slate-300 px-5 py-3.5 pr-6 text-right">
                    <Money value={totals.totalExpected} className="font-bold" />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Lỗi sync ví (nếu có) + gợi ý xem tooltip — giải thích cột nằm ở tooltip tiêu đề */}
        {!loading && !error && shown.length > 0 && (
          <div className="px-4 py-2.5">
            {syncErrors.length > 0 && (
              <p className="mb-1 text-xs font-medium text-amber-700">
                Chưa làm mới được số dư của: {syncErrors.join(" · ")}
              </p>
            )}
            <p className="text-left text-xs italic text-slate-500">
              Rê chuột lên tiêu đề cột để xem giải thích. Số liệu tự cập nhật từ
              sàn mỗi khi mở bảng hoặc bấm “Làm mới”.
            </p>
          </div>
        )}
      </CardContent>
      </Card>

      {/* FORM NHẬP TAY: kế toán xác nhận đã rút ví về ngân hàng */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xác nhận đã rút ví về ngân hàng</DialogTitle>
            <DialogDescription>
              Ghi nhận một lần tiền rời ví sàn về tài khoản ngân hàng — cộng vào
              cột “Về Ngân hàng (30 ngày)”. Số dư Ví sàn đọc thẳng từ API nên tự
              giảm khi sàn ghi nhận lệnh rút, không cần trừ tay.
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
              <p className="text-sm font-medium text-red-500">{formError}</p>
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
