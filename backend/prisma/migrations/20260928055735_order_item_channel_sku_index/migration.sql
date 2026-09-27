-- Vá giá vốn đơn cũ khớp theo mã SKU sàn (lib/cost-price.ts, 28/09/2026)
CREATE INDEX IF NOT EXISTS "OrderItem_channelSku_idx" ON "OrderItem"("channelSku");
