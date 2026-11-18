// M0 — đo nhiều bàn trên MỘT máy (docs/VIDEO-DONG-HANG-THIET-KE.md mục 18). Không phải mã sản phẩm.
//
// Mỗi camera thật = một "bàn": khung camera → canvas in ngày giờ → VideoEncoder H.264 → mediabunny ghép MP4
// → ghi THẲNG xuống OPFS (ổ đĩa riêng của trang) qua StreamTarget. RAM không phình theo độ dài clip.
// Clip tự cắt mỗi N giây; clip lẻ để `moov` ĐẦU tệp bằng cách dành chỗ trước ('reserve'), clip chẵn để `moov`
// CUỐI tệp (fastStart: false) — để so hai cách. Song song: đọc tem trong Worker mỗi 200 ms như màn quay thật.
//
// Số đo ghi ra máy chủ thử (`POST /save`) mỗi 10 giây: m0_<giờ>.json — đọc được ngay cả khi tab sập.

import {
	EncodedPacket,
	EncodedVideoPacketSource,
	Mp4OutputFormat,
	Output,
	StreamTarget,
} from '/node_modules/mediabunny/dist/bundles/mediabunny.mjs';
import { Composer } from './modules/composer.js';
import { describeMp4, errText, fileStamp, makeStat, onLog, round, saveToServer } from './modules/core.js';
import { startPump } from './modules/pump.js';
import { Scanner } from './modules/scanner.js';

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const BITRATE = 800_000;
const KEY_US = 1_000_000;
const MAX_ENCODE_QUEUE = 10;
/** Dành chỗ cho `moov` theo trần 60 phút một clip (số tự chọn ở mục 52 khảo sát), cộng 33 % như mediabunny khuyên. */
const RESERVE_MAX_PACKETS = Math.ceil(FPS * 60 * 60 * 1.33);
const STREAM_CHUNK = 1 << 20; // ghi xuống ổ theo khúc 1 MiB
const KEEP_CLIPS_PER_MODE = 2; // giữ vài clip mỗi kiểu để soi (gửi về máy chủ thử); còn lại xóa như "đã tải lên"
const REPORT_EVERY_MS = 10_000;

const $ = (id) => document.getElementById(id);
const RUN_ID = fileStamp();
const events = []; // sự kiện thiết bị: rớt camera, đổi thiết bị…
const logLines = [];

function note(level, msg, data) {
	const line = { t: new Date().toISOString(), level, msg, ...(data ? { data } : {}) };
	logLines.push(line);
	if (logLines.length > 2000) logLines.shift();
	const el = $('log');
	el.textContent = `${line.t.slice(11, 19)} [${level}] ${msg}\n` + el.textContent.slice(0, 20000);
}
onLog((entry) => note(entry.level ?? 'info', entry.msg ?? String(entry)));

let opfsDir = null;
async function dir() {
	if (!opfsDir) {
		const root = await navigator.storage.getDirectory();
		opfsDir = await root.getDirectoryHandle('m0', { create: true });
	}
	return opfsDir;
}

class Station {
	constructor(index, device) {
		this.index = index;
		this.label = device.label || `camera ${index}`;
		this.deviceId = device.deviceId;
		this.track = null;
		this.state = 'chưa mở';
		this.composer = new Composer();
		this.scanner = new Scanner({ boxCanvas: null });
		this.encoder = null;
		this.encoderInfo = null;
		this.pump = null;
		this.clip = null;
		this.clipNo = 0;
		this.cutPending = false;
		this.decoderConfig = null;
		this.done = [];
		this.kept = { reserve: 0, end: 0 };
		this.reset();
		this.buildCell();
	}

