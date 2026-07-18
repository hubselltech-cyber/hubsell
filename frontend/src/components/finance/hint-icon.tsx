"use client";

import { HelpCircle } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/// Icon dấu hỏi nhỏ — hover vào để xem giải thích công thức/ý nghĩa chỉ số.
export function HintIcon({
  hint,
  className,
}: {
  hint: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Giải thích"
            className={cn(
              "text-muted-foreground/60 transition-colors hover:text-foreground",
              className
            )}
          />
        }
      >
        <HelpCircle className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

/// Dòng chữ nhỏ có tooltip — hover vào là hiện giải thích công thức.
/// Dùng cho các dòng phụ (sub-info) lồng dưới số liệu chính trong bảng.
export function HintText({
  children,
  hint,
  className,
}: {
  children: React.ReactNode;
  hint: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            // Trông như chữ thường nhưng vẫn focus được bằng bàn phím
            className={cn(
              "cursor-help text-xs leading-tight underline decoration-dotted underline-offset-2 transition-colors",
              className
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}
