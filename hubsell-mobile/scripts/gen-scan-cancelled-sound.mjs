// Tạo assets/sounds/scan-cancelled.wav — tiếng báo ĐƠN ĐÃ HỦY của màn Quét đóng gói
// (05/11/2026). Tự tổng hợp như ba tiếng quét có sẵn (không dùng tệp âm ngoài).
//
// Phải phân biệt được bằng tai với ba tiếng kia khi người gói không nhìn màn hình:
//   scan-success   "ting-ting" đi LÊN, cao        → đã ghi
//   scan-duplicate "boop-boop" hai nhịp CÙNG tông → kiện đã quét rồi
//   scan-error     một tiếng rè trầm đi xuống     → không ghi được
//   scan-cancelled CÒI HAI TÔNG cao–thấp lặp 3 lần, dài ~1 giây → ĐƠN HỦY, bỏ kiện lại
//
// Chạy: node scripts/gen-scan-cancelled-sound.mjs   (trong hubsell-mobile)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100; // cùng định dạng với ba tệp có sẵn: PCM 16 bit, mono, 44,1 kHz
const HI = 494; // Hz
const LO = 330; // Hz
const HI_MS = 140;
const LO_MS = 180;
const GAP_MS = 15;
const CYCLES = 3;
const GAIN = 0.9; // đo được: rms ≈ 0,53 — ngang ba tệp có sẵn (0,46–0,54), không to nhỏ lệch nhau
const FADE_MS = 6; // vuốt đầu / cuối từng nốt cho khỏi lụp bụp

const samples = [];
const silence = (ms) => {
  for (let i = 0; i < Math.round((RATE * ms) / 1000); i++) samples.push(0);
};
const tone = (freq, ms) => {
  const n = Math.round((RATE * ms) / 1000);
  const fade = Math.round((RATE * FADE_MS) / 1000);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    // Sóng vuông làm mềm (3 hài lẻ đầu): đủ gắt để nghe ra là cảnh báo, không chói loa điện thoại.
    const w =
      Math.sin(2 * Math.PI * freq * t) +
      Math.sin(2 * Math.PI * 3 * freq * t) / 3 +
      Math.sin(2 * Math.PI * 5 * freq * t) / 5;
    const env = Math.min(1, i / fade, (n - 1 - i) / fade);
    samples.push((w / 1.2) * GAIN * env);
  }
};

for (let c = 0; c < CYCLES; c++) {
  tone(HI, HI_MS);
  silence(GAP_MS);
  tone(LO, LO_MS);
  silence(GAP_MS);
}

const data = Buffer.alloc(samples.length * 2);
samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "sounds", "scan-cancelled.wav");
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log(`${out}: ${(samples.length / RATE).toFixed(2)} giây, ${header.length + data.length} byte`);