	reset() {
		this.framesIn = 0;
		this.framesEncoded = 0;
		this.droppedQueue = 0;
		this.queueMax = 0;
		this.encodeMs = makeStat();
		this.drawMs = makeStat();
		this.feedWall = new Map();
		this.baseUs = null;
		this.lastTs = -1;
		this.lastKeyTs = -Infinity;
		this.encoderErrors = 0;
		this.lastEncoderError = null;
		this.codes = 0;
		this.windowFrames = 0;
		this.windowStart = performance.now();
		this.fpsNow = 0;
		this.fpsMin = Infinity;
	}

	buildCell() {
		const cell = document.createElement('div');
		cell.className = 'cell';
		cell.innerHTML = `<h2>Bàn ${this.index} — ${this.label}</h2><video muted playsinline autoplay></video><div class="state"></div><pre></pre>`;
		$('grid').append(cell);
		this.video = cell.querySelector('video');
		this.stateEl = cell.querySelector('.state');
		this.pre = cell.querySelector('pre');
	}

	async openCamera() {
		const stream = await navigator.mediaDevices.getUserMedia({
			video: { deviceId: { exact: this.deviceId }, width: { ideal: WIDTH }, height: { ideal: HEIGHT }, frameRate: { ideal: FPS } },
			audio: false,
		});
		this.track = stream.getVideoTracks()[0];
		this.video.srcObject = stream;
		this.settings = this.track.getSettings();
		this.track.addEventListener('ended', () => {
			events.push({ t: new Date().toISOString(), station: this.index, event: 'track-ended' });
			this.state = 'MẤT CAMERA';
			note('error', `Bàn ${this.index}: mất camera (track ended)`);
			void this.closeClip('mất camera');
		});
		this.track.addEventListener('mute', () => events.push({ t: new Date().toISOString(), station: this.index, event: 'mute' }));
		this.track.addEventListener('unmute', () => events.push({ t: new Date().toISOString(), station: this.index, event: 'unmute' }));
		this.state = 'camera mở';
		note('info', `Bàn ${this.index}: mở ${this.settings.width}×${this.settings.height}@${this.settings.frameRate}`);
	}

	async start(hw) {
		this.reset();
		const w = this.settings.width;
		const h = this.settings.height;
		this.composer.resize(w, h);
		const candidates = ['avc1.64001f', 'avc1.4d401f', 'avc1.42e01f', 'avc1.640028'];
		const tried = [];
		let config = null;
		for (const codec of candidates) {
			const c = { codec, width: w, height: h, bitrate: BITRATE, framerate: FPS, latencyMode: 'realtime', hardwareAcceleration: hw, avc: { format: 'avc' } };
			const r = await VideoEncoder.isConfigSupported(c).catch((e) => ({ supported: false, error: errText(e) }));
			tried.push({ codec, supported: !!r.supported });
			if (r.supported) {
				config = c;
				break;
			}
		}
		if (!config) throw new Error(`Bàn ${this.index}: bộ mã hóa không nhận cấu hình (${hw})`);
		this.encoderInfo = { codec: config.codec, hardwareAcceleration: hw, tried };
		this.encoder = new VideoEncoder({
			output: (chunk, meta) => this.onChunk(chunk, meta),
			error: (err) => {
				this.encoderErrors++;
				this.lastEncoderError = errText(err);
				note('error', `Bàn ${this.index}: bộ mã hóa lỗi — ${this.lastEncoderError}`);
			},
		});
		this.encoder.configure(config);
		if (!this.scanner.info.ready) await this.scanner.init();
		this.scanner.start({ video: this.video, usePumpFrames: true, onRead: (codes) => (this.codes += codes.length) });
		this.cutPending = true; // khung đầu mở clip 1
		this.pump = startPump({ mode: 'mstp', track: this.track, video: this.video, onFrame: (f, ts) => this.onFrame(f, ts) });
		this.state = 'đang quay';
	}

