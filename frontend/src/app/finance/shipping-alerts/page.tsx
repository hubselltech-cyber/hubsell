import { redirect } from "next/navigation";

/**
 * Trang "Đối soát phí ship" đã điều chuyển từ nhóm Quản lý Tài chính sang
 * Quản lý Kho, route đổi theo cho khớp nhóm menu. Giữ route cũ để bookmark,
 * link cũ và deep-link trong cảnh báo ops-alerts đã lưu không chết — chỉ
 * redirect, không còn nội dung.
 */
export default function FinanceShippingAlertsRedirect() {
  redirect("/warehouse/shipping-alerts");
}
