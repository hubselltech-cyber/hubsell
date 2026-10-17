-- Lượt đếm trang công cụ hubsell.vn/tinh-roas-hoa-von — CHỈ ĐỌC, dán vào Supabase → SQL Editor.
-- Bảng landing_event_daily (từ 17/10/2026): một dòng mỗi ngày (giờ VN) mỗi sự kiện.
--   roas_tool_view         = lượt mở trang công cụ
--   roas_tool_login_click  = lượt bấm "Đăng nhập để tính bằng đơn thật"
-- Không lưu IP hay người dùng, nên đây là số LƯỢT, không phải số người.

SELECT
  day                                                               AS ngay,
  SUM(count) FILTER (WHERE event = 'roas_tool_view')                AS luot_mo_trang,
  SUM(count) FILTER (WHERE event = 'roas_tool_login_click')         AS luot_bam_dang_nhap,
  ROUND(100.0 * SUM(count) FILTER (WHERE event = 'roas_tool_login_click')
        / NULLIF(SUM(count) FILTER (WHERE event = 'roas_tool_view'), 0), 1) AS ti_le_bam_phan_tram
FROM landing_event_daily
GROUP BY day
ORDER BY day DESC
LIMIT 60;
