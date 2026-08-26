/**
 * Sinh MP3 thuyáº¿t minh cho 3 tour Ä‘á»™ng cá»§a trang HÆ°á»›ng dáº«n sá»­ dá»¥ng (/guide):
 * Quáº£n lÃ½ kho (6), ÄÆ¡n hÃ ng & dÃ²ng tiá»n (6), HÃ³a Ä‘Æ¡n (7) â€” giá»ng Ná»® tiáº¿ng Viá»‡t
 * vi-VN-HoaiMyNeural, cÃ¹ng giá»ng vá»›i tour onboarding.
 * (Tour LiÃªn káº¿t gian hÃ ng tÃ¡i dÃ¹ng public/onboarding/voice/ â€” khÃ´ng sinh á»Ÿ Ä‘Ã¢y.)
 *
 * Ra file public/guide-assets/voice/{kho|donhang|hoadon}/step-N.mp3.
 * Lá»œI THOáº I pháº£i khá»›p title/desc trong lib/guide-tours.ts â€” sá»­a bÆ°á»›c nÃ o thÃ¬
 * sá»­a cÃ¢u tÆ°Æ¡ng á»©ng rá»“i cháº¡y láº¡i script.
 *
 * Cáº§n CLI edge-tts (Python): pip install edge-tts. CÃ¹ng cÃ¡c gotcha Ä‘Ã£ bisect á»Ÿ
 * generate-onboarding-voice.js: truyá»n cÃ¢u qua --file UTF-8 (qua --text argv
 * bá»‹ NoAudioReceived), dá»‹ch vá»¥ flaky nÃªn retry 4 lÆ°á»£t + nghá»‰ giá»¯a cÃ¡c call.
 *
 * Cháº¡y: node scripts/generate-guide-voice.js
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "D:/Claude Code/Hubsell/frontend/public/guide-assets/voice";
const VOICE = "vi-VN-HoaiMyNeural";

const TOURS = {
  kho: [
    "BÆ°á»›c 1. Má»Ÿ Quáº£n lÃ½ Kho, chá»n HÃ ng hÃ³a. ToÃ n bá»™ sáº£n pháº©m vÃ  tá»“n kho náº±m á»Ÿ Ä‘Ã¢y â€” má»™t kho duy nháº¥t cho má»i gian hÃ ng.",
    "BÆ°á»›c 2. Má»Ÿ tab Chá» liÃªn káº¿t rá»“i báº¥m Äá»“ng bá»™ tá»« sÃ n. Sáº£n pháº©m cá»§a má»i gian Ä‘Ã£ káº¿t ná»‘i Ä‘Æ°á»£c kÃ©o vá» Ä‘Ã¢y, kÃ¨m cáº£ giÃ¡ bÃ¡n vÃ  tá»“n kho trÃªn sÃ n.",
    "BÆ°á»›c 3. Báº¥m Tá»± khá»›p vÃ  táº¡o SKU toÃ n bá»™. SKU trÃ¹ng mÃ£ tá»± ná»‘i vÃ o kho, pháº§n cÃ²n láº¡i há»‡ thá»‘ng táº¡o SKU kho má»›i rá»“i ná»‘i luÃ´n. Tá»“n kho ban Ä‘áº§u tá»± láº¥y theo sá»‘ trÃªn sÃ n.",
    "BÆ°á»›c 4. Muá»‘n tá»± quyáº¿t, tick cÃ¡c dÃ²ng thuá»™c cÃ¹ng má»™t máº«u. Thanh cÃ´ng cá»¥ hiá»‡n dÆ°á»›i Ä‘Ã¡y: chá»n SKU gá»‘c rá»“i báº¥m LiÃªn káº¿t, hoáº·c báº¥m Táº¡o SKU kho cho hÃ ng chÆ°a cÃ³ trong kho.",
    "BÆ°á»›c 5. Tab Tá»“n kho lÃ  má»™t nguá»“n sá»‘ duy nháº¥t. Cá»™t BÃ¡n trÃªn cho biáº¿t má»—i SKU Ä‘ang ná»‘i nhá»¯ng gian nÃ o â€” Ä‘Æ¡n tá»« gian nÃ o vá» cÅ©ng trá»« chung má»™t tá»“n kho.",
    "BÆ°á»›c 6. Báº¥m CÃ i Ä‘áº·t rá»“i gáº¡t Tá»± Ä‘á»™ng Ä‘á»“ng bá»™: má»i biáº¿n Ä‘á»™ng kho tá»± Ä‘áº©y tá»“n má»›i lÃªn má»i gian. Chá»‰ báº­t khi sá»‘ tá»“n trong Hubsell Ä‘Ã£ Ä‘Ãºng.",
  ],
  donhang: [
    "BÆ°á»›c 1. Má»Ÿ menu ÄÆ¡n hÃ ng. ÄÆ¡n cá»§a má»i sÃ n gom vá» má»™t chá»— â€” lá»c theo sÃ n, gian hÃ ng, vÃ  tráº¡ng thÃ¡i giao.",
    "BÆ°á»›c 2. ÄÆ¡n tá»± cháº£y vá», khÃ´ng cáº§n lÃ m gÃ¬. Há»‡ thá»‘ng tá»± quÃ©t Ä‘Æ¡n má»›i mÆ°á»i phÃºt má»™t láº§n, cháº¡y cáº£ khi báº¡n khÃ´ng má»Ÿ pháº§n má»m.",
    "BÆ°á»›c 3. Muá»‘n láº¥y Ä‘Æ¡n ngay, sang trang KÃªnh bÃ¡n vÃ  báº¥m Äá»“ng bá»™ Ä‘Æ¡n trÃªn gian hÃ ng.",
    "BÆ°á»›c 4. VÃ o Quáº£n lÃ½ TÃ i chÃ­nh, chá»n Cáº¥u hÃ¬nh GiÃ¡ vá»‘n, rá»“i Ä‘iá»n giÃ¡ vá»‘n tá»«ng sáº£n pháº©m â€” Ä‘iá»u kiá»‡n Ä‘á»ƒ bÃ¡o cÃ¡o lÃ£i lá»— tÃ­nh Ä‘Ãºng.",
    "BÆ°á»›c 5. Báº¥m Äá»“ng bá»™ Ä‘á»‘i soÃ¡t Ä‘á»ƒ biáº¿t tá»«ng Ä‘Æ¡n thá»±c nháº­n bao nhiÃªu sau khi sÃ n trá»« phÃ­. Há»‡ thá»‘ng cÅ©ng tá»± cháº¡y má»—i giá» cho cáº£ ba sÃ n.",
    "BÆ°á»›c 6. Lá»£i nhuáº­n tá»«ng Ä‘Æ¡n xem á»Ÿ LÃ£i Lá»— Thá»±c Hiá»‡n, dÃ²ng tiá»n vá» ngÃ¢n hÃ ng xem á»Ÿ BÃ¡o cÃ¡o dÃ²ng tiá»n â€” cÃ¹ng trong nhÃ³m Quáº£n lÃ½ TÃ i chÃ­nh.",
  ],
  hoadon: [
    "BÆ°á»›c 1. VÃ o HÃ³a Ä‘Æ¡n vÃ  Thuáº¿, chá»n Káº¿t ná»‘i vÃ  Xuáº¥t hÃ³a Ä‘Æ¡n, rá»“i má»Ÿ tab Cáº¥u hÃ¬nh káº¿t ná»‘i. Viá»‡c thiáº¿t láº­p chá»‰ lÃ m má»™t láº§n.",
    "BÆ°á»›c 2. Äiá»n mÃ£ sá»‘ thuáº¿, tÃªn há»™ kinh doanh, Ä‘á»‹a chá»‰, rá»“i tÃ i khoáº£n meInvoice cá»§a shop. ChÆ°a cÃ³ tÃ i khoáº£n thÃ¬ báº¥m link ÄÄƒng kÃ½ ngay trong form.",
    "BÆ°á»›c 3. Báº¥m Test Ä‘á»ƒ kiá»ƒm tra káº¿t ná»‘i. Káº¿t ná»‘i thÃ nh cÃ´ng thÃ¬ há»‡ thá»‘ng tá»± táº£i kÃ½ hiá»‡u hÃ³a Ä‘Æ¡n tá»« meInvoice vá» cho báº¡n chá»n.",
    "BÆ°á»›c 4. Chá»n kÃ½ hiá»‡u hÃ³a Ä‘Æ¡n vÃ  thuáº¿ suáº¥t máº·c Ä‘á»‹nh, rá»“i báº¥m LÆ°u cáº¥u hÃ¬nh. Tá»« giá» xuáº¥t hÃ³a Ä‘Æ¡n chá»‰ cÃ²n má»™t cÃº tick.",
    "BÆ°á»›c 5. Tab Xuáº¥t hÃ³a Ä‘Æ¡n liá»‡t kÃª cÃ¡c Ä‘Æ¡n Ä‘Ã£ giao thÃ nh cÃ´ng. Tick nhá»¯ng Ä‘Æ¡n cáº§n xuáº¥t rá»“i báº¥m nÃºt â€” hÃ³a Ä‘Æ¡n Ä‘Æ°á»£c phÃ¡t hÃ nh vÃ  gá»­i CÆ¡ quan Thuáº¿.",
    "BÆ°á»›c 6. Gáº¡t Tá»± Ä‘á»™ng phÃ¡t hÃ nh: Ä‘Æ¡n giao thÃ nh cÃ´ng vÃ  Ä‘Ã£ Ä‘á»‘i soÃ¡t tá»± ra hÃ³a Ä‘Æ¡n. Tá»± Ä‘á»™ng Ä‘iá»u chá»‰nh khi hoÃ n lo ná»‘t pháº§n hÃ ng tráº£ láº¡i.",
    "BÆ°á»›c 7. Trang Lá»‹ch sá»­ vÃ  BÃ¡o cÃ¡o thuáº¿ lÆ°u má»i hÃ³a Ä‘Æ¡n Ä‘Ã£ phÃ¡t hÃ nh â€” báº¥m Táº£i Ä‘á»ƒ láº¥y báº£n PDF Ä‘Ã£ kÃ½.",
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (const [tour, lines] of Object.entries(TOURS)) {
    const dir = path.join(BASE, tour);
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < lines.length; i++) {
      const dest = path.join(dir, `step-${i + 1}.mp3`);
      const txt = path.join(dir, `line-${i + 1}.txt`);
      fs.writeFileSync(txt, lines[i], "utf8");
      let ok = false;
      for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
        const r = spawnSync(
          "python",
          ["-m", "edge_tts", "--voice", VOICE, "--file", txt, "--write-media", dest],
          { encoding: "utf8" }
        );
        ok = r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 5000;
        if (!ok) {
          console.warn(`  ${tour}/step-${i + 1} lÆ°á»£t ${attempt} há»ng, thá»­ láº¡iâ€¦`);
          await sleep(2000 * attempt);
        }
      }
      fs.rmSync(txt, { force: true });
      if (!ok) {
        console.error(`FAIL: ${tour}/step-${i + 1}.mp3 sinh há»ng sau 4 lÆ°á»£t`);
        process.exit(1);
      }
      const kb = Math.round(fs.statSync(dest).size / 1024);
      console.log(`${tour}/step-${i + 1}.mp3  ${kb} KB`);
      await sleep(1500);
    }
  }
  console.log("DONE:", BASE);
})();