	async onFrame(source, tsUs) {
		this.framesIn++;
		this.windowFrames++;
		const enc = this.encoder;
		if (!enc || enc.state !== 'configured') return;
		const scan = this.scanner.offer(source, 'pump');
		if (this.baseUs === null) this.baseUs = tsUs;
		let ts = Math.round(tsUs - this.baseUs);
		if (ts <= this.lastTs) ts = this.lastTs + 1;
		this.lastTs = ts;
		this.queueMax = Math.max(this.queueMax, enc.encodeQueueSize);
		if (enc.encodeQueueSize > MAX_ENCODE_QUEUE && !this.cutPending) {
			this.droppedQueue++;
			if (scan) await scan;
			return;
		}
		let keyFrame = ts - this.lastKeyTs >= KEY_US - 16_000;
		if (this.cutPending) {
			this.cutPending = false;
			keyFrame = true;
			this.cutAtTs = ts;
		}
		if (keyFrame) this.lastKeyTs = ts;
		const t0 = performance.now();
		this.composer.draw(source, true);
		const frame = new VideoFrame(this.composer.canvas, { timestamp: ts, duration: Math.round(1e6 / FPS), alpha: 'discard' });
		this.drawMs.add(performance.now() - t0);
		try {
			this.feedWall.set(ts, performance.now());
			enc.encode(frame, { keyFrame });
		} finally {
			frame.close();
		}
		if (this.feedWall.size > 600) this.feedWall.clear();
		if (scan) await scan;
	}

	onChunk(chunk, meta) {
		this.framesEncoded++;
		if (meta?.decoderConfig) this.decoderConfig = meta.decoderConfig;
		const fed = this.feedWall.get(chunk.timestamp);
		if (fed !== undefined) {
			this.encodeMs.add(performance.now() - fed);
			this.feedWall.delete(chunk.timestamp);
		}
		if (this.cutAtTs !== null && this.cutAtTs !== undefined && chunk.timestamp >= this.cutAtTs && chunk.type === 'key') {
			this.cutAtTs = null;
			const old = this.clip;
			this.clip = this.openClip(chunk.timestamp);
			if (old) void this.finishClip(old);
		}
		const clip = this.clip;
		if (!clip) return;
		const data = new Uint8Array(chunk.byteLength);
		chunk.copyTo(data);
		const packet = new EncodedPacket(data, chunk.type, (chunk.timestamp - clip.t0) / 1e6, (chunk.duration ?? 33_333) / 1e6);
		const first = clip.packets === 0;
		clip.packets++;
		clip.payload += data.byteLength;
		clip.chain = clip.chain.then(() => (clip.error ? null : clip.source.add(packet, first ? { decoderConfig: this.decoderConfig } : undefined))).catch((e) => {
			clip.error = errText(e);
		});
	}

	openClip(t0) {
		this.clipNo++;
		const mode = this.clipNo % 2 === 1 ? 'reserve' : 'end';
		const name = `${RUN_ID}_ban${this.index}_${String(this.clipNo).padStart(3, '0')}_${mode}.mp4`;
		const clip = { no: this.clipNo, mode, name, t0, packets: 0, payload: 0, startedWall: performance.now(), writes: 0, writeMs: makeStat(), error: null };
		clip.source = new EncodedVideoPacketSource('avc');
		clip.chain = (async () => {
			const fh = await (await dir()).getFileHandle(name, { create: true });
			clip.fileHandle = fh;
			const writable = await fh.createWritable();
			clip.writable = writable;
			// Bọc để đo thời gian mỗi lần ghi xuống ổ.
			const timed = new WritableStream({
				async write(chunk) {
					const s = performance.now();
					await writable.write(chunk);
					clip.writes++;
					clip.writeMs.add(performance.now() - s);
				},
				async close() {
					await writable.close();
				},
				async abort(reason) {
					await writable.abort(reason);
				},
			});
			clip.output = new Output({
				format: new Mp4OutputFormat({ fastStart: mode === 'reserve' ? 'reserve' : false }),
				target: new StreamTarget(timed, { chunked: true, chunkSize: STREAM_CHUNK }),
			});
			// ⚠️ KHÔNG khai `frameRate`: mediabunny sẽ "bắt" mốc thời gian về lưới 1/30 giây, khung camera lệch nhịp
			// rơi trùng mốc → tệp có hai khung cùng giờ (đo 18/11). Mã sản phẩm (clip-pipeline.ts) cũng không khai.
			clip.output.addVideoTrack(clip.source, mode === 'reserve' ? { maximumPacketCount: RESERVE_MAX_PACKETS } : {});
			await clip.output.start();
		})().catch((e) => {
			clip.error = `mở tệp lỗi: ${errText(e)}`;
		});
		return clip;
	}

