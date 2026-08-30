"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleDollarSign,
  Flame,
  LinkIcon,
  PackageCheck,
  PackageOpen,
  Timer,
} from "lucide-react";
import { toast } from "sonner";

import {
  SAMPLE_OVERDUE_META,
  SAMPLE_STATUS_META,
  kocPlatformMeta,
} from "@/components/koc/koc-data";
import { KocShell } from "@/components/koc/koc-shell";
import { SampleExportModal } from "@/components/koc/sample-export-modal";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Money } from "@/components/ui/money";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchKocPartners,
  fetchKocSamples,
  updateKocSample,
  type KocSampleRow,
} from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery, useInvalidate } from "@/lib/use-api-query";
import { formatNumber } from "@/lib/format";
import {
  TABLE_HEAD_EMPHASIS,
  TEXT_NUMBER_MUTED,
  TEXT_SUB,
} from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * SỔ HÀNG MẪU & SEEDING (số thật — nhịp 1 Sổ KOC).
 *
 * Vòng đời phiếu: gửi mẫu (có HẠN lên bài, mặc định 14 ngày) → KOC đăng bài
 * (lưu link làm bằng chứng nghiệm thu) HOẶC quá hạn → chủ shop đánh dấu BÙNG
 * (kèm tuỳ chọn cho vào danh sách đen — hệ thống chặn gửi mẫu lần sau).
 * Chuông cảnh báo "mẫu quá hạn" tự chạy sau mỗi nhịp quét — không cần canh.
 */

type StatusFilter = "ALL" | "WAITING" | "OVERDUE" | "POSTED" | "BURNED";

