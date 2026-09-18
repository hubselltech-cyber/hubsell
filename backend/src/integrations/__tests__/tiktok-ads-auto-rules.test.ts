import { describe, expect, it } from "vitest";
import {
  AUTO_RULE_DEFAULTS,
  assessVideo,
  BREAKEVEN_MIN_COVERAGE_PCT,
  compareRunDigest,
  daysBetween,
  describeConfigChanges,
  parseRehearsedConfig,
  resolveHardLevel,
  ruleNumbersChanged,
  runChangeLabel,
  runDigestOf,
  unrehearsedFields,
  videoDataProblem,
  planAutoExclusion,
  sanitizeAutoRuleConfig,
  summarizeAutoPlan,
  type AutoRuleConfig,
  type AutoVideoInput,
  type BreakevenInput,
} from "../tiktok-ads/auto-rules";

const today = "2026-09-18";
const cfg: AutoRuleConfig = { ...AUTO_RULE_DEFAULTS, roiTarget: 15, maxCpa: 80_000, ruleCpaOn: true };

function video(over: Partial<AutoVideoInput> & { videoId?: string }): AutoVideoInput {
  return {
    videoId: over.videoId ?? "7600000000000000001",
    spuId: "1729000000000000001",
    deliveryStatus: "DELIVERING",
    cost: 0,
    orders: 0,
    gmv: 0,
    orders30d: 0,
    windowDaysUsed: 7,
    ...over,
  };
}

