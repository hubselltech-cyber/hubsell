import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Thẻ <select> gốc của trình duyệt, style đồng bộ với shadcn/ui.
// Dùng cho các chỗ chọn nhanh (chọn sàn, chọn sản phẩm gốc khi mapping).
export function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        className={cn(
          // Đồng bộ cỡ chữ với ô Input theo quy chuẩn hệ thống
          "text-base md:text-sm 2xl:text-base",
          "h-9 w-full appearance-none rounded-lg border border-input bg-background py-1 pl-3 pr-8 shadow-xs transition-colors outline-none",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
