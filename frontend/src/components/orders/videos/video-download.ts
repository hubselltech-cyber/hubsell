import { toast } from "sonner";

import { ApiError, fetchPackVideoUrl } from "@/lib/api";

/**
 * Tải một video về máy: xin đường dẫn ký sẵn (máy chủ đặt sẵn tên tệp = mã vận đơn và
 * kiểu "đính kèm") rồi để trình duyệt tự tải — byte video đi thẳng từ kho tệp, không
 * qua máy chủ Hubsell. Trả về false khi không xin được đường dẫn.
 */
export async function downloadPackVideo(videoId: string): Promise<boolean> {
  try {
    const { url } = await fetchPackVideoUrl(videoId, true);
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : "Không lấy được đường dẫn tải video");
    return false;
  }
}