describe("assessVideo — chấm một video GMV Max", () => {
  it("video TikTok còn học / chờ thử → không xét, dù tiêu bao nhiêu", () => {
    expect(assessVideo(video({ deliveryStatus: "LEARNING", cost: 5_000_000 }), cfg, today).verdict).toBe("learning");
    expect(assessVideo(video({ deliveryStatus: "IN_QUEUE", cost: 5_000_000 }), cfg, today).verdict).toBe("learning");
  });

  it("tiêu dưới sàn dữ liệu → chưa đủ dữ liệu, kể cả 0 đơn", () => {
    const a = assessVideo(video({ cost: 49_999, orders: 0 }), cfg, today);
    expect(a.verdict).toBe("insufficient");
    expect(a.violated).toBe(false);
  });

  it("tiêu ≥ ngưỡng mà 0 đơn → loại; tiêu trên sàn nhưng dưới ngưỡng 0 đơn → ổn", () => {
    expect(assessVideo(video({ cost: 200_000, orders: 0 }), cfg, today).verdict).toBe("exclude");
    expect(assessVideo(video({ cost: 120_000, orders: 0 }), cfg, today).verdict).toBe("healthy");
  });

  it("số thật @micastore92: 7 ngày chi 815k ROI 3,74 so mục tiêu 15 → loại (dưới 50% mục tiêu)", () => {
    const a = assessVideo(video({ cost: 815_000, orders: 9, gmv: 815_000 * 3.74 }), cfg, today);
    expect(a.verdict).toBe("exclude");
    expect(a.reason).toContain("ROI 3,74");
    expect(a.reason).toContain("7,5");
  });

  it("có đơn, ROI giữa mức cứng và mục tiêu → chỉ gắn cờ; ROI đạt mục tiêu → ổn", () => {
    expect(assessVideo(video({ cost: 300_000, orders: 5, gmv: 300_000 * 9 }), cfg, today).verdict).toBe("flag");
    expect(assessVideo(video({ cost: 300_000, orders: 5, gmv: 300_000 * 15 }), cfg, today).verdict).toBe("healthy");
  });

  it("CPA vượt trần → loại dù ROI vẫn cao (hàng giá trị lớn nhưng bán lỗ theo CPA)", () => {
    // 1 đơn 200k, doanh thu 4tr → ROI 20 nhưng CPA 200k > trần 80k.
    const a = assessVideo(video({ cost: 200_000, orders: 1, gmv: 4_000_000 }), cfg, today);
    expect(a.verdict).toBe("exclude");
    expect(a.reason).toContain("chi phí/đơn");
    // Không đặt trần CPA / tắt luật CPA thì video này ổn.
    expect(assessVideo(video({ cost: 200_000, orders: 1, gmv: 4_000_000 }), { ...cfg, maxCpa: null }, today).verdict).toBe("healthy");
    expect(assessVideo(video({ cost: 200_000, orders: 1, gmv: 4_000_000 }), { ...cfg, ruleCpaOn: false }, today).verdict).toBe("healthy");
  });

  it("công tắc từng luật: tắt luật nào thì luật đó không xét, kể cả khi số bên cạnh là 0", () => {
    const off = { ...cfg, ruleNoOrderOn: false, spendNoOrder: 0 };
    expect(assessVideo(video({ cost: 900_000, orders: 0 }), off, today).verdict).toBe("healthy");
    const noRoi = { ...cfg, ruleLowRoiOn: false, ruleCpaOn: false }; // CPA 90k > 80k nên phải tắt cả CPA mới còn mỗi cờ
    expect(assessVideo(video({ cost: 815_000, orders: 9, gmv: 815_000 * 3.74 }), noRoi, today).verdict).toBe("flag");
    const noGrace = { ...cfg, graceOn: false };
    expect(assessVideo(video({ cost: 500_000, orders: 4, gmv: 500_000 * 2, orders30d: 55 }), noGrace, today).verdict).toBe("exclude");
  });

  it("công thần (≥20 đơn/30 ngày) vi phạm lần đầu → ân hạn, đủ ngày liên tục mới loại", () => {
    const bad = { cost: 500_000, orders: 4, gmv: 500_000 * 2, orders30d: 55 };
    const first = assessVideo(video(bad), cfg, today);
    expect(first.verdict).toBe("grace");
    expect(first.graceDaysLeft).toBe(2);
    expect(first.violated).toBe(true);

    const day2 = assessVideo(video({ ...bad, watch: { violationSince: "2026-09-17", restoredByUserAt: null } }), cfg, today);
    expect(day2.verdict).toBe("grace");
    expect(day2.graceDaysLeft).toBe(1);

    const day3 = assessVideo(video({ ...bad, watch: { violationSince: "2026-09-16", restoredByUserAt: null } }), cfg, today);
    expect(day3.verdict).toBe("exclude");
    expect(day3.reason).toContain("hết ân hạn");
  });

  it("khách đã khôi phục tay trong 30 ngày → máy chỉ gắn cờ (protected), không loại", () => {
    const recent = new Date(Date.now() - 5 * 86_400_000);
    const a = assessVideo(video({ cost: 900_000, orders: 0, watch: { violationSince: "", restoredByUserAt: recent } }), cfg, today);
    expect(a.verdict).toBe("protected");
    expect(a.violated).toBe(true);
    // Quá 30 ngày thì hết bảo vệ.
    const old = new Date(Date.now() - 40 * 86_400_000);
    expect(assessVideo(video({ cost: 900_000, orders: 0, watch: { violationSince: "", restoredByUserAt: old } }), cfg, today).verdict).toBe("exclude");
  });
});

describe("planAutoExclusion — chốt an toàn cấp chiến dịch", () => {
  it("trần số video loại/ngày: tốn tiền nhất đi trước, phần còn lại chờ", () => {
    const vids = Array.from({ length: 6 }, (_, i) => video({ videoId: `76000000000000000${i}`, cost: 300_000 + i * 10_000, orders: 0 }));
    const plan = planAutoExclusion(vids, { ...cfg, maxExcludePerDay: 4 }, today);
    expect(plan.exclude).toHaveLength(4);
    expect(plan.heldByCap).toHaveLength(2);
    expect(plan.exclude[0].cost).toBe(350_000);
    expect(plan.heldByCap.map((a) => a.cost)).toEqual([310_000, 300_000]);
  });

  it("không loại tới video cuối còn ra đơn: giữ lại đủ minOrderingVideosKeep", () => {
    const vids = [
      video({ videoId: "1", cost: 400_000, orders: 3, gmv: 400_000 * 2 }), // ROI 2 → vi phạm, có đơn
      video({ videoId: "2", cost: 300_000, orders: 2, gmv: 300_000 * 2 }), // vi phạm, có đơn
      video({ videoId: "3", cost: 250_000, orders: 0 }), // 0 đơn → loại thoải mái
      video({ videoId: "4", cost: 100_000, orders: 4, gmv: 100_000 * 20 }), // ổn
    ];
    const plan = planAutoExclusion(vids, { ...cfg, minOrderingVideosKeep: 2 }, today);
    // 3 video có đơn (1, 2, 4); phải còn ≥2 → chỉ được loại MỘT trong hai video 1/2 (tốn hơn: 1).
    expect(plan.exclude.map((a) => a.videoId)).toEqual(["1", "3"]);
    expect(plan.heldByFloor.map((a) => a.videoId)).toEqual(["2"]);
    expect(plan.excludeSpend).toBe(650_000);
    expect(plan.excludeOrders).toBe(3);
  });

  it("tóm tắt kể bằng tiền và đếm đủ các nhóm", () => {
    const vids = [
      video({ videoId: "a", cost: 500_000, orders: 0 }),
      video({ videoId: "b", cost: 300_000, orders: 5, gmv: 300_000 * 9 }),
      video({ videoId: "c", deliveryStatus: "LEARNING", cost: 50_000 }),
    ];
    const plan = planAutoExclusion(vids, cfg, today);
    const s = summarizeAutoPlan(plan, cfg);
    expect(s).toContain("loại 1 video đang ngốn 500.000đ/7 ngày mà ra 0 đơn");
    expect(s).toContain("gắn cờ 1 video");
    expect(s).toContain("bỏ qua 1 video đang học");
    expect(plan.counts).toMatchObject({ exclude: 1, flag: 1, learning: 1 });
  });
});

