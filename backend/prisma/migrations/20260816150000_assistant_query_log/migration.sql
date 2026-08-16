-- Nhật ký câu hỏi Trợ lý Hubsell (tầng luật) — ghi mọi câu từ ngày đầu để
-- đọc lại các câu miss phổ biến rồi bồi thành intent mới (kiến trúc 16/08).
CREATE TABLE "assistant_query_log" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "intent" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_query_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_query_log_ownerId_createdAt_idx" ON "assistant_query_log"("ownerId", "createdAt");

CREATE INDEX "assistant_query_log_outcome_createdAt_idx" ON "assistant_query_log"("outcome", "createdAt");
