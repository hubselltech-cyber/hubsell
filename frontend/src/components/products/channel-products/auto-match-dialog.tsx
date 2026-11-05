"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, linkMappingPairs, previewAutoMatch, type AutoMatchCandidate } from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { formatNumber } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * TỰ KHỚP MÃ TRÙNG — CÓ BƯỚC XEM LẠI (docs/SAN-PHAM-TREN-SAN-THIET-KE-LAI.md mục 6.3).
 * Chỉ trùng mã chính xác (luật anh Trung 22/10). Ba nhóm: Khớp chắc (tick sẵn) · Cần rà (không tick,
 * có lý do — học Sapo "chế độ an toàn") · Không khớp (chỉ đếm). Bấm Áp → /link-batch với cặp đã tick.
 */
export function AutoMatchDialog({
  open,
  onOpenChange,
  channelId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId?: string;
  onDone?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ sure: AutoMatchCandidate[]; review: AutoMatchCandidate[]; none: number; scanned: number } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setData(null);
    previewAutoMatch(channelId)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setChecked(new Set(d.sure.map((c) => c.channelProductId)));
      })
      .catch((err) => toast.error(err instanceof ApiError ? err.message : "Không xem trước được"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, channelId]);

  const all = useMemo(() => [...(data?.sure ?? []), ...(data?.review ?? [])], [data]);
  const selected = all.filter((c) => checked.has(c.channelProductId));

  function toggle(id: string) {
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleGroup(list: AutoMatchCandidate[], on: boolean) {
    setChecked((s) => {
      const n = new Set(s);
      for (const c of list) {
        if (on) n.add(c.channelProductId);
        else n.delete(c.channelProductId);
      }
      return n;
    });
  }

  async function apply() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      let linked = 0;
      for (let i = 0; i < selected.length; i += 500) {
        const r = await linkMappingPairs(
          selected.slice(i, i + 500).map((c) => ({ channelProductId: c.channelProductId, productId: c.productId })),
          "auto"
        );
        linked += r.linked;
      }
      toast.success(`Đã nối ${formatNumber(linked)} phân loại theo mã trùng.`);
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không áp được", { duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Tự khớp mã trùng — xem lại trước khi áp
          </DialogTitle>
          <DialogDescription>
            Chỉ ghép khi mã SKU trên sàn trùng đúng một mã trong Tổng kho. Không đoán theo tên hay giá. Mã trùng ở nhiều chỗ thì đưa vào Cần rà
            để bạn quyết.
          </DialogDescription>
        </DialogHeader>
        {loading || !data ? (
          <p className={cn(TEXT_SUB, "inline-flex items-center gap-2")}>
            <Loader2 className="size-4 animate-spin" /> Đang so mã sàn với Tổng kho…
          </p>
        ) : (
          <>
            <MatchGroup title="Khớp chắc" note="mã sàn = đúng một SKU kho" list={data.sure} tone="ok" checked={checked} onToggle={toggle} onToggleGroup={toggleGroup} />
            <MatchGroup title="Cần rà" note="mã trùng nhưng có điều đáng ngờ — bật từng dòng nếu đúng" list={data.review} tone="warn" checked={checked} onToggle={toggle} onToggleGroup={toggleGroup} />
            <p className={TEXT_SUB}>
              Không khớp: {formatNumber(data.none)} phân loại (trong {formatNumber(data.scanned)} đã quét) — nối tay bằng nút &ldquo;Nối kho&rdquo;; hàng chưa có trong kho thì tạo ở Tổng kho trước.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className={cn(TEXT_SUB, "tabular-nums")}>{formatNumber(selected.length)} cặp sẽ nối</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                  Hủy
                </Button>
                <Button disabled={busy || selected.length === 0} onClick={() => void apply()}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Áp {formatNumber(selected.length)} liên kết
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MatchGroup({
  title,
  note,
  list,
  tone,
  checked,
  onToggle,
  onToggleGroup,
}: {
  title: string;
  note: string;
  list: AutoMatchCandidate[];
  tone: "ok" | "warn";
  checked: Set<string>;
  onToggle: (id: string) => void;
  onToggleGroup: (list: AutoMatchCandidate[], on: boolean) => void;
}) {
  const allOn = list.length > 0 && list.every((c) => checked.has(c.channelProductId));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-4 accent-primary" checked={allOn} disabled={list.length === 0} onChange={(e) => onToggleGroup(list, e.target.checked)} />
          {title}
          <span className={cn("rounded-full px-2 py-0.5 text-xs", tone === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
            {formatNumber(list.length)}
          </span>
        </label>
        <span className={TEXT_SUB}>{note}</span>
      </div>
      {list.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border">
          <table className="w-full table-fixed text-sm">
            <tbody>
              {list.map((c) => (
                <tr key={c.channelProductId} className="border-b last:border-b-0">
                  <td className="w-8 px-2 py-1.5 align-top">
                    <input type="checkbox" className="size-4 accent-primary" checked={checked.has(c.channelProductId)} onChange={() => onToggle(c.channelProductId)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="truncate" title={c.productName}>
                      {c.productName}
                      {c.variantName ? <span className="text-muted-foreground"> · {c.variantName}</span> : null}
                    </div>
                    <div className={cn(TEXT_SUB, "truncate")}>
                      {CHANNEL_META[c.channelName].label} · {c.shopName} · <span className="font-mono">{c.channelSku}</span>
                    </div>
                  </td>
                  <td className="w-[38%] px-2 py-1.5">
                    <div className="truncate font-mono text-xs">{c.productSku}</div>
                    <div className={cn(TEXT_SUB, "truncate")}>
                      {c.productTitle}
                      {c.productVariant ? ` · ${c.productVariant}` : ""}
                    </div>
                    {c.reason && <div className="text-xs text-amber-700">{c.reason}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
