"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SourcePicker } from "@/components/operations/copy-listing/source-picker";
import { PLATFORM_ORDER } from "@/components/operations/copy-listing/shared";
import { fetchCopyListingChannels, type ChannelName, type CopyListingSource } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import { useApiQuery } from "@/lib/use-api-query";

/**
 * SAO CHÉP SẢN PHẨM TỪ SÀN → SKU KHO ĐỘC LẬP (05/11/2026, anh Trung; docs/SAO-CHEP-SAN-PHAM.md mục 34).
 *
 * Mục trong menu "Tạo sản phẩm kho" của Tổng kho. Anh chốt: "ở Tổng kho thì sản phẩm độc lập trước,
 * việc nối thực hiện sau; sản phẩm từ sàn chưa có SKU đúng thì phải yêu cầu đặt SKU". Hộp này chỉ
 * CHỌN MỘT sản phẩm trên gian (dùng lại bảng chọn nguồn của Sao chép sản phẩm, chế độ chọn một) rồi
 * sang /products/new?fromChannel=&item= — form Tạo sản phẩm mới đổ sẵn dữ liệu sàn, khách đặt mã
 * còn thiếu rồi "Lưu vào Tổng kho". KHÔNG tạo liên kết gian, KHÔNG đăng.
 */
export function CopyFromChannelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [sourceChannelId, setSourceChannelId] = useState("");
  const [sourcePlatform, setSourcePlatform] = useState<ChannelName | "">("");
  const [picked, setPicked] = useState<Map<string, CopyListingSource>>(new Map());

  const channelsQ = useApiQuery({ queryKey: qk.copyListingChannels(), queryFn: fetchCopyListingChannels, enabled: open });
  const channels = useMemo(
    () =>
      [...(channelsQ.data?.items ?? [])].sort(
        (a, b) => PLATFORM_ORDER.indexOf(a.channelName) - PLATFORM_ORDER.indexOf(b.channelName) || a.shopName.localeCompare(b.shopName)
      ),
    [channelsQ.data]
  );
  const platformsPresent = PLATFORM_ORDER.filter((p) => channels.some((c) => c.channelName === p));

  // Gian nguồn mặc định = gian đầu có sản phẩm (cùng luật bước 1 của Sao chép sản phẩm).
  useEffect(() => {
    if (!sourceChannelId && channels.length > 0) {
      const first = channels.find((c) => c.productCount > 0) ?? channels[0];
      setSourceChannelId(first.id);
      setSourcePlatform(first.channelName);
    }
  }, [channels, sourceChannelId]);

  function onPicked(next: Map<string, CopyListingSource>) {
    const key = [...next.keys()][0];
    if (!key || !sourceChannelId) return;
    setPicked(next);
    onOpenChange(false);
    router.push(`/products/new?fromChannel=${encodeURIComponent(sourceChannelId)}&item=${encodeURIComponent(key)}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Sao chép sản phẩm từ sàn</DialogTitle>
          <DialogDescription>
            Chọn một sản phẩm trên gian đã nối. Hubsell lấy tên, ảnh, mô tả, phân loại, giá về form Tạo sản phẩm mới để bạn
            kiểm tra, đặt mã SKU còn thiếu rồi lưu thành SKU <b className="text-foreground">độc lập</b> trong Tổng kho. Chưa nối
            gian — nối sau ở Sản phẩm trên sàn.
          </DialogDescription>
        </DialogHeader>
        {channelsQ.denied ? (
          <p className="text-sm text-muted-foreground">Tài khoản chưa có quyền Sao chép sản phẩm — nhờ chủ shop gán quyền ở trang Nhân viên.</p>
        ) : channelsQ.data && channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa có gian nào đã nối API để lấy sản phẩm — nối gian ở trang Kênh bán trước.</p>
        ) : (
          <div className="space-y-4">
            <SourcePicker
              single
              sourceType="CHANNEL"
              channels={channels}
              platformsPresent={platformsPresent}
              sourcePlatform={sourcePlatform}
              sourceChannelId={sourceChannelId}
              onPlatformChange={setSourcePlatform}
              onPickChannel={(id) => {
                setSourceChannelId(id);
                setPicked(new Map());
              }}
              picked={picked}
              onPickedChange={onPicked}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
