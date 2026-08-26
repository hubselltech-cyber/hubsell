/**
 * Sinh 8 file MP3 thuyáº¿t minh cho tour onboarding (onboarding-overlay.tsx)
 * báº±ng giá»ng Ná»® tiáº¿ng Viá»‡t vi-VN-HoaiMyNeural (Microsoft Edge neural TTS â€”
 * giá»ng ná»¯ phá»• biáº¿n, anh Trung chá»‘t 25/08 sau khi Web Speech Ä‘á»c ngá»ng trÃªn
 * mÃ¡y thiáº¿u giá»ng Viá»‡t).
 *
 * File tÄ©nh Ä‘Ã³ng gÃ³i vÃ o public/onboarding/voice/step-N.mp3 â†’ má»i mÃ¡y nghe
 * Má»˜T giá»ng nhÆ° nhau, khÃ´ng phá»¥ thuá»™c trÃ¬nh duyá»‡t. Lá»œI THOáº I pháº£i khá»›p ná»™i
 * dung TOUR_STEPS â€” sá»­a bÆ°á»›c nÃ o thÃ¬ sá»­a cÃ¢u tÆ°Æ¡ng á»©ng rá»“i cháº¡y láº¡i script.
 *
 * Cáº§n CLI edge-tts (Python): pip install edge-tts
 * (npm msedge-tts 2.0.7 Ä‘Ã£ thá»­ nhÆ°ng cháº¿t "no turn.end received" â€” endpoint
 * Microsoft Ä‘á»•i token, báº£n Python Ä‘Æ°á»£c vÃ¡ Ä‘á»u Ä‘áº·n nÃªn tin cáº­y hÆ¡n.)
 *
 * Cháº¡y: node scripts/generate-onboarding-voice.js
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const OUT = "D:/Claude Code/Hubsell/frontend/public/onboarding/voice";
const VOICE = "vi-VN-HoaiMyNeural";

const LINES = [
  "BÆ°á»›c 1. Má»Ÿ menu KÃªnh bÃ¡n á»Ÿ thanh Ä‘iá»u hÆ°á»›ng bÃªn trÃ¡i. ÄÃ¢y lÃ  trung tÃ¢m quáº£n lÃ½ má»i gian hÃ ng cá»§a báº¡n.",
  "BÆ°á»›c 2. Báº¥m nÃºt Káº¿t ná»‘i gian hÃ ng á»Ÿ gÃ³c pháº£i phÃ­a trÃªn. Má»™t sÃ n cÃ³ thá»ƒ káº¿t ná»‘i nhiá»u gian hÃ ng khÃ¡c nhau.",
  "BÆ°á»›c 3. Chá»n sÃ n báº¡n Ä‘ang bÃ¡n trong Ã´ SÃ n thÆ°Æ¡ng máº¡i: Shopee, Lazada, hay TikTok Shop.",
  "BÆ°á»›c 4. Báº¥m Tiáº¿p tá»¥c vá»›i Shopee. Báº¡n sáº½ Ä‘Æ°á»£c chuyá»ƒn sang trang cá»§a Shopee Ä‘á»ƒ Ä‘Äƒng nháº­p vÃ  cho phÃ©p Hubsell truy cáº­p gian hÃ ng.",
  "BÆ°á»›c 5. TrÃªn trang Ä‘Äƒng nháº­p chÃ­nh chá»§ cá»§a Shopee, chá»n khu vá»±c Viá»‡t Nam á»Ÿ Ã´ Ä‘áº§u tiÃªn.",
  "BÆ°á»›c 6. Äiá»n tÃªn Ä‘Äƒng nháº­p vÃ  máº­t kháº©u Shopee cá»§a shop, rá»“i báº¥m ÄÄƒng Nháº­p. Báº¡n nháº­p trá»±c tiáº¿p trÃªn trang Shopee, Hubsell khÃ´ng nhÃ¬n tháº¥y máº­t kháº©u cá»§a báº¡n.",
  "BÆ°á»›c 7. Shopee liá»‡t kÃª cÃ¡c quyá»n cáº§n cáº¥p cho Hubsell. Báº¥m Confirm Authorization Ä‘á»ƒ hoÃ n táº¥t káº¿t ná»‘i.",
  "BÆ°á»›c 8. Xong rá»“i! ÄÆ¡n hÃ ng sáº½ tá»± Ä‘á»™ng Ä‘á»“ng bá»™ vá» Hubsell. Muá»‘n kÃ©o vá» ngay, báº¥m Äá»“ng bá»™ Ä‘Æ¡n trÃªn gian hÃ ng vá»«a káº¿t ná»‘i.",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (let i = 0; i < LINES.length; i++) {
    const dest = path.join(OUT, `step-${i + 1}.mp3`);
    let ok = false;
    // Dá»‹ch vá»¥ hay nháº£ NoAudioReceived thoÃ¡ng qua khi gá»i dá»“n dáº­p â†’ retry + nghá»‰.
    // Truyá»n cÃ¢u qua FILE UTF-8 thay vÃ¬ --text: vÃ i cÃ¢u tiáº¿ng Viá»‡t truyá»n qua
    // argument bá»‹ NoAudioReceived á»•n Ä‘á»‹nh (lá»—i encoding táº§ng argv), qua --file
    // thÃ¬ cháº¡y â€” Ä‘Ã£ bisect 25/08.
    const txt = path.join(OUT, `line-${i + 1}.txt`);
    fs.writeFileSync(txt, LINES[i], "utf8");
    for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
      // python -m edge_tts: cháº¡y Ä‘Æ°á»£c cáº£ khi Scripts/ cá»§a Python khÃ´ng trong PATH
      const r = spawnSync(
        "python",
        ["-m", "edge_tts", "--voice", VOICE, "--file", txt, "--write-media", dest],
        { encoding: "utf8" }
      );
      ok = r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 5000;
      if (!ok) {
        console.warn(`  step-${i + 1} lÆ°á»£t ${attempt} há»ng, thá»­ láº¡iâ€¦`);
        await sleep(2000 * attempt);
      }
    }
    fs.rmSync(txt, { force: true });
    if (!ok) {
      console.error(`FAIL: step-${i + 1}.mp3 sinh há»ng sau 4 lÆ°á»£t`);
      process.exit(1);
    }
    const kb = Math.round(fs.statSync(dest).size / 1024);
    console.log(`step-${i + 1}.mp3  ${kb} KB  â€” ${LINES[i].slice(0, 50)}â€¦`);
    await sleep(1500);
  }
  console.log("DONE:", OUT);
})();