describe("sanitizeAutoRuleConfig / daysBetween", () => {
  it("kẹp số vào biên, sai kiểu thì giữ số cũ, maxCpa rỗng = không dùng", () => {
    const c = sanitizeAutoRuleConfig({ windowDays: 99, roiHardPct: "abc", maxCpa: "", graceDays: 0, roiTarget: "12.5", ruleNoOrderOn: false, ruleCpaOn: "yes" }, cfg);
    expect(c.ruleNoOrderOn).toBe(false);
    expect(c.ruleCpaOn).toBe(true); // "yes" không phải boolean → giữ số cũ (cfg bật)
    expect(c.windowDays).toBe(30);
    expect(c.roiHardPct).toBe(50);
    expect(c.maxCpa).toBeNull();
    expect(c.graceDays).toBe(1);
    expect(c.roiTarget).toBe(12.5);
  });
  it("daysBetween tính đúng và không vỡ khi sai định dạng", () => {
    expect(daysBetween("2026-09-16", "2026-09-18")).toBe(2);
    expect(daysBetween("", "2026-09-18")).toBe(0);
  });
});

// MỨC LOẠI THEO HÒA VỐN (anh Trung duyệt 18/09): dưới hòa vốn là lỗ thật; hòa vốn chưa đủ tin thì tự rơi về % mục tiêu.
describe("resolveHardLevel — mức loại theo % mục tiêu hay theo hòa vốn", () => {
  const be = (over: Partial<BreakevenInput> = {}): BreakevenInput => ({
    breakevenRoi: 6,
    negativeMargin: false,
    source: "campaign",
    orders: 312,
    costCoveragePct: 100,
    ...over,
  });
  const byBe: AutoRuleConfig = { ...cfg, hardBasis: "breakeven" };

  it("mặc định theo %: 50% của mục tiêu 15 = 7,5, có đưa hòa vốn vào cũng không dùng", () => {
    expect(resolveHardLevel(cfg, be())).toMatchObject({ hardRoi: 7.5, basis: "pct", fallbackReason: "" });
  });

  it("khách chọn hòa vốn + hòa vốn đủ tin → mức loại = hòa vốn, nhãn nêu số đơn đã đối soát", () => {
    const h = resolveHardLevel(byBe, be());
    expect(h).toMatchObject({ hardRoi: 6, basis: "breakeven", fallbackReason: "" });
    expect(h.label).toContain("hòa vốn 6");
    expect(h.label).toContain("312 đơn đã đối soát");
  });

  it("hòa vốn CHƯA đủ tin → rơi về % và nêu đúng lý do", () => {
    expect(resolveHardLevel(byBe, null)).toMatchObject({ hardRoi: 7.5, basis: "pct" });
    expect(resolveHardLevel(byBe, null).fallbackReason).toContain("chưa tính được");
    expect(resolveHardLevel(byBe, be({ source: "shop" })).fallbackReason).toContain("mượn biên lãi toàn gian");
    expect(resolveHardLevel(byBe, be({ costCoveragePct: BREAKEVEN_MIN_COVERAGE_PCT - 1 })).fallbackReason).toContain("% doanh thu có giá vốn");
    expect(resolveHardLevel(byBe, be({ costCoveragePct: BREAKEVEN_MIN_COVERAGE_PCT })).basis).toBe("breakeven");
    expect(resolveHardLevel(byBe, be({ breakevenRoi: null })).fallbackReason).toContain("chưa có đơn đã đối soát");
    // Sản phẩm lỗ sẵn: KHÔNG được biến thành "loại mọi video" — rơi về % và báo.
    const neg = resolveHardLevel(byBe, be({ breakevenRoi: null, negativeMargin: true }));
    expect(neg.basis).toBe("pct");
    expect(neg.fallbackReason).toContain("lỗ trước cả quảng cáo");
  });

  it("video ROI 6,5: theo % (7,5) thì bị loại, theo hòa vốn (6) thì còn lãi → chỉ gắn cờ", () => {
    const v = video({ cost: 200_000, orders: 4, gmv: 200_000 * 6.5 });
    expect(assessVideo(v, cfg, today).verdict).toBe("exclude");
    const a = assessVideo(v, byBe, today, resolveHardLevel(byBe, be()));
    expect(a.verdict).toBe("flag");
    expect(a.reason).toContain("chưa tới mức loại (6)");
  });

  it("hòa vốn 9 CAO hơn mức % 7,5: video ROI 8 đang lỗ → theo hòa vốn thì loại, căn cứ ghi rõ mốc hòa vốn", () => {
    const v = video({ cost: 200_000, orders: 4, gmv: 200_000 * 8 });
    expect(assessVideo(v, cfg, today).verdict).toBe("flag");
    const plan = planAutoExclusion([v], byBe, today, be({ breakevenRoi: 9 }));
    // Chiến dịch chỉ có 1 video ra đơn → chốt "giữ tối thiểu N video ra đơn" giữ lại; soi KẾT LUẬN chấm.
    expect(plan.assessments[0].verdict).toBe("exclude");
    expect(plan.heldByFloor).toHaveLength(1);
    expect(plan.assessments[0].reason).toContain("hòa vốn 9");
    expect(plan.assessments[0].reason).toContain("đang lỗ");
    expect(summarizeAutoPlan(plan, byBe)).toContain("mức loại theo hòa vốn 9");
  });

  it("tóm tắt lượt nói rõ khi phải rơi về %", () => {
    const plan = planAutoExclusion([video({ cost: 60_000, orders: 1, gmv: 60_000 * 20 })], byBe, today, be({ source: "shop" }));
    expect(plan.hard.basis).toBe("pct");
    expect(summarizeAutoPlan(plan, byBe)).toContain("chưa dùng được hòa vốn làm mức loại");
  });

  it("sanitize chỉ nhận đúng hai giá trị của hardBasis", () => {
    expect(sanitizeAutoRuleConfig({ hardBasis: "breakeven" }, cfg).hardBasis).toBe("breakeven");
    expect(sanitizeAutoRuleConfig({ hardBasis: "bua" }, cfg).hardBasis).toBe("pct");
    expect(sanitizeAutoRuleConfig({}, byBe).hardBasis).toBe("breakeven");
  });
});

