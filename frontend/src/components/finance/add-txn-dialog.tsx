"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { SkuCombobox } from "@/components/finance/sku-combobox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Segmented } from "@/components/ui/segmented";
import {
  ApiError,
  createOperatingTxn,
  createShopRecurringExpense,
  fetchProducts,
  type Channel,
  type ChannelName,
  type ExpenseCategory,
  type Product,
  type RecurringCadence,
  type TransactionDirection,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { dayCountInclusive, fixTypedYear, formatDayKeyVN, isPlausibleDay } from "@/lib/date-input";
import { toDateKey, type DateRange } from "@/lib/date-range";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  RENT: "Mặt bằng",
  SALARY: "Nhân viên",
  PACKAGING: "Đóng gói",
  ADS: "Quảng cáo",
  OTHER: "Khác",
};
const CATEGORIES: ExpenseCategory[] = ["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"];

/** Cách ghi khoản chi: một lần, hay ĐỊNH KỲ (máy tự ghi mỗi ngày / tháng / năm). */
type Repeat = "ONCE" | RecurringCadence;
const REPEAT_ITEMS: { key: Repeat; label: string }[] = [
  { key: "ONCE", label: "Một lần" },
  { key: "DAILY", label: "Hằng ngày" },
  { key: "MONTHLY", label: "Hằng tháng" },
  { key: "YEARLY", label: "Hằng năm" },
];
const PER_LABEL: Record<RecurringCadence, string> = {
  DAILY: "mỗi ngày",
  MONTHLY: "mỗi tháng",
  YEARLY: "mỗi năm",
};
/** Chi phí hằng ngày dài tối đa ngần này ngày — khớp máy chủ (lib/recurring-expense.ts). */
const DAILY_MAX_DAYS = 366;

const YEAR_HINT = `Năm chưa đúng — nhập đủ 4 chữ số, ví dụ ${new Date().getFullYear()}`;

const txnSchema = z
  .object({
    name: z.string().trim().min(1, "Vui lòng nhập nội dung"),
    amount: z
      .string()
      .trim()
      .min(1, "Vui lòng nhập số tiền")
      .refine((v) => Number(v) > 0, "Số tiền phải là số dương"),
    platform: z.string().optional(), // lọc shop theo sàn
    shopChannelId: z.string().min(1, "Vui lòng chọn gian hàng"),
    type: z.enum(["FIXED", "VARIABLE"]).optional(),
    category: z.enum(["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"]).optional(),
    appliedSku: z.string().optional(),
    repeat: z.enum(["ONCE", "DAILY", "MONTHLY", "YEARLY"]),
    // Một lần: ngày phát sinh (bỏ trống = lúc lưu). Định kỳ: NGÀY BẮT ĐẦU (bắt buộc).
    // Gõ tay năm 2 chữ số ra "0026-…": ô tự đổi thành 2026 lúc rời ô, còn bấm Enter
    // ngay trong ô thì onSubmit đổi. Năm gõ dở / gõ thừa không đoán được → báo lỗi.
    expenseDate: z
      .string()
      .optional()
      .refine((v) => !v || isPlausibleDay(fixTypedYear(v)), YEAR_HINT),
    endDate: z
      .string()
      .optional()
      .refine((v) => !v || isPlausibleDay(fixTypedYear(v)), YEAR_HINT),
    note: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.repeat === "ONCE") return;
    const start = v.expenseDate ? fixTypedYear(v.expenseDate) : "";
    const end = v.endDate ? fixTypedYear(v.endDate) : "";
    if (!start) {
      ctx.addIssue({ code: "custom", path: ["expenseDate"], message: "Chọn ngày bắt đầu" });
      return;
    }
    if (!isPlausibleDay(start) || (end && !isPlausibleDay(end))) return; // đã báo ở từng ô
    if (v.repeat === "DAILY" && !end) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "Chọn ngày kết thúc" });
      return;
    }
    if (end && end < start) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "Phải từ ngày bắt đầu trở đi" });
      return;
    }
    if (v.repeat === "DAILY" && dayCountInclusive(start, end) > DAILY_MAX_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: `Tối đa ${DAILY_MAX_DAYS} ngày — hết kỳ thì tạo khoản mới`,
      });
    }
  });
type TxnFormValues = z.infer<typeof txnSchema>;

/**
 * Câu xác nhận dưới ô ngày của khoản ĐỊNH KỲ — nói bằng số cụ thể máy sẽ ghi gì,
 * để chủ shop soát trước khi lưu. null khi chưa đủ dữ kiện.
 */
