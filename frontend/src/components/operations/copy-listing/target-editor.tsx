"use client";

// ============================================================
// Khung sửa MỘT gian đích: danh mục (xổ cha → con), thương hiệu, cân nặng, kích thước,
// % giá, tồn đăng, thuộc tính danh mục (bắt buộc xếp trước), kênh vận chuyển (Shopee).
// "Lưu gian này" / "Áp cho N sản phẩm còn lại" (cùng gian trong đợt — mẹo UpBase).
// ============================================================

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  apiErrorMessage,
  applyCopyListingTargetToBatch,
  updateCopyListingTarget,
  type CopyListingBatch,
  type CopyListingJob,
  type CopyListingTarget,
  type CopyListingTargetPatch,
} from "@/lib/api";
import { CHANNEL_META } from "@/lib/channel-meta";
import { qk } from "@/lib/query-keys";
import { TEXT_SUB, TEXT_TABLE_HEAD } from "@/lib/typography";
import { useInvalidate } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { BrandCombobox } from "./brand-combobox";
import { CategoryCascade } from "./category-cascade";
import { RequiredPill, WARN_INPUT } from "./primitives";
import { isOpen } from "./shared";

/**
 * Ô nhập: nhãn + viên "Bắt buộc" (sàn không cho đăng nếu trống) + ghi chú ngắn nói điền gì.
 * Thiếu → nhãn vàng "còn thiếu" (đồng bộ cột Còn thiếu ở dòng gian).
 */
function EditorField({
  label,
  missing,
  required,
  hint,
  children,
}: {
  label: React.ReactNode;
  missing: boolean;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-1.5", missing && "text-amber-700")}>
        <span>{label}</span>
        {required && <RequiredPill />}
        {missing && <span className="font-normal normal-case">· còn thiếu</span>}
      </div>
      {children}
      {/* Ô nằm trong TableCell (whitespace-nowrap) → ép xuống dòng, không tràn sang cột bên. */}
      {hint && <div className={cn(TEXT_SUB, "whitespace-normal leading-snug")}>{hint}</div>}
    </div>
  );
}

