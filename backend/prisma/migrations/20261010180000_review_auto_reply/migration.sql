-- ============================================================
-- TỰ ĐỘNG TRẢ LỜI ĐÁNH GIÁ CHẠY NỀN MỖI NGÀY (10/10/2026, anh Trung: "để 1 ngày
-- trả lời 1 lần thôi"). Trước đây cờ số sao + bộ mẫu nằm localStorage và engine
-- chạy trong trình duyệt → tắt tab là không tự trả lời.
--
-- 1. "review_auto_reply_config": 1 dòng/chủ shop — mức sao bật, bộ mẫu, lịch
--    chạy kế (nextRunAt) + kết quả lượt gần nhất. Chỉ mục nextRunAt cho worker
--    tìm shop tới hạn.
-- 2. "review_auto_replies": sổ chống trùng, unique (channelId, reviewId) — ghi
--    trước khi gửi nên hai tiến trình không trả lời đôi. Chỉ mục createdAt cho
--    việc dọn dòng cũ.
--
-- Bảng mới, không khóa ngoại → không lấy khóa trên bảng đang ghi. Bật RLS như
-- mọi bảng khác. IF NOT EXISTS để chạy lại êm.
-- ============================================================

CREATE TABLE IF NOT EXISTS "review_auto_reply_config" (
  "id"             TEXT NOT NULL,
  "ownerId"        TEXT NOT NULL,
  "enabledStars"   INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "templates"      JSONB,
  "nextRunAt"      TIMESTAMP(3),
  "lastRunAt"      TIMESTAMP(3),
  "lastRunReplied" INTEGER NOT NULL DEFAULT 0,
  "lastRunFailed"  INTEGER NOT NULL DEFAULT 0,
  "lastRunError"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "review_auto_reply_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "review_auto_reply_config_ownerId_key" ON "review_auto_reply_config" ("ownerId");
CREATE INDEX IF NOT EXISTS "review_auto_reply_config_nextRunAt_idx" ON "review_auto_reply_config" ("nextRunAt");

ALTER TABLE "review_auto_reply_config" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "review_auto_replies" (
  "id"        TEXT NOT NULL,
  "ownerId"   TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "reviewId"  TEXT NOT NULL,
  "rating"    INTEGER NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'SENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "review_auto_replies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "review_auto_replies_channelId_reviewId_key" ON "review_auto_replies" ("channelId", "reviewId");
CREATE INDEX IF NOT EXISTS "review_auto_replies_createdAt_idx" ON "review_auto_replies" ("createdAt");

ALTER TABLE "review_auto_replies" ENABLE ROW LEVEL SECURITY;
