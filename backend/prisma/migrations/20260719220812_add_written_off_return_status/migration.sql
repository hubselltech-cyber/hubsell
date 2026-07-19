-- Kết quả khiếu nại hàng hư hỏng/mất: thua kiện thì shop chịu hao hụt.
-- (CLAIM_SETTLED — thắng kiện, đã được đền — đã có sẵn trong enum từ trước.)
--
-- Postgres 12+ cho phép ADD VALUE trong transaction miễn là không DÙNG giá trị
-- mới ngay trong cùng transaction đó. Migration này chỉ khai báo, không update
-- dòng nào, nên chạy an toàn qua prisma migrate deploy.
ALTER TYPE "ReturnStatus" ADD VALUE 'WRITTEN_OFF';
