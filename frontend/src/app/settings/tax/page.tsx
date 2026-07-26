import { redirect } from "next/navigation";

/**
 * Trang "Hóa đơn & Thuế" đã chuyển từ Cấu hình lên danh mục lớn riêng và đổi
 * tên thành "Kết nối & Xuất hóa đơn". Giữ route cũ để bookmark/link cũ không
 * chết — chỉ redirect, không còn nội dung.
 */
export default function SettingsTaxRedirect() {
  redirect("/invoicing/connect");
}
