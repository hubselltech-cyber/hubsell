/**
 * TIẾNG BÍP cho màn quét (01/11/2026): người gói nhìn kiện, không nhìn màn hình
 * — một tiếng cao = ghi được, hai tiếng trầm = CHẶN (đơn hủy…), một tiếng
 * ngắn giữa = trùng. Web Audio, không tệp âm thanh; trình duyệt chặn âm trước
 * tương tác đầu tiên thì im lặng (quét = đã có tương tác nên gần như không gặp).
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx)
      ctx = new (
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      )();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, startMs: number, durMs: number, gain = 0.15) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(ac.destination);
  const t0 = ac.currentTime + startMs / 1000;
  osc.start(t0);
  osc.stop(t0 + durMs / 1000);
}

export const beep = {
  /** Ghi được — một tiếng cao ngắn. */
  ok: () => tone(1180, 0, 90),
  /** Trùng — một tiếng giữa, dài hơn chút. */
  dup: () => tone(660, 0, 160),
  /** Chặn — hai tiếng trầm. */
  error: () => {
    tone(220, 0, 180, 0.2);
    tone(220, 240, 260, 0.2);
  },
};
