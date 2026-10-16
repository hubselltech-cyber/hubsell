import { afterEach, describe, expect, it, vi } from "vitest";
import { getTiktokVideoMeta, summarizeOembedFailures, type OembedOutcome } from "../tiktok-ads/video-meta";

const META = (id: string) => ({ videoId: id, author: "shop", authorName: "Shop", caption: "Cap " + id, thumbnailUrl: "https://cdn/" + id });

describe("summarizeOembedFailures", () => {
  it("gom theo nhãn, bỏ ok, nhiều trước", () => {
    expect(summarizeOembedFailures(["ok", "503", "503", "timeout", "ok", "503"])).toBe("503×3, timeout×1");
    expect(summarizeOembedFailures(["ok", "ok"])).toBe("");
  });
});

describe("getTiktokVideoMeta — log tóm tắt một dòng mỗi lượt + nhớ đệm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("TikTok trả 503 cho mọi video → không có meta, MỘT dòng warn ghi số hỏng theo mã HTTP", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMeta = vi.fn(async (): Promise<OembedOutcome> => ({ meta: null, why: "503" }));
    // Mã 19 chữ số, khác với các test khác để không dính bộ nhớ đệm chung của module.
    const ids = ["7000000000000000001", "7000000000000000002", "7000000000000000003"];
    const out = await getTiktokVideoMeta(ids, fetchMeta);
    expect(out).toEqual({});
    expect(fetchMeta).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe("[TikTok Ads] oEmbed: hỏi 3, được 0, hỏng 3 (503×3)");
    expect(log).not.toHaveBeenCalled();
  });

  it("một phần được → log thường khi không hỏng, warn khi có hỏng; lượt sau đọc từ đệm không hỏi lại", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMeta = vi.fn(async (id: string): Promise<OembedOutcome> =>
      id.endsWith("9") ? { meta: null, why: "timeout" } : { meta: META(id), why: "ok" }
    );
    const ids = ["7000000000000000011", "7000000000000000019"];
    const out = await getTiktokVideoMeta(ids, fetchMeta);
    expect(Object.keys(out)).toEqual(["7000000000000000011"]);
    expect(warn.mock.calls[0][0]).toBe("[TikTok Ads] oEmbed: hỏi 2, được 1, hỏng 1 (timeout×1)");

    // Lượt 2 ngay sau: cả hai đã trong đệm (được 3h, hỏng 10') → không gọi, không log.
    fetchMeta.mockClear();
    warn.mockClear();
    log.mockClear();
    const again = await getTiktokVideoMeta(ids, fetchMeta);
    expect(Object.keys(again)).toEqual(["7000000000000000011"]);
    expect(fetchMeta).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();

    // Mã mới, toàn ok → console.log.
    await getTiktokVideoMeta(["7000000000000000021"], fetchMeta);
    expect(log.mock.calls[0][0]).toBe("[TikTok Ads] oEmbed: hỏi 1, được 1, hỏng 0");
  });

  it("hàm lấy ném lỗi → tính là hỏng 'error', không vỡ cả lượt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMeta = vi.fn(async (): Promise<OembedOutcome> => { throw new Error("boom"); });
    const out = await getTiktokVideoMeta(["7000000000000000031"], fetchMeta);
    expect(out).toEqual({});
  });
});