	async finishClip(clip) {
		const s = performance.now();
		await clip.chain;
		if (!clip.error) {
			try {
				await clip.output.finalize();
			} catch (e) {
				clip.error = `finalize lỗi: ${errText(e)}`;
			}
		}
		// Chưa chắc mediabunny tự đóng luồng ghi khi finalize: OPFS chỉ "chốt" tệp khi luồng đóng → đóng chắc.
		try {
			await clip.writable?.close();
		} catch {
			// đã đóng rồi
		}
		const finalizeMs = performance.now() - s;
		let fileBytes = null;
		let boxes = null;
		let keptAs = null;
		try {
			const file = await clip.fileHandle.getFile();
			fileBytes = file.size;
			if (this.kept[clip.mode] < KEEP_CLIPS_PER_MODE && !clip.error) {
				const buf = await file.arrayBuffer();
				boxes = describeMp4(buf);
				const saved = await saveToServer(clip.name, buf, 'video/mp4');
				keptAs = saved.name;
				this.kept[clip.mode]++;
			}
			await (await dir()).removeEntry(clip.name); // "đã tải lên" → xóa khỏi ổ
		} catch (e) {
			clip.error ??= `đọc / xóa tệp lỗi: ${errText(e)}`;
		}
		const durSec = (performance.now() - clip.startedWall) / 1000;
		const rec = {
			no: clip.no,
			mode: clip.mode,
			name: clip.name,
			seconds: round(durSec, 1),
			packets: clip.packets,
			payloadBytes: clip.payload,
			fileBytes,
			overheadBytes: fileBytes === null ? null : fileBytes - clip.payload,
			mbPerMin: fileBytes === null ? null : round(fileBytes / 1048576 / (durSec / 60), 2),
			writes: clip.writes,
			writeMs: clip.writeMs.toJSON(),
			finalizeMs: round(finalizeMs, 1),
			boxes,
			keptAs,
			error: clip.error,
		};
		this.done.push(rec);
		note(clip.error ? 'error' : 'info', `Bàn ${this.index}: xong clip ${clip.no} (${clip.mode}) ${rec.seconds}s, ${fileBytes ?? '?'} byte, đệm ${rec.overheadBytes ?? '?'}${clip.error ? ' — ' + clip.error : ''}`);
	}

	cut() {
		this.cutPending = true;
	}

	async closeClip(reason) {
		const c = this.clip;
		this.clip = null;
		if (c) {
			note('warn', `Bàn ${this.index}: đóng clip ${c.no} vì ${reason}`);
			await this.finishClip(c);
		}
	}

	async stop() {
		await this.pump?.stop();
		this.pump = null;
		this.scanner.stop();
		try {
			await this.encoder?.flush();
		} catch {
			// đã đóng
		}
		await this.closeClip('dừng đo');
		try {
			this.encoder?.close();
		} catch {
			// đã đóng
		}
		this.encoder = null;
		if (this.state !== 'MẤT CAMERA') this.state = 'đã dừng';
	}

	tick() {
		const now = performance.now();
		const span = (now - this.windowStart) / 1000;
		if (span >= 1) {
			this.fpsNow = this.windowFrames / span;
			if (this.state === 'đang quay' && this.framesIn > FPS * 3) this.fpsMin = Math.min(this.fpsMin, this.fpsNow);
			this.windowFrames = 0;
			this.windowStart = now;
		}
	}

