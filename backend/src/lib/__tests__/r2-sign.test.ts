// Ký đường dẫn R2: không gọi mạng — chỉ kiểm cấu trúc đường dẫn và việc các rào ĐƯỢC ký.
// Hành vi của R2 với các rào này đã thử thật 15/11/2026 (tài liệu khảo sát mục 57.2).
import { describe, expect, it } from "vitest";
import { presignGet, presignPart, presignPut, r2ObjectUrl, type R2Credentials } from "../r2-sign";

const cfg: R2Credentials = {
  endpoint: "https://acct.r2.cloudflarestorage.com/",
  bucket: "bucket-thu",
  accessKeyId: "AKIDTEST",
  secretAccessKey: "bi-mat-khong-duoc-lo",
};
const KEY = "u_abc/2026-11-16/vid1.mp4";
const AT = "20261116T030000Z";

const q = (url: string) => new URL(url).searchParams;

describe("r2-sign", () => {
  it("đường dẫn tệp gồm bucket + khóa, không nhân đôi dấu gạch", () => {
    expect(r2ObjectUrl(cfg, KEY)).toBe("https://acct.r2.cloudflarestorage.com/bucket-thu/u_abc/2026-11-16/vid1.mp4");
  });

  it("PUT ký cả content-length và content-type, có hạn, không lộ khóa bí mật", async () => {
    const url = await presignPut(cfg, KEY, {
      contentLength: 1234,
      contentType: "video/mp4",
      expiresSec: 900,
      datetime: AT,
    });
    const p = q(url);
    expect(new URL(url).pathname).toBe("/bucket-thu/u_abc/2026-11-16/vid1.mp4");
    expect(p.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(p.get("X-Amz-Expires")).toBe("900");
    expect(p.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(p.get("X-Amz-Credential")).toContain("AKIDTEST/20261116/auto/s3/aws4_request");
    expect(url).not.toContain(cfg.secretAccessKey);
  });

  it("đổi cỡ tệp / kiểu tệp / tên tệp thì chữ ký đổi (rào nằm TRONG chữ ký)", async () => {
    const sig = async (key: string, contentLength: number, contentType: string) =>
      q(await presignPut(cfg, key, { contentLength, contentType, expiresSec: 900, datetime: AT })).get(
        "X-Amz-Signature"
      );
    const base = await sig(KEY, 1234, "video/mp4");
    expect(await sig(KEY, 1234, "video/mp4")).toBe(base);
    expect(await sig(KEY, 1235, "video/mp4")).not.toBe(base);
    expect(await sig(KEY, 1234, "text/html")).not.toBe(base);
    expect(await sig("u_khac/2026-11-16/vid1.mp4", 1234, "video/mp4")).not.toBe(base);
  });

  it("mảnh: ký cỡ mảnh, mang partNumber + uploadId", async () => {
    const opts = { uploadId: "UP+ID/1", partNumber: 3, expiresSec: 900, datetime: AT };
    const p = q(await presignPart(cfg, KEY, { ...opts, contentLength: 8388608 }));
    expect(p.get("partNumber")).toBe("3");
    expect(p.get("uploadId")).toBe("UP+ID/1");
    expect(p.get("X-Amz-SignedHeaders")).toBe("content-length;host");
    const other = q(await presignPart(cfg, KEY, { ...opts, contentLength: 8388609 }));
    expect(other.get("X-Amz-Signature")).not.toBe(p.get("X-Amz-Signature"));
  });

  it("GET xem: chỉ ký host; GET tải về: kèm tên tệp đã lọc ký tự lạ", async () => {
    const view = q(await presignGet(cfg, KEY, { expiresSec: 300, datetime: AT }));
    expect(view.get("X-Amz-SignedHeaders")).toBe("host");
    expect(view.get("X-Amz-Expires")).toBe("300");
    expect(view.has("response-content-disposition")).toBe(false);

    const dl = q(await presignGet(cfg, KEY, { expiresSec: 300, downloadName: 'SPX"12\r\n3.mp4', datetime: AT }));
    expect(dl.get("response-content-disposition")).toBe('attachment; filename="SPX123.mp4"');
    expect(dl.get("X-Amz-Signature")).not.toBe(view.get("X-Amz-Signature"));
  });

  it("từ chối cỡ tệp / hạn ký / số mảnh vô lý", async () => {
    const put = { contentType: "video/mp4", expiresSec: 900 };
    await expect(presignPut(cfg, KEY, { ...put, contentLength: 0 })).rejects.toThrow();
    await expect(presignPut(cfg, KEY, { ...put, contentLength: 1.5 })).rejects.toThrow();
    await expect(presignGet(cfg, KEY, { expiresSec: 0 })).rejects.toThrow();
    await expect(presignGet(cfg, KEY, { expiresSec: 8 * 24 * 3600 })).rejects.toThrow();
    await expect(
      presignPart(cfg, KEY, { uploadId: "x", partNumber: 0, contentLength: 10, expiresSec: 900 })
    ).rejects.toThrow();
  });
});