// A2 — CHỐT CHẶN SỐ LIỆU SÀN HỎNG: chỉ chặn khi có bằng chứng dương tính, không so lệch phần trăm.
describe("videoDataProblem — tầng video báo 0 trong khi tầng chiến dịch có số", () => {
  it("bình thường: hai tầng đều có số (lệch nhau là chuyện thường) → cho qua", () => {
    expect(videoDataProblem({ cost: 1_600_000, orders: 45 }, { spend: 2_100_000, orders: 82 })).toBe("");
  });
  it("tầng video 0 đơn mà chiến dịch có đơn → bỏ lượt, lý do nêu số đơn của chiến dịch", () => {
    const why = videoDataProblem({ cost: 1_600_000, orders: 0 }, { spend: 2_100_000, orders: 82 });
    expect(why).toContain("0 đơn cho MỌI video");
    expect(why).toContain("82 đơn");
  });
  it("tầng video 0 đồng chi phí mà chiến dịch có tiêu tiền → bỏ lượt", () => {
    expect(videoDataProblem({ cost: 0, orders: 0 }, { spend: 500_000, orders: 0 })).toContain("0 đồng chi phí");
  });
  it("chiến dịch thật sự không ra đơn nào → 0 đơn ở tầng video là ĐÚNG, không chặn", () => {
    expect(videoDataProblem({ cost: 300_000, orders: 0 }, { spend: 320_000, orders: 0 })).toBe("");
  });
  it("Hubsell không có số tầng chiến dịch của khoảng đó → không kết luận được → cho qua", () => {
    expect(videoDataProblem({ cost: 300_000, orders: 0 }, null)).toBe("");
  });
});

