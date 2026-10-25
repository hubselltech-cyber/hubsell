-- CA THỰC TẾ TRỢ LÝ QUẢNG CÁO — số trước/sau theo tuần của gian anh Trung (chỉ SELECT, Supabase SQL Editor).
-- Kết quả lần chạy 25/10/2026: KET-QUA-2026-10-25-TRO-LY-QUANG-CAO.md
-- Gian: and.not.or (TikTok, cmu3gdi1q0082lw3ot1ka8smm) — nơi trợ lý TỰ LOẠI VIDEO thật;
--       ANO Official Store (Shopee, cmshe0487007oiz3pg41t2vb0) — trợ lý chỉ diễn tập, anh tự chạy ads.
-- Tuần bắt đầu thứ Hai (date_trunc week). Lãi trước ads = Σ profit sổ cái của đơn tính doanh thu, có giá vốn
-- (cùng luật Tổng quan). Gian TikTok feeGmvMax = 0 → tiền ads không nằm trong đơn, trừ riêng bằng AdSpend/hiệu suất chiến dịch.
-- Mẹo đọc: lưới Supabase ảo hóa dòng/cột → bọc string_agg(r::text, ' ~ ') để ra một ô rồi đọc innerText.

-- 1) Gian của chủ shop + mốc trợ lý chạy thật / diễn tập
select c.id, c."shopName", c."channelName", c.status,
  (select count(*) from "AdsCampaign" a where a."channelId" = c.id) camps,
  (select min(x."createdAt") from "AdsActionLog" x where x."channelId" = c.id and x.mode = 'live' and x.status = 'SUCCESS') first_live,
  (select count(*) from "AdsActionLog" x where x."channelId" = c.id and x.mode = 'live' and x.status = 'SUCCESS') n_live,
  (select min(x."createdAt") from "AdsActionLog" x where x."channelId" = c.id and x.mode = 'dry_run') first_dry,
  (select string_agg(r.mode, ',') from tiktok_ads_auto_rules r join "AdsCampaign" a on a.id = r."adsCampaignId" where a."channelId" = c.id) tt_modes,
  (select config->'autoExecute'->>'mode' from "AdsAssistantConfig" k where k."channelId" = c.id) sp_mode
from "Channel" c
where c."userId" = (select "userId" from "Channel" where id = 'cmu3gdi1q0082lw3ot1ka8smm')
order by 2;

-- 2) Theo tuần: đơn, GMV, lãi trước/sau ads, chi ads, đơn/GMV ads, lệnh trợ lý
with ch as (select id, "shopName" from "Channel" where id in ('cmu3gdi1q0082lw3ot1ka8smm', 'cmshe0487007oiz3pg41t2vb0')),
o as (
  select l."channelId" cid, date_trunc('week', l."createdDate")::date wk, count(*) don,
    count(*) filter (where l."shippingStatus" <> 'CANCELLED') khong_huy,
    round(sum(l."revenueGross") filter (where l."countsAsRevenue")) gmv,
    round(sum(l.profit) filter (where l."countsAsRevenue" and not l."missingCostPrice")) lai_truoc_ads,
    count(*) filter (where l."countsAsRevenue" and l."missingCostPrice") thieu_gv,
    round(100.0 * count(*) filter (where l."isSettled") / count(*)) pct_doi_soat,
    round(sum(l."feeGmvMax")) fee_gmvmax
  from order_ledger l join ch on ch.id = l."channelId"
  where l."createdDate" >= date '2026-07-27' group by 1, 2),
s as (
  select "channelId" cid, date_trunc('week', date)::date wk, round(sum(amount)) adspend
  from "AdSpend" where "channelId" in (select id from ch) and date >= date '2026-07-27' group by 1, 2),
a as (
  select c."channelId" cid, date_trunc('week', p.date)::date wk, round(sum(p.expense)) chi_cd,
    sum(p."broadOrder") don_ads, round(sum(p."broadGmv")) gmv_ads,
    sum(p."directOrder") don_ads_d, round(sum(p."directGmv")) gmv_ads_d,
    count(distinct c.id) filter (where p.expense > 0) cd_tieu
  from "AdsCampaignDailyPerf" p join "AdsCampaign" c on c.id = p."adsCampaignId"
  where c."channelId" in (select id from ch) and p.date >= date '2026-07-27' group by 1, 2),
g as (
  select "channelId" cid, date_trunc('week', ("createdAt" at time zone 'UTC') at time zone 'Asia/Ho_Chi_Minh')::date wk,
    count(*) filter (where mode = 'live' and status = 'SUCCESS' and action in ('exclude_video', 'pause')) lenh_cat,
    count(*) filter (where mode = 'live' and status = 'SUCCESS' and action not in ('exclude_video', 'pause')) lenh_khac,
    count(*) filter (where mode = 'dry_run' and action <> 'config_change') dien_tap
  from "AdsActionLog" where "channelId" in (select id from ch) group by 1, 2)
select string_agg(r::text, ' ~ ' order by r.gian, r.tuan) from (
  select ch."shopName" gian, o.wk tuan, o.don, o.khong_huy, o.gmv, o.lai_truoc_ads, s.adspend, a.chi_cd, o.fee_gmvmax,
    o.lai_truoc_ads - coalesce(s.adspend, 0) lai_sau_ads, a.don_ads, a.gmv_ads, a.don_ads_d, a.gmv_ads_d, a.cd_tieu,
    o.thieu_gv, o.pct_doi_soat, g.lenh_cat, g.lenh_khac, g.dien_tap
  from o join ch on ch.id = o.cid
  left join s on s.cid = o.cid and s.wk = o.wk
  left join a on a.cid = o.cid and a.wk = o.wk
  left join g on g.cid = o.cid and g.wk = o.wk) r;

-- 3) Theo tuần TỪNG chiến dịch GMV Max của and.not.or (so chiến dịch có trợ lý chạy thật với chiến dịch đối chứng)
select string_agg(t, ' ~ ' order by t) from (
  select concat_ws(' ; ', nm, wk, round(sp), od, round(gm), round(gm / nullif(sp, 0), 1), d) t from (
    select left(c.name, 12) nm, date_trunc('week', p.date)::date wk, sum(p.expense) sp, sum(p."broadOrder") od,
      sum(p."broadGmv") gm, count(*) filter (where p.expense > 0) d
    from "AdsCampaignDailyPerf" p join "AdsCampaign" c on c.id = p."adsCampaignId"
    where c."channelId" = 'cmu3gdi1q0082lw3ot1ka8smm' and p.date >= date '2026-08-17'
    group by 1, 2 having sum(p.expense) > 0) y) z;

-- 4) Sổ lệnh thật / tay của trợ lý trên 2 gian + chế độ luật từng chiến dịch TikTok
select concat_ws(' | ', to_char((x."createdAt" at time zone 'UTC') at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI'),
  ch."shopName", c.name, x.action, x.mode, x.status, x.verdict, left(replace(x.reasons, E'\n', ' / '), 160))
from "AdsActionLog" x join "AdsCampaign" c on c.id = x."adsCampaignId" join "Channel" ch on ch.id = x."channelId"
where x."channelId" in ('cmu3gdi1q0082lw3ot1ka8smm', 'cmshe0487007oiz3pg41t2vb0') and x.mode in ('live', 'manual')
order by x."createdAt";

select c.name, c.status, r.mode, r."roiTarget", r."hardBasis", r."windowDays", r."updatedAt"
from tiktok_ads_auto_rules r join "AdsCampaign" c on c.id = r."adsCampaignId"
where c."channelId" = 'cmu3gdi1q0082lw3ot1ka8smm';
