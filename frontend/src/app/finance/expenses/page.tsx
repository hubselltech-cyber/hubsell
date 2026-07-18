"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, Receipt, Trash2 } from "lucide-react";

import { AccessDenied } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
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
  createFinanceExpense,
  deleteExpense,
  fetchExpenses,
  fetchProducts,
  getStoredUser,
  getToken,
  type ExpenseCategory,
  type ExpenseType,
  type OperatingExpense,
  type Product,
} from "@/lib/api";
import { formatVND, formatDateTime } from "@/lib/format";

// Nhãn phân loại cố định / biến đổi
const TYPE_META: Record<ExpenseType, { label: string; className: string }> = {
  FIXED: {
    label: "Cố định",
    className: "bg-blue-100 text-blue-700 border-blue-200",
  },
  VARIABLE: {
    label: "Biến đổi",
    className: "bg-amber-100 text-amber-700 border-amber-200",
  },
};

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  RENT: "Mặt bằng",
  SALARY: "Nhân viên",
  PACKAGING: "Đóng gói",
  ADS: "Quảng cáo",
  OTHER: "Khác",
};
const CATEGORIES: ExpenseCategory[] = ["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"];

const expenseSchema = z.object({
  description: z.string().trim().min(1, "Vui lòng nhập mô tả khoản chi"),
  type: z.enum(["FIXED", "VARIABLE"]),
  category: z.enum(["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"]),
  appliedSku: z.string().optional(),
  amount: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập số tiền")
    .refine((v) => Number(v) > 0, "Số tiền phải là số dương"),
  expenseDate: z.string().optional(),
  note: z.string().optional(),
});
type ExpenseFormValues = z.infer<typeof expenseSchema>;

function AddExpenseDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [skus, setSkus] = useState<Product[]>([]);
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      description: "",
      type: "FIXED",
      category: "RENT",
      appliedSku: "",
      amount: "",
      expenseDate: "",
      note: "",
    },
  });

  // Theo dõi loại chi phí để hiện/ẩn ô chọn SKU
  const expenseType = form.watch("type");

  // Nạp danh sách SKU khi mở hộp thoại (để gắn chi phí biến đổi vào sản phẩm)
  useEffect(() => {
    if (!open) return;
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
        // không tải được thì để trống, người dùng vẫn lưu được chi phí cố định
      }
    })();
  }, [open]);

  async function onSubmit(values: ExpenseFormValues) {
    setSubmitting(true);
    try {
      await createFinanceExpense({
        description: values.description,
        type: values.type,
        category: values.category,
        // Chỉ gắn SKU khi là chi phí biến đổi
        appliedSku:
          values.type === "VARIABLE" && values.appliedSku
            ? values.appliedSku
            : undefined,
        amount: Number(values.amount),
        expenseDate: values.expenseDate || undefined,
        note: values.note?.trim() || undefined,
      });
      toast.success(`Đã thêm chi phí "${values.description}"`);
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
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        Thêm chi phí
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm chi phí vận hành</DialogTitle>
          <DialogDescription>
            Ghi nhận chi phí cố định (mặt bằng, lương…) hoặc biến đổi (quảng cáo,
            đóng gói…) để tính Lợi nhuận thuần.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mô tả khoản chi</FormLabel>
                  <FormControl>
                    <Input placeholder="VD: Thuê mặt bằng tháng 7" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
            {/* Chi phí biến đổi → cho phép gắn vào 1 mã SKU cụ thể */}
            {expenseType === "VARIABLE" && (
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
                      Gõ mã SKU hoặc tên sản phẩm để tìm nhanh. Khoản chi sẽ được
                      tính vào lời/lỗ riêng của sản phẩm đó (bảng SKU P&amp;L).
                    </FormDescription>
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
                    <FormLabel>Ngày chi</FormLabel>
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
                    <Input placeholder="VD: Cửa hàng + kho" {...field} />
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
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin" />}
                Lưu chi phí
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function FinanceExpensesPage() {
  const router = useRouter();
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setExpenses(await fetchExpenses());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        setDenied(true);
        return;
      }
      // 409 (chưa có kênh) — AppShell overlay xử lý
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (getStoredUser()?.role === "STAFF") {
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
      toast.success("Đã xoá khoản chi phí");
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

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const fixed = expenses
    .filter((e) => e.type === "FIXED")
    .reduce((s, e) => s + Number(e.amount), 0);
  const variable = total - fixed;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Danh sách chi phí vận hành của shop ({expenses.length} khoản).
          </p>
          <AddExpenseDialog onAdded={load} />
        </div>

        {/* Tổng quan nhanh */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Tổng chi phí</p>
              <p className="text-2xl font-bold text-rose-600">{formatVND(total)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Chi phí cố định</p>
              <p className="text-2xl font-bold text-blue-700">{formatVND(fixed)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">Chi phí biến đổi</p>
              <p className="text-2xl font-bold text-amber-700">
                {formatVND(variable)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Đang tải…
              </p>
            ) : expenses.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Receipt className="mx-auto mb-2 size-8" />
                Chưa có khoản chi phí nào. Bấm “Thêm chi phí” để bắt đầu.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mô tả</TableHead>
                    <TableHead>Phân loại</TableHead>
                    <TableHead>Nhóm</TableHead>
                    <TableHead className="text-right">Số tiền</TableHead>
                    <TableHead className="text-right">Ngày chi</TableHead>
                    <TableHead className="text-center">Xoá</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((e) => {
                    const meta = TYPE_META[e.type];
                    return (
                      <TableRow key={e.id}>
                        <TableCell>
                          <p className="font-medium">{e.name}</p>
                          {e.note && (
                            <p className="text-xs text-muted-foreground">{e.note}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                          >
                            {meta.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {CATEGORY_LABEL[e.category]}
                          {e.appliedSku && (
                            <span className="mt-0.5 block font-mono text-xs text-primary">
                              → {e.appliedSku}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-rose-600">
                          − {formatVND(e.amount)}
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
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
          Hubsell Finance · Chi phí vận hành
        </p>
      </div>
    </AppShell>
  );
}
