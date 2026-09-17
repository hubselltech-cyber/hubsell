"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";

import { Refreshing } from "@/components/shared/refreshing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ApiError,
  applyCostRules,
  deleteCostPriceRule,
  fetchCostPriceRules,
  importCostPriceRulesExcel,
  previewCostRules,
  saveCostPriceRule,
  type ChannelName,
  type CostMappingPreview,
  type CostMappingRow,
  type CostPriceRule,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { downloadCostRuleTemplate, exportUnmatchedCostSkus } from "@/lib/excel";
import { formatNumber, formatVND } from "@/lib/format";
import { TEXT_SUB } from "@/lib/typography";
import { cn } from "@/lib/utils";

/**
 * BẢNG GIÁ THEO MÃ MẪU — phần NÂNG CAO của tab Mapping giá vốn, mặc định thu gọn.
 *
 * Dành cho shop đặt mã có quy tắc (TBSA01-Vàng-XXL): khai "TBSA01 = 52.000" một
 * lần là mọi phân loại trên mọi gian nhận giá, và SKU mới đồng bộ về sau cũng tự
 * nhận. Nhập tay từng mã hoặc cả bảng từ Excel. Mặc định chỉ điền ô trống; ô
 * đang có giá khác phải tick mới ghi đè.
 */

/** Mỗi nhóm chỉ vẽ tối đa ngần này dòng — shop nghìn SKU không cần nhìn hết để quyết. */
const VISIBLE_ROWS = 50;

