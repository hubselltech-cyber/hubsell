-- ============================================================
-- 19/10/2026 — Pha B "Nền" lát B2 (docs/CUNG-HOA-LOP-GOI-SAN.md mục 5b): cổng
-- gọi sàn — GCRA dùng chung mọi tiến trình (N4) + lùi theo khóa lưu DB (N5).
-- Bảng + hàm MỚI, chưa lệnh sàn nào đi qua (Pha C mới chuyển từng luồng).
-- Công thức là bản Postgres của backend/src/lib/rate-gate.ts — đổi một bên
-- thì đổi cả hai (test rate-gate-db so hai bản).
--
-- Khóa: "SHOPEE:<app>" · "SHOPEE:<app>|shop:<id>" · "SHOPEE:<app>|ep:<path>" …
-- Mốc thời gian là mili giây theo đồng hồ DB (clock_timestamp) → mọi tiến trình
-- cùng một đồng hồ, không lệch giờ máy.
-- ============================================================
CREATE TABLE IF NOT EXISTS "api_rate_keys" (
  "key"            TEXT             NOT NULL,
  "tatMs"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "blockedUntilMs" BIGINT           NOT NULL DEFAULT 0,
  "failures"       INTEGER          NOT NULL DEFAULT 0,
  "factor"         DOUBLE PRECISION NOT NULL DEFAULT 1,
  "decreasedAtMs"  BIGINT           NOT NULL DEFAULT 0,
  "hits"           INTEGER          NOT NULL DEFAULT 0,
  "lastError"      TEXT,
  "updatedAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_rate_keys_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "api_rate_keys" ENABLE ROW LEVEL SECURITY;

-- Xin p_n lượt trên mọi khóa, tất cả hoặc không. emission 0 = không chặn trước
-- (chỉ đọc mốc lùi, KHÔNG ghi). Trả wait_ms = 0 khi được (đã trừ lượt), > 0 khi
-- phải chờ (không trừ gì), kèm các khóa đang có lỗi liên tiếp.
CREATE OR REPLACE FUNCTION api_rate_take(
  p_keys text[], p_emission_ms double precision[], p_burst integer[], p_n integer, p_recover_ms double precision
) RETURNS TABLE(wait_ms bigint, failed_keys text[])
LANGUAGE plpgsql AS $$
DECLARE
  now_ms   double precision := extract(epoch FROM clock_timestamp()) * 1000;
  cnt      integer := coalesce(array_length(p_keys, 1), 0);
  i        integer;
  v_cap    integer := NULL;
  v_want   integer;
  v_wait   double precision := 0;
  v_failed text[] := '{}';
  v_tats   double precision[] := array_fill(0::double precision, ARRAY[greatest(cnt, 1)]);
  r        record;
  f        double precision;
  eff      double precision;
  tat      double precision;
BEGIN
  FOR i IN 1..cnt LOOP
    IF p_emission_ms[i] > 0 THEN v_cap := least(coalesce(v_cap, p_burst[i]), p_burst[i]); END IF;
  END LOOP;
  v_want := greatest(1, least(p_n, coalesce(v_cap, p_n)));

  -- Khóa theo thứ tự chữ: hai tiến trình xin cùng bộ khóa không khóa chéo nhau.
  FOR i IN SELECT u.ord::integer FROM unnest(p_keys) WITH ORDINALITY AS u(k, ord) ORDER BY u.k LOOP
    IF p_emission_ms[i] > 0 THEN
      INSERT INTO "api_rate_keys"("key") VALUES (p_keys[i]) ON CONFLICT ("key") DO NOTHING;
      SELECT "tatMs", "blockedUntilMs", "failures", "factor", "decreasedAtMs" INTO r
        FROM "api_rate_keys" WHERE "key" = p_keys[i] FOR UPDATE;
    ELSE
      SELECT "tatMs", "blockedUntilMs", "failures", "factor", "decreasedAtMs" INTO r
        FROM "api_rate_keys" WHERE "key" = p_keys[i];
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;

    IF r."failures" > 0 THEN v_failed := v_failed || p_keys[i]; END IF;
    IF r."blockedUntilMs" > now_ms THEN v_wait := greatest(v_wait, r."blockedUntilMs" - now_ms); END IF;
    IF p_emission_ms[i] > 0 THEN
      f := CASE WHEN r."factor" >= 1 THEN 1
                ELSE least(1, r."factor" + greatest(0, now_ms - r."decreasedAtMs") / p_recover_ms) END;
      eff := p_emission_ms[i] / f;
      tat := greatest(r."tatMs", now_ms) + eff * v_want;
      IF tat - now_ms - p_burst[i] * eff > 0 THEN
        v_wait := greatest(v_wait, ceil(tat - now_ms - p_burst[i] * eff));
      END IF;
      v_tats[i] := tat;
    END IF;
  END LOOP;

  IF v_wait = 0 THEN
    FOR i IN 1..cnt LOOP
      IF p_emission_ms[i] > 0 THEN
        UPDATE "api_rate_keys" SET "tatMs" = v_tats[i] WHERE "key" = p_keys[i];
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT ceil(v_wait)::bigint, v_failed;
END $$;

-- Một lần lỗi trên khóa: tăng đếm, lùi (full jitter hoặc đúng trần), tôn trọng
-- Retry-After, tùy chọn hạ nhịp AIMD. Trả mốc lùi (ms).
CREATE OR REPLACE FUNCTION api_rate_penalize(
  p_key text, p_base_ms double precision, p_cap_ms double precision, p_jitter boolean,
  p_retry_after_ms double precision, p_decrease boolean, p_min_factor double precision,
  p_recover_ms double precision, p_error text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  now_ms   double precision := extract(epoch FROM clock_timestamp()) * 1000;
  r        record;
  v_fails  integer;
  v_ceil   double precision;
  v_gen    double precision;
  v_block  double precision;
  v_factor double precision;
  v_dec    double precision;
BEGIN
  INSERT INTO "api_rate_keys"("key") VALUES (p_key) ON CONFLICT ("key") DO NOTHING;
  SELECT "blockedUntilMs", "failures", "factor", "decreasedAtMs" INTO r
    FROM "api_rate_keys" WHERE "key" = p_key FOR UPDATE;
  v_fails := r."failures" + 1;
  v_ceil := least(p_cap_ms, p_base_ms * power(2, least(greatest(0, v_fails - 1), 40)));
  v_gen := CASE WHEN p_jitter THEN round(random() * v_ceil) ELSE v_ceil END;
  IF p_retry_after_ms IS NOT NULL AND p_retry_after_ms > 0 THEN v_gen := greatest(v_gen, round(p_retry_after_ms)); END IF;
  v_block := greatest(r."blockedUntilMs", now_ms + v_gen);
  v_factor := r."factor";
  v_dec := r."decreasedAtMs";
  IF p_decrease THEN
    v_factor := greatest(p_min_factor, (CASE WHEN r."factor" >= 1 THEN 1
      ELSE least(1, r."factor" + greatest(0, now_ms - r."decreasedAtMs") / p_recover_ms) END) * 0.5);
    v_dec := now_ms;
  END IF;
  UPDATE "api_rate_keys"
     SET "failures" = v_fails, "blockedUntilMs" = round(v_block)::bigint, "factor" = v_factor,
         "decreasedAtMs" = round(v_dec)::bigint, "hits" = "hits" + 1, "lastError" = left(p_error, 300),
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE "key" = p_key;
  RETURN round(v_block)::bigint;
END $$;
