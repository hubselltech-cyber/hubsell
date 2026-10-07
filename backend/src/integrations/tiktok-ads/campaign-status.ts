// ============================================================
// TRẠNG THÁI CHIẾN DỊCH GMV MAX — từ vựng, thứ tự trên bảng, luật đối soát (THUẦN, không DB)
//
// Vì sao cần một chỗ riêng (anh Trung 07/10/2026: "đang chạy luôn ở trên, tắt rồi
// xuống dưới; thêm bộ lọc Đang hoạt động / Tạm dừng / Đã dừng"):
//   · Trước đây bảng xếp theo CHI TIÊU trước, trạng thái sau → chiến dịch đã tắt
//     mà tuần trước tiêu nhiều vẫn chèn lên trên chiến dịch đang chạy. Thứ tự
//     đúng là NHÓM trạng thái trước, trong nhóm mới tới chi tiêu.
//   · TikTok có HAI nguồn nói về chiến dịch, mỗi nguồn kể một nửa:
//       - /gmv_max/report/get/  : CHỈ chiến dịch có chi tiêu trong kỳ (+ operation_status)
//       - /gmv_max/campaign/get/: MỌI chiến dịch còn tồn tại (kể cả không tiêu tiền)
//     Chỉ đọc báo cáo (cách cũ) thì chiến dịch bị xóa / kết thúc trên TikTok không
//     bao giờ biến mất khỏi Hubsell — nằm mãi với trạng thái cuối, có khi là "Đang
//     chạy". Trạng thái thứ ba "Đã dừng" (ended) sinh ra từ phép đối soát hai nguồn:
//     Hubsell biết mà TikTok không còn liệt kê → đã dừng. Chiến dịch xuất hiện lại
//     (TikTok cho khôi phục) → tự sống lại theo operation_status mới.
//
// Từ vựng status trong AdsCampaign (dùng chung với Shopee): ongoing | paused | ended.
// TikTok không có "scheduled"/"closed"/"deleted" riêng — gom hết vào "ended".
// ============================================================

export type TiktokCampaignStatus = "ongoing" | "paused" | "ended";

/** Thứ tự nhóm trên bảng — chỉ số nhỏ đứng trên. Trạng thái lạ xếp cuối cùng. */
export const TIKTOK_CAMPAIGN_STATUS_ORDER: readonly TiktokCampaignStatus[] = ["ongoing", "paused", "ended"];

export function tiktokCampaignStatusRank(status: string): number {
  const i = TIKTOK_CAMPAIGN_STATUS_ORDER.indexOf(status as TiktokCampaignStatus);
  return i === -1 ? TIKTOK_CAMPAIGN_STATUS_ORDER.length : i;
}

/**
 * secondary_status (theo bảng công khai của Marketing API) nói chiến dịch đã KẾT THÚC
 * dù operation_status có thể vẫn là ENABLE: xóa, hết hạn lịch chạy. Chỉ hai giá trị này
 * mới ép về "ended" — các secondary khác (DISABLE, BUDGET_EXCEED, PRODUCT_USED_BY_…)
 * giữ nguyên nghĩa của operation_status. Gian nhà mới gặp ENABLE / DISABLE /
 * PRODUCT_USED_BY_PRODUCT_GMV_MAX (docs/ADS-TIKTOK-GMV-MAX.md); hai mã dưới chưa gặp.
 */
const SECONDARY_ENDED = new Set(["CAMPAIGN_STATUS_DELETE", "CAMPAIGN_STATUS_TIME_DONE"]);

/**
 * operation_status ENABLE → đang chạy; mọi giá trị khác (DISABLE, rỗng, lạ) → tạm dừng.
 * Không bao giờ SUY RA "đang chạy" từ dữ liệu thiếu: nhầm "đang chạy" đắt hơn nhầm
 * "tạm dừng" (máy tự loại video chỉ chạm chiến dịch ongoing).
 */
export function tiktokCampaignStatusOf(c: { operationStatus?: string | null; secondaryStatus?: string | null }): TiktokCampaignStatus {
  if (c.secondaryStatus && SECONDARY_ENDED.has(c.secondaryStatus)) return "ended";
  return c.operationStatus === "ENABLE" ? "ongoing" : "paused";
}

