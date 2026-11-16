// Đường quay WebCodecs: camera → (canvas ghép ngày giờ) → VideoEncoder H.264 → mediabunny ghép MP4.
//
// MỘT bộ mã hóa chạy xuyên suốt, nhiều clip nối đuôi nhau. Cắt clip = ép khung kế tiếp thành khung khóa
// rồi chuyển các gói H.264 từ khung khóa đó trở đi sang tệp MP4 mới. Không dừng, không cấu hình lại bộ mã hóa,
// nên không mất khung nào giữa hai clip.

import {
	BufferTarget,
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
} from '/node_modules/mediabunny/dist/bundles/mediabunny.mjs';
import { counters, deferred, describeMp4, errText, log, makeStat, round, saveToServer } from './core.js';
import { startPump } from './pump.js';

const KEY_FRAME_INTERVAL_US = 1_000_000; // một khung khóa mỗi giây
const MAX_ENCODE_QUEUE = 10; // hàng chờ bộ mã hóa dài hơn mức này thì bỏ khung (chạy thời gian thực, không để dồn mãi)

// Chọn chuỗi codec H.264 theo độ phân giải: thử High → Main → Baseline ở mức (level) vừa đủ.
function codecCandidates(width, height, fps) {
	const pixels = width * height;
	let level = '33'; // 5.1
	if (pixels <= 1280 * 720 && fps <= 30) level = '1f'; // 3.1
	else if (pixels <= 1920 * 1088 && fps <= 30) level = '28'; // 4.0
	else if (pixels <= 2560 * 1440 && fps <= 30) level = '32'; // 5.0
	const list = [`avc1.6400${level}`, `avc1.4d40${level}`, `avc1.42e0${level}`];
	if (level !== '33') list.push('avc1.640033');
	return list;
}

export function webCodecsSupport() {
	if (typeof window.VideoEncoder !== 'function') return { supported: false, reason: 'Trình duyệt không có VideoEncoder (WebCodecs)' };
	if (typeof window.VideoFrame !== 'function') return { supported: false, reason: 'Trình duyệt không có VideoFrame (WebCodecs)' };
	return { supported: true };
}

export class WcPipeline {
	constructor({ track, video, width, height, fps, bitrate, overlay, pumpMode, composer, scanner, hardwareAcceleration }) {
		this.track = track;
		this.video = video;
		this.width = width;
		this.height = height;
		this.fps = fps;
		this.bitrate = bitrate;
		this.overlay = overlay;
		this.pumpMode = pumpMode;
		this.composer = composer;
		this.scanner = scanner ?? null;
		this.hardwareAcceleration = hardwareAcceleration ?? 'no-preference';

		this.frameDurUs = Math.round(1_000_000 / fps);
		this.encoder = null;
		this.pump = null;
		this.codec = null;
		this.decoderConfig = null;
		this.error = null;
		this.closed = false;

		this.baseUs = null;
		this.lastTsUs = -1;
		this.lastKeyTsUs = -Infinity;
		this.framesSeen = 0;
		this.chunksOut = 0;
		this.encodeQueueMax = 0;
		this.feedWall = new Map(); // dấu thời gian khung → lúc đưa vào bộ mã hóa
		this.encodeMs = makeStat();

		this.pendingBegin = null; // clip đã quyết định bắt đầu, chờ khung kế tiếp
		this.feedClip = null; // clip đang nhận khung
		this.writeClip = null; // clip đang nhận gói đã mã hóa
		this.boundaries = []; // các clip đã có khung đầu, chờ gói khóa tương ứng đi ra
		this.clips = [];
	}

	async open() {
		const support = webCodecsSupport();
		if (!support.supported) throw new Error(support.reason);
		if (this.width % 2 || this.height % 2) throw new Error(`H.264 cần kích thước chẵn, camera trả ${this.width}×${this.height}`);

		let config = null;
		const tried = [];
		for (const codec of codecCandidates(this.width, this.height, this.fps)) {
			const candidate = {
				codec,
				width: this.width,
				height: this.height,
				bitrate: this.bitrate,
				framerate: this.fps,
				latencyMode: 'realtime',
				hardwareAcceleration: this.hardwareAcceleration,
				avc: { format: 'avc' }, // gói dạng AVCC + description (avcC) – đúng thứ MP4 cần
			};
			try {
				const result = await VideoEncoder.isConfigSupported(candidate);
				tried.push({ codec, supported: !!result.supported });
				if (result.supported) {
					config = candidate;
					break;
				}
			} catch (err) {
				tried.push({ codec, supported: false, error: errText(err) });
			}
		}
		this.triedCodecs = tried;
		if (!config) {
			throw new Error(`Bộ mã hóa H.264 không nhận cấu hình ${this.width}×${this.height}@${this.fps} (${this.hardwareAcceleration})`);
		}
		this.codec = config.codec;
		this.encoder = new VideoEncoder({
			output: (chunk, meta) => this.#onChunk(chunk, meta),
			error: (err) => this.#onEncoderError(err),
		});
		this.encoder.configure(config);
		if (this.overlay) {
			this.composer.resize(this.width, this.height);
			this.composer.resetStats();
		}
		this.pump = startPump({
			mode: this.pumpMode,
			track: this.track,
			video: this.video,
			onFrame: (source, tsUs) => this.#onFrame(source, tsUs),
		});
		log(`Mở đường quay WebCodecs: ${this.codec}, ${this.width}×${this.height}@${this.fps}, ${this.bitrate} bps, bơm khung ${this.pumpMode}`);
	}

