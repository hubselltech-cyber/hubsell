-- GĐ3 (22/08 khuya): SĐT khách để lại khi gửi yêu cầu mua/tư vấn gói —
-- HQ phải gọi lại được (anh Trung chốt: trước mắt bắt khách để lại SĐT,
-- luồng Zalo tích hợp sau).

ALTER TABLE "plan_upgrade_requests" ADD COLUMN "contactPhone" TEXT;
