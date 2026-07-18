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
