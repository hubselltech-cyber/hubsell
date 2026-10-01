import { describe, expect, it } from "vitest";
import { durableQueueSignal } from "../platform-health";

const q = (name: string, ready = 0, active = 0) => ({ name, ready, deferred: 0, active, failed: 0 });
const idle = [q("evt.auth"), q("evt.dead"), q("evt.order"), q("stock.channel"), q("stock.dead"), q("stock.verify")];
const base = { durableQueueError: null, inboxPending: 0, inboxOldestMin: null };

describe("durableQueueSignal", () => {
  it("hàng đợi trống → xanh", () => {
    const [value, level] = durableQueueSignal({ ...base, durableQueues: idle });
    expect(level).toBe("ok");
    expect(value).toContain("0 việc chờ, 0 đang chạy, 0 trong hàng đợi lỗi");
  });

  it("không đọc được → vàng, kèm lý do khởi động hỏng", () => {
    const [value, level] = durableQueueSignal({
      ...base,
      durableQueues: null,
      durableQueueError: "pg-boss is not installed",
    });
    expect(level).toBe("warn");
    expect(value).toContain("pg-boss is not installed");
  });

  it("có việc trong hàng đợi lỗi → vàng, không tính vào việc chờ", () => {
    const [value, level, hint] = durableQueueSignal({
      ...base,
      durableQueues: idle.map((x) => (x.name === "evt.dead" ? q("evt.dead", 2) : x)),
    });
    expect(level).toBe("warn");
    expect(value).toContain("0 việc chờ");
    expect(value).toContain("2 trong hàng đợi lỗi");
    expect(hint).toContain("hàng đợi lỗi");
  });

  it("việc dồn quá ngưỡng hoặc dòng hộp thư đến chờ quá lâu → đỏ", () => {
    const backlog = durableQueueSignal({
      ...base,
      durableQueues: idle.map((x) => (x.name === "evt.order" ? q("evt.order", 200, 4) : x)),
    });
    expect(backlog[1]).toBe("crit");
    expect(backlog[0]).toContain("đông nhất evt.order: 200");
    const old = durableQueueSignal({ ...base, durableQueues: idle, inboxPending: 3, inboxOldestMin: 30 });
    expect(old[1]).toBe("crit");
    expect(old[0]).toContain("hộp thư đến 3 chờ, cũ nhất 30'");
  });
});
