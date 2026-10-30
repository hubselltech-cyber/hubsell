// ============================================================
// NÉN ẢNH TRÊN TRÌNH DUYỆT — dùng chung cho ảnh yêu cầu hỗ trợ (27/09/2026) và
// ảnh sản phẩm "Sao chép sản phẩm → Tạo mới" (30/10/2026). Ảnh gốc chục MB không
// bao giờ rời máy khách; backend chỉ nhận bản đã nén.
// ============================================================

/** Cạnh dài tối đa sau nén — chữ trên màn hình điện thoại vẫn đọc rõ. */
const COMPRESS_MAX_SIDE = 1600;
/** Đích dung lượng mỗi ảnh (backend hỗ trợ chặn cứng 600 KB, ảnh sản phẩm 1 MB). */
const COMPRESS_TARGET_BYTES = 400 * 1024;

/**
 * Thu về ≤ maxSide, xuất JPEG, hạ chất lượng rồi hạ kích thước dần tới khi ≤
 * targetBytes. Nền trắng (ảnh PNG trong suốt → trắng, đúng kiểu ảnh sàn).
 */
export async function compressImage(
  file: File | Blob,
  opts: { maxSide?: number; targetBytes?: number } = {}
): Promise<Blob> {
  const maxSide = opts.maxSide ?? COMPRESS_MAX_SIDE;
  const targetBytes = opts.targetBytes ?? COMPRESS_TARGET_BYTES;
  const bitmap = await createImageBitmap(file);
  try {
    let side = Math.min(maxSide, Math.max(bitmap.width, bitmap.height));
    const qualities = [0.82, 0.7, 0.58];
    for (let round = 0; round < 3; round++) {
      const scale = side / Math.max(bitmap.width, bitmap.height);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Trình duyệt không hỗ trợ xử lý ảnh");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      for (const q of qualities) {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
        if (!blob) throw new Error("Không nén được ảnh");
        if (blob.size <= targetBytes) return blob;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error("Ảnh quá lớn, vui lòng chọn ảnh khác");
  } finally {
    bitmap.close();
  }
}

/** Kích thước điểm ảnh gốc (để cảnh báo ảnh nhỏ hơn mức sàn khuyên). */
export async function imageDimensions(file: File | Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
