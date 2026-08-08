import { redirect } from "next/navigation";

/**
 * Route gốc của module Mạng lưới KOC & Marketing — không có nội dung riêng,
 * đưa thẳng về màn hình chính Tổng quan Net-ROI Đa kênh.
 */
export default function KocMarketingIndex() {
  redirect("/koc-marketing/overview");
}
