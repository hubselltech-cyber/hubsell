import type { ReactNode } from "react";
import { Lock } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { TEXT_SUB } from "@/lib/typography";

/**
 * THẺ "CHƯA MỞ" — tầng 2 của một cổng tính năng (tầng 1 = mục sidebar mờ + ổ khóa,
 * xem lib/features.ts). Ai gõ thẳng đường dẫn của trang chưa mở cho tài khoản mình
 * chỉ thấy thẻ này; trang KHÔNG gọi API nào.
 */
export function FeatureLockedCard({
  title,
  description,
  action,
}: {
  /** Vd "Video đóng hàng chưa mở". */
  title: string;
  description: ReactNode;
  /** Nút / đường dẫn đưa người dùng về chỗ làm việc được. */
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-muted">
          <Lock className="size-5 text-muted-foreground" />
        </span>
        <div className="max-w-md space-y-1">
          <p className="text-sm font-medium text-slate-900">{title}</p>
          <p className={TEXT_SUB}>{description}</p>
        </div>
        {action}
      </CardContent>
    </Card>
  );
}
