"use client";

import { HelpCircle } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TEXT_SUB } from "@/lib/typography";
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
              // Cỡ chữ dòng phụ theo quy chuẩn hệ thống.
              // KHÔNG gạch chân: một rừng gạch chấm dưới mỗi con số làm bảng
              // trông bẩn. Con trỏ đổi thành dấu hỏi là đủ báo "hover được".
              TEXT_SUB,
              "cursor-help text-left leading-tight transition-colors hover:text-slate-900",
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
