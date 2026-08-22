-- DÙNG THỬ (anh Trung chốt 22/08): mọi khách mới dùng thử N ngày (N là DATA
-- trên gói — mặc định thương mại 14, đổi được không sửa code); Subscription
-- mang cờ isTrial, thanh toán đầu tiên hạ cờ.

ALTER TABLE "service_plans" ADD COLUMN IF NOT EXISTS "trialDays" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "isTrial" BOOLEAN NOT NULL DEFAULT false;
