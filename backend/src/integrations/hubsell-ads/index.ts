// Hubsell Ads — app "Ads Service" riêng trên Shopee Open Platform.
// Đọc config.ts để hiểu vì sao có app thứ hai và cách bật/tắt bằng env.
export {
  HUBSELL_ADS_APP_LABEL,
  HUBSELL_ADS_CALLBACK_PATH,
  getHubsellAdsConfig,
  getHubsellAdsEnv,
  isHubsellAdsConfigured,
} from "./config";
export {
  buildHubsellAdsAuthorizeUrl,
  decodeHubsellAdsStateOrigin,
  handleHubsellAdsCallback,
  signHubsellAdsState,
  unlinkHubsellAds,
  verifyHubsellAdsState,
  type HubsellAdsLinkResult,
} from "./oauth";
export {
  HubsellAdsNotLinkedError,
  getHubsellAdsLinkStatus,
  getValidHubsellAdsAccessToken,
  hasShopeeAdsAccess,
  isHubsellAdsNotLinkedError,
  refreshExpiringHubsellAdsTokens,
  resolveShopeeAdsAccess,
  type HubsellAdsLinkStatus,
  type ShopeeAdsAccess,
} from "./token";