	snapshot() {
		const s = this.scanner.stats();
		return {
			station: this.index,
			label: this.label,
			state: this.state,
			settings: this.settings ? { width: this.settings.width, height: this.settings.height, frameRate: this.settings.frameRate } : null,
			encoder: this.encoderInfo,
			fpsNow: round(this.fpsNow, 1),
			fpsMin: Number.isFinite(this.fpsMin) ? round(this.fpsMin, 1) : null,
			framesIn: this.framesIn,
			framesEncoded: this.framesEncoded,
			droppedQueue: this.droppedQueue,
			encodeQueueMax: this.queueMax,
			encodeMs: this.encodeMs.toJSON(),
			drawMs: this.drawMs.toJSON(),
			encoderErrors: this.encoderErrors,
			lastEncoderError: this.lastEncoderError,
			scan: { attempts: s.attempts, successes: s.successes, skippedBusy: s.skippedBusy, errors: s.errors, decodeMs: s.decodeMs, codesRead: this.codes },
			clipOpen: this.clip ? { no: this.clip.no, mode: this.clip.mode, packets: this.clip.packets, payloadBytes: this.clip.payload } : null,
			clipsDone: this.done,
		};
	}

	render() {
		const s = this.snapshot();
		this.stateEl.textContent = `${this.state} · ${s.fpsNow} khung/giây (thấp nhất ${s.fpsMin ?? '–'})`;
		this.stateEl.className = `state ${this.state === 'MẤT CAMERA' || s.encoderErrors ? 'bad' : this.state === 'đang quay' ? 'ok' : ''}`;
		const last = this.done.at(-1);
		this.pre.textContent = [
			`mã hóa: ${s.encoder?.codec ?? '–'} (${s.encoder?.hardwareAcceleration ?? '–'})`,
			`khung vào ${s.framesIn} · đã mã hóa ${s.framesEncoded} · bỏ vì dồn ${s.droppedQueue} · hàng chờ lớn nhất ${s.encodeQueueMax}`,
			`mã hóa ms tb ${s.encodeMs.avg ?? '–'} / max ${s.encodeMs.max ?? '–'} · vẽ ms tb ${s.drawMs.avg ?? '–'}`,
			`đọc tem: ${s.scan.attempts} lần, giải mã tb ${s.scan.decodeMs?.avg ?? '–'} ms, bỏ lượt ${s.scan.skippedBusy}, đọc được ${s.scan.codesRead}`,
			`clip: ${this.done.length} xong${s.clipOpen ? ` · đang ${s.clipOpen.no} (${s.clipOpen.mode})` : ''}`,
			last ? `clip cuối: ${last.mode} ${last.seconds}s ${last.fileBytes} B, đệm ${last.overheadBytes} B, ghi ${last.writes} lần tb ${last.writeMs.avg} ms` : '',
		].join('\n');
	}
}

const run = {
	stations: [],
	running: false,
	startedAt: null,
	endsAt: null,
	cutTimer: null,
	reportTimer: null,
	uiTimer: null,
	persisted: null,
	reportName: `m0_${RUN_ID}.json`,
};

async function openAll() {
	// Xin quyền một lần để có tên thiết bị.
	const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
	probe.getTracks().forEach((t) => t.stop());
	const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
	const real = devices.filter((d) => !/obs|virtual|lsvcam/i.test(d.label));
	note('info', `Chrome thấy ${devices.length} nguồn hình, dùng ${real.length}: ${real.map((d) => d.label).join(' | ')}`);
	for (const s of run.stations) await s.stop().catch(() => {});
	run.stations.forEach((s) => s.track?.stop());
	$('grid').innerHTML = '';
	run.stations = real.map((d, i) => new Station(i + 1, d));
	for (const s of run.stations) {
		try {
			await s.openCamera();
		} catch (e) {
			s.state = `mở lỗi: ${errText(e)}`;
			note('error', `Bàn ${s.index}: ${s.state}`);
		}
	}
	run.persisted = navigator.storage.persist ? await navigator.storage.persist() : null;
	startUi();
	return run.stations.map((s) => ({ station: s.index, label: s.label, state: s.state, settings: s.settings }));
}

