import { describe, expect, it } from "vitest";
import {
  compareTiktokCampaigns,
  reconcileTiktokCampaignStatuses,
  tiktokCampaignStatusOf,
  tiktokCampaignStatusRank,
} from "../tiktok-ads/campaign-status";

describe("tiktokCampaignStatusOf — từ vựng TikTok → status Hubsell", () => {
  it("ENABLE → ongoing; DISABLE / rỗng / lạ → paused (không suy ra đang chạy từ dữ liệu thiếu)", () => {
    expect(tiktokCampaignStatusOf({ operationStatus: "ENABLE" })).toBe("ongoing");
    expect(tiktokCampaignStatusOf({ operationStatus: "DISABLE" })).toBe("paused");
    expect(tiktokCampaignStatusOf({ operationStatus: "" })).toBe("paused");
    expect(tiktokCampaignStatusOf({ operationStatus: undefined })).toBe("paused");
    expect(tiktokCampaignStatusOf({ operationStatus: "WHATEVER" })).toBe("paused");
  });

  it("secondary_status DELETE / TIME_DONE ép về ended kể cả khi operation_status ENABLE", () => {
    expect(tiktokCampaignStatusOf({ operationStatus: "ENABLE", secondaryStatus: "CAMPAIGN_STATUS_DELETE" })).toBe("ended");
    expect(tiktokCampaignStatusOf({ operationStatus: "DISABLE", secondaryStatus: "CAMPAIGN_STATUS_TIME_DONE" })).toBe("ended");
    // secondary khác giữ nghĩa của operation_status (gian nhà: PRODUCT_USED_BY_PRODUCT_GMV_MAX đi cùng ENABLE)
    expect(
      tiktokCampaignStatusOf({ operationStatus: "ENABLE", secondaryStatus: "CAMPAIGN_STATUS_PRODUCT_USED_BY_PRODUCT_GMV_MAX" })
    ).toBe("ongoing");
    expect(tiktokCampaignStatusOf({ operationStatus: "DISABLE", secondaryStatus: "CAMPAIGN_STATUS_DISABLE" })).toBe("paused");
  });
});

describe("compareTiktokCampaigns — đang chạy LUÔN trên cùng, rồi mới tới chi tiêu", () => {
  const row = (name: string, status: string, spend: number) => ({ name, status, spend });

  it("chiến dịch tạm dừng tiêu nhiều vẫn nằm DƯỚI chiến dịch đang chạy tiêu ít", () => {
    const rows = [row("Tắt tiêu nhiều", "paused", 9_000_000), row("Chạy tiêu ít", "ongoing", 10_000), row("Đã dừng", "ended", 50_000_000)];
    expect(rows.sort(compareTiktokCampaigns).map((r) => r.name)).toEqual(["Chạy tiêu ít", "Tắt tiêu nhiều", "Đã dừng"]);
  });

  it("trong cùng nhóm: tiêu nhiều đứng trước, bằng nhau thì theo tên", () => {
    const rows = [row("B", "ongoing", 100), row("A", "ongoing", 100), row("C", "ongoing", 500)];
    expect(rows.sort(compareTiktokCampaigns).map((r) => r.name)).toEqual(["C", "A", "B"]);
  });

  it("trạng thái lạ xếp cuối cùng, sau cả ended", () => {
    expect(tiktokCampaignStatusRank("ongoing")).toBeLessThan(tiktokCampaignStatusRank("paused"));
    expect(tiktokCampaignStatusRank("paused")).toBeLessThan(tiktokCampaignStatusRank("ended"));
    expect(tiktokCampaignStatusRank("ended")).toBeLessThan(tiktokCampaignStatusRank("scheduled"));
  });
});

describe("reconcileTiktokCampaignStatuses — đối soát báo cáo × danh sách chiến dịch", () => {
  const known = [
    { id: "r1", campaignId: "1", status: "ongoing", name: "TC001" },
    { id: "r2", campaignId: "2", status: "paused", name: "TC002" },
    { id: "r3", campaignId: "3", status: "ongoing", name: "TC003" },
    { id: "r4", campaignId: "4", status: "ended", name: "TC004" },
  ];

  it("vắng ở danh sách lẫn báo cáo → ended; đã ended thì không chạm lại", () => {
    const r = reconcileTiktokCampaignStatuses({
      known,
      listed: [{ campaignId: "1", name: "TC001", operationStatus: "ENABLE" }],
      reported: ["1"],
    });
    expect(r.updates).toEqual([
      { id: "r2", status: "ended" },
      { id: "r3", status: "ended" },
    ]);
    expect(r.creates).toEqual([]);
    expect(r.liveCampaigns).toBe(1);
  });

  it("có trong báo cáo lượt này (vừa tiêu tiền) thì KHÔNG bị gán ended dù vắng ở danh sách", () => {
    const r = reconcileTiktokCampaignStatuses({
      known,
      listed: [{ campaignId: "1", name: "TC001", operationStatus: "ENABLE" }],
      reported: ["1", "3"],
    });
    expect(r.updates).toEqual([{ id: "r2", status: "ended" }]);
    // r3 còn ongoing theo báo cáo → vẫn đếm là đang chạy
    expect(r.liveCampaigns).toBe(2);
  });

  it("danh sách nói khác DB → đổi theo danh sách; ended xuất hiện lại thì sống lại; tên đổi thì cập nhật", () => {
    const r = reconcileTiktokCampaignStatuses({
      known,
      listed: [
        { campaignId: "1", name: "TC001", operationStatus: "DISABLE" }, // chủ shop vừa tắt
        { campaignId: "2", name: "TC002 NEW", operationStatus: "ENABLE" }, // bật lại + đổi tên
        { campaignId: "3", name: "TC003", operationStatus: "ENABLE" }, // y nguyên → không chạm
        { campaignId: "4", name: "TC004", operationStatus: "DISABLE" }, // TikTok khôi phục
      ],
      reported: [],
    });
    expect(r.updates).toEqual([
      { id: "r1", status: "paused" },
      { id: "r2", status: "ongoing", name: "TC002 NEW" },
      { id: "r4", status: "paused" },
    ]);
    expect(r.creates).toEqual([]);
    expect(r.liveCampaigns).toBe(2);
  });

  it("danh sách có mà Hubsell chưa biết → tạo mới với trạng thái đúng; tên rỗng không đè tên cũ", () => {
    const r = reconcileTiktokCampaignStatuses({
      known: [{ id: "r1", campaignId: "1", status: "ongoing", name: "TC001" }],
      listed: [
        { campaignId: "1", name: "", operationStatus: "ENABLE" },
        { campaignId: "9", name: "Mới tạo, chưa tiêu", operationStatus: "DISABLE" },
        { campaignId: "", name: "rác", operationStatus: "ENABLE" },
      ],
      reported: ["1"],
    });
    expect(r.updates).toEqual([]);
    expect(r.creates).toEqual([{ campaignId: "9", name: "Mới tạo, chưa tiêu", status: "paused" }]);
    expect(r.liveCampaigns).toBe(1);
  });

  it("trùng campaign_id trong danh sách: dòng sau đè dòng trước", () => {
    const r = reconcileTiktokCampaignStatuses({
      known: [{ id: "r1", campaignId: "1", status: "paused", name: "TC001" }],
      listed: [
        { campaignId: "1", name: "TC001", operationStatus: "DISABLE" },
        { campaignId: "1", name: "TC001", operationStatus: "ENABLE" },
      ],
      reported: [],
    });
    expect(r.updates).toEqual([{ id: "r1", status: "ongoing" }]);
  });
});