function recurringPreview(repeat: Repeat, amountRaw: string, startRaw: string, endRaw: string): string | null {
  if (repeat === "ONCE") return null;
  const amount = Number(amountRaw);
  const start = startRaw ? fixTypedYear(startRaw) : "";
  const end = endRaw ? fixTypedYear(endRaw) : "";
  if (!(amount > 0) || !isPlausibleDay(start) || (end && !isPlausibleDay(end)) || (end && end < start)) {
    return null;
  }
  const money = formatVND(amount);
  if (repeat === "DAILY") {
    if (!end) return null;
    const days = dayCountInclusive(start, end);
    return `${money} × ${days} ngày = ${formatVND(amount * days)}.`;
  }
  const until = end ? `tới ${formatDayKeyVN(end)}` : "cho tới khi bấm Dừng";
  const day = Number(start.slice(8, 10));
  if (repeat === "MONTHLY") {
    const clamp = day > 28 ? ` Tháng không có ngày ${day} thì ghi vào ngày cuối tháng.` : "";
    return `Ghi ${money} vào ngày ${day} hằng tháng, từ ${formatDayKeyVN(start)} ${until}.${clamp}`;
  }
  return `Ghi ${money} vào ngày ${start.slice(8, 10)}/${start.slice(5, 7)} hằng năm, từ ${formatDayKeyVN(start)} ${until}.`;
}

/**
 * Dialog thêm THU (xanh) hoặc CHI (đỏ) — dùng chung, đổi hành vi theo `direction`.
 * Nguồn tiền chọn [Sàn]+[Shop]; túi tiền do BACKEND ép = Ngân hàng (ERP: thu/chi
 * thủ công luôn qua ngân hàng, KHÔNG đụng Ví sàn).
 *
 * Khoản CHI có thêm ô "Lặp lại" (26/11/2026): chọn Hằng ngày / Hằng tháng / Hằng năm thì
 * hộp tạo một LUẬT chi phí định kỳ — máy tự ghi khoản chi thường mỗi kỳ, tới hết hôm nay
 * (docs/THU-CHI-VAN-HANH-CHI-PHI-DINH-KY.md). "Định kỳ" là cách ghi, không phải phân loại
 * thứ ba cạnh Cố định / Biến đổi.
 */