/**
 * Thêm bàn "nhân bản" để đo 4–6 luồng khi máy chỉ có 2–3 camera: Chrome cho mở lại CÙNG một thiết bị (dùng chung luồng),
 * mỗi bàn nhân bản vẫn có bộ in ngày giờ + bộ mã hóa + bộ đọc tem + tệp riêng → tải mã hóa / đọc tem / ghi ổ là thật,
 * chỉ phần USB là không nhân lên.
 */
async function addClones(total) {
	const live = run.stations.filter((s) => s.track && s.track.readyState === 'live' && !s.cloneOf);
	if (!live.length) throw new Error('Chưa có camera nào mở');
	let i = 0;
	while (run.stations.length < total) {
		const src = live[i++ % live.length];
		const s = new Station(run.stations.length + 1, { deviceId: src.deviceId, label: `${src.label} · nhân bản` });
		s.cloneOf = src.index;
		try {
			await s.openCamera();
		} catch (e) {
			s.state = `mở lỗi: ${errText(e)}`;
		}
		run.stations.push(s);
	}
	return run.stations.map((s) => `${s.index}: ${s.label} — ${s.state}`);
}

async function startAll({ hw, clipSeconds, minutes } = {}) {
	hw ??= $('sel-hw').value;
	clipSeconds ??= Number($('inp-clip').value) || 60;
	minutes ??= Number($('inp-minutes').value) || 30;
	if (run.running) await stopAll();
	const usable = run.stations.filter((s) => s.track && s.track.readyState === 'live');
	for (const s of usable) {
		try {
			await s.start(hw);
		} catch (e) {
			s.state = `bắt đầu lỗi: ${errText(e)}`;
			note('error', s.state);
		}
	}
	run.running = true;
	run.config = { hw, clipSeconds, minutes, width: WIDTH, height: HEIGHT, fps: FPS, bitrate: BITRATE, reserveMaxPackets: RESERVE_MAX_PACKETS };
	run.startedAt = new Date().toISOString();
	run.endsAt = Date.now() + minutes * 60_000;
	run.cutTimer = setInterval(() => {
		if (Date.now() >= run.endsAt) {
			void stopAll();
			return;
		}
		for (const s of run.stations) if (s.state === 'đang quay') s.cut();
	}, clipSeconds * 1000);
	run.reportTimer = setInterval(() => void report(), REPORT_EVERY_MS);
	note('info', `Bắt đầu đo ${usable.length} bàn, ${hw}, clip ${clipSeconds} giây, ${minutes} phút`);
	return run.config;
}

async function stopAll() {
	clearInterval(run.cutTimer);
	clearInterval(run.reportTimer);
	run.running = false;
	for (const s of run.stations) await s.stop().catch((e) => note('error', errText(e)));
	run.stoppedAt = new Date().toISOString();
	await report();
	note('info', 'Đã dừng đo');
	return summary();
}

async function globalStats() {
	const est = navigator.storage.estimate ? await navigator.storage.estimate() : null;
	let opfsFiles = 0;
	try {
		for await (const _ of (await dir()).keys()) opfsFiles++;
	} catch {
		opfsFiles = null;
	}
	const mem = performance.memory;
	return {
		now: new Date().toISOString(),
		running: run.running,
		hidden: document.hidden,
		persisted: run.persisted,
		storage: est ? { usageMB: round(est.usage / 1048576, 1), quotaGB: round(est.quota / 1073741824, 1) } : null,
		opfsFiles,
		jsHeapMB: mem ? round(mem.usedJSHeapSize / 1048576, 1) : null,
		events,
	};
}

