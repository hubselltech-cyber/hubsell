// TikTok Ads — app riêng trên TikTok Marketing API (quảng cáo GMV Max).
// Đọc config.ts để hiểu vì sao tách khỏi integrations/tiktok/ và cách bật bằng env.
export {
  TIKTOK_ADS_API_BASE,
  buildTiktokAdsAuthorizeUrl,
  getTiktokAdsConfig,
  isTiktokAdsConfigured,
  type TiktokAdsConfig,
} from "./config";
export {
  GMV_MAX_CREATIVE_BATCH,
  TiktokAdsApiError,
  exchangeTiktokAdsAuthCode,
  getGmvMaxBidRecommendation,
  getGmvMaxCampaignInfo,
  getGmvMaxReport,
  getGmvMaxStores,
  getTiktokAdsAdvertisers,
  isTiktokAdsScopeMissing,
  updateGmvMaxCreatives,
  type GmvMaxBidRecommendation,
  type GmvMaxCampaignInfo,
  type GmvMaxCreativeAction,
  type GmvMaxReportPage,
  type GmvMaxReportQuery,
  type GmvMaxReportRow,
  type GmvMaxStore,
  type TiktokAdsAdvertiser,
  type TiktokAdsTokenResult,
} from "./client";
export {
  connectTiktokAds,
  getTiktokAdsLinkStatus,
  signTiktokAdsState,
  unlinkTiktokAds,
  verifyTiktokAdsState,
  type TiktokAdsConnectResult,
  type TiktokAdsLinkStatus,
  type TiktokAdsLinkedStore,
} from "./oauth";
