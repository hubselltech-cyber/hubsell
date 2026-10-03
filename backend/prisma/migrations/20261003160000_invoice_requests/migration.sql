-- ============================================================
-- HÓA ĐƠN BƯỚC 5, LÁT 9: xuất HÀNG LOẠT chạy nền qua làn của shop (03/10/2026,
-- anh Trung duyệt kế hoạch 03/10: "Ok em. Làm đi").
--
-- Bảng MỚI "invoice_requests": mỗi đơn chủ shop tick rồi bấm Xuất hóa đơn là một
-- dòng; một lần bấm = một batchId (để hiện tiến độ "Đang xuất 7/40"). Làn của shop
-- (invoice_lanes, lát 8) làm lần lượt các dòng PENDING, cũ trước.
--   · status: PENDING | DONE | FAILED | CANCELLED. Không có RUNNING: làn thuê đã
--     cho biết ai đang chạy; tờ đang dở có vé riêng là dòng InvoiceLog PENDING.
--   · attempts / nextRetryAt: lỗi TẠM của nhà cung cấp thì thử lại, tối đa 3 lượt.
--   · errorCode 'OUTCOME_UNKNOWN' trên dòng DONE = tờ chưa rõ kết quả, vòng quét
--     lát 6b đang kiểm lại.
--
-- Chỉ mục:
--   · open_key (duy nhất, riêng phần): một đơn chỉ có MỘT yêu cầu đang chờ → bấm
--     trùng không sinh dòng thứ hai; cũng phục vụ câu "yêu cầu chờ của shop này".
--   · due_idx (riêng phần): lưới quét tìm shop có yêu cầu tới hạn, chỉ chứa dòng chờ.
--   · batch_idx: đếm tiến độ một lô.
--   · createdAt_idx: tác vụ dọn nhật ký (xong 7 ngày, còn lại 30 ngày).
--
-- Bảng mới, cố ý KHÔNG có khóa ngoại sang User / Order → migration không lấy khóa
-- trên bảng đang được ghi liên tục (bài học 30/09). Bật RLS như mọi bảng khác.
--
-- Hàng đợi pg-boss "invoice.issue": CHỈ là tín hiệu "shop này vừa có yêu cầu" để
-- worker chạy ngay (việc dài vài mili-giây); mất tín hiệu thì lưới quét 5 giây nhặt.
-- ============================================================

CREATE TABLE "invoice_requests" (
  "id"            TEXT NOT NULL,
  "ownerId"       TEXT NOT NULL,
  "kind"          TEXT NOT NULL,
  "source"        TEXT NOT NULL,
  "targetKey"     TEXT NOT NULL,
  "params"        JSONB,
  "batchId"       TEXT,
  "requestedById" TEXT,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resultLogId"   TEXT,
  "errorCode"     TEXT,
  "error"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "finishedAt"    TIMESTAMP(3),

  CONSTRAINT "invoice_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_requests_open_key" ON "invoice_requests" ("ownerId", "kind", "targetKey")
  WHERE "status" = 'PENDING';
CREATE INDEX "invoice_requests_due_idx" ON "invoice_requests" ("nextRetryAt")
  WHERE "status" = 'PENDING';
CREATE INDEX "invoice_requests_ownerId_batchId_idx" ON "invoice_requests" ("ownerId", "batchId");
CREATE INDEX "invoice_requests_createdAt_idx" ON "invoice_requests" ("createdAt");

ALTER TABLE "invoice_requests" ENABLE ROW LEVEL SECURITY;

SELECT pgboss.create_queue('invoice.issue', '{"policy":"stately","retryLimit":2,"retryDelay":30,"retryBackoff":true,"expireInSeconds":300}'::jsonb);
