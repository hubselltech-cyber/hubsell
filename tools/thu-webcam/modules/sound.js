// Âm báo bằng Web Audio, không dùng tệp âm thanh.
//  - "ting-ting": bắt đầu một clip mới.
//  - "boop-boop": tem này đã quay rồi.
//  - "tinh-tung": một clip vừa kết thúc và được lưu (trên điện thoại còn thiếu âm này).

let ctx = null;

function getContext() {
	const Ctor = window.AudioContext ?? window.webkitAudioContext;
	if (!Ctor) return null;
	if (!ctx) ctx = new Ctor();
	// Chrome chỉ cho phát tiếng sau khi người dùng đã bấm vào trang; thử đánh thức, không được thì thôi.
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});
	return ctx;
}

function tone(audio, { at, freq, duration, type, peak }) {
	const osc = audio.createOscillator();
	const gain = audio.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(freq, at);
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
	osc.connect(gain).connect(audio.destination);
	osc.start(at);
	osc.stop(at + duration + 0.02);
}

function play(notes) {
	try {
		const audio = getContext();
		if (!audio) return { played: false, reason: 'Trình duyệt không có Web Audio' };
		const t0 = audio.currentTime + 0.01;
		for (const note of notes) tone(audio, { ...note, at: t0 + note.offset });
		return audio.state === 'running'
			? { played: true }
			: { played: false, reason: 'AudioContext đang bị treo – cần bấm vào trang một lần để mở tiếng' };
	} catch (err) {
		return { played: false, reason: String(err?.message ?? err) };
	}
}

export function playTing() {
	return play([
		{ offset: 0, freq: 1568, duration: 0.14, type: 'sine', peak: 0.35 },
		{ offset: 0.16, freq: 2093, duration: 0.2, type: 'sine', peak: 0.35 },
	]);
}

export function playBoop() {
	return play([
		{ offset: 0, freq: 196, duration: 0.17, type: 'square', peak: 0.22 },
		{ offset: 0.24, freq: 196, duration: 0.17, type: 'square', peak: 0.22 },
	]);
}

// Hai nốt đi XUỐNG – ngược với "ting-ting" đi lên – để tai phân biệt được mở clip với đóng clip.
export function playDone() {
	return play([
		{ offset: 0, freq: 1319, duration: 0.14, type: 'sine', peak: 0.3 },
		{ offset: 0.16, freq: 880, duration: 0.24, type: 'sine', peak: 0.3 },
	]);
}

// Ba tiếng gắt, dồn dập: MẤT CAMERA giữa chừng – phải nghe ra ngay cả khi không nhìn màn hình.
export function playAlarm() {
	return play([
		{ offset: 0, freq: 440, duration: 0.16, type: 'square', peak: 0.3 },
		{ offset: 0.22, freq: 440, duration: 0.16, type: 'square', peak: 0.3 },
		{ offset: 0.44, freq: 440, duration: 0.28, type: 'square', peak: 0.3 },
	]);
}

export function audioState() {
	return ctx ? ctx.state : 'chưa mở';
}

// Gọi trong lúc người dùng bấm nút để mở tiếng trước.
export function unlockAudio() {
	getContext();
}
