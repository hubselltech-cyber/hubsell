/**
 * CHỐT AN TOÀN PHÁT HÀNH HÓA ĐƠN — hàng rào cuối trước khi Hubsell gửi lệnh
 * tạo hóa đơn sang MISA.
 *
 * VÌ SAO CẦN (khảo sát portal developer.misa.vn ngày 07/08/2026):
 *   · App "Hubsell" mới xong Bước 1 (đăng ký sản phẩm) và Bước 2 (đọc tài
 *     liệu). **Bước 3 "Kiểm thử & vận hành — gọi thử trên môi trường sandbox"
 *     vẫn ở trạng thái "Chưa mở khóa"** ⇒ CHƯA có môi trường sandbox riêng.
 *   · Base URL tài liệu (developer.misa.vn/apis) KHÔNG có tham số tách môi
 *     trường, và tài liệu chỉ chỗ tra hóa đơn đã phát hành là app3.meinvoice.vn
 *     — tức hệ thống THẬT.
 *   · Cặp Client ID/Secret trên portal là khóa ỨNG DỤNG, không phải khóa
 *     sandbox; phần định danh còn lại là tài khoản meInvoice THẬT của shop.
 *
 * ⇒ Gọi API phát hành lúc này có thể sinh HÓA ĐƠN THẬT có mã Cơ quan Thuế —
 * loại chứng từ KHÔNG xoá được, muốn bỏ phải làm thủ tục hủy/thay thế và giải
 * trình với cơ quan thuế. Hóa đơn máy tính tiền còn phát hành tức thì từ dải
 * mã cấp sẵn nên không có khoảng dừng nào để kịp can thiệp.
 *
 * Vì vậy MỌI lệnh phát hành đều phải đi qua assertPublishAllowed(). Mặc định
 * CHẶN; chỉ mở khi người vận hành chủ động đặt env MISA_ALLOW_PUBLISH=1 sau
 * khi đã xác nhận đang trỏ đúng môi trường được phép.
 *
 * Các API CHỈ ĐỌC (lấy token, /invoice/templates, danh sách chứng thư số, kéo
 * hóa đơn đầu vào) KHÔNG đi qua chốt này — chúng không sinh chứng từ.
 */

/** Bật cờ cho phép phát hành? (env "1" | "true", không phân biệt hoa thường) */
export function isPublishAllowed(): boolean {
  const flag = process.env.MISA_ALLOW_PUBLISH?.trim().toLowerCase();
  return flag === "1" || flag === "true";
}

/**
 * Ném lỗi chặn nếu chưa bật cờ cho phép phát hành.
 *
 * @param context Tên luồng để thông điệp lỗi nói rõ chỗ bị chặn
 *                (VD "hóa đơn kê khai", "hóa đơn máy tính tiền").
 */
export function assertPublishAllowed(context: string): void {
  if (isPublishAllowed()) return;
  throw new Error(
    `CHẶN AN TOÀN: chưa được phép phát hành ${context}. ` +
      "Môi trường sandbox của MISA cho ứng dụng Hubsell vẫn ở trạng thái " +
      '"Chưa mở khóa" (developer.misa.vn → Open API → Bước 3), nên lệnh phát ' +
      "hành có thể tạo HÓA ĐƠN THẬT có mã Cơ quan Thuế — không xoá được. " +
      "Chỉ đặt MISA_ALLOW_PUBLISH=1 khi đã xác nhận được phép phát hành trên " +
      "môi trường đang trỏ tới.",
  );
}
