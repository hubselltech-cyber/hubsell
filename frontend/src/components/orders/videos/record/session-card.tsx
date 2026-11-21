"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatHoursBalance } from "@/lib/pack-video";
import { retrySessionClip, type SessionClip } from "@/lib/pack-video-recorder/session";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

import { KIND_ACCENT, formatElapsed } from "./record-bits";

const STATUS_TEXT: Record<Exclude<SessionClip["status"], "recording" | "failed">, string> = {
  saving: "đang lưu",
  queued: "chờ tải lên",
  uploading: "đang tải lên",
  stored: "đã tải lên",
};

/**
 * Một clip đã quay xong của lượt: mã tem · thời lượng · đang ở bước nào; clip lỗi có nút "Thử lại".
 * MÃ TEM LUÔN HIỆN ĐỦ (anh Trung 21/11/2026: "mục đích anh muốn mã đơn hàng luôn được hiển thị đầy đủ") — không rút
 * gọn "…đuôi", không cắt "…"; dòng chật thì mã tự xuống dòng.
 */
function ClipLine({ clip }: { clip: SessionClip }) {
  if (clip.status === "recording") return null;
  const label = clip.manual ? "Quay tay" : clip.code;
  // Clip đang chờ sau một lần gửi hỏng: nói rõ là máy đang TỰ thử lại (không cần bấm gì).
  const retrying = clip.status === "queued" && !!clip.error;
  return (
    <li className="flex items-center justify-between gap-2 border-t py-1.5 text-sm first:border-t-0">
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {clip.kind === "UNBOX" && (
          <span className={cn("shrink-0 rounded px-1.5 py-px text-[11px] font-medium", KIND_ACCENT.UNBOX.chip)}>Khui</span>
        )}
        <span className={cn("min-w-0", !clip.manual && "break-all font-mono")}>{label}</span>
        {clip.restored && (
          <span
            className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600"
            title="Quay từ lượt trước, lúc đó chưa gửi được — đang gửi tiếp"
          >
            lượt trước
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2 tabular-nums">
        {clip.durationSec !== null && <span className="text-muted-foreground">{formatElapsed(clip.durationSec)}</span>}
        {clip.status === "failed" ? (
          <>
            <span className="font-medium text-rose-600" title={clip.error ?? undefined}>
              lỗi
            </span>
            {clip.sizeBytes !== null && (
              <Button variant="outline" size="xs" onClick={() => retrySessionClip(clip.localId)}>
                <RotateCcw className="size-3" />
                Thử lại
              </Button>
            )}
          </>
        ) : (
          <span
            className={cn("font-medium", clip.status === "stored" ? "text-emerald-600" : "text-amber-600")}
            title={clip.error ?? undefined}
          >
            {clip.status === "uploading"
              ? `tải lên ${Math.round(clip.progress * 100)} %`
              : retrying
                ? "chờ thử lại"
                : STATUS_TEXT[clip.status]}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Ô LƯỢT QUAY NÀY — nằm ngay dưới khung hình, bên phải ô "Đang quay cho tem", và là ô RỘNG của hàng đó.
 *
 * Anh Trung 21/11/2026: "chuyển lượt quay lên vùng anh khoanh → thiết kế dạng đếm số kiểu 10 (tải lên) / 12 (đã
 * quay)"; rồi về ô tem bên cạnh: "phần này có mỗi mã vận đơn, cho ngắn lại để nhường chỗ cho tab bên cạnh nhiều
 * thông tin hơn". Trước đó ô này nằm cuối cột điều khiển và rơi khỏi màn hình.
 *
 * Hai nửa, LUÔN XẾP CHỒNG ở mọi cỡ màn (anh chốt 21/11: "Luôn xếp chồng" — em từng cho đứng cạnh nhau ở màn rộng, đã bỏ):
 *   · TRÊN — bộ đếm: "tải lên" = clip đã nằm trên hệ thống, "đã quay" = clip đã quay XONG (clip đang quay dở hiện ở
 *     ô tem bên cạnh, chưa tính). Hai số bằng nhau thì số đầu xanh (không còn gì trên máy này), lệch thì vàng; dòng
 *     dưới nói còn mấy clip chờ lên / lỗi / bao nhiêu video khui.
 *   · DƯỚI — các clip gần nhất (mới nhất ở trên) kèm trạng thái tải lên và nút "Thử lại" cho clip lỗi.
 * Cả hai nửa CAO CỐ ĐỊNH: mỗi vài giây lại có clip lên xong, ô không được giật và đẩy Nhật ký lên xuống.
 */
export function SessionCard({ clips }: { clips: SessionClip[] }) {
  const recorded = clips.filter((c) => c.status !== "recording");
  const pending = recorded.filter((c) => c.status !== "stored");
  const uploaded = recorded.length - pending.length;
  const failed = pending.filter((c) => c.status === "failed").length;
  const waiting = pending.length - failed;
  const unboxCount = recorded.filter((c) => c.kind === "UNBOX").length;
  const total = recorded.reduce((sum, c) => sum + (c.durationSec ?? 0), 0);
  const allUp = recorded.length > 0 && pending.length === 0;
  const notes: { key: string; text: string; className: string }[] = [];
  if (waiting > 0) notes.push({ key: "w", text: `${waiting.toLocaleString("vi-VN")} đang chờ lên`, className: "text-amber-600" });
  if (failed > 0) notes.push({ key: "f", text: `${failed.toLocaleString("vi-VN")} lỗi`, className: "text-rose-600" });
  if (unboxCount > 0) {
    notes.push({ key: "u", text: `${unboxCount.toLocaleString("vi-VN")} video khui`, className: KIND_ACCENT.UNBOX.text });
  }
  return (
    <Card className="[--card-spacing:--spacing(4)]">
      <CardContent>
        <div className="flex flex-col gap-3">
          <div className="shrink-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className={TEXT_SUB}>Lượt quay này</p>
              {recorded.length > 0 && (
                <p className="text-xs text-muted-foreground tabular-nums" title="Tổng thời lượng các video đã quay trong lượt">
                  {formatHoursBalance(total)}
                </p>
              )}
            </div>
            {/* Lưới 3 cột × 2 hàng, đổ theo cột: [số tải lên · nhãn] [gạch chéo · trống] [số đã quay · nhãn]. */}
            <div
              role="group"
              className="mt-1.5 grid grid-flow-col grid-rows-[auto_auto] justify-start gap-x-3"
              aria-label={`Đã tải lên ${uploaded} trên ${recorded.length} video đã quay`}
            >
              <p
                className={cn(
                  "text-3xl font-semibold leading-none tabular-nums",
                  allUp ? "text-emerald-600" : pending.length > 0 && "text-amber-600"
                )}
              >
                {uploaded.toLocaleString("vi-VN")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">tải lên</p>
              <span className="text-3xl font-light leading-none text-muted-foreground/60" aria-hidden>
                /
              </span>
              <span aria-hidden />
              <p className="text-3xl font-semibold leading-none tabular-nums">{recorded.length.toLocaleString("vi-VN")}</p>
              <p className="mt-1 text-xs text-muted-foreground">đã quay</p>
            </div>
            {/* Dòng này luôn giữ chỗ (kể cả khi trống) để ô không đổi chiều cao. */}
            <p className="mt-2 h-4 truncate text-xs font-medium tabular-nums">
              {notes.map((note, index) => (
                <React.Fragment key={note.key}>
                  {index > 0 && <span className="text-muted-foreground"> · </span>}
                  <span className={note.className}>{note.text}</span>
                </React.Fragment>
              ))}
            </p>
          </div>
          <div className="min-w-0 border-t pt-2">
            {recorded.length === 0 ? (
              <p className="flex h-25 items-center justify-center text-center text-sm text-muted-foreground">
                Chưa quay video nào trong lượt này.
              </p>
            ) : (
              <ul className="h-25 overflow-y-auto pr-1" aria-label="Các video gần nhất của lượt">
                {recorded.slice(0, 30).map((clip) => (
                  <ClipLine key={clip.localId} clip={clip} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