// B6 — cấu hình sắp bật thật có phải cấu hình lượt chấm gần nhất đã dùng không (khác thì popup CẢNH BÁO, khách tự quyết bỏ qua).
describe("unrehearsedFields — cấu hình đang lưu có phải cấu hình đã diễn tập không", () => {
  it("chưa có lượt chấm nào (hoặc dòng cũ chưa ghi cấu hình) → coi như chưa diễn tập", () => {
    expect(parseRehearsedConfig(null)).toBeNull();
    expect(parseRehearsedConfig({ summary: "linh tinh" })).toBeNull();
    expect(unrehearsedFields(null, cfg).length).toBeGreaterThan(0);
  });
  it("ghi ra Json rồi đọc lại phải tròn: đúng cấu hình đã diễn tập → không ô nào khác", () => {
    const stored = JSON.parse(JSON.stringify(cfg));
    expect(unrehearsedFields(parseRehearsedConfig(stored), cfg)).toEqual([]);
  });
  it("diễn tập bằng số nhẹ rồi sửa số nặng → chỉ đúng các ô đã đổi", () => {
    const heavier = { ...cfg, roiHardPct: 90, maxExcludePerDay: 50 };
    expect(unrehearsedFields(cfg, heavier).sort()).toEqual(["maxExcludePerDay", "roiHardPct"]);
  });
  it("số đi kèm một luật ĐANG TẮT không tham gia chấm điểm → sửa nó không tính là đổi cấu hình", () => {
    const cpaOff = { ...cfg, ruleCpaOn: false };
    expect(unrehearsedFields(cpaOff, { ...cpaOff, maxCpa: 10_000 })).toEqual([]);
    // Bật luật đó lên thì vừa công tắc vừa con số đều là mới.
    expect(unrehearsedFields(cpaOff, { ...cpaOff, ruleCpaOn: true, maxCpa: 10_000 }).sort()).toEqual(["maxCpa", "ruleCpaOn"]);
  });
});

// B8 — chuông chỉ khi kết quả lượt chấm ĐỔI so với lượt trước.
describe("compareRunDigest — lượt hôm nay có khác lượt trước không", () => {
  const prev = { mode: "dry_run", excludeIds: ["a", "b"], grace: 1, flag: 2 };
  it("chưa có lượt trước / lượt trước bị bỏ (A2) / lệnh bị sàn từ chối → luôn chuông", () => {
    expect(runDigestOf(null)).toBeNull();
    expect(runDigestOf({ mode: "dry_run", skipped: "bỏ lượt", exclude: 0 })).toBeNull();
    expect(runDigestOf({ mode: "live", error: "TikTok từ chối", excludeIds: ["a"] })).toBeNull();
    expect(compareRunDigest(null, prev).changed).toBe(true);
  });
  it("đúng các video hôm trước → không chuông lại (thứ tự khác nhau không tính)", () => {
    expect(compareRunDigest(prev, { ...prev, excludeIds: ["b", "a"], flag: 5 })).toEqual({ changed: false, added: 0, removed: 0 });
  });
  it("danh sách đổi → chuông, tiêu đề nói thêm / bớt mấy video", () => {
    const c = compareRunDigest(prev, { ...prev, excludeIds: ["b", "c", "d"] });
    expect(c).toEqual({ changed: true, added: 2, removed: 1 });
    expect(runChangeLabel(prev, c)).toBe(" (thêm 2, bớt 1 so với lượt trước)");
    expect(runChangeLabel(null, c)).toBe("");
  });
  it("đổi chế độ (Diễn tập → Tự loại thật) thì lượt đầu của chế độ mới luôn chuông", () => {
    expect(compareRunDigest(prev, { ...prev, mode: "live" }).changed).toBe(true);
  });
  it("không loại video nào: chỉ chuông khi số video ân hạn / cần xem đổi", () => {
    const quiet = { mode: "dry_run", excludeIds: [], grace: 1, flag: 2 };
    expect(compareRunDigest(quiet, { ...quiet }).changed).toBe(false);
    expect(compareRunDigest(quiet, { ...quiet, flag: 3 }).changed).toBe(true);
  });
  it("đọc được lastRunSummary ghi TRƯỚC khi có excludeIds (dòng đang nằm trên prod): lấy mã từ videos", () => {
    const d = runDigestOf({ mode: "dry_run", exclude: 2, grace: 0, flag: 1, videos: [{ videoId: "a" }, { videoId: "b" }] });
    expect(d).toEqual({ mode: "dry_run", excludeIds: ["a", "b"], grace: 0, flag: 1 });
  });
});

