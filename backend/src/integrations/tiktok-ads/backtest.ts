// ============================================================
// TIKTOK ADS — ĐỐI CHIẾU DIỄN TẬP (thuần, không đụng DB / sàn)
//
// Câu hỏi phải trả lời trước khi chủ shop bật "Tự loại thật": những video máy
// ĐỊNH loại trong lúc diễn tập, SAU ngày đó chạy ra sao? Vẫn ngốn tiền không ra
// đơn → máy đúng; hồi lại trên ROI mục tiêu → loại là tiếc.
//
// Cách tính (không có con số tự đặt — mọi mốc lấy từ cấu hình của chính khách):
//   · Mỗi video lấy NGÀY ĐẦU TIÊN máy định loại (D). Diễn tập lặp lại đúng video
//     đó mỗi ngày vì chưa loại thật — các ngày sau chỉ đếm vào `plannedDays`.
//   · Số "từ đó đến nay" tính từ D+1: lượt chấm chạy sau 12h trưa ngày D và tầng
//     video không có số theo giờ → không tách được nửa ngày D; bỏ ngày D là cách
//     tính DÈ DẶT (không nhận vơ phần tiền mà lệnh loại thật cũng không kịp chặn).
//   · Kết luận từng video so với đúng các mốc khách đã cài:
//       insufficient — tiêu thêm < minSpend ("sàn dữ liệu") → chưa phán
//       right        — 0 đơn, hoặc ROI < roiTarget × roiHardPct% (mức loại)
//       recovered    — ROI ≥ roiTarget
//       middle       — ở giữa hai mốc
// ROI tầng video của TikTok gộp cả đơn tự nhiên → kết luận nghiêng về phía "hồi
// phục" (nhân từ với video), cùng chiều với luật.
// ============================================================

export interface DryRunPlan {
  /** Ngày VN "YYYY-MM-DD" của lượt diễn tập. */
  date: string;
  videos: { videoId: string; note: string }[];
}

export interface VideoDayRow {
  videoId: string;
  spuId: string;
  /** "YYYY-MM-DD" */
  date: string;
  deliveryStatus: string;
  cost: number;
  orders: number;
  gmv: number;
}

export type BacktestVerdict = "insufficient" | "right" | "recovered" | "middle";

export interface BacktestVideo {
  videoId: string;
  spuId: string;
  firstPlannedOn: string;
  lastPlannedOn: string;
  /** Số lượt diễn tập máy định loại video này. */
  plannedDays: number;
  /** Số liệu + căn cứ máy ghi ở lượt ĐẦU TIÊN. */
  noteAtPlan: string;
  /** Trạng thái sàn gần nhất thấy trong khoảng đối chiếu ("" = không còn dòng nào). */
  deliveryStatus: string;
  /** Số ngày có trong khoảng đối chiếu của video (D+1 → hôm nay). */
  daysSince: number;
  cost: number;
  orders: number;
  gmv: number;
  roi: number | null;
  verdict: BacktestVerdict;
}

export interface DryRunBacktest {
  /** Ngày diễn tập đầu tiên có video định loại ("" = chưa có lượt nào định loại gì). */
  firstPlanOn: string;
  videos: BacktestVideo[];
  totals: { videos: number; cost: number; orders: number; gmv: number; roi: number | null };
  counts: Record<BacktestVerdict, number>;
}

const shift = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Ngày bắt đầu cần kéo số theo ngày: D+1 của video được định loại sớm nhất (null = chưa cần gọi sàn). */
export function backtestStartDate(plans: DryRunPlan[], today: string): string | null {
  const dates = plans.filter((p) => p.videos.length > 0).map((p) => p.date);
  if (dates.length === 0) return null;
  const start = shift(dates.reduce((a, b) => (a < b ? a : b)), 1);
  return start > today ? null : start;
}

export function buildDryRunBacktest(
  plans: DryRunPlan[],
  dayRows: VideoDayRow[],
  cfg: { roiTarget: number; roiHardPct: number; minSpend: number },
  today: string
): DryRunBacktest {
  const seen = new Map<string, { first: string; last: string; days: Set<string>; note: string }>();
  for (const p of [...plans].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const v of p.videos) {
      const s = seen.get(v.videoId);
      if (!s) seen.set(v.videoId, { first: p.date, last: p.date, days: new Set([p.date]), note: v.note });
      else {
        s.last = p.date;
        s.days.add(p.date);
      }
    }
  }

  const hardRoi = cfg.roiTarget * (cfg.roiHardPct / 100);
  const counts: Record<BacktestVerdict, number> = { insufficient: 0, right: 0, recovered: 0, middle: 0 };
  const videos: BacktestVideo[] = [];
  for (const [videoId, s] of seen) {
    let cost = 0;
    let orders = 0;
    let gmv = 0;
    let spuId = "";
    let status = "";
    let statusDay = "";
    for (const r of dayRows) {
      if (r.videoId !== videoId || r.date <= s.first || r.date > today) continue;
      cost += r.cost;
      orders += r.orders;
      gmv += r.gmv;
      spuId = spuId || r.spuId;
      if (r.date >= statusDay) {
        statusDay = r.date;
        status = r.deliveryStatus;
      }
    }
    const roi = cost > 0 ? gmv / cost : null;
    const verdict: BacktestVerdict =
      cost < cfg.minSpend || roi == null
        ? "insufficient"
        : orders === 0 || roi < hardRoi
          ? "right"
          : roi >= cfg.roiTarget
            ? "recovered"
            : "middle";
    counts[verdict]++;
    videos.push({
      videoId,
      spuId,
      firstPlannedOn: s.first,
      lastPlannedOn: s.last,
      plannedDays: s.days.size,
      noteAtPlan: s.note,
      deliveryStatus: status,
      daysSince: Math.max(0, dayDiff(s.first, today)),
      cost,
      orders,
      gmv,
      roi,
      verdict,
    });
  }
  videos.sort((a, b) => b.cost - a.cost || a.firstPlannedOn.localeCompare(b.firstPlannedOn));

  const cost = videos.reduce((t, v) => t + v.cost, 0);
  const gmv = videos.reduce((t, v) => t + v.gmv, 0);
  return {
    firstPlanOn: videos.reduce((m, v) => (m === "" || v.firstPlannedOn < m ? v.firstPlannedOn : m), ""),
    videos,
    totals: { videos: videos.length, cost, orders: videos.reduce((t, v) => t + v.orders, 0), gmv, roi: cost > 0 ? gmv / cost : null },
    counts,
  };
}
