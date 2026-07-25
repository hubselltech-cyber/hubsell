"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Receipt,
  Scale,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { canAccessFinance } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";
import { DashboardCard } from "@/components/dashboard/dashboard-card";
import { DateRangePicker } from "@/components/date-range-picker";
import { Refreshing } from "@/components/refreshing";
import { defaultRange, type DateRange } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Card, CardContent } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  createOperatingTxn,
  deleteExpense,
  fetchChannels,
  fetchExpenses,
  fetchProducts,
  getStoredUser,
  getToken,
  type Channel,
  type ExpenseCategory,
  type ExpenseType,
  type FundSourceType,
  type OperatingExpense,
  type Product,
  type TransactionDirection,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { cn } from "@/lib/utils";
import { formatVND, formatDateTime } from "@/lib/format";

const TYPE_META: Record<ExpenseType, { label: string; className: string }> = {
  FIXED: { label: "Cố định", className: "bg-blue-50 text-blue-700 border-blue-200" },
  VARIABLE: { label: "Biến đổi", className: "bg-amber-50 text-amber-700 border-amber-200" },
};
const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  RENT: "Mặt bằng",
  SALARY: "Nhân viên",
  PACKAGING: "Đóng gói",
  ADS: "Quảng cáo",
  OTHER: "Khác",
};
const CATEGORIES: ExpenseCategory[] = ["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"];
const SOURCE_LABEL: Record<FundSourceType, string> = {
  PLATFORM_WALLET: "Ví sàn",
  BANK_ACCOUNT: "Ngân hàng",
};

/** Nhãn nguồn tiền của một dòng thu/chi (gian + túi tiền). */
function fundLabel(e: OperatingExpense): string | null {
  if (!e.fundShopName || !e.fundSource) return null;
  return `${e.fundShopName} — ${SOURCE_LABEL[e.fundSource]}`;
}

const txnSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập nội dung"),
  amount: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập số tiền")
    .refine((v) => Number(v) > 0, "Số tiền phải là số dương"),
  platform: z.string().optional(), // chỉ dùng cho CHI để lọc shop theo sàn
  shopChannelId: z.string().min(1, "Vui lòng chọn gian hàng"),
  type: z.enum(["FIXED", "VARIABLE"]).optional(),
  category: z.enum(["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"]).optional(),
  appliedSku: z.string().optional(),
  expenseDate: z.string().optional(),
  note: z.string().optional(),
});
type TxnFormValues = z.infer<typeof txnSchema>;