	// Quyết định bắt đầu một clip mới. Nếu đang có clip thì đây là một lần CẮT: clip cũ tự kết thúc
	// đúng tại khung khóa đầu tiên của clip mới.
	beginClip(name, { fileName, decidedAtMs } = {}) {
		const clip = {
			name,
			fileName: fileName ?? `${name}.mp4`,
			decidedAtMs: decidedAtMs ?? performance.now(),
			isCut: !!this.feedClip,
			framesFed: 0,
			chunks: 0,
			keyChunks: 0,
			bytesEncoded: 0,
			droppedBeforeEncode: 0,
			boundaryTsUs: null,
			t0Us: null,
			lastTsUs: null,
			firstFrameWallMs: null,
			endedWallMs: null,
			msDecisionToFirstFrame: null,
			msDecisionToFirstChunk: null,
			keyNotHonoured: false,
			output: null,
			source: null,
			chain: Promise.resolve(),
			error: null,
			finishing: false,
			started: deferred(),
			done: deferred(),
		};
		if (this.closed || this.error) {
			const error = this.error ?? 'Đường quay đã đóng';
			clip.started.resolve({ ok: false, error });
			clip.done.resolve({ ok: false, name, error });
			return clip;
		}
		if (this.pendingBegin) this.#cancelPending('Bị thay bằng clip khác trước khi có khung hình');
		this.pendingBegin = clip;
		this.clips.push(clip);
		return clip;
	}

	// Kết thúc clip đang quay (không mở clip mới). Bộ mã hóa vẫn mở, sẵn sàng cho clip sau.
	async endClip() {
		if (this.pendingBegin) this.#cancelPending('Đã dừng trước khi có khung hình');
		const clip = this.feedClip;
		this.feedClip = null;
		if (!clip) return null;
		clip.endedWallMs = performance.now();
		try {
			if (this.encoder?.state === 'configured') await this.encoder.flush();
		} catch (err) {
			clip.error ??= `flush lỗi: ${errText(err)}`;
		}
		// Sau flush mọi gói của clip đã ra hết. Nếu trong lúc chờ đã có clip khác mở thì clip này
		// đã được đóng ở ranh giới; còn không thì đóng ở đây.
		if (this.writeClip === clip) {
			this.writeClip = null;
			this.#finishClip(clip);
		} else if (!clip.output && !clip.finishing) {
			this.boundaries = this.boundaries.filter((b) => b !== clip);
			clip.finishing = true;
			clip.done.resolve({ ok: false, name: clip.name, error: this.error ?? 'Clip không có khung hình nào được mã hóa' });
		}
		return clip.done.promise;
	}

	async close() {
		if (this.closed) return;
		await this.endClip().catch(() => {});
		this.closed = true;
		await this.pump?.stop().catch(() => {});
		try {
			if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
		} catch {
			// đã đóng
		}
		await Promise.all(this.clips.map((c) => c.done.promise));
		log('Đóng đường quay WebCodecs');
	}

