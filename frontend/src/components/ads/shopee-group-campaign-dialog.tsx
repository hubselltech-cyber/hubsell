"use client";

// ============================================================
// POPUP "THÊM CHIẾN DỊCH NHIỀU SẢN PHẨM VÀO BẢNG" (docs ADS-SHOPEE-KHAI-THAC-API mục 15.7–15.9, 19/10/2026)
//
// Shopee KHÔNG liệt kê Chiến dịch Nhóm nhiều SP (Seller Center `manual-mpd`) qua API, chỉ trả số theo ngày
// khi biết id → khách dán id một lần, Hubsell lưu dòng "group" và tự kéo số từ đó. Popup gồm: cách lấy id
// (3 bước, có ví dụ URL), ô nhập, nút Thêm, câu lỗi của sàn; "Soi (kỹ thuật)" in JSON cho hỗ trợ.
// ============================================================

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addShopeeGroupCampaign, probeShopeeCampaignById } from "@/lib/api";

export function ShopeeGroupCampaignDialog({
  open,
  channelId,
  onClose,
  onAdded,
}: {
  open: boolean;
  channelId: string;
  onClose: () => void;
  /** Gọi sau khi thêm thành công — trang nạp lại bảng + hiện câu báo. */
  onAdded: (message: string) => void;
}) {
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeOut, setProbeOut] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCampaignId("");
    setBusy(false);
    setError(null);
    setProbeOut(null);
  }, [open]);

  async function add() {
    if (!campaignId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await addShopeeGroupCampaign(channelId, campaignId);
      onAdded(r.message);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function probe() {
    if (!campaignId || busy) return;
    setBusy(true);
    setProbeOut(null);
    try {
      const r = await probeShopeeCampaignById(channelId, campaignId);
      setProbeOut(JSON.stringify(r, null, 2));
    } catch (err) {
      setProbeOut(`Lỗi: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader className="min-w-0">
          <DialogTitle>Thêm chiến dịch nhiều sản phẩm vào bảng</DialogTitle>
          <DialogDescription>
            Shopee chưa cho phần mềm nào tự thấy <b>Chiến dịch Nhóm nhiều sản phẩm</b> (GMV Max gom nhiều SP).
            Hubsell thêm được bằng id chiến dịch, làm một lần; sau đó số chi phí, đơn, ROAS tự cập nhật mỗi 30 phút.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Cách lấy id chiến dịch</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-300">
              <li>
                Trên Seller Center → <b>Kênh Marketing → Quảng cáo Shopee</b>, bấm vào <b>tên</b> chiến dịch Nhóm.
              </li>
              <li>
                Nhìn thanh địa chỉ trình duyệt, đường dẫn có dạng:
                <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  banhang.shopee.vn/portal/marketing/pas/product/manual-mpd/
                  <b className="text-red-600 dark:text-red-400">202942166</b>?source_page_id=…
                </code>
              </li>
              <li>
                Chép <b>dãy số ngay sau <code>manual-mpd/</code></b> (trước dấu <code>?</code>). Các số ở phía sau
                như <code>from=</code>, <code>to=</code> là khoảng ngày, chiến dịch nào cũng có, không phải id.
              </li>
            </ol>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-9 w-60"
              placeholder="Dán id chiến dịch, ví dụ 202942166"
              value={campaignId}
              inputMode="numeric"
              autoFocus
              onChange={(e) => setCampaignId(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void add();
              }}
            />
            <Button size="sm" disabled={busy || !campaignId} onClick={() => void add()}>
              {busy ? "Đang hỏi Shopee…" : "Thêm vào bảng"}
            </Button>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">Không thêm được: {error}</p>}

          <p className="text-xs text-muted-foreground">
            Sau khi thêm: có chi phí, đơn, doanh thu, ROAS theo ngày so với hòa vốn toàn gian. Không có ngân sách /
            mục tiêu ROAS / danh sách SP (Shopee không cho đọc). Trợ lý chỉ cảnh báo, không tự dừng loại này — muốn
            dừng hay đổi mục tiêu thì làm trên Seller Center. Xóa trên Shopee thì Hubsell tự đóng dòng.
          </p>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Soi kỹ thuật (in nguyên văn Shopee trả — dùng khi cần hỗ trợ)</summary>
            <div className="mt-2 space-y-2">
              <Button size="sm" variant="outline" disabled={busy || !campaignId} onClick={() => void probe()}>
                Soi id này
              </Button>
              {probeOut && (
                <pre className="max-h-72 overflow-auto rounded border bg-slate-50 p-2 text-[11px] leading-snug dark:bg-slate-900">
                  {probeOut}
                </pre>
              )}
            </div>
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
