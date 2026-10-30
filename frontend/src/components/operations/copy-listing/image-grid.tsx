"use client";

// ============================================================
// LƯỚI ẢNH + VÒNG TẢI ẢNH dùng chung cho Sửa bài đăng (source-editor) và form Tạo mới
// (manual-product-form): chọn tệp → nén canvas ≤ 400 KB → POST /images → URL bền.
// Ảnh đầu = bìa; bỏ ảnh / đặt làm bìa / thêm ảnh; ảnh nhỏ hơn mức sàn khuyên gắn nhãn "Nhỏ".
// ============================================================

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, X } from "lucide-react";

import { apiErrorMessage, uploadCopyListingImage } from "@/lib/api";
import { compressImage, imageDimensions } from "@/lib/compress-image";
import { cn } from "@/lib/utils";

/** Ảnh nhỏ hơn mức sàn khuyên (Shopee ≥ 500 px — số trợ giúp sàn, chưa kiểm API). */
const IMAGE_MIN_SIDE = 500;

export interface UploadImage {
  id: string;
  /** null = đang tải lên. */
  url: string | null;
  preview: string;
  small?: boolean;
}

let seq = 0;
const uid = () => `img-${Date.now()}-${seq++}`;

/** Nén + tải MỘT tệp; ném lỗi (toast do nơi gọi). */
export async function uploadImageFile(file: File): Promise<{ url: string; small: boolean }> {
  const [blob, dim] = await Promise.all([compressImage(file), imageDimensions(file)]);
  const { url } = await uploadCopyListingImage(blob);
  return { url, small: Math.min(dim.width, dim.height) < IMAGE_MIN_SIDE };
}

/**
 * Danh sách ảnh có thể sửa: `add(files)` tải tuần tự (chỗ trống theo `max`, quá thì báo),
 * `remove`, `setCover` (đưa lên đầu). `urls` = ảnh đã có URL theo thứ tự; `uploading` = còn ảnh
 * đang tải (khóa nút Lưu / Tiếp).
 */
export function useImageUploads(initialUrls: string[], max: number) {
  const [images, setImages] = useState<UploadImage[]>(() => initialUrls.map((url, i) => ({ id: `init-${i}`, url, preview: url })));
  const inputRef = useRef<HTMLInputElement>(null);

  const add = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const room = Math.max(0, max - images.length);
      const picked = Array.from(files).slice(0, room);
      if (picked.length < files.length) toast.warning(`Tối đa ${max} ảnh — đã bỏ ${files.length - picked.length} ảnh.`);
      for (const file of picked) {
        const id = uid();
        const preview = URL.createObjectURL(file);
        setImages((prev) => [...prev, { id, url: null, preview }]);
        try {
          const { url, small } = await uploadImageFile(file);
          setImages((prev) => prev.map((i) => (i.id === id ? { ...i, url, small } : i)));
        } catch (err) {
          toast.error(`${file.name}: ${apiErrorMessage(err, "không tải được ảnh")}`);
          setImages((prev) => prev.filter((i) => i.id !== id));
        } finally {
          URL.revokeObjectURL(preview);
        }
      }
    },
    [images.length, max]
  );
  const remove = useCallback((id: string) => setImages((prev) => prev.filter((x) => x.id !== id)), []);
  const setCover = useCallback((id: string) => setImages((prev) => {
    const img = prev.find((x) => x.id === id);
    return img ? [img, ...prev.filter((x) => x.id !== id)] : prev;
  }), []);

  return {
    images,
    inputRef,
    add,
    remove,
    setCover,
    /** Mở hộp chọn tệp. */
    pick: () => inputRef.current?.click(),
    urls: images.map((i) => i.url).filter((u): u is string => Boolean(u)),
    uploading: images.some((i) => !i.url),
    /** Ô input ẩn — đặt một lần trong cây. */
    input: (
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))}
      />
    ),
  };
}

/**
 * Lưới ảnh: `tile` "square" = ô vuông 3 cột (Sửa bài đăng, cột hẹp 14 rem); "thumb" = ô 80 px
 * xếp tràn (form Tạo mới). `showCover` gắn nhãn "Bìa" ảnh đầu + nút "Đặt làm bìa" các ảnh sau.
 */
export function ImageGrid({
  images,
  max,
  editable,
  tile = "thumb",
  showCover = true,
  onRemove,
  onSetCover,
  onAdd,
}: {
  images: UploadImage[];
  max: number;
  editable: boolean;
  tile?: "square" | "thumb";
  showCover?: boolean;
  onRemove: (id: string) => void;
  onSetCover: (id: string) => void;
  onAdd: () => void;
}) {
  const box = tile === "square" ? "aspect-square" : "size-20";
  return (
    <div className={tile === "square" ? "grid grid-cols-3 gap-2" : "flex flex-wrap gap-2"}>
      {images.map((img, i) => {
        const ready = Boolean(img.url);
        return (
          <div key={img.id} className={cn("group relative overflow-hidden rounded-lg border border-slate-200 bg-muted", box)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url ?? img.preview} alt={`Ảnh ${i + 1}`} className={cn("size-full object-cover", !ready && "opacity-50")} loading="lazy" />
            {!ready && <span className="absolute inset-x-0 bottom-0 bg-black/60 text-center text-[10px] text-white">Đang tải…</span>}
            {ready && showCover && i === 0 && (
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">Bìa</span>
            )}
            {ready && img.small && (
              <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1 text-[10px] font-medium text-white" title={`Ảnh nhỏ hơn ${IMAGE_MIN_SIDE} px — sàn có thể làm mờ`}>
                Nhỏ
              </span>
            )}
            {editable && (
              <button
                type="button"
                aria-label="Bỏ ảnh"
                title="Bỏ ảnh này"
                onClick={() => onRemove(img.id)}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              >
                <X className="size-3" />
              </button>
            )}
            {editable && showCover && i > 0 && ready && (
              <button
                type="button"
                onClick={() => onSetCover(img.id)}
                className="absolute inset-x-0 bottom-0 hidden bg-black/60 py-0.5 text-center text-[10px] text-white group-hover:block"
              >
                Đặt làm bìa
              </button>
            )}
          </div>
        );
      })}
      {editable && images.length < max && (
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700",
            box
          )}
        >
          <ImagePlus className="size-5" />
          <span className="text-[11px]">Thêm ảnh</span>
        </button>
      )}
    </div>
  );
}
