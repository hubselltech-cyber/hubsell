import * as React from "react";

import { cn } from "@/lib/utils";

/** Ô nhập nhiều dòng — cùng viền / focus / cỡ chữ với Input (14 px từ md, 16 px mobile). */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "text-base md:text-sm",
        "min-h-9 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 leading-6 transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
