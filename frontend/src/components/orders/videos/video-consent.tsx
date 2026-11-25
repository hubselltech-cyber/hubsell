"use client";

import * as React from "react";
import { Loader2, Video } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { acceptPackVideoConsent, apiErrorMessage, fetchMe, getStoredUser, setStoredUser } from "@/lib/api";
import { isAdmin } from "@/lib/permissions";
import { TEXT_SUB } from "@/lib/typography";

const PRIVACY_URL = "https://hubsell.vn/privacy";

/**
 * THẺ BẬT VIDEO ĐÓNG HÀNG (26/11/2026) — lần đầu chủ shop mở trang, trước khi tính năng chạy.
 *
 * Video có hình tem vận đơn (tên, số điện thoại, địa chỉ người mua) và lưu ở kho ngoài Việt Nam, nên Chính sách bảo
 * mật hứa xin đồng ý trước. Một nút duy nhất; bấm xong máy chủ ghi sổ đồng ý, tặng giờ quay và trang mở ngay.
 * Nhân viên không bật thay được — chỉ thấy câu nhờ chủ shop.
 */
export function PackVideoConsentCard() {
  const [busy, setBusy] = React.useState(false);
  // Chủ shop = vai ADMIN của shop (lib/permissions.ts); nhân viên không bật thay được.
  const isOwner = isAdmin(getStoredUser());

  async function handleAccept() {
    setBusy(true);
    try {
      await acceptPackVideoConsent();
      // Máy chủ quyết cổng: đọc lại người dùng để mục menu + trang cùng mở.
      const me = await fetchMe();
      setStoredUser(me.user);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Chưa bật được, thử lại sau."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="mx-auto flex max-w-xl flex-col items-center gap-4 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-emerald-50">
          <Video className="size-5 text-emerald-600" />
        </span>
        <div className="space-y-1">
          <p className="text-base font-semibold text-slate-900">Bật Video đóng hàng</p>
          <p className={TEXT_SUB}>
            Quay lúc đóng hàng bằng webcam, tìm lại bằng mã vận đơn khi cần bằng chứng khiếu nại.
          </p>
        </div>

        {isOwner ? (
          <>
            <ul className="list-disc space-y-1.5 pl-5 text-left text-sm text-slate-700">
              <li>Video có hình tem vận đơn: tên, số điện thoại, địa chỉ người mua.</li>
              <li>Video lưu ở kho Cloudflare R2 đặt ngoài Việt Nam, chỉ tài khoản của shop xem được.</li>
              <li>
                Hệ thống tự xóa video sau khi đơn qua hạn khiếu nại 3 ngày, lưu tối đa 60 ngày từ ngày quay. Shop tự xóa
                từng video được bất cứ lúc nào.
              </li>
              <li>Tặng 2 giờ quay đầu tiên. Sau đó 2.000 đ một giờ quay, mua trước, hết giờ thì dừng quay.</li>
            </ul>
            <Button onClick={() => void handleAccept()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Video className="size-4" />}
              Đồng ý và bắt đầu
            </Button>
            <p className={TEXT_SUB}>
              Bấm nút là đồng ý cho Hubsell lưu và xử lý video theo{" "}
              <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="font-medium text-sky-700 hover:underline">
                Chính sách bảo mật
              </a>
              .
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-700">
            Chủ shop chưa bật tính năng này. Nhờ chủ shop mở trang Video đóng hàng và bấm đồng ý một lần.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
