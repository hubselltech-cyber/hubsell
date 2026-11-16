// Cửa 5 – máy trạng thái tự cắt clip theo tem.
//
//   nghỉ ──(mã hợp lệ X thấy 2 lần đọc liên tiếp)──▶ đang quay X
//   đang quay A ──(mã hợp lệ B ≠ A thấy 2 lần liên tiếp)──▶ lưu clip A, quay ngay clip B
//   mã đã có clip trong phiên này ──▶ không mở clip, báo "Tem này đã quay rồi" + boop-boop
//   nút Dừng ──▶ lưu clip đang quay, về nghỉ

import { errText, fileStamp, log, round } from './core.js';

// Mã "trông giống mã vận đơn": 8–30 ký tự A–Z / 0–9 (sau khi cắt khoảng trắng), có ít nhất 6 chữ số,
// không phải đường link. Trả chuỗi đã cắt khoảng trắng, hoặc null nếu bỏ qua.
export function looksLikeTracking(raw) {
	const value = String(raw ?? '').trim();
	if (value.length < 8 || value.length > 30) return null;
	if (/^[a-z][a-z0-9+.-]*:/i.test(value) || /^www\./i.test(value) || value.includes('/')) return null;
	if (!/^[A-Z0-9]+$/.test(value)) return null;
	if ((value.match(/[0-9]/g) ?? []).length < 6) return null;
	return value;
}

export class AutoCut {
	constructor({ pipeline, sounds, onChange, confirmReads = 2, repeatNoticeMs = 3000 }) {
		this.pipeline = pipeline;
		this.sounds = sounds;
		this.onChange = onChange ?? (() => {});
		this.confirmReads = confirmReads;
		this.repeatNoticeMs = repeatNoticeMs;

		this.current = null; // { code, clip, startedAtIso, manual? }
		this.candidate = null; // { code, count }
		this.done = new Set(); // mã đã có clip trong phiên này
		this.lastRepeatNotice = new Map();
		this.clips = [];
		this.cuts = [];
		this.reads = { total: 0, valid: 0, ignored: 0, confirmed: 0, repeats: 0 };
		this.notice = null;
		this.stopped = false;
	}

	get phase() {
		return this.current ? 'recording' : 'idle';
	}

	// Gọi sau MỖI lần thử đọc (kể cả lần không đọc được gì) – cần vậy mới đếm đúng "liên tiếp".
	onRead(codes) {
		if (this.stopped) return;
		const valid = [];
		for (const code of codes ?? []) {
			this.reads.total++;
			const value = looksLikeTracking(code.rawValue);
			if (value) valid.push({ code: value, format: code.format });
			else this.reads.ignored++;
		}
		if (!valid.length) {
			this.candidate = null;
			return;
		}
		this.reads.valid += valid.length;
		// Tem đang quay vẫn còn trong hình → coi như chưa đổi kiện, kể cả khi thấy thêm mã khác.
		if (this.current && valid.some((v) => v.code === this.current.code)) {
			this.candidate = null;
			return;
		}
		// Một tem có thể có nhiều mã hợp lệ. Chọn cố định: ưu tiên Code 128, rồi mã dài hơn, rồi theo thứ tự chữ.
		valid.sort(
			(a, b) =>
				(a.format === 'code_128' ? 0 : 1) - (b.format === 'code_128' ? 0 : 1) ||
				b.code.length - a.code.length ||
				a.code.localeCompare(b.code),
		);
		const pick = valid[0];
		if (this.candidate?.code === pick.code) this.candidate.count++;
		else this.candidate = { code: pick.code, count: 1 };
		if (this.candidate.count < this.confirmReads) return;
		this.candidate = null;
		this.#confirmed(pick.code);
	}

	#confirmed(code) {
		const decidedAtMs = performance.now();
		this.reads.confirmed++;

		if (this.done.has(code)) {
			// Tem còn nằm trong hình thì cứ 2 lần đọc lại xác nhận một lần – chỉ nhắc mỗi vài giây.
			const last = this.lastRepeatNotice.get(code) ?? -Infinity;
			if (decidedAtMs - last >= this.repeatNoticeMs) {
				this.lastRepeatNotice.set(code, decidedAtMs);
				this.reads.repeats++;
				const sound = this.sounds.boop();
				this.notice = { kind: 'repeat', text: 'Tem này đã quay rồi', code, at: new Date().toISOString(), soundPlayed: sound.played };
				log(`Tem này đã quay rồi: ${code} – không mở clip mới`, undefined, 'warn');
				this.onChange();
			}
			return;
		}

		const previous = this.current;
		const clip = this.pipeline.beginClip(code, { fileName: `${code}_${fileStamp()}.mp4`, decidedAtMs });
		this.current = { code, clip, startedAtIso: new Date().toISOString() };
		const sound = this.sounds.ting();
		this.notice = { kind: 'start', text: `Đang quay: ${code}`, code, at: this.current.startedAtIso, soundPlayed: sound.played };
		this.#track(code, clip);

