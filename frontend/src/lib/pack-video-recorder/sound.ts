// ============================================================
// Âm báo của màn quay — Web Audio, không dùng tệp âm thanh.
//
// Anh Trung 14/11: "còn thiếu tiếng nhạc nữa là xuất sắc"; 16/11: "phải có nút bắt đầu và dừng… nhạc nữa".
// Người đóng hàng nhìn kiện chứ không nhìn màn hình, nên mỗi việc một âm khác hẳn nhau:
//   ting-ting (hai nốt đi LÊN)     mở một clip
//   hai nốt đi XUỐNG               clip vừa kết thúc và được lưu
//   boop-boop (trầm, vuông)        tem này đã quay rồi — không quay lại
//   ba hồi gắt                     MẤT CAMERA giữa chừng
// Chrome chỉ cho phát tiếng sau khi người dùng đã bấm vào trang → gọi unlockAudio() trong lúc bấm nút.
// ============================================================

interface Note {
  offset: number;
  freq: number;
  duration: number;
  type: OscillatorType;
  peak: number;
}

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function play(notes: Note[]): boolean {
  try {
    const audio = getContext();
    if (!audio) return false;
    const t0 = audio.currentTime + 0.01;
    for (const note of notes) {
      const at = t0 + note.offset;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = note.type;
      osc.frequency.setValueAtTime(note.freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(note.peak, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.duration);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + note.duration + 0.02);
    }
    return audio.state === "running";
  } catch {
    return false;
  }
}

/** Mở clip. */
export function playTing(): boolean {
  return play([
    { offset: 0, freq: 1568, duration: 0.14, type: "sine", peak: 0.35 },
    { offset: 0.16, freq: 2093, duration: 0.2, type: "sine", peak: 0.35 },
  ]);
}

/** Clip kết thúc. */
export function playDone(): boolean {
  return play([
    { offset: 0, freq: 1319, duration: 0.14, type: "sine", peak: 0.3 },
    { offset: 0.16, freq: 880, duration: 0.24, type: "sine", peak: 0.3 },
  ]);
}

/** Tem đã quay rồi. */
export function playBoop(): boolean {
  return play([
    { offset: 0, freq: 196, duration: 0.17, type: "square", peak: 0.22 },
    { offset: 0.24, freq: 196, duration: 0.17, type: "square", peak: 0.22 },
  ]);
}

/** Mất camera. */
export function playAlarm(): boolean {
  return play([
    { offset: 0, freq: 440, duration: 0.16, type: "square", peak: 0.3 },
    { offset: 0.22, freq: 440, duration: 0.16, type: "square", peak: 0.3 },
    { offset: 0.44, freq: 440, duration: 0.28, type: "square", peak: 0.3 },
  ]);
}

/** Gọi trong lúc người dùng bấm nút để mở tiếng trước (lần tạo AudioContext đầu tiên chậm). */
export function unlockAudio(): void {
  getContext();
}
