"use client";

import { useEffect, useState } from "react";
import { Link2, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  connectHubsellAdsCode,
  getHubsellAdsAuthUrl,
  unlinkHubsellAds,
  type HubsellAdsLinkStatus,
} from "@/lib/api";

/**
 * HUBSELL ADS — KHỐI LIÊN KẾT APP ADS SERVICE RIÊNG (10/09/2026)
 *
 * Shopee cấp quyền theo từng app: app chính của Hubsell (ERP System sau ISV)
 * không còn Ads API, nên Trợ lý quảng cáo Shopee chạy trên app "Hubsell Ads"
 * và gian phải ủy quyền THÊM một lần cho app này. Khối này chỉ hiện khi backend
 * đã bật Hubsell Ads (status.required = true):
 *   · NOT_LINKED   → MỘT nút "Kết nối Hubsell Ads" trên thanh công cụ (17/09:
 *                    bỏ thẻ to — chọn gian nào thì nút nối gian đó, chi tiết tooltip)
 *   · DISCONNECTED → cùng nút, sắc vàng "Kết nối lại"
 *   · ACTIVE       → một dòng mờ "Hubsell Ads ✓" + nút Gỡ
 * Chưa bật (required = false) → không render gì, trang chạy như trước.
 *
 * Kết quả ủy quyền quay về chính trang này qua query ?hubsell_ads=connected|
 * error|code (code = trạm trung chuyển dev local → gọi /connect ngay tại đây).
 */
export function HubsellAdsLink({
  channelId,
  shopName,
  status,
  adsSyncedAt,
  onChanged,
}: {
  channelId: string;
  shopName: string;
  status: HubsellAdsLinkStatus | null;
  /** Mốc số ads hiện có (ISO) — gian chưa nối thì nói rõ số đang đứng từ lúc nào. */
  adsSyncedAt?: string | null;
  /** Gọi sau khi liên kết/gỡ xong để trang nạp lại dashboard. */
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const staleText = adsSyncedAt
    ? `Số liệu quảng cáo đang đứng ở ${new Date(adsSyncedAt).toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      })}.`
    : null;

  // Đọc kết quả ủy quyền MỘT lần rồi dọn query — F5 không toast lại.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("hubsell_ads");
    if (!result) return;
    const clean = () => {
      params.delete("hubsell_ads");
      params.delete("code");
      params.delete("shop_id");
      params.delete("shop");
      params.delete("msg");
      const qs = params.toString();
      window.history.replaceState({}, "", `/ads/shopee${qs ? `?${qs}` : ""}`);
    };
    if (result === "connected") {
      toast.success(`Đã kết nối Hubsell Ads cho gian ${params.get("shop") || ""}`.trim());
      clean();
      onChanged();
    } else if (result === "error") {
      toast.error(`Kết nối Hubsell Ads thất bại: ${params.get("msg") || "lỗi không rõ"}`);
      clean();
    } else if (result === "code" && params.get("code") && params.get("shop_id")) {
      const cid = params.get("channelId") || channelId;
      const code = params.get("code")!;
      const shopId = params.get("shop_id")!;
      clean();
      toast.info("Đã nhận code uỷ quyền Hubsell Ads — đang đổi token…");
      connectHubsellAdsCode(code, shopId, cid)
        .then((r) => {
          toast.success(r.message);
          onChanged();
        })
        .catch((err) =>
          toast.error(
            `Kết nối Hubsell Ads thất bại: ${err instanceof Error ? err.message : "lỗi không rõ"}`
          )
        );
    }
    // Chỉ chạy lúc mount — query là kết quả của lần redirect này.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status?.required) return null;

  async function connect() {
    if (!channelId || busy) return;
    setBusy(true);
    try {
      const { url } = await getHubsellAdsAuthUrl(channelId);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Không lấy được link ủy quyền");
      setBusy(false);
    }
  }

  async function unlink() {
    if (!channelId || busy) return;
    if (!window.confirm(`Gỡ liên kết Hubsell Ads khỏi gian "${shopName}"? Số liệu ads sẽ ngừng cập nhật cho tới khi kết nối lại.`)) {
      return;
    }
    setBusy(true);
    try {
      const r = await unlinkHubsellAds(channelId);
      toast.success(r.message);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gỡ liên kết thất bại");
    } finally {
      setBusy(false);
    }
  }

  if (status.status === "ACTIVE") {
    // Đã nối: một dòng chữ mờ trên thanh công cụ, nút gỡ trốn trong đó.
    return (
      <span
        className="flex items-center gap-1 text-xs text-muted-foreground"
        title={`Hubsell Ads đã kết nối cho gian ${shopName} · ủy quyền tự gia hạn`}
      >
        <ShieldCheck className="size-3.5 text-emerald-600" />
        Hubsell Ads
        <button
          type="button"
          onClick={() => void unlink()}
          disabled={busy}
          className="ml-1 underline-offset-2 hover:underline disabled:opacity-50"
        >
          Gỡ
        </button>
      </span>
    );
  }

  // CHƯA NỐI / HẾT HẠN — chỉ MỘT nút cạnh nút Làm mới (anh Trung 17/09: thẻ to
  // chướng mắt; ai muốn nối gian nào thì chọn gian đó rồi bấm). Vì sao phải nối,
  // số đang đứng từ lúc nào → tooltip.
  const expired = status.status === "DISCONNECTED";
  const hint = expired
    ? `Shopee thu hồi phiên của ứng dụng quảng cáo cho gian ${shopName}. ${staleText ?? ""} Kết nối lại một lần để Trợ lý tiếp tục theo dõi và tạm dừng được chiến dịch cắn tiền.`
    : `Shopee tách quyền quảng cáo sang ứng dụng riêng Hubsell Ads, gian ${shopName} cần ủy quyền thêm một lần (đăng nhập đúng tài khoản Shopee của gian này rồi chọn Đồng ý). ${staleText ?? "Chưa có số liệu ads cho tới khi kết nối."} Đơn hàng, kho, tài chính không ảnh hưởng.`;
  return (
    <Button
      size="sm"
      onClick={() => void connect()}
      disabled={busy || !channelId}
      title={hint.trim()}
      className={
        expired
          ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : "bg-orange-500 text-white hover:bg-orange-600"
      }
      variant={expired ? "outline" : "default"}
    >
      {expired ? <TriangleAlert className="size-4" /> : <Link2 className="size-4" />}
      {busy ? "Đang mở Shopee…" : expired ? "Kết nối lại Hubsell Ads" : "Kết nối Hubsell Ads"}
    </Button>
  );
}
