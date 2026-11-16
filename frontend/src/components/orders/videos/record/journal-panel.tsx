"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatJournalTime, journalAsText, type JournalEntry } from "@/lib/pack-video-recorder/journal";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * NHẬT KÝ của màn quay — anh Trung 16/11/2026: "giữ lại cả nhật ký nữa nhé. Khá cần".
 * Luôn hiện dưới khung quay, dòng mới nhất trên cùng, cuộn trong hộp. Nút "Chép nhật ký" để dán gửi
 * đi khi cần hỏi vì sao một kiện không có video. Nhật ký của hôm nay được giữ qua lần tải lại trang.
 */
export function JournalPanel({ entries }: { entries: JournalEntry[] }) {
  const newestFirst = [...entries].reverse();

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(journalAsText(entries));
      toast.success(`Đã chép ${entries.length.toLocaleString("vi-VN")} dòng nhật ký`);
    } catch {
      toast.error("Trình duyệt không cho chép — hãy bôi đen rồi chép tay");
    }
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-base font-semibold">Nhật ký</p>
            <p className={TEXT_SUB}>Hôm nay · {entries.length.toLocaleString("vi-VN")} dòng · dòng mới nhất ở trên</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void copyAll()} disabled={entries.length === 0}>
            <Copy className="size-3.5" />
            Chép nhật ký
          </Button>
        </div>
        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Chưa có gì. Bật camera là nhật ký bắt đầu ghi.</p>
        ) : (
          <ol className="mt-3 max-h-64 overflow-y-auto rounded-lg border bg-muted/30 text-sm" aria-label="Nhật ký quay">
            {newestFirst.map((entry) => (
              <li key={entry.id} className="flex gap-3 border-b px-3 py-1.5 last:border-b-0">
                <span className="shrink-0 font-mono text-xs leading-5 text-muted-foreground tabular-nums">
                  {formatJournalTime(entry.at)}
                </span>
                <span
                  className={cn(
                    "min-w-0 break-words",
                    entry.level === "warn" && "text-amber-700",
                    entry.level === "error" && "font-medium text-rose-700"
                  )}
                >
                  {entry.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
