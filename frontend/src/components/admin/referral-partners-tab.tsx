"use client";

// ============================================================
// TAB CỘNG TÁC VIÊN ĐẶC BIỆT (trang Marketing & Giới thiệu — lá hq.marketing,
// 07/11/2026). Anh Trung: "đây đã được coi là cộng tác viên rồi, mình chỉ thêm
// tab cho cộng tác viên đặc biệt để nâng hoặc hạ mức hoa hồng và thời gian".
// Mọi tài khoản vốn là CTV 10% vĩnh viễn; ở đây HQ chọn một tài khoản ĐÃ ĐĂNG
// KÝ và đặt % riêng trong một khoảng thời gian. Hết hạn / gỡ → tự về mặc định.
// Hoa hồng đã cộng vào ví không tính lại (sổ cái bất biến).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BadgePercent, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  deleteReferralPartner,
  searchReferralPartnerCandidates,
  upsertReferralPartner,
  type ReferralPartnerCandidate,
  type ReferralPartnerRow,
  type ReferralPartnerStatus,
  type ReferralPartnersResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatCount, formatMoney } from "./shared";

const STATUS_META: Record<ReferralPartnerStatus, { label: string; className: string }> = {
  active: {
    label: "Đang áp dụng",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  upcoming: {
    label: "Chưa tới ngày",
    className: "border-sky-200 bg-sky-50 text-sky-700",
  },
  expired: {
    label: "Hết hạn",
    className: "border-slate-200 bg-slate-50 text-slate-600",
  },
};

/** dd/MM/yyyy theo giờ máy người xem. */
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Date → "YYYY-MM-DD" theo giờ địa phương (giá trị của <input type="date">). */
function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtPercent(n: number): string {
  return `${n.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;
}

export function ReferralPartnersTab({
  data,
  loading,
  onChanged,
}: {
  data: ReferralPartnersResponse | null;
  loading: boolean;
  /** Sau khi lưu / gỡ — trang tải lại cả hai tab cho khớp số. */
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<ReferralPartnerRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<ReferralPartnerRow | null>(null);

  const defaultPercent = data?.defaultCommissionPercent ?? 10;
  // Hook phải đứng trước mọi return sớm.
  const existingUserIds = useMemo(
    () => new Set((data?.partners ?? []).map((p) => p.userId)),
    [data]
  );

  if (loading && !data) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">Đang tải dữ liệu…</p>
    );
  }
  if (!data) return null;

  const activeCount = data.partners.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl text-sm text-muted-foreground">
          <p>
            Mọi tài khoản Hubsell đều là cộng tác viên với hoa hồng{" "}
            <span className="font-semibold text-foreground">{fmtPercent(defaultPercent)}</span>{" "}
            vĩnh viễn. Tab này dành cho cộng tác viên đặc biệt: chọn một tài khoản đã đăng ký,
            đặt mức % riêng và khoảng thời gian áp dụng. Hết hạn hoặc gỡ thì tự về mức mặc định;
            hoa hồng đã cộng vào ví không tính lại.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Thêm cộng tác viên
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">Cộng tác viên đặc biệt</p>
            <p className="text-xs text-muted-foreground">
              {formatCount(activeCount)} đang áp dụng / {formatCount(data.partners.length)} đã thiết lập
            </p>
          </div>
          {data.partners.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <BadgePercent className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                Chưa có cộng tác viên đặc biệt nào. Bấm “Thêm cộng tác viên” để chọn một tài khoản
                và đặt mức hoa hồng riêng.
              </p>
            </div>
          ) : (
            // Ô đệm ngang 12px thay 16px: 7 cột vừa khít 1280px không sinh thanh cuộn ngang.
            <Table className="[&_td]:px-3 [&_th]:px-3">
              <TableHeader>
                <TableRow>
                  <TableHead>Cộng tác viên</TableHead>
                  <TableHead className="text-right">Hoa hồng</TableHead>
                  <TableHead>Hiệu lực</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-center">Đã giới thiệu</TableHead>
                  <TableHead className="text-right">Hoa hồng tích lũy</TableHead>
                  <TableHead className="w-20 text-right">
                    <span className="sr-only">Thao tác</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.partners.map((p) => {
                  const meta = STATUS_META[p.status];
                  return (
                    <TableRow key={p.userId}>
                      <TableCell>
                        <p className="text-sm">{p.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.email ?? "—"}
                          {p.referralCode && (
                            <>
                              {" · "}
                              <span className="font-mono">{p.referralCode}</span>
                            </>
                          )}
                        </p>
                        {p.note && (
                          <p
                            className="mt-0.5 max-w-[12rem] truncate text-xs text-muted-foreground"
                            title={p.note}
                          >
                            {p.note}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <p className="text-sm font-semibold tabular-nums">
                          {fmtPercent(p.commissionPercent)}
                        </p>
                        {p.commissionPercent !== defaultPercent && (
                          <p className="text-xs text-muted-foreground">
                            mặc định {fmtPercent(defaultPercent)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        <p>{fmtDay(p.startsAt)}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.endsAt ? `đến ${fmtDay(p.endsAt)}` : "không thời hạn"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                            meta.className
                          )}
                          title={
                            p.status === "expired"
                              ? `Đã về mức mặc định ${fmtPercent(defaultPercent)}`
                              : undefined
                          }
                        >
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-sm tabular-nums">
                        {formatCount(p.referredCount)} người
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <p className="text-sm font-semibold">{formatMoney(p.totalCommission)}</p>
                        <p className="text-xs text-muted-foreground" title="Số dư Ví Hubsell hiện tại">
                          ví {formatMoney(p.walletBalance)}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Sửa mức hoa hồng"
                            onClick={() => setEditing(p)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Gỡ mức riêng (về mặc định)"
                            onClick={() => setRemoving(p)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PartnerDialog
        open={adding || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false);
            setEditing(null);
          }
        }}
        partner={editing}
        defaultPercent={defaultPercent}
        existingUserIds={existingUserIds}
        onSaved={() => {
          setAdding(false);
          setEditing(null);
          onChanged();
        }}
      />

      <RemoveDialog
        partner={removing}
        defaultPercent={defaultPercent}
        onOpenChange={(o) => {
          if (!o) setRemoving(null);
        }}
        onRemoved={() => {
          setRemoving(null);
          onChanged();
        }}
      />
    </div>
  );
}

// ---------- Hộp thoại thêm / sửa ----------

function PartnerDialog({
  open,
  onOpenChange,
  partner,
  defaultPercent,
  existingUserIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** null = thêm mới (phải tìm và chọn tài khoản). */
  partner: ReferralPartnerRow | null;
  defaultPercent: number;
  existingUserIds: Set<string>;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ReferralPartnerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ReferralPartnerCandidate | null>(null);
  const [percent, setPercent] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [noEnd, setNoEnd] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Nạp lại form mỗi lần mở: sửa thì điền từ dòng, thêm thì để trống + mặc định
  // bắt đầu hôm nay và hạn 12 tháng (gợi ý, HQ đổi tùy ý).
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCandidates([]);
    if (partner) {
      setSelected(null);
      setPercent(String(partner.commissionPercent));
      setStartsAt(toDateInput(new Date(partner.startsAt)));
      setNoEnd(!partner.endsAt);
      setEndsAt(partner.endsAt ? toDateInput(new Date(partner.endsAt)) : "");
      setNote(partner.note ?? "");
    } else {
      const today = new Date();
      const nextYear = new Date(today);
      nextYear.setFullYear(today.getFullYear() + 1);
      setSelected(null);
      setPercent("");
      setStartsAt(toDateInput(today));
      setNoEnd(false);
      setEndsAt(toDateInput(nextYear));
      setNote("");
    }
  }, [open, partner]);

  // Tìm tài khoản — chờ 300ms sau phím cuối, hủy lượt cũ khi gõ tiếp.
  useEffect(() => {
    if (!open || partner) return;
    const q = query.trim();
    if (q.length < 2) {
      setCandidates([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchReferralPartnerCandidates(q, ctrl.signal);
        setCandidates(r.users);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setCandidates([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open, partner]);

  const percentNum = Number(percent.replace(",", "."));
  const percentValid = percent.trim() !== "" && Number.isFinite(percentNum) && percentNum >= 0 && percentNum <= 100;
  const endsValid = noEnd || (endsAt !== "" && (startsAt === "" || endsAt > startsAt));
  const targetUserId = partner?.userId ?? selected?.id ?? null;
  const canSave = !!targetUserId && percentValid && endsValid && !submitting;

  // Ví dụ bằng tiền để HQ thấy ngay mức mới khác mặc định bao nhiêu.
  const sample = 1_000_000;
  const sampleNew = Math.round((sample * (percentValid ? percentNum : defaultPercent)) / 100);
  const sampleDefault = Math.round((sample * defaultPercent) / 100);

  async function handleSave() {
    if (!targetUserId) return;
    setSubmitting(true);
    try {
      await upsertReferralPartner(targetUserId, {
        commissionPercent: Math.round(percentNum * 100) / 100,
        startsAt: startsAt || null,
        endsAt: noEnd ? null : endsAt,
        note: note.trim() || null,
      });
      toast.success(
        partner
          ? `Đã cập nhật mức hoa hồng — ${partner.fullName}`
          : `Đã thêm cộng tác viên đặc biệt — ${selected?.fullName ?? ""}`
      );
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không lưu được");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgePercent className="size-5 text-primary" />
            {partner ? "Sửa mức hoa hồng riêng" : "Thêm cộng tác viên đặc biệt"}
          </DialogTitle>
          <DialogDescription>
            {partner ? (
              <>
                {partner.fullName}
                {partner.email ? ` · ${partner.email}` : ""}
                {partner.referralCode ? ` · ${partner.referralCode}` : ""}
              </>
            ) : (
              <>Chọn một tài khoản đã đăng ký Hubsell rồi đặt % và thời gian áp dụng.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!partner && (
            <div className="space-y-2">
              <Label htmlFor="partner-search">Tài khoản</Label>
              {selected ? (
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{selected.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {selected.email ?? "—"}
                      {selected.referralCode ? ` · ${selected.referralCode}` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Đổi
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="partner-search"
                      autoFocus
                      className="pl-8"
                      placeholder="Gõ email, tên hoặc mã giới thiệu (HUBSELL…)"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {searching && (
                      <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {query.trim().length >= 2 && !searching && candidates.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Không thấy chủ shop nào khớp. Chỉ tìm được tài khoản đã đăng ký.
                    </p>
                  )}
                  {candidates.length > 0 && (
                    <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
                      {candidates.map((c) => {
                        const already = existingUserIds.has(c.id);
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              disabled={already}
                              onClick={() => setSelected(c)}
                              className={cn(
                                "flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/60",
                                already && "cursor-not-allowed opacity-60"
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm">{c.fullName}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {c.email ?? "—"}
                                  {c.referralCode ? ` · ${c.referralCode}` : ""}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {already
                                  ? `đã có mức ${fmtPercent(c.currentPercent ?? 0)}`
                                  : `từ ${fmtDay(c.createdAt)}`}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="partner-percent">Hoa hồng (%)</Label>
              <Input
                id="partner-percent"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.5}
                placeholder={String(defaultPercent)}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                aria-invalid={percent !== "" && !percentValid}
              />
              <p className="text-xs text-muted-foreground">
                Mặc định {fmtPercent(defaultPercent)}. Từ 0 đến 100.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="partner-starts">Bắt đầu từ</Label>
              <Input
                id="partner-starts"
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Áp cho thanh toán phát sinh từ ngày này.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="partner-ends">Hết hạn</Label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={noEnd} onCheckedChange={setNoEnd} />
                Không thời hạn
              </label>
            </div>
            <Input
              id="partner-ends"
              type="date"
              disabled={noEnd}
              min={startsAt || undefined}
              value={noEnd ? "" : endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              aria-invalid={!noEnd && endsAt !== "" && !endsValid}
            />
            <p className="text-xs text-muted-foreground">
              {noEnd
                ? "Giữ mức riêng cho tới khi anh gỡ."
                : "Sau ngày này tự về mức mặc định, không cần nhớ gỡ."}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="partner-note">Ghi chú nội bộ</Label>
            <Textarea
              id="partner-note"
              rows={2}
              maxLength={500}
              placeholder="Thỏa thuận, kênh của cộng tác viên…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Ví dụ: khách do cộng tác viên này giới thiệu thanh toán{" "}
            <span className="font-medium text-foreground">{formatMoney(sample)}</span> → cộng tác
            viên nhận{" "}
            <span className="font-semibold text-foreground">{formatMoney(sampleNew)}</span>
            {sampleNew !== sampleDefault && <> (mặc định {formatMoney(sampleDefault)})</>}.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {partner ? "Lưu thay đổi" : "Thêm cộng tác viên"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Hộp thoại gỡ ----------

function RemoveDialog({
  partner,
  defaultPercent,
  onOpenChange,
  onRemoved,
}: {
  partner: ReferralPartnerRow | null;
  defaultPercent: number;
  onOpenChange: (o: boolean) => void;
  onRemoved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleRemove() {
    if (!partner) return;
    setSubmitting(true);
    try {
      await deleteReferralPartner(partner.userId);
      toast.success(`Đã gỡ mức riêng — ${partner.fullName} về ${fmtPercent(defaultPercent)}`);
      onRemoved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Không gỡ được");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={partner !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gỡ mức hoa hồng riêng?</DialogTitle>
          <DialogDescription>
            {partner?.fullName} sẽ về mức mặc định {fmtPercent(defaultPercent)} cho các thanh toán
            từ giờ. Hoa hồng đã cộng vào ví giữ nguyên.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Giữ lại
          </Button>
          <Button variant="destructive" onClick={handleRemove} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Gỡ mức riêng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
