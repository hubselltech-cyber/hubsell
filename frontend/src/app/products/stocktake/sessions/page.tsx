"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Printer } from "lucide-react";

import { LocationSelect } from "@/components/products/location-select";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeaderBand } from "@/components/ui/page-tabs";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, createStocktakeSession, fetchStockLocations, fetchStocktakeSessions, getToken } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";
import { qk } from "@/lib/query-keys";
import { SESSION_STATUS_META } from "@/lib/stocktake-session";
import { TEXT_SUB } from "@/lib/typography";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

/**
 * KIỂM KÊ THEO PHIÊN — danh sách phiên + mở phiên mới (kho chuẩn quốc tế lát 5, 20/11/2026,
 * docs/QUAN-LY-KHO-CHUAN-QUOC-TE.md mục 17).
 *
 * Trang Kiểm kê nhanh (/products/stocktake) giữ nguyên cho shop một người đếm. Phiên là cách thêm cho
 * shop có nhân viên: nhiều người đếm vào một phiên, đếm xong gửi duyệt, chủ shop duyệt thì mới ghi vào
 * kho; có đếm mù và biên bản in. Mỗi phiên là một trang riêng (/products/stocktake/sessions/<id>).
 */
export default function StocktakeSessionsPage() {
  const router = useRouter();
  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const listQ = useApiQuery({ queryKey: qk.stocktakeSessions(), queryFn: fetchStocktakeSessions });
  const locationsQ = useApiQuery({ queryKey: qk.stockLocations(), queryFn: fetchStockLocations });
  const locations = locationsQ.data?.items ?? [];
  const locationsEnabled = locations.length > 0;

  const [locationId, setLocationId] = useState<string | null>(null);
  const effectiveLocationId =
    locationId ?? (locationsEnabled ? (locations.find((l) => l.isDefault)?.id ?? locations[0].id) : "");
  const [blind, setBlind] = useState(false);
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await createStocktakeSession({
        locationId: effectiveLocationId || undefined,
        blind,
        note: note.trim() || undefined,
      });
      router.push(`/products/stocktake/sessions/${res.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không kết nối được máy chủ");
      setCreating(false);
    }
  }

  const items = listQ.data?.items ?? [];

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeaderBand className="pb-4">
          <div className="space-y-1">
            <Link
              href="/products/stocktake"
              className={cn(TEXT_SUB, "inline-flex items-center gap-1 hover:text-foreground")}
            >
              <ArrowLeft className="size-3.5" />
              Kiểm kê nhanh
            </Link>
            <p className="text-sm text-muted-foreground">
              Kiểm kê theo phiên: nhiều người cùng đếm vào một phiên, đếm xong gửi duyệt. Chủ shop duyệt thì phần chênh
              mới ghi vào kho.
            </p>
          </div>
        </PageHeaderBand>

        {/* ===== MỞ PHIÊN MỚI ===== */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          {locationsEnabled && (
            <div className="grid w-64 gap-1.5">
              <Label htmlFor="kk-location">Vị trí kiểm</Label>
              <LocationSelect
                id="kk-location"
                locations={locations}
                value={effectiveLocationId}
                onChange={setLocationId}
                suffix={(l) => ` · ${formatNumber(l.skuCount)} SKU`}
              />
            </div>
          )}
          <div className="grid w-full max-w-xs gap-1.5">
            <Label htmlFor="kk-note">Ghi chú (không bắt buộc)</Label>
            <Input
              id="kk-note"
              placeholder="VD: kiểm cuối tháng 11"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <label
            className="flex h-9 items-center gap-2 text-sm"
            title="Người đếm không thấy số sổ và phần lệch khi đang đếm — đếm khách quan hơn. Chủ shop vẫn thấy."
          >
            <Switch checked={blind} onCheckedChange={setBlind} />
            Đếm mù
          </label>
          <Button onClick={() => void handleCreate()} disabled={creating || locationsQ.loading}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Mở phiên mới
          </Button>
        </div>

        {/* ===== DANH SÁCH PHIÊN ===== */}
        <div className="overflow-hidden rounded-lg border bg-card">
          {listQ.error ? (
            <p className="py-10 text-center text-sm text-amber-700">{listQ.error}</p>
          ) : listQ.loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Chưa có phiên kiểm kê nào. Mở phiên mới ở trên để bắt đầu.
            </p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Phiên</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    {locationsEnabled && <TableHead>Vị trí</TableHead>}
                    <TableHead>Người mở</TableHead>
                    <TableHead className="text-right">Số mã</TableHead>
                    <TableHead className="text-right">Chênh đã ghi</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((s) => {
                    const meta = SESSION_STATUS_META[s.status];
                    return (
                      <TableRow
                        key={s.id}
                        className="cursor-pointer"
                        onClick={() => router.push(`/products/stocktake/sessions/${s.id}`)}
                      >
                        <TableCell>
                          <p className="font-mono text-sm font-medium">{s.code}</p>
                          <p className={cn(TEXT_SUB, "max-w-[16rem] truncate")} title={s.note ?? undefined}>
                            {formatDateTime(s.createdAt)}
                            {s.blind ? " · đếm mù" : ""}
                            {s.note ? ` · ${s.note}` : ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                              meta.className
                            )}
                          >
                            {meta.label}
                          </span>
                        </TableCell>
                        {locationsEnabled && (
                          <TableCell className="text-sm">
                            <span className="block max-w-[12rem] truncate" title={s.locationName ?? undefined}>
                              {s.locationName ?? "—"}
                            </span>
                          </TableCell>
                        )}
                        <TableCell className="text-sm">
                          <span className="block max-w-[12rem] truncate" title={s.createdByName ?? undefined}>
                            {s.createdByName ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">{formatNumber(s.lineCount)}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {s.status !== "APPROVED" ? (
                            <span className={TEXT_SUB}>—</span>
                          ) : s.adjustedCount === 0 ? (
                            <span className={TEXT_SUB}>khớp sổ</span>
                          ) : (
                            <>
                              {s.totalDown > 0 && (
                                <span className="font-semibold text-rose-700">−{formatNumber(s.totalDown)}</span>
                              )}
                              {s.totalDown > 0 && s.totalUp > 0 && <span className={TEXT_SUB}> · </span>}
                              {s.totalUp > 0 && (
                                <span className="font-semibold text-emerald-700">+{formatNumber(s.totalUp)}</span>
                              )}
                            </>
                          )}
                        </TableCell>
                        <TableCell>
                          {s.status === "APPROVED" && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="In biên bản kiểm kê"
                              aria-label={`In biên bản ${s.code}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`/print/stocktake/${s.id}`, "_blank", "noopener");
                              }}
                            >
                              <Printer className="size-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