function shopLabel(c: { channelName: ChannelName; shopName: string }) {
  return `${CHANNEL_META[c.channelName].label} · ${c.shopName}`;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

export function CostRulesSection({ onApplied }: { onApplied: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [rules, setRules] = React.useState<CostPriceRule[]>([]);
  const [coverage, setCoverage] = React.useState({ totalSkus: 0, coveredSkus: 0 });
  const [loaded, setLoaded] = React.useState(false);

  const [preview, setPreview] = React.useState<CostMappingPreview | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [overwrite, setOverwrite] = React.useState<Set<string>>(new Set());
  const [applying, setApplying] = React.useState(false);

  // Xem trước chạy lại sau MỖI lần bảng giá đổi — khách chỉ còn một nút Áp dụng.
  const seqRef = React.useRef(0);
  const reload = React.useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const res = await fetchCostPriceRules();
      if (seq !== seqRef.current) return;
      setRules(res.rules);
      setCoverage({ totalSkus: res.totalSkus, coveredSkus: res.coveredSkus });
      if (res.rules.length === 0) {
        setPreview(null);
        return;
      }
      setPreviewing(true);
      const p = await previewCostRules();
      if (seq !== seqRef.current) return; // đã có lượt mới hơn
      setPreview(p);
      setOverwrite(new Set());
    } catch (err) {
      if (seq === seqRef.current) {
        toast.error(errorMessage(err, "Không tải được bảng giá theo mã mẫu"));
      }
    } finally {
      if (seq === seqRef.current) {
        setPreviewing(false);
        setLoaded(true);
      }
    }
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  async function handleApply() {
    setApplying(true);
    try {
      const res = await applyCostRules([...overwrite]);
      const parts: string[] = [];
      if (res.filled > 0) parts.push(`Đã điền giá vốn cho ${formatNumber(res.filled)} SKU`);
      if (res.overwritten > 0) parts.push(`Đã ghi đè ${formatNumber(res.overwritten)} SKU`);
      if (res.backfilledOrderLines > 0) {
        parts.push(`tính lại ${formatNumber(res.backfilledOrderLines)} dòng hàng đã bán`);
      }
      toast.success(parts.join(" · "), { duration: 6000 });
      onApplied();
      await reload();
    } catch (err) {
      toast.error(errorMessage(err, "Không áp dụng được bảng giá"));
    } finally {
      setApplying(false);
    }
  }

  const fillRows = preview?.rows.filter((r) => r.status === "fill") ?? [];
  const conflictRows = preview?.rows.filter((r) => r.status === "conflict") ?? [];
  const ambiguousRows = preview?.rows.filter((r) => r.status === "ambiguous") ?? [];
  const willChange = fillRows.length + overwrite.size;

  return (
    <div className="space-y-6">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted/40"
      >
        <ChevronRight
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-90"
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Bảng giá theo mã mẫu · nhập từ Excel</span>
          <span className={cn(TEXT_SUB, "block")}>
            Khai <span className="font-mono">TBSA01</span> một lần cho mọi{" "}
            <span className="font-mono">TBSA01-màu-size</span> trên mọi gian — SKU mới đồng bộ
            về sau cũng tự nhận giá.
          </span>
        </span>
        {loaded && rules.length > 0 && (
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {formatNumber(rules.length)} mã · phủ {formatNumber(coverage.coveredSkus)}/
            {formatNumber(coverage.totalSkus)} SKU
          </span>
        )}
      </button>

      {open && (
        <>
          <RulesCard rules={rules} loaded={loaded} onChanged={reload} />

          {preview && (
            <Refreshing active={previewing}>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile label="Sẽ điền giá vốn" value={preview.counts.fill} tone="good" />
                  <StatTile
                    label="Đang có giá khác"
                    value={preview.counts.conflict}
                    tone={preview.counts.conflict > 0 ? "warn" : "idle"}
                  />
                  <StatTile
                    label="Không khớp mã, còn thiếu giá"
                    value={preview.counts.unmatched}
                    tone={preview.counts.unmatched > 0 ? "warn" : "idle"}
                  />
                  <StatTile label="Đã đúng giá sẵn" value={preview.counts.same} tone="idle" />
                </div>

                {preview.counts.fill === 0 && preview.counts.conflict === 0 ? (
                  <Card>
                    <CardContent className="flex items-center gap-3 p-5 text-sm">
                      {preview.counts.matched === 0 ? (
                        <AlertTriangle className="size-5 shrink-0 text-amber-600" />
                      ) : (
                        <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                      )}
                      {preview.counts.matched === 0
                        ? "Chưa có SKU nào trên các gian mang mã trong bảng giá. Kiểm tra lại mã."
                        : "Các SKU khớp mã đều đã có đúng giá vốn — không còn gì để điền."}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                    <p className="text-sm">
                      Điền giá vốn cho{" "}
                      <b className="tabular-nums">{formatNumber(fillRows.length)}</b> SKU đang trống
                      {overwrite.size > 0 && (
                        <>
                          , ghi đè <b className="tabular-nums">{formatNumber(overwrite.size)}</b>{" "}
                          SKU đã tick
                        </>
                      )}
                      . Đơn cũ bán lúc chưa có giá vốn sẽ được tính lại lãi/lỗ.
                    </p>
                    <Button onClick={handleApply} disabled={applying || willChange === 0}>
                      {applying && <Loader2 className="size-4 animate-spin" />}
                      Áp dụng cho {formatNumber(willChange)} SKU
                    </Button>
                  </div>
                )}

                {conflictRows.length > 0 && (
                  <RowSection
                    title={`Đang có giá khác (${formatNumber(conflictRows.length)})`}
                    hint="Mặc định giữ nguyên giá cũ. Tick những SKU bạn muốn ghi đè bằng giá mới."
                    rows={conflictRows}
                    selection={{ selected: overwrite, onChange: setOverwrite }}
                  />
                )}

                {fillRows.length > 0 && (
                  <RowSection
                    title={`Sẽ điền giá vốn (${formatNumber(fillRows.length)})`}
                    rows={fillRows}
                  />
                )}

                {ambiguousRows.length > 0 && (
                  <RowSection
                    title={`Bỏ qua — một sản phẩm kho khớp ra nhiều giá (${formatNumber(
                      ambiguousRows.length
                    )})`}
                    hint="Các SKU này cùng nối về một sản phẩm kho nhưng bảng giá cho ra giá khác nhau. Hãy đặt giá cho sản phẩm đó ở danh sách phía trên."
                    rows={ambiguousRows}
                  />
                )}

                {preview.unmatched.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                    <p className="text-sm">
                      Còn <b className="tabular-nums">{formatNumber(preview.unmatched.length)}</b>{" "}
                      SKU thiếu giá vốn mà bảng giá chưa có mã nào nhận. Xuất ra Excel, điền cột
                      Giá vốn rồi nhập lại là xong.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exportUnmatchedCostSkus(preview.unmatched)}
                    >
                      <Download className="size-4" />
                      Xuất Excel
                    </Button>
                  </div>
                )}
              </div>
            </Refreshing>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "idle";
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className={TEXT_SUB}>{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "good" && value > 0 && "text-emerald-500",
          tone === "warn" && "text-amber-600",
          (tone === "idle" || value === 0) && "text-foreground"
        )}
      >
        {formatNumber(value)}
      </p>
    </div>
  );
}

/* ─────────────────────── Bảng dòng xem trước (điền / xung đột) ─────────────────────── */

function RowSection({
  title,
  hint,
  rows,
  selection,
}: {
  title: string;
  hint?: string;
  rows: CostMappingRow[];
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void };
}) {
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? rows : rows.slice(0, VISIBLE_ROWS);
  const allChecked = !!selection && rows.every((r) => selection.selected.has(r.skuId));

  return (
    <Card>
      <CardContent className="p-0">
        <div className="space-y-0.5 p-5 pb-3">
          <p className="text-sm font-semibold">{title}</p>
          {hint && <p className={TEXT_SUB}>{hint}</p>}
        </div>
        <Table className="min-w-[44rem] table-fixed">
          <TableHeader>
            <TableRow>
              {selection && (
                <TableHead className="w-10">
                  {/* Chọn tất cả tính trên TOÀN BỘ nhóm, không chỉ các dòng đang vẽ */}
                  <input
                    type="checkbox"
                    aria-label="Ghi đè tất cả"
                    checked={allChecked}
                    onChange={() =>
                      selection.onChange(
                        allChecked ? new Set() : new Set(rows.map((r) => r.skuId))
                      )
                    }
                    className="size-4 cursor-pointer accent-primary"
                  />
                </TableHead>
              )}
              <TableHead className="w-[22%]">Mã SKU</TableHead>
              <TableHead>Sản phẩm</TableHead>
              <TableHead className="w-[20%]">Gian hàng</TableHead>
              <TableHead className="w-[14%]">Khớp theo</TableHead>
              <TableHead className="w-[19%] text-right">Giá vốn</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((r) => (
              <TableRow key={r.skuId}>
                {selection && (
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Ghi đè giá vốn của ${r.sku}`}
                      checked={selection.selected.has(r.skuId)}
                      onChange={() => {
                        const next = new Set(selection.selected);
                        if (next.has(r.skuId)) next.delete(r.skuId);
                        else next.add(r.skuId);
                        selection.onChange(next);
                      }}
                      className="size-4 cursor-pointer accent-primary"
                    />
                  </TableCell>
                )}
                <TableCell className="truncate font-mono" title={r.sku}>
                  {r.sku}
                </TableCell>
                <TableCell className="truncate" title={r.productName}>
                  {r.productName}
                  {r.productId && (
                    <span
                      className="ml-1.5 text-xs text-muted-foreground"
                      title="SKU đã nối kho — giá vốn ghi lên sản phẩm kho, mọi gian cùng nối sản phẩm đó đổi theo"
                    >
                      · đã nối kho
                    </span>
                  )}
                </TableCell>
                <TableCell className="truncate" title={shopLabel(r)}>
                  {shopLabel(r)}
                </TableCell>
                <TableCell className={cn(TEXT_SUB, "truncate")} title={r.matchedCode}>
                  {r.matchKind === "prefix" ? `Mã mẫu ${r.matchedCode}` : "Trùng mã"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.currentCost > 0 && (
                    <span className="mr-1.5 text-muted-foreground line-through">
                      {formatVND(r.currentCost)}
                    </span>
                  )}
                  <span className="font-semibold">{formatVND(r.newCost)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length > VISIBLE_ROWS && (
          <div className="border-t p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll
                ? "Thu gọn"
                : `Xem tất cả ${formatNumber(rows.length)} SKU`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────────────────────────── Bảng giá tự nhập ───────────────────────────── */

function RulesCard({
  rules,
  loaded,
  onChanged,
}: {
  rules: CostPriceRule[];
  loaded: boolean;
  onChanged: () => Promise<void>;
}) {
  const [code, setCode] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const codeRef = React.useRef<HTMLInputElement>(null);

  const canAdd = code.trim() !== "" && Number(cost) > 0;

  async function handleAdd() {
    if (!canAdd) return;
    setSaving(true);
    try {
      await saveCostPriceRule(code, Number(cost), label);
      setCode("");
      setCost("");
      setLabel("");
      await onChanged();
      codeRef.current?.focus(); // gõ liền mã tiếp theo, khỏi với chuột
    } catch (err) {
      toast.error(errorMessage(err, "Không lưu được mã này"));
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      const res = await importCostPriceRulesExcel(file);
      toast.success(
        `Đã lưu ${formatNumber(res.saved)} mã vào bảng giá` +
          (res.errors.length > 0
            ? ` · bỏ qua ${formatNumber(res.errors.length)} dòng (${res.errors
                .slice(0, 3)
                .map((e) => `dòng ${e.row}`)
                .join(", ")}${res.errors.length > 3 ? "…" : ""})`
            : ""),
        { duration: 7000 }
      );
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Không nhập được file Excel"));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const visible = showAll ? rules : rules.slice(0, VISIBLE_ROWS);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-4">
          <div>
            <p className="text-sm font-semibold">Bảng giá tự nhập</p>
            <p className={TEXT_SUB}>
              Nhập mã SKU đầy đủ, hoặc chỉ mã mẫu: <span className="font-mono">TBSA01</span> sẽ
              áp cho mọi <span className="font-mono">TBSA01-màu-size</span>. Có cả hai thì mã
              đầy đủ được ưu tiên.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={downloadCostRuleTemplate}>
              <Download className="size-4" />
              File mẫu
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Nhập từ Excel
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => handleImport(e.target.files?.[0])}
            />
          </div>
        </div>

        {/* Dòng thêm nhanh — Enter ở ô nào cũng lưu */}
        <form
          className="flex flex-wrap items-center gap-2 border-y bg-muted/30 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
        >
          <Input
            ref={codeRef}
            className="w-52 font-mono"
            placeholder="Mã SKU hoặc mã mẫu"
            aria-label="Mã SKU hoặc mã mẫu"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <CurrencyInput
            className="w-36 text-right tabular-nums"
            placeholder="Giá vốn"
            aria-label="Giá vốn"
            value={cost}
            onValueChange={setCost}
          />
          <Input
            className="min-w-40 flex-1"
            placeholder="Ghi chú (không bắt buộc)"
            aria-label="Ghi chú"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" disabled={!canAdd || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Thêm
          </Button>
        </form>

        {loaded && rules.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Chưa có mã nào. Thêm từng mã ở dòng trên, hoặc nhập cả bảng từ Excel.
          </p>
        ) : (
          <Table className="min-w-[44rem] table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[26%]">Mã</TableHead>
                <TableHead>Ghi chú</TableHead>
                <TableHead className="w-[16%] text-right">Đang phủ</TableHead>
                <TableHead className="w-44 text-right">Giá vốn (VNĐ)</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <RuleRow key={r.id} rule={r} onChanged={onChanged} />
              ))}
            </TableBody>
          </Table>
        )}
        {rules.length > VISIBLE_ROWS && (
          <div className="border-t p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Thu gọn" : `Xem tất cả ${formatNumber(rules.length)} mã`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RuleRow({
  rule,
  onChanged,
}: {
  rule: CostPriceRule;
  onChanged: () => Promise<void>;
}) {
  const saved = String(Number(rule.costPrice));
  const [draft, setDraft] = React.useState(saved);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setDraft(saved), [saved]);

  async function handleBlur() {
    const value = Number(draft);
    if (draft === saved) return;
    if (!(value > 0)) {
      setDraft(saved);
      return;
    }
    setBusy(true);
    try {
      await saveCostPriceRule(rule.code, value, rule.label);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Không lưu được giá vốn"));
      setDraft(saved);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteCostPriceRule(rule.id);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err, "Không xoá được mã này"));
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="truncate font-mono" title={rule.code}>
        {rule.code}
      </TableCell>
      <TableCell className="truncate text-muted-foreground" title={rule.label ?? ""}>
        {rule.label ?? "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {rule.matchedSkus > 0 ? (
          `${formatNumber(rule.matchedSkus)} SKU`
        ) : (
          <span
            className="text-amber-700"
            title="Chưa có SKU nào trên các gian mang mã này — kiểm tra lại mã, hoặc mã này đã bị một mã cụ thể hơn nhận hết"
          >
            0 SKU
          </span>
        )}
      </TableCell>
      <TableCell>
        <CurrencyInput
          className="ml-auto w-32 text-right tabular-nums"
          aria-label={`Giá vốn của mã ${rule.code}`}
          value={draft}
          onValueChange={setDraft}
          onBlur={handleBlur}
          disabled={busy}
        />
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Xoá mã ${rule.code}`}
          onClick={handleDelete}
          disabled={busy}
        >
          <Trash2 className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