async function report() {
	const body = JSON.stringify({ run: { id: RUN_ID, config: run.config, startedAt: run.startedAt, stoppedAt: run.stoppedAt ?? null }, global: await globalStats(), stations: run.stations.map((s) => s.snapshot()), log: logLines.slice(-300) }, null, 1);
	try {
		await saveToServer(run.reportName, new Blob([body], { type: 'application/json' }), 'application/json');
	} catch (e) {
		note('warn', `Không ghi được báo cáo: ${errText(e)}`);
	}
}

function summary() {
	return run.stations.map((s) => {
		const x = s.snapshot();
		return { station: x.station, state: x.state, enc: x.encoder?.codec, fpsMin: x.fpsMin, framesIn: x.framesIn, encoded: x.framesEncoded, dropped: x.droppedQueue, errs: x.encoderErrors, clips: x.clipsDone.length };
	});
}

let uiStarted = false;
function startUi() {
	if (uiStarted) return;
	uiStarted = true;
	run.uiTimer = setInterval(async () => {
		for (const s of run.stations) {
			s.tick();
			s.render();
		}
		const g = await globalStats();
		$('global').textContent = `ổ trình duyệt: dùng ${g.storage?.usageMB ?? '?'} MB / hạn ${g.storage?.quotaGB ?? '?'} GB · giữ lâu dài (persist): ${g.persisted} · tệp OPFS: ${g.opfsFiles} · JS heap ${g.jsHeapMB} MB · tab ẩn: ${g.hidden}\nsự kiện thiết bị: ${g.events.length ? JSON.stringify(g.events.slice(-5)) : 'không có'}${run.running ? `\ncòn ${Math.max(0, Math.round((run.endsAt - Date.now()) / 1000))} giây` : ''}`;
	}, 1000);
}

/** Tua thử một tệp đã lưu: nạp từ máy chủ thử (có Range), nhảy tới giữa rồi gần cuối, đo thời gian. */
async function testSeek(name) {
	const v = document.createElement('video');
	v.muted = true;
	v.preload = 'metadata';
	const t0 = performance.now();
	const waitFor = (ev) => new Promise((res, rej) => {
		const to = setTimeout(() => rej(new Error(`chờ ${ev} quá 15 giây`)), 15000);
		v.addEventListener(ev, () => { clearTimeout(to); res(); }, { once: true });
		v.addEventListener('error', () => { clearTimeout(to); rej(new Error(`lỗi phát: ${v.error?.code}`)); }, { once: true });
	});
	v.src = `/out/${encodeURIComponent(name)}`;
	await waitFor('loadedmetadata');
	const metaMs = performance.now() - t0;
	const duration = v.duration;
	const s1 = performance.now();
	v.currentTime = duration / 2;
	await waitFor('seeked');
	const midMs = performance.now() - s1;
	const s2 = performance.now();
	v.currentTime = Math.max(0, duration - 1);
	await waitFor('seeked');
	const endMs = performance.now() - s2;
	v.removeAttribute('src');
	v.load();
	return { name, duration: round(duration, 2), metadataMs: round(metaMs, 1), seekMidMs: round(midMs, 1), seekEndMs: round(endMs, 1), size: `${v.videoWidth}x${v.videoHeight}` };
}

navigator.mediaDevices.addEventListener('devicechange', () => {
	events.push({ t: new Date().toISOString(), event: 'devicechange' });
	note('warn', 'Windows báo đổi thiết bị (devicechange)');
});
document.addEventListener('visibilitychange', () => events.push({ t: new Date().toISOString(), event: document.hidden ? 'tab-hidden' : 'tab-visible' }));

$('btn-open').addEventListener('click', () => openAll().catch((e) => note('error', errText(e))));
$('btn-start').addEventListener('click', () => startAll().catch((e) => note('error', errText(e))));
$('btn-stop').addEventListener('click', () => stopAll().catch((e) => note('error', errText(e))));

window.__m0 = { run, openAll, addClones, startAll, stopAll, summary, testSeek, report, globalStats };
note('info', `Sẵn sàng. Báo cáo ghi ra ${run.reportName}`);
