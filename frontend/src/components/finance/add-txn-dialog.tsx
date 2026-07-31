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
import {
  ApiError,
  createOperatingTxn,
  fetchProducts,
  type Channel,
  type ChannelName,
  type ExpenseCategory,
  type Product,
  type TransactionDirection,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  RENT: "Mặt bằng",
  SALARY: "Nhân viên",
  PACKAGING: "Đóng gói",
  ADS: "Quảng cáo",
  OTHER: "Khác",
};
const CATEGORIES: ExpenseCategory[] = ["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"];

const txnSchema = z.object({
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
  expenseDate: z.string().optional(),
  note: z.string().optional(),
});
type TxnFormValues = z.infer<typeof txnSchema>;

/**
 * Dialog thêm THU (xanh) hoặc CHI (đỏ) — dùng chung, đổi hành vi theo `direction`.
 * Nguồn tiền chọn [Sàn]+[Shop]; túi tiền do BACKEND ép = Ngân hàng (ERP: thu/chi
 * thủ công luôn qua ngân hàng, KHÔNG đụng Ví sàn).
 */
export function AddTxnDialog({
  direction,
  channels,
  onAdded,
}: {
  direction: TransactionDirection;
  channels: Channel[];
  onAdded: () => void;
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
      expenseDate: "",
      note: "",
    },
  });
  const expenseType = form.watch("type");
  const selectedPlatform = form.watch("platform");
  const selectedShop = form.watch("shopChannelId");
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
    try {
      await createOperatingTxn({
        direction,
        name: values.name,
        amount: Number(values.amount),
        // "ALL" (Tất cả shop) → bỏ trống fundChannelId: backend lưu null = khoản chung.
        // Sàn cụ thể + "Tất cả các shop" → gửi kèm fundPlatform = khoản chung CẤP SÀN.
        fundChannelId: values.shopChannelId === "ALL" ? undefined : values.shopChannelId,
        fundPlatform:
          values.shopChannelId === "ALL" && values.platform && values.platform !== "ALL"
            ? (values.platform as ChannelName)
            : undefined,
        ...(isIncome
          ? {}
          : {
              type: values.type,
              category: values.category,
              appliedSku:
                values.type === "VARIABLE" && values.appliedSku
                  ? values.appliedSku
                  : undefined,
            }),
        expenseDate: values.expenseDate || undefined,
        note: values.note?.trim() || undefined,
      });
      toast.success(`Đã thêm khoản ${isIncome ? "thu" : "chi"} "${values.name}"`);
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
      <DialogContent className="sm:max-w-md">
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
                        isIncome ? "VD: Hoàn tiền nhà cung cấp" : "VD: Thuê mặt bằng tháng 7"
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
                          <option value="FIXED">Cố định (FIXED)</option>
                          <option value="VARIABLE">Biến đổi (VARIABLE)</option>
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

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Số tiền (₫)</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" placeholder="8000000" {...field} />
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
                    <FormLabel>Ngày phát sinh</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
                {isIncome ? "Lưu khoản thu" : "Lưu chi phí"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
