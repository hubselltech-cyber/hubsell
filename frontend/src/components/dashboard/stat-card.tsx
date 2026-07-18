import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  accentClass?: string; // màu nền của ô icon
}

export function StatCard({
  label,
  value,
  icon: Icon,
  accentClass = "bg-primary/10 text-primary",
}: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div
          className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${accentClass}`}
        >
          <Icon className="size-6" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {/* break-words thay vì truncate để số tiền dài không bị cắt mất chữ số */}
          <p className="text-xl font-semibold leading-tight tracking-tight break-words">
            {value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