export default function KocSamplesPage() {
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [markPosted, setMarkPosted] = useState<KocSampleRow | null>(null);
  const [markBurned, setMarkBurned] = useState<KocSampleRow | null>(null);

  // Deep-link ?overdue=1 từ chuông cảnh báo bùng mẫu.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("overdue") === "1") {
      setFilter("OVERDUE");
    }
  }, []);

  const samplesQ = useApiQuery({
    queryKey: qk.kocSamples({}),
    queryFn: () => fetchKocSamples(),
  });
  const partnersQ = useApiQuery({
    queryKey: qk.kocPartners(90),
    queryFn: () => fetchKocPartners(90),
  });
  const invalidate = useInvalidate();
  const reload = () => invalidate(["koc-samples"], ["koc-partners"]);

  const samples = useMemo(() => samplesQ.data?.samples ?? [], [samplesQ.data]);
  const rows = useMemo(
    () =>
      samples.filter((s) => {
        if (filter === "ALL") return true;
        if (filter === "OVERDUE") return s.overdue;
        return s.status === filter;
      }),
    [samples, filter]
  );

  const stats = useMemo(() => {
    const totalQty = samples.reduce((s, x) => s + x.qty, 0);
    const totalCost = samples.reduce((s, x) => s + x.cost, 0);
    const posted = samples.filter((x) => x.status === "POSTED").length;
    const overdue = samples.filter((x) => x.overdue).length;
    const burnedCost = samples
      .filter((x) => x.status === "BURNED")
      .reduce((s, x) => s + x.cost, 0);
    return { totalQty, totalCost, posted, overdue, burnedCost };
  }, [samples]);

  return (
    <KocShell>
      {/* ===== CHỈ SỐ HÀNG MẪU ===== */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sản phẩm mẫu đã xuất"
          value={formatNumber(stats.totalQty)}
          icon={PackageOpen}
          tone="neutral"
          subtitle={`${formatNumber(samples.length)} phiếu mẫu`}
        />
        <StatCard
          label="Giá trị hàng mẫu"
          value={<Money value={stats.totalCost} />}
          icon={CircleDollarSign}
          tone="negative"
          colorValue
          subtitle="Theo giá vốn — tính vào chi phí Net-ROI"
        />
        <StatCard
          label="Đã lên bài"
          value={`${formatNumber(stats.posted)}/${formatNumber(samples.length)}`}
          icon={PackageCheck}
          tone="positive"
          subtitle="Phiếu đã có video/bài đăng"
        />
        <StatCard
          label="Quá hạn chưa đăng"
          value={formatNumber(stats.overdue)}
          icon={Timer}
          tone="warning"
          subtitle={
            stats.burnedCost > 0
              ? `Đã mất ${formatNumber(stats.burnedCost)}₫ vì bùng mẫu`
              : "Nhắc KOC đòi bài hoặc đánh dấu bùng"
          }
        />
      </div>

      {/* ===== BẢNG PHIẾU MẪU ===== */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Sổ hàng mẫu</CardTitle>
              <CardDescription>
                Mỗi phiếu có hạn lên bài — quá hạn tự nhảy cảnh báo lên chuông.
                Phiếu từ Kho vật lý trừ tồn + chốt giá vốn ngay lúc xuất.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <NativeSelect
                className="w-48"
                value={filter}
                onChange={(e) => setFilter(e.target.value as StatusFilter)}
                aria-label="Lọc trạng thái phiếu mẫu"
              >
                <option value="ALL">Tất cả phiếu</option>
                <option value="WAITING">⏳ Chờ lên bài</option>
                <option value="OVERDUE">⚠️ Quá hạn chưa đăng</option>
                <option value="POSTED">✅ Đã đăng bài</option>
                <option value="BURNED">🔥 Bùng mẫu</option>
              </NativeSelect>
              <Button onClick={() => setModalOpen(true)}>
                <PackageOpen className="size-4" />
                Gửi hàng mẫu
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader className={TABLE_HEAD_EMPHASIS}>
              <TableRow>
                <TableHead>KOC nhận mẫu</TableHead>
                <TableHead>Hàng mẫu</TableHead>
                <TableHead className="w-16 text-right">SL</TableHead>
                <TableHead className="text-right">Giá trị</TableHead>
                <TableHead className="w-40">Hạn lên bài</TableHead>
                <TableHead className="w-44">Trạng thái</TableHead>
                <TableHead className="w-36 text-right">Nghiệm thu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const meta = s.overdue
                  ? SAMPLE_OVERDUE_META
                  : SAMPLE_STATUS_META[s.status];
                const platform = kocPlatformMeta(s.platform);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{s.kocName}</p>
                      <p className={TEXT_SUB}>{platform.label}</p>
                    </TableCell>
                    <TableCell>
                      {s.sku && (
                        <p className="font-mono text-sm text-slate-900">{s.sku}</p>
                      )}
                      <p className={s.sku ? TEXT_SUB : "text-sm text-slate-900"}>
                        {s.productName}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm text-slate-700">
                      {formatNumber(s.qty)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={s.cost} className={TEXT_NUMBER_MUTED} />
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      <span className={cn(s.overdue && "font-semibold text-red-500")}>
                        {new Date(s.postDeadlineAt).toLocaleDateString("vi-VN")}
                      </span>
                      <p className={TEXT_SUB}>
                        Gửi {new Date(s.exportedAt).toLocaleDateString("vi-VN")}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={meta.badgeClass}>
                        {meta.label}
                      </Badge>
                      {s.status === "POSTED" && s.contentUrl && (
                        <p className={cn(TEXT_SUB, "mt-1")}>
                          <a
                            href={s.contentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 hover:underline"
                          >
                            <LinkIcon className="size-3" /> Xem bài
                          </a>
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.status === "WAITING" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            title="KOC đã đăng bài — lưu link nghiệm thu"
                            onClick={() => setMarkPosted(s)}
                          >
                            <PackageCheck className="size-4" /> Đã đăng
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="outline"
                            aria-label="Đánh dấu bùng mẫu"
                            title="Bùng mẫu — mất tiền mẫu, tuỳ chọn đưa vào danh sách đen"
                            className="text-red-500 hover:bg-rose-50 hover:text-red-600"
                            onClick={() => setMarkBurned(s)}
                          >
                            <Flame className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className={cn(TEXT_SUB, "block text-right")}>—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {samplesQ.loading
                      ? "Đang tải dữ liệu…"
                      : "Chưa có phiếu mẫu nào" +
                        (filter !== "ALL" ? " khớp bộ lọc." : " — bấm Gửi hàng mẫu để tạo phiếu đầu tiên.")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SampleExportModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        partners={partnersQ.data?.partners ?? []}
        onDone={() => void reload()}
      />
      <MarkPostedDialog
        sample={markPosted}
        onOpenChange={(o) => !o && setMarkPosted(null)}
        onDone={() => void reload()}
      />
      <MarkBurnedDialog
        sample={markBurned}
        onOpenChange={(o) => !o && setMarkBurned(null)}
        onDone={() => void reload()}
      />

      <p className="text-center text-xs text-muted-foreground">
        Hubsell KOC · Sổ hàng mẫu &amp; Seeding
      </p>
    </KocShell>
  );
}

/** Dialog nghiệm thu "đã đăng bài" — lưu link content làm bằng chứng. */
function MarkPostedDialog({
  sample,
  onOpenChange,
  onDone,
}: {
  sample: KocSampleRow | null;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!sample || busy) return;
    setBusy(true);
    try {
      await updateKocSample(sample.id, { status: "POSTED", contentUrl: url.trim() });
      toast.success(`Đã nghiệm thu bài đăng của ${sample.kocName}`);
      onOpenChange(false);
      setUrl("");
      onDone();
    } catch {
      toast.error("Không cập nhật được phiếu mẫu");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={sample !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>KOC đã đăng bài</DialogTitle>
          <DialogDescription>
            Lưu link video/bài đăng làm bằng chứng nghiệm thu seeding của{" "}
            <b>{sample?.kocName}</b>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="posted-url">Link content (tuỳ chọn)</Label>
          <Input
            id="posted-url"
            placeholder="https://www.tiktok.com/@…/video/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? "Đang lưu…" : "Xác nhận đã đăng"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog đánh dấu BÙNG mẫu — tuỳ chọn đưa KOC vào danh sách đen. */
function MarkBurnedDialog({
  sample,
  onOpenChange,
  onDone,
}: {
  sample: KocSampleRow | null;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const [blacklist, setBlacklist] = useState(true);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!sample || busy) return;
    setBusy(true);
    try {
      await updateKocSample(sample.id, { status: "BURNED", blacklist });
      toast.success(
        blacklist
          ? `Đã đánh dấu bùng mẫu và đưa ${sample.kocName} vào danh sách đen`
          : `Đã đánh dấu bùng mẫu của ${sample.kocName}`
      );
      onOpenChange(false);
      onDone();
    } catch {
      toast.error("Không cập nhật được phiếu mẫu");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={sample !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="size-5 text-red-500" />
            Đánh dấu bùng mẫu
          </DialogTitle>
          <DialogDescription>
            <b>{sample?.kocName}</b> nhận mẫu trị giá{" "}
            <b>{formatNumber(sample?.cost ?? 0)}₫</b> nhưng không lên bài.
            Khoản này vẫn tính vào chi phí Net-ROI của KOC (tiền đã mất).
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={blacklist}
            onChange={(e) => setBlacklist(e.target.checked)}
            className="size-4 accent-red-500"
          />
          Đưa KOC vào danh sách đen — hệ thống chặn gửi mẫu lần sau
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button
            onClick={handleSave}
            disabled={busy}
            className="bg-red-500 text-white hover:bg-red-600"
          >
            {busy ? "Đang lưu…" : "Xác nhận bùng mẫu"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