export function TargetEditor({
  batch,
  job,
  target: t,
  canEdit,
}: {
  batch: CopyListingBatch;
  job: CopyListingJob;
  target: CopyListingTarget;
  canEdit: boolean;
}) {
  const invalidate = useInvalidate();
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draft, setDraft] = useState<CopyListingTargetPatch>({});
  /** Kênh vận chuyển: mặc định theo cài đặt gian, chỉ xổ khi khách muốn tuỳ chỉnh hoặc đang thiếu. */
  const [logisticsOpen, setLogisticsOpen] = useState(false);

  const value = <K extends keyof CopyListingTargetPatch>(k: K): CopyListingTargetPatch[K] =>
    draft[k] !== undefined ? draft[k] : (t as unknown as CopyListingTargetPatch)[k];
  const attrs = { ...t.attributes, ...(draft.attributes ?? {}) };
  const dims = draft.dimensionsCm !== undefined ? draft.dimensionsCm : t.dimensionsCm;
  const logistics = draft.logisticIds ?? t.logisticIds;
  const logisticEnabled = t.logisticOptions.filter((o) => o.enabled);
  const logisticsOn = logisticEnabled.filter((o) => logistics.includes(o.id)).length;
  const req = t.requirements;
  const dirty = Object.keys(draft).length > 0;
  const missing = new Set(t.missing);
  const inputCls = (code: string) => cn(missing.has(code) && WARN_INPUT);
  /** Số gian cùng gian hàng ở sản phẩm khác trong đợt còn chờ — nút "Áp cho sản phẩm còn lại". */
  const siblings = batch.jobs
    .filter((j) => j.id !== job.id)
    .flatMap((j) => j.targets)
    .filter((x) => x.channel.id === t.channel.id && isOpen(x)).length;
  // Thuộc tính bắt buộc lên đầu để khách thấy ngay phải điền gì; tuỳ chọn xếp sau.
  const attributeDefs = [...t.attributeDefs].sort((a, b) => Number(b.required) - Number(a.required));
  const requiredAttrCount = attributeDefs.filter((d) => d.required).length;
  const platformLabel = CHANNEL_META[t.channel.channelName].label;

  async function save() {
    setSaving(true);
    try {
      await updateCopyListingTarget(job.id, t.id, draft);
      // Nạp lại đợt XONG mới xoá nháp — tránh ô danh mục nháy về giá trị cũ một nhịp.
      await invalidate(qk.copyListingBatch(batch.id));
      setDraft({});
      toast.success(`Đã lưu ${t.channel.shopName}.`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function applyToOthers() {
    setApplying(true);
    try {
      if (dirty) await updateCopyListingTarget(job.id, t.id, draft);
      const r = await applyCopyListingTargetToBatch(batch.id, t.id);
      await invalidate(qk.copyListingBatch(batch.id));
      setDraft({});
      toast.success(`Đã áp danh mục, thuộc tính, cân nặng… cho ${r.applied} sản phẩm còn lại trên ${t.channel.shopName}.`);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setApplying(false);
    }
  }

  const setAttr = (id: string, v: string) => setDraft((d) => ({ ...d, attributes: { ...(d.attributes ?? {}), [id]: v } }));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className={cn(TEXT_TABLE_HEAD, "flex flex-wrap items-center gap-1.5", missing.has("category") && "text-amber-700")}>
          <span>Danh mục trên {platformLabel}</span>
          <RequiredPill />
          {missing.has("category") && <span className="font-normal normal-case">· còn thiếu</span>}
          {t.categoryConfidence != null && draft.categoryId === undefined && (
            <span className="ml-2 font-normal normal-case text-slate-500">Hubsell gợi ý · độ khớp {Math.round(t.categoryConfidence * 100)}%</span>
          )}
        </div>
        <CategoryCascade
          jobId={job.id}
          targetId={t.id}
          value={value("categoryId") ?? null}
          disabled={!canEdit}
          invalid={missing.has("category")}
          onChange={(id) => setDraft((d) => ({ ...d, categoryId: id }))}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(req?.brandRequired || t.brandId) && (
          <EditorField label="Thương hiệu" missing={missing.has("brand")} required={Boolean(req?.brandRequired)} hint="Gõ vài chữ đầu để tìm. Hàng không có thương hiệu thì chọn Không có thương hiệu (No Brand).">
            <BrandCombobox
              jobId={job.id}
              targetId={t.id}
              categoryId={value("categoryId") ?? null}
              value={(() => {
                const id = value("brandId");
                if (!id) return null;
                return { id, name: draft.brandId !== undefined ? (draft.brandName ?? id) : (t.brandName ?? id) };
              })()}
              disabled={!canEdit}
              invalid={missing.has("brand")}
              onChange={(b) => setDraft((d) => ({ ...d, brandId: b?.id ?? null, brandName: b?.name ?? null }))}
            />
          </EditorField>
        )}
        <EditorField label="Cân nặng (gram)" missing={missing.has("weight")} required={req?.weightRequired ?? true} hint="Cân nặng cả gói hàng, tính phí ship. Ví dụ áo thun: 250.">
          <Input
            type="number"
            min={0}
            className={inputCls("weight")}
            value={value("weightGrams") ?? ""}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, weightGrams: e.target.value === "" ? null : Number(e.target.value) }))}
          />
        </EditorField>
        <EditorField
          label="Kích thước kiện hàng (cm)"
          missing={missing.has("dimensions")}
          required={Boolean(req?.dimensionsRequired)}
          hint={req?.dimensionsRequired ? "Dài × Rộng × Cao của gói hàng khi gửi, đủ cả 3 số." : "Không bắt buộc. Nếu nhập thì phải đủ cả 3 số Dài × Rộng × Cao; để trống cả 3 nếu không rõ."}
        >
          <div className="flex gap-2">
            {(["length", "width", "height"] as const).map((k) => (
              <Input
                key={k}
                type="number"
                min={0}
                className={inputCls("dimensions")}
                placeholder={k === "length" ? "Dài" : k === "width" ? "Rộng" : "Cao"}
                value={dims?.[k] || ""}
                disabled={!canEdit}
                onChange={(e) =>
                  setDraft((d) => {
                    const next = { length: dims?.length ?? 0, width: dims?.width ?? 0, height: dims?.height ?? 0, [k]: Number(e.target.value) || 0 };
                    // Xóa hết 3 ô → null (không gửi sàn); sàn từ chối nếu nhận số 0.
                    const empty = next.length <= 0 && next.width <= 0 && next.height <= 0;
                    return { ...d, dimensionsCm: empty ? null : next };
                  })
                }
              />
            ))}
          </div>
        </EditorField>
        <EditorField label="Điều chỉnh giá so với nguồn (%)" missing={missing.has("price")} hint="0 = giữ giá nguồn. Ví dụ 10 = đắt hơn 10%, −5 = rẻ hơn 5%.">
          <Input
            type="number"
            min={-50}
            max={100}
            value={value("priceAdjustPercent") ?? 0}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, priceAdjustPercent: Number(e.target.value) || 0 }))}
          />
        </EditorField>
        <EditorField label="Tồn đăng mỗi phân loại" missing={missing.has("stock")} hint="Để trống = lấy số tồn của nguồn.">
          <Input
            type="number"
            min={0}
            value={value("stock") ?? ""}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, stock: e.target.value === "" ? null : Number(e.target.value) }))}
          />
        </EditorField>
      </div>
      {attributeDefs.length > 0 && (
        <div className={cn(TEXT_SUB, "whitespace-normal pt-1 leading-snug")}>
          Thông tin {platformLabel} hỏi thêm cho danh mục này
          {requiredAttrCount > 0
            ? ` — ${requiredAttrCount} ô có nhãn Bắt buộc phải điền mới đăng được; các ô còn lại để trống vẫn đăng được, có thì khách dễ tìm thấy hàng hơn.`
            : " — không có ô bắt buộc; điền được ô nào thì khách dễ tìm thấy hàng hơn."}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {attributeDefs.map((def) => {
          const code = `attr:${def.id}`;
          return (
            <EditorField key={code} label={def.name} missing={missing.has(code)} required={def.required}>
              {def.type === "select" ? (
                <NativeSelect className={inputCls(code)} value={attrs[def.id] ?? ""} disabled={!canEdit} onChange={(e) => setAttr(def.id, e.target.value)}>
                  <option value="">— Chọn —</option>
                  {(def.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  type={def.type === "number" ? "number" : "text"}
                  className={inputCls(code)}
                  value={attrs[def.id] ?? ""}
                  disabled={!canEdit}
                  placeholder={def.type === "number" ? "Nhập số" : "Nhập chữ"}
                  onChange={(e) => setAttr(def.id, e.target.value)}
                />
              )}
            </EditorField>
          );
        })}
      </div>
      {logisticEnabled.length > 0 && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(TEXT_TABLE_HEAD, missing.has("logistics") && "text-amber-700")}>Kênh vận chuyển</span>
            {req?.logisticsRequired && <RequiredPill />}
            <span className={cn(TEXT_SUB, "tabular-nums")}>
              {logisticsOn === logisticEnabled.length
                ? `theo cài đặt gian — ${logisticEnabled.length} kênh đang bật trên sàn`
                : `${logisticsOn}/${logisticEnabled.length} kênh đang bật trên sàn`}
            </span>
            {canEdit && (
              <Button size="xs" variant="ghost" onClick={() => setLogisticsOpen((v) => !v)}>
                {logisticsOpen || missing.has("logistics") ? "Thu gọn" : "Tuỳ chỉnh"}
              </Button>
            )}
          </div>
          {(logisticsOpen || missing.has("logistics")) && (
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
              {logisticEnabled.map((o) => (
                <label key={o.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    disabled={!canEdit}
                    checked={logistics.includes(o.id)}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, logisticIds: e.target.checked ? [...logistics, o.id] : logistics.filter((x) => x !== o.id) }))
                    }
                  />
                  {o.name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={TEXT_SUB}>
          Giới hạn sàn: tên {req?.titleMin ?? "?"}–{req?.titleMax ?? "?"} ký tự · tối đa {req?.maxImages ?? "?"} ảnh ·{" "}
          {req?.maxOptions ?? "?"} nhóm phân loại · {req?.maxVariants ?? "?"} phân loại. Video, bảng size, chứng chỉ: bổ sung trên
          sàn sau khi đăng.
        </span>
        {canEdit && (
          <div className="flex items-center gap-2">
            {siblings > 0 && (
              <Button size="sm" variant="outline" disabled={applying || saving} onClick={applyToOthers}>
                {applying ? "Đang áp…" : `Áp cho ${siblings} sản phẩm còn lại`}
              </Button>
            )}
            <Button size="sm" disabled={!dirty || saving || applying} onClick={save}>
              {saving ? "Đang lưu…" : "Lưu gian này"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