/** Đang chạy trên cùng → tạm dừng → đã dừng; trong cùng nhóm tiêu nhiều đứng trước; cuối cùng theo tên. */
export function compareTiktokCampaigns<T extends { status: string; spend: number; name: string }>(a: T, b: T): number {
  return (
    tiktokCampaignStatusRank(a.status) - tiktokCampaignStatusRank(b.status) ||
    b.spend - a.spend ||
    a.name.localeCompare(b.name, "vi")
  );
}

export interface TiktokCampaignReconcileInput {
  /** Dòng AdsCampaign của gian đang có trong DB. */
  known: { id: string; campaignId: string; status: string; name: string }[];
  /** /gmv_max/campaign/get/ — nguồn chuẩn "chiến dịch còn tồn tại" (đủ cả chiến dịch không tiêu tiền). */
  listed: { campaignId: string; name: string; operationStatus: string; secondaryStatus?: string }[];
  /**
   * campaign_id vừa thấy trong BÁO CÁO của chính lượt đồng bộ này. Có trong báo cáo thì
   * chắc chắn còn tồn tại (hoặc mới xóa hôm nay) → không được gán "ended" dù vắng ở danh
   * sách; trạng thái của chúng đã ghi theo báo cáo. Vài ngày sau rơi khỏi cửa sổ báo cáo
   * mà vẫn vắng ở danh sách thì mới thành "ended".
   */
  reported: Iterable<string>;
}

export interface TiktokCampaignReconcileResult {
  /** Dòng đã có cần đổi (chỉ những dòng THỰC SỰ khác, để lastSyncedAt không bị chạm vô cớ). */
  updates: { id: string; status: TiktokCampaignStatus; name?: string }[];
  /** TikTok có mà Hubsell chưa từng thấy (chưa tiêu tiền trong cửa sổ báo cáo nào) → tạo mới. */
  creates: { campaignId: string; name: string; status: TiktokCampaignStatus }[];
  /** Số chiến dịch đang chạy sau đối soát (listed ∪ reported). */
  liveCampaigns: number;
}

/**
 * Đối soát trạng thái. Thuần: không gọi gì, trả về việc cần ghi. Luật:
 *   1. Có trong danh sách TikTok → trạng thái theo operation/secondary_status (ghi đè
 *      cả dòng "ended" cũ = chiến dịch sống lại); tên đổi thì cập nhật tên.
 *   2. Hubsell biết (ongoing/paused), KHÔNG có trong danh sách VÀ không có trong báo
 *      cáo lượt này → "ended".
 *   3. Danh sách có mà Hubsell chưa biết → tạo (biddingMethod/ngân sách để trống —
 *      danh sách không trả, info từng chiến dịch là một call riêng, không đáng).
 * Trùng campaign_id trong danh sách: dòng sau đè dòng trước.
 */
export function reconcileTiktokCampaignStatuses(input: TiktokCampaignReconcileInput): TiktokCampaignReconcileResult {
  const listed = new Map<string, { name: string; status: TiktokCampaignStatus }>();
  for (const l of input.listed) {
    if (l.campaignId) listed.set(l.campaignId, { name: l.name ?? "", status: tiktokCampaignStatusOf(l) });
  }
  const reported = new Set(input.reported);

  const updates: TiktokCampaignReconcileResult["updates"] = [];
  const creates: TiktokCampaignReconcileResult["creates"] = [];
  let liveCampaigns = 0;

  for (const k of input.known) {
    const l = listed.get(k.campaignId);
    let status: string = k.status;
    if (l) {
      status = l.status;
      const nameChanged = l.name !== "" && l.name !== k.name;
      if (l.status !== k.status || nameChanged) {
        updates.push({ id: k.id, status: l.status, ...(nameChanged ? { name: l.name } : {}) });
      }
    } else if (!reported.has(k.campaignId) && (k.status === "ongoing" || k.status === "paused")) {
      // Vắng ở cả danh sách lẫn báo cáo lượt này → TikTok không còn chiến dịch này.
      status = "ended";
      updates.push({ id: k.id, status: "ended" });
    }
    if (status === "ongoing") liveCampaigns++;
  }

  const knownIds = new Set(input.known.map((k) => k.campaignId));
  for (const [campaignId, l] of listed) {
    if (knownIds.has(campaignId)) continue;
    creates.push({ campaignId, name: l.name, status: l.status });
    if (l.status === "ongoing") liveCampaigns++;
  }

  return { updates, creates, liveCampaigns };
}
