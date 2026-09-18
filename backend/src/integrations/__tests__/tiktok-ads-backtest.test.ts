import { describe, expect, it } from "vitest";
import { backtestStartDate, buildDryRunBacktest, type DryRunPlan, type VideoDayRow } from "../tiktok-ads/backtest";

// ĐỐI CHIẾU DIỄN TẬP — video máy định loại, từ hôm sau ngày định loại tới nay chạy ra sao.
const cfg = { roiTarget: 15, hardRoi: 7.5, minSpend: 50_000 }; // mức loại = ROI 7,5
const today = "2026-09-25";

const day = (videoId: string, date: string, cost: number, orders: number, gmv: number, deliveryStatus = "DELIVERING"): VideoDayRow => ({
  videoId,
  spuId: "spu1",
  date,
  deliveryStatus,
  cost,
  orders,
  gmv,
});

describe("backtestStartDate", () => {
  it("chưa có lượt nào định loại video → không cần gọi sàn", () => {
    expect(backtestStartDate([], today)).toBeNull();
    expect(backtestStartDate([{ date: "2026-09-20", videos: [] }], today)).toBeNull();
  });
  it("lấy D+1 của lượt sớm nhất; máy mới định loại HÔM NAY thì chưa có gì để đối chiếu", () => {
    const plans: DryRunPlan[] = [
      { date: "2026-09-22", videos: [{ videoId: "1", note: "" }] },
      { date: "2026-09-20", videos: [{ videoId: "2", note: "" }] },
    ];
    expect(backtestStartDate(plans, today)).toBe("2026-09-21");
    expect(backtestStartDate([{ date: today, videos: [{ videoId: "1", note: "" }] }], today)).toBeNull();
  });
});

describe("buildDryRunBacktest", () => {
  it("video lặp lại qua nhiều lượt diễn tập chỉ tính từ lượt ĐẦU, giữ căn cứ của lượt đầu", () => {
    const plans: DryRunPlan[] = [
      { date: "2026-09-21", videos: [{ videoId: "1", note: "lượt sau" }] },
      { date: "2026-09-20", videos: [{ videoId: "1", note: "lượt đầu" }] },
      { date: "2026-09-22", videos: [{ videoId: "1", note: "lượt sau nữa" }] },
    ];
    const r = buildDryRunBacktest(plans, [], cfg, today);
    expect(r.videos).toHaveLength(1);
    expect(r.videos[0]).toMatchObject({ firstPlannedOn: "2026-09-20", lastPlannedOn: "2026-09-22", plannedDays: 3, noteAtPlan: "lượt đầu", daysSince: 5 });
    expect(r.firstPlanOn).toBe("2026-09-20");
  });

  it("BỎ ngày định loại (D) và mọi ngày trước đó — chỉ cộng từ D+1", () => {
    const plans: DryRunPlan[] = [{ date: "2026-09-20", videos: [{ videoId: "1", note: "" }] }];
    const rows = [
      day("1", "2026-09-19", 900_000, 0, 0),
      day("1", "2026-09-20", 800_000, 0, 0),
      day("1", "2026-09-21", 60_000, 0, 0),
      day("1", "2026-09-22", 40_000, 0, 0),
      day("khac", "2026-09-22", 999_000, 9, 9_000_000), // video máy không định loại → không lẫn vào
    ];
    const r = buildDryRunBacktest(plans, rows, cfg, today);
    expect(r.videos[0]).toMatchObject({ cost: 100_000, orders: 0, gmv: 0, verdict: "right" });
    expect(r.totals).toMatchObject({ videos: 1, cost: 100_000, orders: 0 });
  });

  it("kết luận theo đúng mốc khách cài: chưa đủ dữ liệu / máy đúng / lưng chừng / hồi phục", () => {
    const plans: DryRunPlan[] = [
      {
        date: "2026-09-20",
        videos: ["it", "khongdon", "roithap", "giua", "hoi"].map((videoId) => ({ videoId, note: "" })),
      },
    ];
    const rows = [
      day("it", "2026-09-21", 49_999, 0, 0), // dưới sàn dữ liệu 50k
      day("khongdon", "2026-09-21", 200_000, 0, 0),
      day("roithap", "2026-09-21", 100_000, 2, 700_000), // ROI 7 < 7,5
      day("giua", "2026-09-21", 100_000, 3, 1_000_000), // ROI 10: trên mức loại, dưới mục tiêu
      day("hoi", "2026-09-21", 100_000, 5, 1_500_000), // ROI 15 = mục tiêu
    ];
    const r = buildDryRunBacktest(plans, rows, cfg, today);
    const verdictOf = Object.fromEntries(r.videos.map((v) => [v.videoId, v.verdict]));
    expect(verdictOf).toEqual({ it: "insufficient", khongdon: "right", roithap: "right", giua: "middle", hoi: "recovered" });
    expect(r.counts).toEqual({ insufficient: 1, right: 2, middle: 1, recovered: 1 });
    // Tốn tiền nhất đứng đầu.
    expect(r.videos[0].videoId).toBe("khongdon");
    expect(r.totals.roi).toBeCloseTo(3_200_000 / 549_999, 5);
  });

  it("video bị loại tay giữa chừng: trạng thái lấy của ngày mới nhất, số dừng ở đó", () => {
    const plans: DryRunPlan[] = [{ date: "2026-09-20", videos: [{ videoId: "1", note: "" }] }];
    const rows = [day("1", "2026-09-21", 70_000, 0, 0, "DELIVERING"), day("1", "2026-09-22", 0, 0, 0, "EXCLUDED")];
    const r = buildDryRunBacktest(plans, rows, cfg, today);
    expect(r.videos[0]).toMatchObject({ deliveryStatus: "EXCLUDED", cost: 70_000 });
  });

  it("không có video nào → tổng 0, ROI null", () => {
    const r = buildDryRunBacktest([], [], cfg, today);
    expect(r).toMatchObject({ firstPlanOn: "", videos: [], totals: { videos: 0, cost: 0, orders: 0, gmv: 0, roi: null } });
  });
});