// NHẬT KÝ ĐỔI THÔNG SỐ — mỗi lần Lưu có đổi gì thì tab Lịch sử thêm một dòng trung tính.
describe("describeConfigChanges — nhật ký đổi thông số", () => {
  it("mỗi ô đổi một dòng số cũ → số mới đúng đơn vị; đổi chế độ đứng đầu", () => {
    const lines = describeConfigChanges(
      { mode: "dry_run", config: cfg },
      { mode: "live", config: { ...cfg, roiHardPct: 90, spendNoOrder: 100_000, graceOn: false } }
    );
    expect(lines[0]).toBe("Chế độ: Diễn tập → Tự loại thật");
    expect(lines).toContain("Mức loại (% ROI mục tiêu): 50% → 90%");
    expect(lines).toContain("Mức tiêu mà 0 đơn: 200.000đ → 100.000đ");
    expect(lines).toContain("Bảo vệ video công thần: bật → tắt");
    expect(lines).toHaveLength(4);
  });
  it("lưu lại y nguyên → không có gì để ghi", () => {
    expect(describeConfigChanges({ mode: "dry_run", config: cfg }, { mode: "dry_run", config: { ...cfg } })).toEqual([]);
  });
  it("là nhật ký chứ không phải luật: số nằm cạnh một luật ĐANG TẮT đổi vẫn ghi", () => {
    const cpaOff = { ...cfg, ruleCpaOn: false };
    expect(describeConfigChanges({ mode: "live", config: cpaOff }, { mode: "live", config: { ...cpaOff, maxCpa: 10_000 } })).toEqual([
      "Trần chi phí mỗi đơn: 80.000đ → 10.000đ",
    ]);
  });
  it("chiến dịch bật tự động lần đầu → chỉ ghi dòng chế độ; lần đầu mà để Tắt thì không ghi", () => {
    expect(describeConfigChanges(null, { mode: "dry_run", config: cfg })).toEqual(["Chế độ: Tắt → Diễn tập"]);
    expect(describeConfigChanges(null, { mode: "off", config: cfg })).toEqual([]);
  });
});

// Tab Đối chiếu diễn tập chỉ tính lượt SAU lần khách đổi BỘ SỐ gần nhất — chỉ đổi chế độ thì bộ luật vẫn vậy.
describe("ruleNumbersChanged — dòng nhật ký có đổi bộ số của luật không", () => {
  it("chỉ đổi chế độ → không", () => {
    const lines = describeConfigChanges({ mode: "dry_run", config: cfg }, { mode: "off", config: cfg });
    expect(ruleNumbersChanged(lines.join("\n"))).toBe(false);
  });
  it("đổi số (kèm hay không kèm đổi chế độ) → có", () => {
    const a = describeConfigChanges({ mode: "dry_run", config: cfg }, { mode: "dry_run", config: { ...cfg, roiTarget: 20 } });
    const b = describeConfigChanges({ mode: "dry_run", config: cfg }, { mode: "live", config: { ...cfg, graceOn: false } });
    expect(ruleNumbersChanged(a.join("\n"))).toBe(true);
    expect(ruleNumbersChanged(b.join("\n"))).toBe(true);
  });
});
