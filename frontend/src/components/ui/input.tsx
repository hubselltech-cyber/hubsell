import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Cỡ chữ theo quy chuẩn: mobile 16px (chống iOS tự phóng to khi focus),
        // từ md trở lên 14px Ở MỌI CỠ MÀN. 19/09/2026 bỏ 2xl:text-base: màn PC
        // ≥1536px chữ trong ô nở 16px trong khi nhãn, chữ thân, textarea vẫn 14px
        // → chữ trong hộp to hơn cả nhãn của nó (anh Trung: "text quá to").
        "text-base md:text-sm",
        "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
