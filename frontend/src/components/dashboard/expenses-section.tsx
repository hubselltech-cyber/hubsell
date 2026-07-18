"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, Receipt, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  ApiError,
  createExpense,
  deleteExpense,
  fetchExpenses,
  type ExpenseCategory,
  type OperatingExpense,
} from "@/lib/api";
import { formatVND, formatDateTime } from "@/lib/format";

// Nhãn & màu cho từng loại chi phí
export const EXPENSE_CATEGORY_META: Record<
  ExpenseCategory,
  { label: string; className: string }
> = {
  RENT: { label: "Mặt bằng", className: "bg-blue-100 text-blue-700 border-blue-200" },
  SALARY: { label: "Nhân viên", className: "bg-violet-100 text-violet-700 border-violet-200" },
  PACKAGING: { label: "Đóng gói", className: "bg-amber-100 text-amber-700 border-amber-200" },
  ADS: { label: "Quảng cáo", className: "bg-rose-100 text-rose-700 border-rose-200" },
  OTHER: { label: "Khác", className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
};

const CATEGORIES: ExpenseCategory[] = ["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"];

const expenseSchema = z.object({
  name: z.string().trim().min(1, "Vui lòng nhập tên khoản chi"),
  category: z.enum(["RENT", "SALARY", "PACKAGING", "ADS", "OTHER"]),
  amount: z
    .string()
    .trim()
    .min(1, "Vui lòng nhập số tiền")
    .refine((v) => Number(v) > 0, "Số tiền phải là số dương"),
  note: z.string().optional(),
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

function AddExpenseDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: { name: "", category: "RENT", amount: "", note: "" },
  });

  async function onSubmit(values: ExpenseFormValues) {
    setSubmitting(true);
    try {
      await createExpense({
        name: values.name,
        category: values.category,
        amount: Number(values.amount),
        note: values.note?.trim() || undefined,
      });
      toast.success(`Đã thêm chi phí "${values.name}"`);
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
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        Thêm chi phí
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm chi phí hoạt động</DialogTitle>
          <DialogDescription>
            Ghi nhận các khoản chi cố định/biến đổi để tính Lợi nhuận thuần.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên khoản chi</FormLabel>
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
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Loại chi phí</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {EXPENSE_CATEGORY_META[c].label}
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

export function ExpensesSection({
  onChanged,
}: {
  onChanged: () => void; // báo Dashboard tải lại analytics khi chi phí thay đổi
}) {
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setExpenses(await fetchExpenses());
    } catch {
      // Dashboard đã xử lý 401/403; ở đây chỉ cần im lặng
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteExpense(id);
      toast.success("Đã xoá khoản chi phí");
      load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không xoá được");
    } finally {
      setDeletingId(null);
    }
  }

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-5" />
            Chi phí hoạt động
          </CardTitle>
          <CardDescription>
            Mặt bằng, lương, đóng gói, quảng cáo sàn… — dùng để tính Lợi nhuận thuần.
          </CardDescription>
        </div>
        <AddExpenseDialog
          onAdded={() => {
            load();
            onChanged();
          }}
        />
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Đang tải…
          </p>
        ) : expenses.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Chưa có khoản chi phí nào. Bấm “Thêm chi phí” để bắt đầu.
          </p>
        ) : (
          <div className="space-y-2">
            {expenses.map((e) => {
              const meta = EXPENSE_CATEGORY_META[e.category];
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2"
                >
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatDateTime(e.expenseDate)}
                      {e.note ? ` · ${e.note}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold text-rose-600">
                    − {formatVND(e.amount)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-rose-600"
                    disabled={deletingId === e.id}
                    onClick={() => handleDelete(e.id)}
                  >
                    {deletingId === e.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </div>
              );
            })}

            {/* Tổng cộng */}
            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-medium">Tổng chi phí hoạt động</span>
              <span className="text-base font-bold text-rose-600">
                − {formatVND(total)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