		if (previous) {
			this.done.add(previous.code);
			const cut = { from: previous.code, to: code, at: this.current.startedAtIso, msDecisionToFirstFrame: null, msDecisionToFirstChunk: null };
			this.cuts.push(cut);
			log(`Cắt clip: ${previous.code} → ${code}`);
			clip.started.promise.then((info) => {
				cut.msDecisionToFirstFrame = info.ok ? info.msDecisionToFirstFrame : null;
				if (info.ok) log(`Clip ${code} có khung đầu sau ${info.msDecisionToFirstFrame} ms kể từ lúc quyết định cắt`);
				this.onChange();
			});
			clip.done.promise.then((result) => {
				cut.msDecisionToFirstChunk = result.ok ? result.msDecisionToFirstChunk : null;
			});
		} else {
			log(`Bắt đầu clip: ${code}`);
		}
		this.onChange();
	}

	#track(code, clip) {
		const record = { code, status: 'recording', seconds: null, bytes: null, path: null, frames: null, startedBy: clip.isCut ? 'cut' : 'start' };
		this.clips.push(record);
		clip.done.promise.then((result) => {
			if (result.ok) {
				Object.assign(record, {
					status: 'saved',
					seconds: result.mediaSeconds,
					wallSeconds: result.wallSeconds,
					bytes: result.bytes,
					path: result.savedPath,
					frames: result.framesEncoded,
					framesFed: result.framesFed,
					droppedBeforeEncode: result.droppedBeforeEncode,
					droppedByEncoder: result.droppedByEncoder,
					moovBeforeMdat: result.moovBeforeMdat,
					msDecisionToFirstFrame: result.msDecisionToFirstFrame,
					msDecisionToFirstChunk: result.msDecisionToFirstChunk,
					keyFrameAtCut: result.keyFrameAtCut,
				});
			} else {
				Object.assign(record, { status: 'failed', error: result.error });
				// Clip hỏng thì coi như chưa quay, cho phép quay lại tem này.
				this.done.delete(code);
			}
			this.onChange();
		});
	}

	// Nút "Bắt đầu quay": mở một clip KHÔNG cần tem (như nút QUAY THỬ trên màn thử điện thoại).
	// Clip mang tên QUAYTAY + giờ bấm. Đang quay tay mà đưa tem vào thì máy trạng thái vẫn cắt sang clip của tem như thường.
	startManual() {
		if (this.stopped) return { ok: false, error: 'Đã tắt tự cắt' };
		if (this.current) return { ok: false, error: `Đang quay ${this.current.code} – bấm Dừng trước` };
		const code = `QUAYTAY${fileStamp().replace(/[^0-9]/g, '').slice(-6)}`;
		const clip = this.pipeline.beginClip(code, { fileName: `${code}_${fileStamp()}.mp4`, decidedAtMs: performance.now() });
		this.current = { code, clip, startedAtIso: new Date().toISOString(), manual: true };
		const sound = this.sounds.ting();
		this.notice = { kind: 'start', text: `Đang quay: ${code}`, code, at: this.current.startedAtIso, soundPlayed: sound.played };
		this.#track(code, clip);
		log(`Bắt đầu clip quay tay: ${code}`);
		this.onChange();
		return { ok: true, code };
	}

	// Nút Dừng: lưu clip đang quay, về trạng thái nghỉ (vẫn tiếp tục đọc mã).
	async finishClip() {
		const current = this.current;
		if (!current) return { ok: true, finished: null };
		this.current = null;
		this.candidate = null;
		this.done.add(current.code);
		const sound = this.sounds.done?.() ?? { played: false };
		this.notice = { kind: 'stop', text: `Đã dừng clip ${current.code}`, code: current.code, at: new Date().toISOString(), soundPlayed: sound.played };
		this.onChange();
		try {
			const result = await this.pipeline.endClip();
			return { ok: !!result?.ok, finished: result };
		} catch (err) {
			return { ok: false, error: errText(err) };
		}
	}

	async stop() {
		const last = await this.finishClip();
		this.stopped = true;
		return last;
	}

	snapshot() {
		const saved = this.clips.filter((c) => c.status === 'saved');
		const cutMs = this.cuts.map((c) => c.msDecisionToFirstFrame).filter((v) => typeof v === 'number');
		return {
			phase: this.phase,
			currentCode: this.current?.code ?? null,
			currentStartedAt: this.current?.startedAtIso ?? null,
			candidate: this.candidate ? { ...this.candidate } : null,
			confirmReads: this.confirmReads,
			doneCodes: [...this.done],
			reads: { ...this.reads },
			notice: this.notice,
			clips: this.clips.map((c) => ({ ...c })),
			cuts: this.cuts.map((c) => ({ ...c })),
			clipsSaved: saved.length,
			cutMsAvg: cutMs.length ? round(cutMs.reduce((a, b) => a + b, 0) / cutMs.length, 1) : null,
			cutMsMax: cutMs.length ? round(Math.max(...cutMs), 1) : null,
		};
	}
}
