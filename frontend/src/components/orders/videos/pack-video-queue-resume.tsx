"use client";

import * as React from "react";

import { useFeature } from "@/lib/use-feature";

/** Chờ trang đang mở nạp xong dữ liệu của nó rồi mới đụng tới hàng chờ video. Số tự chọn. */
const RESUME_DELAY_MS = 3000;

/**
 * GỬI TIẾP VIDEO ĐANG CHỜ Ở MỌI TRANG (câu K-6, docs/VIDEO-DONG-HANG-THIET-KE.md mục 18.10 C5 + mục 24).
 *
 * Trước đây hàng chờ chỉ tự gửi tiếp khi mở màn QUAY: Chrome sập, mở lại Hubsell mà vào trang khác thì video quay
 * dở / chưa gửi nằm im trên máy. Thẻ này đặt ở khung chung của app: tài khoản đã mở tính năng Video đóng hàng vào
 * BẤT KỲ trang nào cũng mở lại hàng chờ (gửi tiếp clip chưa lên kho + cứu clip đang quay dở lúc trang bị đóng).
 *
 * Không vẽ gì. Mã hàng chờ được nạp ĐỘNG nên không nằm trong gói mã chung của các trang; tài khoản chưa mở tính
 * năng thì không nạp gì cả. Gọi lặp vô hại (hàng chờ tự nhớ đã mở cho tài khoản nào).
 */
export function PackVideoQueueResume() {
  const open = useFeature("packVideo") === "open";
  React.useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void import("@/lib/pack-video-recorder/session")
        .then((session) => session.resumeUploadQueue())
        .catch(() => {
          // không nạp được mã hàng chờ (mạng chập chờn) → lần mở trang sau thử lại
        });
    }, RESUME_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return null;
}
