// ============================================================
// TIKTOK ADS — ẢNH BÌA + TÊN KÊNH + CAPTION CỦA VIDEO (để chủ shop nhận mặt)
//
// Probe 17/09/2026: API chính thức /gmv_max/video/get/ CHỈ trả video của tài
// khoản TikTok nhà (and.not.or: 13 video), không trả video của creator /
// affiliate — mà nhóm này mới là đa số (một campaign ~1.800 video) và là nơi
// tiền rơi. Báo cáo tầng video thì không bao giờ trả tên (metric thuộc tính lỗi
// 40002 khi có 3 chiều ID). ➜ Dùng oEmbed CÔNG KHAI của TikTok: không cần
// token, trả author + caption + thumbnail cho mọi video công khai.
//
// Ràng buộc: cổng công khai, không công bố hạn mức → (1) chỉ hỏi cho video
// của TRANG ĐANG XEM (≤ MAX_IDS/lượt), (2) giới hạn song song, (3) nhớ kết quả
// vài giờ (URL ảnh CDN có hạn), nhớ cả lượt hỏng trong thời gian ngắn. Ảnh là
// phần PHỤ: hỏng thì bảng vẫn hiện mã video + link như cũ.
//
// Bộ nhớ đệm nằm trong RAM của từng tiến trình web — chỉ là tối ưu, mất cũng
// không sai số. Khi lưu lượng lớn thì chuyển sang bảng DB.
// ============================================================

export interface TiktokVideoMeta {
  videoId: string;
  /** @handle của kênh đăng (không kèm @). */
  author: string;
  authorName: string;
  caption: string;
  thumbnailUrl: string;
}

export const VIDEO_META_MAX_IDS = 24;
const OK_TTL_MS = 3 * 60 * 60 * 1000;
const FAIL_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 5000;
const CONCURRENCY = 4;
const TIMEOUT_MS = 6000;

const cache = new Map<string, { at: number; meta: TiktokVideoMeta | null }>();

function remember(videoId: string, meta: TiktokVideoMeta | null) {
  if (cache.size >= CACHE_MAX) {
    // Map giữ thứ tự chèn → bỏ 10% cũ nhất.
    let drop = Math.ceil(CACHE_MAX / 10);
    for (const k of cache.keys()) {
      cache.delete(k);
      if (--drop <= 0) break;
    }
  }
  cache.set(videoId, { at: Date.now(), meta });
}

async function fetchOne(videoId: string): Promise<TiktokVideoMeta | null> {
  const url = `https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@/video/${videoId}`)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    author_unique_id?: string;
    author_name?: string;
    title?: string;
    thumbnail_url?: string;
  };
  if (!j.thumbnail_url && !j.title) return null;
  return {
    videoId,
    author: j.author_unique_id ?? "",
    authorName: j.author_name ?? "",
    caption: j.title ?? "",
    thumbnailUrl: j.thumbnail_url ?? "",
  };
}

/** Trả meta cho các video hỏi tới (thiếu = TikTok không cho / video riêng tư / đã xóa). */
export async function getTiktokVideoMeta(videoIds: string[]): Promise<Record<string, TiktokVideoMeta>> {
  const ids = [...new Set(videoIds.filter((id) => /^\d{15,22}$/.test(id)))].slice(0, VIDEO_META_MAX_IDS);
  const out: Record<string, TiktokVideoMeta> = {};
  const todo: string[] = [];
  const now = Date.now();
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && now - hit.at < (hit.meta ? OK_TTL_MS : FAIL_TTL_MS)) {
      if (hit.meta) out[id] = hit.meta;
    } else {
      todo.push(id);
    }
  }
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      while (i < todo.length) {
        const id = todo[i++];
        const meta = await fetchOne(id).catch(() => null);
        remember(id, meta);
        if (meta) out[id] = meta;
      }
    })
  );
  return out;
}
