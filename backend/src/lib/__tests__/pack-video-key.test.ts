// Đường dẫn tệp video trên kho: máy chủ tự dựng, đọc ngược được, kiểm được "tệp này của ai".
import { describe, expect, it } from "vitest";
import {
  buildPackVideoKey,
  keyBelongsToOwner,
  packVideoDownloadName,
  parsePackVideoKey,
} from "../pack-video-key";

describe("pack-video-key", () => {
  const parts = { ownerId: "u_abc123", recordedDate: "2026-11-16", id: "0f3a9c" };

  it("dựng đúng khuôn chủ shop / ngày / id.mp4 và đọc ngược lại được", () => {
    const key = buildPackVideoKey(parts);
    expect(key).toBe("u_abc123/2026-11-16/0f3a9c.mp4");
    expect(parsePackVideoKey(key)).toEqual(parts);
  });

  it("từ chối chủ shop / id có ký tự lạ (không cho chui ra ngoài tiền tố)", () => {
    expect(() => buildPackVideoKey({ ...parts, ownerId: "../ke-khac" })).toThrow();
    expect(() => buildPackVideoKey({ ...parts, ownerId: "a/b" })).toThrow();
    expect(() => buildPackVideoKey({ ...parts, id: "x/../y" })).toThrow();
    expect(() => buildPackVideoKey({ ...parts, recordedDate: "16-11-2026" })).toThrow();
  });

  it("đường dẫn sai khuôn → null", () => {
    for (const bad of ["", "a/b.mp4", "a/2026-11-16/x.mov", "a/2026-11-16/x.mp4/extra", "/2026-11-16/x.mp4"]) {
      expect(parsePackVideoKey(bad)).toBeNull();
    }
  });

  it("keyBelongsToOwner chỉ đúng với chính chủ shop đứng đầu đường dẫn", () => {
    const key = buildPackVideoKey(parts);
    expect(keyBelongsToOwner(key, "u_abc123")).toBe(true);
    expect(keyBelongsToOwner(key, "u_abc12")).toBe(false);
    expect(keyBelongsToOwner(key, "u_khac")).toBe(false);
    expect(keyBelongsToOwner("rac", "u_abc123")).toBe(false);
  });

  it("tên tệp tải về = mã vận đơn, video khui thêm -khui, bỏ ký tự lạ", () => {
    expect(packVideoDownloadName("SPXVN0612345", "PACK")).toBe("SPXVN0612345.mp4");
    expect(packVideoDownloadName("SPXVN0612345", "UNBOX")).toBe("SPXVN0612345-khui.mp4");
    expect(packVideoDownloadName('a"b/c\r\nd', "PACK")).toBe("abcd.mp4");
    expect(packVideoDownloadName("///", "PACK")).toBe("video.mp4");
  });
});
