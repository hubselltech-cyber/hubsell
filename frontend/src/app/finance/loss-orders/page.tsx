import { redirect } from "next/navigation";

/**
 * Trang "Cảnh báo & P&L Sản phẩm" đã điều chuyển từ nhóm Quản lý Tài chính
 * sang Trợ lý vận hành, route đổi theo cho khớp nhóm menu. Giữ route cũ để
 * bookmark, link cũ và deep-link trong cảnh báo ops-alerts đã lưu không chết
 * — chỉ redirect, không còn nội dung.
 */
export default function FinanceLossOrdersRedirect() {
  redirect("/operations-assistant/loss-orders");
}
