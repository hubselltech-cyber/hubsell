/**
 * IN PDF VẬN ĐƠN + PHIẾU NHẶT HÀNG
 *
 * Từ 04/09 phiếu không còn là HTML Hubsell tự dựng: backend trả MỘT file PDF
 * gồm vận đơn CHÍNH CHỦ của sàn (mã vạch + QR phân loại do sàn sinh, shipper
 * quét được) và phiếu nhặt hàng Hubsell khổ A6 đi kèm từng đơn. Việc của
 * frontend chỉ là mở hộp thoại in ngay cho file đó.
 *
 * Cách mở: nhúng PDF vào iframe ẩn rồi gọi print() của chính iframe — Chrome/
 * Edge in được thẳng file PDF (không in trang web bao ngoài). Firefox không cho
 * in PDF trong iframe → mở tab mới, người dùng bấm Ctrl+P.
 */

const FRAME_ID = "hubsell-print-frame";

/** Mở hộp thoại in cho PDF; trả false nếu trình duyệt chặn (cần cho phép pop-up). */
export function printPdfBlob(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const isFirefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);
  if (isFirefox) {
    const win = window.open(url, "_blank");
    return Boolean(win);
  }

  document.getElementById(FRAME_ID)?.remove();
  const iframe = document.createElement("iframe");
  iframe.id = FRAME_ID;
  iframe.title = "In phiếu";
  iframe.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  iframe.src = url;
  iframe.onload = () => {
    // Đợi viewer PDF dựng xong trang đầu rồi mới gọi in, nếu không ra trang trắng
    window.setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(url, "_blank");
      }
    }, 400);
  };
  document.body.appendChild(iframe);
  return true;
}

/** Mở PDF ở tab mới để xem lại (không tự in). */
export function openPdfBlob(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  return Boolean(window.open(url, "_blank"));
}