	#cancelPending(reason) {
		const clip = this.pendingBegin;
		this.pendingBegin = null;
		if (!clip) return;
		clip.finishing = true;
		clip.started.resolve({ ok: false, error: reason });
		clip.done.resolve({ ok: false, name: clip.name, error: reason });
	}

	async #onFrame(source, tsUs) {
		this.framesSeen++;
		// Bộ đọc mã nhận khung GỐC của camera (không có ngày giờ). Phải chờ nó chụp xong rồi mới đi tiếp
		// vì khung sẽ bị đóng sau hàm này.
		if (this.scanner?.active) {
			const snap = this.scanner.offer(source, 'khung');
			if (snap) await snap;
		}
		if (this.closed || this.error) return;
		const pending = this.pendingBegin;
		if (!this.feedClip && !pending) return; // đang nghỉ giữa hai clip: không vẽ, không mã hóa
		const encoder = this.encoder;
		if (!encoder || encoder.state !== 'configured') return;

		if (encoder.encodeQueueSize > this.encodeQueueMax) this.encodeQueueMax = encoder.encodeQueueSize;
		if (encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
			(this.feedClip ?? pending).droppedBeforeEncode++;
			return;
		}

		if (this.baseUs === null) this.baseUs = tsUs;
		let ts = Math.round(tsUs - this.baseUs);
		if (ts <= this.lastTsUs) ts = this.lastTsUs + 1;
		this.lastTsUs = ts;

		let keyFrame = false;
		if (pending) {
			// Khung này là khung ĐẦU của clip mới → ép khung khóa và đánh dấu ranh giới.
			this.pendingBegin = null;
			keyFrame = true;
			pending.boundaryTsUs = ts;
			pending.firstFrameWallMs = performance.now();
			pending.msDecisionToFirstFrame = pending.firstFrameWallMs - pending.decidedAtMs;
			if (this.feedClip) this.feedClip.endedWallMs = pending.firstFrameWallMs;
			this.boundaries.push(pending);
			this.feedClip = pending;
			pending.started.resolve({ ok: true, msDecisionToFirstFrame: round(pending.msDecisionToFirstFrame, 1) });
		} else if (ts - this.lastKeyTsUs >= KEY_FRAME_INTERVAL_US - this.frameDurUs / 2) {
			keyFrame = true;
		}
		if (keyFrame) this.lastKeyTsUs = ts;

		let frame;
		if (this.overlay) {
			this.composer.draw(source, true);
			frame = new VideoFrame(this.composer.canvas, { timestamp: ts, duration: this.frameDurUs, alpha: 'discard' });
		} else {
			// Tắt ngày giờ: đưa thẳng khung camera vào bộ mã hóa, không qua canvas.
			frame = new VideoFrame(source, { timestamp: ts, duration: this.frameDurUs });
		}
		try {
			this.feedWall.set(ts, performance.now());
			encoder.encode(frame, { keyFrame });
			this.feedClip.framesFed++;
		} finally {
			frame.close();
		}
		if (this.feedWall.size > 600) this.feedWall.clear(); // bộ mã hóa bỏ khung thì không dọn được, tránh phình
	}

	#onChunk(chunk, meta) {
		this.chunksOut++;
		counters.encodedChunks++;
		if (meta?.decoderConfig) this.decoderConfig = meta.decoderConfig;
		const fedAt = this.feedWall.get(chunk.timestamp);
		if (fedAt !== undefined) {
			this.encodeMs.add(performance.now() - fedAt);
			this.feedWall.delete(chunk.timestamp);
		}

		// Tới ranh giới: gói này là khung khóa đầu tiên của clip mới → đóng clip cũ, mở tệp mới.
		while (this.boundaries.length && chunk.timestamp >= this.boundaries[0].boundaryTsUs) {
			const next = this.boundaries[0];
			if (chunk.type !== 'key') {
				if (!next.keyNotHonoured) {
					next.keyNotHonoured = true;
					log(`Bộ mã hóa không trả khung khóa đúng chỗ cắt (clip ${next.name}) – chờ khung khóa kế tiếp`, undefined, 'warn');
				}
				break;
			}
			this.boundaries.shift();
			if (this.writeClip) this.#finishClip(this.writeClip);
			this.#openWriter(next, chunk.timestamp);
			next.msDecisionToFirstChunk = performance.now() - next.decidedAtMs;
			this.writeClip = next;
		}

		const clip = this.writeClip;
		if (!clip) return;
		const data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);
		// Dời mốc thời gian để mỗi clip bắt đầu từ 0.
		const packet = new EncodedPacket(
			data,
			chunk.type,
			(chunk.timestamp - clip.t0Us) / 1e6,
			(chunk.duration ?? this.frameDurUs) / 1e6,
		);
		clip.chunks++;
		if (chunk.type === 'key') clip.keyChunks++;
		clip.bytesEncoded += data.byteLength;
		clip.lastTsUs = chunk.timestamp;
		// Gói đầu của mỗi tệp phải kèm decoderConfig (có avcC) – lấy lại cái bộ mã hóa đưa lúc đầu.
		const packetMeta = clip.chunks === 1 ? { decoderConfig: this.decoderConfig } : undefined;
		clip.chain = clip.chain.then(async () => {
			if (clip.error) return;
			try {
				await clip.source.add(packet, packetMeta);
			} catch (err) {
				clip.error = `Ghép MP4 lỗi: ${errText(err)}`;
				log(clip.error, undefined, 'error');
			}
		});
	}

	#openWriter(clip, t0Us) {
		clip.t0Us = t0Us;
		clip.source = new EncodedVideoPacketSource('avc');
		clip.output = new Output({
			// 'in-memory': giữ dữ liệu trong RAM tới lúc kết thúc rồi viết moov TRƯỚC mdat (fast start),
			// tệp MP4 thường, tua được, không phân mảnh.
			format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
			target: new BufferTarget(),
		});
		clip.output.addVideoTrack(clip.source);
		clip.chain = clip.output.start().catch((err) => {
			clip.error = `Không mở được tệp MP4: ${errText(err)}`;
		});
	}

	#finishClip(clip) {
		if (clip.finishing) return;
		clip.finishing = true;
		clip.endedWallMs ??= performance.now();
		clip.chain
			.then(async () => {
				if (clip.error) throw new Error(clip.error);
				if (!clip.chunks) {
					await clip.output.cancel().catch(() => {});
					throw new Error('Clip không có khung hình nào');
				}
				const t0 = performance.now();
				await clip.output.finalize();
				const buffer = clip.output.target.buffer;
				const finalizeMs = performance.now() - t0;
				let mime = 'video/mp4';
				try {
					mime = await clip.output.getMimeType();
				} catch {
					// giữ mặc định
				}
				const mp4 = describeMp4(buffer);
				const saved = await saveToServer(clip.fileName, buffer, 'video/mp4');
				const mediaSeconds = (clip.lastTsUs - clip.t0Us + this.frameDurUs) / 1e6;
				// Số khung lẽ ra phải có nếu camera giữ đúng nhịp yêu cầu suốt clip.
				const expectedFrames = Math.round(mediaSeconds * this.fps);
				return {
					ok: true,
					path: 'webcodecs',
					name: clip.name,
					fileName: saved.name,
					savedPath: saved.path,
					bytes: saved.bytes,
					mime,
					codec: this.codec,
					width: this.width,
					height: this.height,
					wallSeconds: round((clip.endedWallMs - clip.firstFrameWallMs) / 1000, 2),
					mediaSeconds: round(mediaSeconds, 2),
					framesFed: clip.framesFed,
					framesEncoded: clip.chunks,
					keyFrames: clip.keyChunks,
					droppedBeforeEncode: clip.droppedBeforeEncode,
					droppedByEncoder: Math.max(0, clip.framesFed - clip.chunks),
					expectedFrames,
					// Khung không tới được đường quay (camera chậm, hoặc luồng chính bận nên bơm khung bỏ sót).
					missingVsRequestedFps: Math.max(0, expectedFrames - clip.framesFed - clip.droppedBeforeEncode),
					boxOrder: mp4.boxOrder,
					moovBeforeMdat: mp4.moovBeforeMdat,
					fragmented: mp4.fragmented,
					finalizeMs: round(finalizeMs, 1),
					uploadMs: saved.uploadMs,
					isCut: clip.isCut,
					msDecisionToFirstFrame: round(clip.msDecisionToFirstFrame, 1),
					msDecisionToFirstChunk: round(clip.msDecisionToFirstChunk, 1),
					keyFrameAtCut: !clip.keyNotHonoured,
				};
			})
			.then(
				(result) => {
					log(`Đã lưu clip ${result.fileName}: ${result.mediaSeconds} giây, ${result.bytes} byte, ${result.framesEncoded} khung`);
					clip.done.resolve(result);
				},
				(err) => {
					const error = errText(err);
					log(`Clip ${clip.name} hỏng: ${error}`, undefined, 'error');
					clip.done.resolve({ ok: false, path: 'webcodecs', name: clip.name, error });
				},
			);
	}

	#onEncoderError(err) {
		this.error = `Bộ mã hóa lỗi: ${errText(err)}`;
		log(this.error, undefined, 'error');
		// Cứu phần đã quay được.
		if (this.pendingBegin) this.#cancelPending(this.error);
		for (const clip of this.boundaries) {
			clip.finishing = true;
			clip.done.resolve({ ok: false, name: clip.name, error: this.error });
		}
		this.boundaries = [];
		this.feedClip = null;
		if (this.writeClip) {
			const clip = this.writeClip;
			this.writeClip = null;
			this.#finishClip(clip);
		}
	}

	stats() {
		return {
			codec: this.codec,
			triedCodecs: this.triedCodecs ?? null,
			hardwareAcceleration: this.hardwareAcceleration,
			latencyMode: 'realtime',
			keyFrameEverySeconds: KEY_FRAME_INTERVAL_US / 1e6,
			bitrate: this.bitrate,
			overlay: this.overlay,
			pumpMode: this.pumpMode,
			framesSeen: this.framesSeen,
			chunksOut: this.chunksOut,
			encodeQueueMax: this.encodeQueueMax,
			encodeMs: this.encodeMs.toJSON(),
			pump: this.pump ? { ...this.pump.stats } : null,
			error: this.error,
		};
	}
}
