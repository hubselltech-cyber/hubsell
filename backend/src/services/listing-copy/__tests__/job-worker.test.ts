// Luật gom trạng thái job / đợt từ trạng thái các gian đích (thuần). Phần worker chạm DB + sàn không test ở đây.
import { describe, expect, it } from "vitest";
import { rollupStatus } from "../job-worker";

describe("rollupStatus", () => {
  it("còn gian đang xếp hàng / đang đăng → SUBMITTED, kể cả khi gian khác đã xong", () => {
    expect(rollupStatus(["LISTED", "QUEUED"])).toBe("SUBMITTED");
    expect(rollupStatus(["FAILED", "RUNNING", "PENDING"])).toBe("SUBMITTED");
  });
  it("chưa gian nào đăng → DRAFT; mọi gian lên hoặc chờ duyệt → DONE", () => {
    expect(rollupStatus(["PENDING", "PENDING"])).toBe("DRAFT");
    expect(rollupStatus([])).toBe("DRAFT");
    expect(rollupStatus(["LISTED", "PENDING_REVIEW"])).toBe("DONE");
  });
  it("không gian nào lên và không còn gian chờ → FAILED; còn lại → PARTIAL", () => {
    expect(rollupStatus(["FAILED", "FAILED"])).toBe("FAILED");
    expect(rollupStatus(["LISTED", "FAILED"])).toBe("PARTIAL");
    expect(rollupStatus(["LISTED", "PENDING"])).toBe("PARTIAL");
    expect(rollupStatus(["FAILED", "PENDING"])).toBe("PARTIAL");
  });
});
