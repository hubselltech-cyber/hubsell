// Hỏi lại TikTok bài chờ duyệt → trạng thái Hubsell (docs/SAO-CHEP-SAN-PHAM.md mục 17).
import { describe, expect, it } from "vitest";
import { mapTikTokReview } from "../tiktok-listing-adapter";

describe("mapTikTokReview", () => {
  it("ACTIVATE / SELLER_DEACTIVATED → LISTED; PENDING / DRAFT / thiếu → còn chờ", () => {
    expect(mapTikTokReview({ status: "ACTIVATE" }).status).toBe("LISTED");
    expect(mapTikTokReview({ status: "SELLER_DEACTIVATED" }).status).toBe("LISTED");
    expect(mapTikTokReview({ status: "PENDING" }).status).toBe("PENDING_REVIEW");
    expect(mapTikTokReview({ status: "DRAFT" }).status).toBe("PENDING_REVIEW");
    expect(mapTikTokReview({}).status).toBe("PENDING_REVIEW");
  });

  it("FAILED kèm lý do + gợi ý; PLATFORM_DEACTIVATED / DELETED → FAILED câu riêng", () => {
    const r = mapTikTokReview({
      status: "FAILED",
      audit_failed_reasons: [{ position: "title", reasons: ["Tiêu đề chứa từ cấm"], suggestions: ["Bỏ từ 'rẻ nhất'"] }],
    });
    expect(r.status).toBe("FAILED");
    expect(r.reason).toMatch(/^TikTok Shop từ chối bài đăng khi duyệt: Tiêu đề chứa từ cấm; gợi ý: Bỏ từ 'rẻ nhất'/);
    expect(mapTikTokReview({ status: "PLATFORM_DEACTIVATED" }).reason).toMatch(/khóa \/ ẩn/);
    expect(mapTikTokReview({ status: "DELETED" }).reason).toMatch(/bị xóa/);
  });
});
