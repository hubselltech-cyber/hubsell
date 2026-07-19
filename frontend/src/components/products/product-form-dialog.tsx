"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { createProduct, getStoredUser, ApiError } from "@/lib/api";
import { canSeeFinancials } from "@/lib/permissions";
import { cn } from "@/lib/utils";

// Ô nhập là chuỗi; kiểm tra rồi mới chuyển sang số khi gửi đi
const numberString = (message: string) =>
  z
    .string()
    .trim()
    .min(1, "Vui lòng nhập giá trị")
    .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, message);

const productSchema = z.object({
  skuCode: z.string().trim().min(1, "Vui lòng nhập mã SKU").max(50, "SKU tối đa 50 ký tự"),
  productName: z.string().trim().min(1, "Vui lòng nhập tên sản phẩm"),
  costPrice: numberString("Giá vốn phải là số không âm"),
  sellingPrice: numberString("Giá bán phải là số không âm"),
  initialQuantity: numberString("Số lượng phải là số nguyên không âm").refine(
    (v) => Number.isInteger(Number(v)),
    "Số lượng phải là số nguyên"
  ),
});

type ProductFormValues = z.infer<typeof productSchema>;

export function ProductFormDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const seesCost = canSeeFinancials(getStoredUser()?.role);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      skuCode: "",
      productName: "",
      // Ô giá vốn bị ẩn với nhân viên nên phải có sẵn giá trị hợp lệ, nếu không
      // biểu mẫu sẽ báo lỗi ở một ô mà họ không nhìn thấy để sửa.
      costPrice: seesCost ? "" : "0",
      sellingPrice: "",
      initialQuantity: "0",
    },
  });

  async function onSubmit(values: ProductFormValues) {
    setSubmitting(true);
    try {
      const created = await createProduct({
        skuCode: values.skuCode,
        productName: values.productName,
        costPrice: Number(values.costPrice),
        sellingPrice: Number(values.sellingPrice),
        initialQuantity: Number(values.initialQuantity),
      });
      toast.success(`Đã thêm sản phẩm "${created.productName}"`);
      form.reset({ costPrice: seesCost ? "" : "0" });
      setOpen(false);
      onCreated();
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
        Thêm sản phẩm mới
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Thêm sản phẩm mới</DialogTitle>
          <DialogDescription>
            Nhập thông tin sản phẩm. Số lượng ban đầu sẽ được ghi vào lịch sử kho.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="skuCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mã SKU</FormLabel>
                  <FormControl>
                    <Input placeholder="VD: SP006" {...field} />
                  </FormControl>
                  <FormDescription>Mã duy nhất để nhận diện sản phẩm.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="productName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tên sản phẩm</FormLabel>
                  <FormControl>
                    <Input placeholder="VD: Áo khoác gió unisex" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Nhân viên không đặt giá vốn — chủ shop vào cấu hình sau ở trang
                Cấu hình Giá vốn. Máy chủ cũng bỏ qua trường này nếu nhân viên gửi lên. */}
            <div className={cn("grid gap-4", seesCost && "grid-cols-2")}>
              {seesCost && (
                <FormField
                  control={form.control}
                  name="costPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Giá vốn (₫)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="65000" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="sellingPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Giá bán (₫)</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" placeholder="129000" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="initialQuantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Số lượng kho ban đầu</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" step="1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
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
                Lưu sản phẩm
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
