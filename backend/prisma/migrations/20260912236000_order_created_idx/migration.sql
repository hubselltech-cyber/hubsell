-- 12/09/2026 - index Order(createdAt) cho thong ke toan nen tang. Idempotent.
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order"("createdAt");