/** Dialog thêm THU hoặc CHI (dùng chung, đổi hành vi theo `direction`). */
function AddTxnDialog({
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
  // Cả THU lẫn CHI: chọn Sàn rồi Shop (shop lọc theo sàn đã chọn).
  const platforms = Array.from(new Set(channels.map((c) => c.channelName)));
  const shopOptions = channels.filter((c) => c.channelName === selectedPlatform);

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
    // THU luôn về Ngân hàng; CHI luôn ra từ Ví sàn (không cho chọn túi tiền cho gọn).
    const fundChannelId = values.shopChannelId;
    const fundSource: FundSourceType = isIncome ? "BANK_ACCOUNT" : "PLATFORM_WALLET";
    setSubmitting(true);
    try {
      await createOperatingTxn({
        direction,
        name: values.name,
        amount: Number(values.amount),
        fundChannelId,
        fundSource,
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
            className={cn(
              isIncome && "bg-emerald-600 text-white hover:bg-emerald-700"
            )}
          />
        }
      >
        <Plus className="size-4" />
        {isIncome ? "Thêm khoản thu" : "Thêm chi phí"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={isIncome ? "text-emerald-600" : "text-rose-600"}>
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

            {/* NGUỒN TIỀN — cả THU lẫn CHI: chọn Sàn rồi Shop. Túi tiền mặc định
                theo chiều: THU → Ngân hàng, CHI → Ví sàn (không cho chọn cho gọn). */}
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
                          form.setValue("shopChannelId", ""); // đổi sàn → reset shop
                        }}
                      >
                        <option value="">— Chọn sàn —</option>
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
                        <option value="">
                          {!selectedPlatform ? "— Chọn sàn trước —" : "— Chọn gian hàng —"}
                        </option>
                        {shopOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.shopName}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {isIncome
                ? "Khoản thu sẽ CỘNG vào cột Ngân hàng của gian này trong Báo cáo dòng tiền."
                : "Khoản chi sẽ TRỪ khỏi cột Ví sàn của gian này trong Báo cáo dòng tiền."}
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

type TxnFilter = "ALL" | "INCOME" | "EXPENSE";

export default function FinanceExpensesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<OperatingExpense[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [filter, setFilter] = useState<TxnFilter>("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [txns, chs] = await Promise.all([fetchExpenses(range), fetchChannels()]);
      setRows(txns);
      setChannels(chs);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
    } finally {
      setLoading(false);
    }
  }, [router, range]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!canAccessFinance(getStoredUser()?.role)) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load();
  }, [load, router]);

  async function handleDelete(e: OperatingExpense) {
    setDeletingId(e.id);
    try {
      await deleteExpense(e.id);
      toast.success("Đã xoá khoản thu/chi");
      load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xoá được");
    } finally {
      setDeletingId(null);
    }
  }

  if (denied) {
    return (
      <AppShell>
        <AccessDenied />
      </AppShell>
    );
  }

  // Lọc theo loại giao dịch — bảng VÀ 3 card đều tính trên tập đã lọc.
  const shown = filter === "ALL" ? rows : rows.filter((e) => e.direction === filter);
  const totalIncome = shown
    .filter((e) => e.direction === "INCOME")
    .reduce((s, e) => s + Number(e.amount), 0);
  const totalExpense = shown
    .filter((e) => e.direction === "EXPENSE")
    .reduce((s, e) => s + Number(e.amount), 0);
  const net = totalIncome - totalExpense;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Thu &amp; chi vận hành của shop ({shown.length} khoản).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} disabled={loading} />
            <NativeSelect
              className="w-40"
              aria-label="Lọc loại giao dịch"
              value={filter}
              onChange={(e) => setFilter(e.target.value as TxnFilter)}
            >
              <option value="ALL">Tất cả</option>
              <option value="INCOME">Chỉ khoản thu</option>
              <option value="EXPENSE">Chỉ khoản chi</option>
            </NativeSelect>
            <AddTxnDialog direction="EXPENSE" channels={channels} onAdded={load} />
            <AddTxnDialog direction="INCOME" channels={channels} onAdded={load} />
          </div>
        </div>

        {/* 3 card tổng hợp — theo tập đã lọc */}
        <Refreshing active={loading} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DashboardCard
            title="Tổng khoản thu"
            value={<Money value={totalIncome} />}
            icon={TrendingUp}
            tone="positive"
            colorValue
            subtitle="Tiền vào vận hành trong kỳ"
          />
          <DashboardCard
            title="Tổng khoản chi"
            value={<Money value={totalExpense} negative />}
            icon={TrendingDown}
            tone="negative"
            colorValue
            subtitle="Tiền ra vận hành trong kỳ"
          />
          <DashboardCard
            title="Dòng tiền thuần vận hành"
            value={<Money value={Math.abs(net)} negative={net < 0} />}
            icon={Scale}
            tone={net < 0 ? "negative" : "positive"}
            colorValue
            subtitle="Tổng thu − Tổng chi"
          />
        </Refreshing>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Đang tải…</p>
            ) : shown.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Receipt className="mx-auto mb-2 size-8" />
                Chưa có khoản thu/chi nào. Bấm “Thêm khoản thu” hoặc “Thêm chi phí”.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nội dung</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead>Nguồn tiền</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                    <TableHead className="text-right">Ngày</TableHead>
                    <TableHead className="text-center">Xoá</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((e) => {
                    const income = e.direction === "INCOME";
                    const meta = TYPE_META[e.type];
                    const src = fundLabel(e);
                    return (
                      <TableRow key={e.id}>
                        <TableCell>
                          <p className="font-medium">{e.name}</p>
                          {e.note && (
                            <p className="text-xs text-muted-foreground">{e.note}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          {income ? (
                            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              Thu
                            </span>
                          ) : (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                            >
                              {meta.label}
                            </span>
                          )}
                          {!income && e.appliedSku && (
                            <span className="mt-0.5 block font-mono text-xs text-primary">
                              → {e.appliedSku}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {src ?? <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold",
                            income ? "text-emerald-600" : "text-rose-600"
                          )}
                        >
                          {income ? "+ " : "− "}
                          {formatVND(e.amount)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatDateTime(e.expenseDate)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-rose-600"
                            disabled={deletingId === e.id}
                            onClick={() => handleDelete(e)}
                          >
                            {deletingId === e.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Trash2 className="size-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Hubsell Finance · Thu chi vận hành
        </p>
      </div>
    </AppShell>
  );
}
