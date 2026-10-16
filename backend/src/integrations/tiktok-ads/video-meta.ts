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

// 16/10/2026: cổng oEmbed trả 503 "overload-protect triggered" cho MỌI video (cả video chính chủ
// @tiktok) từ trình duyệt ở VN — bảng mất ảnh + tên hàng loạt mà backend không ghi gì. Từ nay:
// (1) gửi header như trình duyệt (yêu cầu từ IP datacenter không có User-Agent bị siết trước),
// (2) mỗi lượt hỏi ghi MỘT dòng log tóm tắt (hỏi/được/hỏng theo mã HTTP) để đọc log Render là biết
// Render có bị chặn không và TikTok đã mở lại chưa. Không log từng video kẻo rác.
const OEMBED_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
};

/** Kết quả một lượt hỏi: meta (null = không lấy được) + nhãn vì sao (mã HTTP / empty / timeout / error). */
export type OembedOutcome = { meta: TiktokVideoMeta | null; why: string };

async function fetchOne(videoId: string): Promise<OembedOutcome> {
  const url = `https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@/video/${videoId}`)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: OEMBED_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { meta: null, why: (err as Error)?.name === "TimeoutError" ? "timeout" : "error" };
  }
  if (!res.ok) return { meta: null, why: String(res.status) };
  let j: { author_unique_id?: string; author_name?: string; title?: string; thumbnail_url?: string };
  try {
    j = (await res.json()) as typeof j;
  } catch {
    return { meta: null, why: "not-json" };
  }
  if (!j.thumbnail_url && !j.title) return { meta: null, why: "empty" };
  return {
    meta: {
      videoId,
      author: j.author_unique_id ?? "",
      authorName: j.author_name ?? "",
      caption: j.title ?? "",
      thumbnailUrl: j.thumbnail_url ?? "",
    },
    why: "ok",
  };
}

/** Gom nhãn hỏng thành "503×4, timeout×1" — thuần, có test. */
export function summarizeOembedFailures(whys: string[]): string {
  const count = new Map<string, number>();
  for (const w of whys) if (w !== "ok") count.set(w, (count.get(w) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w, n]) => `${w}×${n}`)
    .join(", ");
}

/** Trả meta cho các video hỏi tới (thiếu = TikTok không cho / video riêng tư / đã xóa). */
export async function getTiktokVideoMeta(
  videoIds: string[],
  fetchMeta: (videoId: string) => Promise<OembedOutcome> = fetchOne
): Promise<Record<string, TiktokVideoMeta>> {
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
  if (todo.length === 0) return out;
  const whys: string[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      while (i < todo.length) {
        const id = todo[i++];
        const { meta, why } = await fetchMeta(id).catch((): OembedOutcome => ({ meta: null, why: "error" }));
        remember(id, meta);
        whys.push(why);
        if (meta) out[id] = meta;
      }
    })
  );
  const failed = whys.filter((w) => w !== "ok").length;
  const line = `[TikTok Ads] oEmbed: hỏi ${todo.length}, được ${todo.length - failed}, hỏng ${failed}` +
    (failed ? ` (${summarizeOembedFailures(whys)})` : "");
  if (failed) console.warn(line);
  else console.log(line);
  return out;
}