export function AddTxnDialog({
  direction,
  channels,
  onAdded,
  visibleRange,
}: {
  direction: TransactionDirection;
  channels: Channel[];
  onAdded: () => void;
  /** Khoảng ngày bảng bên dưới đang lọc — khoản lưu ngoài khoảng này thì báo rõ
   *  trong toast, kẻo khách thấy bảng không đổi lại tưởng chưa lưu. */
  visibleRange?: DateRange;
}) {
  const isIncome = direction === "INCOME";
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [skus, setSkus] = useState<Product[]>([]);
  const form = useForm<TxnFormValues>({
    resolver: zodResolver(txnSchema),
    defaultValues: {
      name: "",
      amount: "",
      platform: "",
      shopChannelId: "",
      type: "FIXED",
      category: "RENT",
      appliedSku: "",
      repeat: "ONCE",
      expenseDate: "",
      endDate: "",
      note: "",
    },
  });
  const expenseType = form.watch("type");
  const selectedPlatform = form.watch("platform");
  const selectedShop = form.watch("shopChannelId");
  const repeat = form.watch("repeat");
  const isRecurring = !isIncome && repeat !== "ONCE";
  const preview = isRecurring
    ? recurringPreview(repeat, form.watch("amount"), form.watch("expenseDate") ?? "", form.watch("endDate") ?? "")
    : null;
  // Cả THU lẫn CHI: chọn Sàn rồi Shop (shop lọc theo sàn đã chọn).
  // Sàn = "ALL" → khoản CHUNG TOÀN SHOP: shop cố định "Tất cả shop", DB không gắn gian.
  // Sàn cụ thể + shop = "ALL" → khoản CHUNG CẤP SÀN (lưu fundPlatform, không gắn gian).
  const isAllPlatforms = selectedPlatform === "ALL";
  const isPlatformWide = !isAllPlatforms && !!selectedPlatform && selectedShop === "ALL";
  const platforms = Array.from(new Set(channels.map((c) => c.channelName)));
  const shopOptions = channels.filter((c) => c.channelName === selectedPlatform);
  const platformLabel =
    selectedPlatform && !isAllPlatforms
      ? (CHANNEL_META[selectedPlatform as ChannelName]?.label ?? selectedPlatform)
      : "";

  // Nạp SKU (chỉ cần cho CHI biến đổi) khi mở dialog.
  useEffect(() => {
    if (!open || isIncome) return;
    (async () => {
      const all: Product[] = [];
      let page = 1;
      try {
        for (;;) {
          const res = await fetchProducts({ page, pageSize: 50 });
          all.push(...res.items);
          if (page >= res.pageCount || res.pageCount === 0) break;
          page++;
        }
        setSkus(all);
      } catch {
        /* để trống — vẫn lưu được */
      }
    })();
  }, [open, isIncome]);

  async function onSubmit(values: TxnFormValues) {
    setSubmitting(true);
    const expenseDay = values.expenseDate ? fixTypedYear(values.expenseDate) : "";
    // "ALL" (Tất cả shop) → bỏ trống fundChannelId: backend lưu null = khoản chung.
    // Sàn cụ thể + "Tất cả các shop" → gửi kèm fundPlatform = khoản chung CẤP SÀN.
    const fundChannelId = values.shopChannelId === "ALL" ? undefined : values.shopChannelId;
    const fundPlatform =
      values.shopChannelId === "ALL" && values.platform && values.platform !== "ALL"
        ? (values.platform as ChannelName)
        : undefined;
    const appliedSku =
      values.type === "VARIABLE" && values.appliedSku ? values.appliedSku : undefined;
    const note = values.note?.trim() || undefined;
    try {
      if (!isIncome && values.repeat !== "ONCE") {
        const res = await createShopRecurringExpense({
          name: values.name,
          amount: Number(values.amount),
          cadence: values.repeat,
          startDay: expenseDay,
          endDay: values.endDate ? fixTypedYear(values.endDate) : undefined,
          category: values.category ?? "OTHER",
          type: values.type ?? "FIXED",
          appliedSku,
          fundChannelId,
          fundPlatform,
          note,
        });
        toast.success(`Đã tạo khoản chi định kỳ "${values.name}"`, {
          description:
            res.created > 0
              ? `Đã ghi ${res.created} khoản tính tới hôm nay. Các kỳ sau máy tự ghi khi tới ngày.`
              : `Chưa tới ngày bắt đầu — khoản đầu tiên sẽ ghi ngày ${formatDayKeyVN(expenseDay)}.`,
        });
      } else {
        await createOperatingTxn({
          direction,
          name: values.name,
          amount: Number(values.amount),
          fundChannelId,
          fundPlatform,
          ...(isIncome ? {} : { type: values.type, category: values.category, appliedSku }),
          expenseDate: expenseDay || undefined,
          note,
        });
        // So chuỗi "yyyy-mm-dd" với nhau — cùng định dạng nên so thẳng được.
        const outOfView =
          !!expenseDay &&
          !!visibleRange &&
          (expenseDay < toDateKey(visibleRange.from) || expenseDay > toDateKey(visibleRange.to));
        toast.success(`Đã thêm khoản ${isIncome ? "thu" : "chi"} "${values.name}"`, {
          description: outOfView
            ? `Ghi ngày ${formatDayKeyVN(expenseDay)} — ngoài khoảng ngày đang lọc nên chưa hiện trong bảng. Đổi bộ lọc ngày để xem.`
            : undefined,
        });
      }
      form.reset();
      setOpen(false);
      onAdded();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            className={cn(isIncome && "bg-emerald-600 text-white hover:bg-emerald-700")}
          />
        }
      >
        <Plus className="size-4" />
        {isIncome ? "Thêm khoản thu" : "Thêm chi phí"}
      </DialogTrigger>
      {/* Hộp có thể cao hơn màn laptop thấp (khoản định kỳ thêm 2 hàng) → cuộn trong hộp. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={isIncome ? "text-emerald-500" : "text-red-500"}>
            {isIncome ? "Thêm khoản thu vận hành" : "Thêm chi phí vận hành"}
          </DialogTitle>
          <DialogDescription>
            {isIncome
              ? "Ghi nhận tiền vào ngoài đơn hàng (hoàn tiền NCC, thu khác…) và cộng vào nguồn tiền tương ứng."
              : "Ghi nhận chi phí cố định/biến đổi và trừ vào nguồn tiền tương ứng."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nội dung</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={
                        isIncome
                          ? "VD: Hoàn tiền nhà cung cấp"
                          : isRecurring
                            ? "VD: Thuê kho"
                            : "VD: Thuê mặt bằng tháng 7"
                      }
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* CHI: phân loại + nhóm; THU: bỏ qua */}
            {!isIncome && (
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phân loại</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value="FIXED">Cố định</option>
                          <option value="VARIABLE">Biến đổi</option>
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nhóm chi phí</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {CATEGORY_LABEL[c]}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {!isIncome && expenseType === "VARIABLE" && (
              <FormField
                control={form.control}
                name="appliedSku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gắn vào sản phẩm (SKU)</FormLabel>
                    <FormControl>
                      <SkuCombobox
                        products={skus}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormDescription>
                      Khoản chi sẽ tính vào lời/lỗ riêng của sản phẩm đó (bảng SKU P&amp;L).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* NGUỒN TIỀN — [Chọn Sàn] + [Chọn Shop] để định danh sàn/shop (còn lọc
                báo cáo). Dòng tiền LUÔN qua cột Ngân hàng của shop. */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="platform"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chọn sàn</FormLabel>
                    <FormControl>
                      <NativeSelect
                        {...field}
                        onChange={(e) => {
                          field.onChange(e);
                          // Đổi sàn → reset shop; riêng "Tất cả sàn" tự chốt luôn
                          // "Tất cả shop" (khoản chung không gắn gian cụ thể).
                          form.setValue(
                            "shopChannelId",
                            e.target.value === "ALL" ? "ALL" : ""
                          );
                        }}
                      >
                        <option value="">— Chọn sàn —</option>
                        <option value="ALL">Tất cả sàn (khoản chung)</option>
                        {platforms.map((p) => (
                          <option key={p} value={p}>
                            {CHANNEL_META[p]?.label ?? p}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="shopChannelId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chọn shop</FormLabel>
                    <FormControl>
                      <NativeSelect {...field} disabled={!selectedPlatform}>
                        {isAllPlatforms ? (
                          <option value="ALL">Tất cả shop</option>
                        ) : (
                          <>
                            <option value="">
                              {!selectedPlatform
                                ? "— Chọn sàn trước —"
                                : "— Chọn gian hàng —"}
                            </option>
                            {selectedPlatform && (
                              <option value="ALL">
                                Tất cả các shop (khoản chung của sàn)
                              </option>
                            )}
                            {shopOptions.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.shopName}
                              </option>
                            ))}
                          </>
                        )}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {isAllPlatforms
                ? `Khoản ${isIncome ? "thu" : "chi"} CHUNG toàn shop: chỉ tính vào Báo cáo dòng tiền khi bộ lọc để "Tất cả sàn" — lọc đích danh một sàn/shop sẽ không gồm khoản này.`
                : isPlatformWide
                  ? `Khoản ${isIncome ? "thu" : "chi"} CHUNG của sàn ${platformLabel}: tính vào Báo cáo dòng tiền khi bộ lọc để "Tất cả sàn" hoặc chọn đúng sàn ${platformLabel} (tất cả shop) — lọc đích danh một shop sẽ không gồm khoản này.`
                  : isIncome
                    ? "Khoản thu sẽ CỘNG vào cột Ngân hàng của shop này trong Báo cáo dòng tiền."
                    : "Khoản chi sẽ TRỪ khỏi cột Ngân hàng của shop này trong Báo cáo dòng tiền."}
            </p>

            {/* CHI: một lần hay định kỳ. Đổi lựa chọn thì xóa ngày kết thúc cũ. */}
            {!isIncome && (
              <FormField
                control={form.control}
                name="repeat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lặp lại</FormLabel>
                    <FormControl>
                      <Segmented
                        ariaLabel="Lặp lại"
                        className="w-full [&>button]:flex-1 [&>button]:justify-center [&>button]:px-1"
                        items={REPEAT_ITEMS}
                        value={field.value}
                        onChange={(key) => {
                          field.onChange(key);
                          if (key === "ONCE") form.setValue("endDate", "");
                          form.clearErrors(["expenseDate", "endDate"]);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className={cn(isRecurring && "col-span-2")}>
                    <FormLabel>
                      {isRecurring ? `Số tiền ${PER_LABEL[repeat as RecurringCadence]} (₫)` : "Số tiền (₫)"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="0"
                        placeholder={isRecurring && repeat === "DAILY" ? "100000" : "8000000"}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expenseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{isRecurring ? "Từ ngày" : "Ngày phát sinh"}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isRecurring && (
                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {repeat === "DAILY" ? "Đến ngày" : "Đến ngày (không bắt buộc)"}
                      </FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
            {isRecurring && (
              <div className="space-y-1 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {preview && <p className="font-medium text-foreground">{preview}</p>}
                <p>
                  {repeat === "DAILY"
                    ? "Máy tự ghi mỗi ngày một khoản chi, tới hết hôm nay. Ngày đã qua được ghi bù ngay khi lưu."
                    : `Cả khoản ghi vào MỘT ngày ${PER_LABEL[repeat as RecurringCadence]} — lợi nhuận ngày đó giảm đủ số này. Muốn chia đều từng ngày thì chọn Hằng ngày và nhập số đã chia.`}
                </p>
              </div>
            )}
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ghi chú (không bắt buộc)</FormLabel>
                  <FormControl>
                    <Input placeholder="VD: đối soát kỳ tháng 7" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Huỷ
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className={cn(isIncome && "bg-emerald-600 text-white hover:bg-emerald-700")}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {isIncome ? "Lưu khoản thu" : isRecurring ? "Lưu chi phí định kỳ" : "Lưu chi phí"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
