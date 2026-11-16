// Trang thử quay video đóng hàng bằng webcam – điều phối năm cửa.
// Mọi kết quả đều nằm ở window.__thu để phiên điều khiển đọc bằng JavaScript:
//   __thu.state  – trạng thái + kết quả từng cửa (JSON thuần)
//   __thu.log    – nhật ký
//   __thu.run.*  – các hàm chạy thử, hàm nào cũng trả Promise ra một đối tượng JSON thuần, không ném lỗi.

import { AutoCut, looksLikeTracking } from './modules/auto-cut.js';
import { Composer } from './modules/composer.js';
import { counters, errText, fileStamp, log, logEntries, onLog, round, sleep, toPlain } from './modules/core.js';
import { FAKE_CAMERA_LABEL, createFakeCamera } from './modules/fake-camera.js';
import { mediaRecorderSupport, recordWithMediaRecorder } from './modules/mr-recorder.js';
import { resolvePumpMode, supportedPumpModes } from './modules/pump.js';
import { SCAN_INTERVAL_MS, Scanner } from './modules/scanner.js';
import { audioState, playAlarm, playBoop, playDone, playTing, unlockAudio } from './modules/sound.js';
import { createUi } from './modules/ui.js';

const FAKE_ID = '__fake__';
const RESOLUTIONS = [
	[1280, 720],
	[1920, 1080],
	[2560, 1440],
];

// Ngưỡng đạt / không đạt. Tất cả là mặc định TỰ CHỌN cho trang thử (không lấy từ tài liệu nào) – xem README.
const THRESHOLDS = {
	fpsRatio: 0.9, // tốc độ khung đo được ≥ 90 % tốc độ yêu cầu
	framesRatio: 0.8, // số khung mã hóa ≥ 80 % số khung lẽ ra phải có
	drawBudgetRatio: 0.5, // vẽ canvas trung bình ≤ một nửa khoảng cách giữa hai khung
	overlayFramesRatio: 0.9, // có ngày giờ vẫn giữ ≥ 90 % số khung so với không có
	scanAttemptRatio: 0.7, // số lần thử đọc ≥ 70 % nhịp 200 ms
	cutMaxMs: 200, // từ lúc quyết định cắt tới khung đầu của clip mới ≤ 200 ms (một nhịp đọc mã)
};

const state = {
	page: { url: location.href, userAgent: navigator.userAgent, loadedAt: new Date().toISOString() },
	thresholds: THRESHOLDS,
	options: null,
	support: null,
	cameras: [],
	camera: null,
	busy: null,
	gates: {
		1: { status: 'not-run', reason: null, result: null },
		2: {
			status: 'not-run',
			reason: null,
			a: { status: 'not-run', reason: null, result: null },
			b: { status: 'not-run', reason: null, result: null },
		},
		3: { status: 'not-run', reason: null, result: null },
		4: { status: 'not-run', reason: null, result: null },
		5: { status: 'not-run', reason: null, result: null },
	},
	scan: null,
	decodes: [],
	auto: null,
	pipeline: null,
	visibility: { current: document.visibilityState, sinceHidden: null, events: [] },
	counters,
	audio: 'chưa mở',
};

// Những thứ không phải JSON (luồng, bộ mã hóa…) để riêng ở đây.
const rt = {
	stream: null,
	track: null,
	fake: null,
	monitorHandle: 0,
	monitorTimes: [],
	pipeline: null,
	auto: null,
	hiddenSnap: null,
	wcModule: null,
};

const $ = (id) => document.getElementById(id);
const video = $('video');
const composer = new Composer();
const scanner = new Scanner({ boxCanvas: $('boxes') });
const ui = createUi(state, { video });

function render() {
	ui.render();
}

function setGate(n, patch) {
	Object.assign(state.gates[n], patch);
	render();
}

// ───────────────────────── Cài đặt ─────────────────────────

function readOptions() {
	const [width, height] = $('sel-resolution').value.split('x').map(Number);
	return {
		deviceId: $('sel-camera').value || null,
		width,
		height,
		frameRate: Number($('sel-fps').value),
		bitrate: Math.max(50_000, Number($('inp-bitrate').value) || 800_000),
		overlay: $('chk-overlay').checked,
		audio: $('chk-audio').checked,
		pump: $('sel-pump').value,
		seconds: Math.max(1, Number($('inp-seconds').value) || 10),
	};
}

function writeOptions(opts = {}) {
	if (opts.width && opts.height) $('sel-resolution').value = `${opts.width}x${opts.height}`;
	if (opts.frameRate) $('sel-fps').value = String(opts.frameRate);
	if (opts.bitrate) $('inp-bitrate').value = String(opts.bitrate);
	if (typeof opts.overlay === 'boolean') $('chk-overlay').checked = opts.overlay;
	if (typeof opts.audio === 'boolean') $('chk-audio').checked = opts.audio;
	if (opts.pump) $('sel-pump').value = opts.pump;
	if (opts.seconds) $('inp-seconds').value = String(opts.seconds);
	if (opts.fake) $('sel-camera').value = FAKE_ID;
	else if (opts.deviceId && [...$('sel-camera').options].some((o) => o.value === opts.deviceId)) {
		$('sel-camera').value = opts.deviceId;
	}
	state.options = readOptions();
}

// Bọc một việc: không cho hai việc chạy chồng nhau, không bao giờ ném lỗi ra ngoài.
async function exclusive(name, fn) {
	if (state.busy) return { ok: false, error: `Đang bận: ${state.busy}` };
	state.busy = name;
	render();
	try {
		return toPlain(await fn());
	} catch (err) {
		log(`${name} lỗi: ${errText(err)}`, undefined, 'error');
		return { ok: false, error: errText(err) };
	} finally {
		state.busy = null;
		refreshLive();
	}
}

async function safe(fn) {
	try {
		return toPlain(await fn());
	} catch (err) {
		return { ok: false, error: errText(err) };
	}
}

// ───────────────────────── Kiểm API ─────────────────────────

async function checkSupportImpl() {
	const mr = mediaRecorderSupport();
	const support = {
		secureContext: window.isSecureContext,
		getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
		barcodeDetectorInWindow: 'BarcodeDetector' in window,
		barcodeDetectorFormats: null,
		typeofVideoEncoder: typeof window.VideoEncoder,
		typeofVideoFrame: typeof window.VideoFrame,
		typeofMediaRecorder: typeof window.MediaRecorder,
		mediaRecorderTypes: mr.types,
		typeofMediaStreamTrackProcessor: typeof window.MediaStreamTrackProcessor,
		requestVideoFrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
		pumpModes: supportedPumpModes(),
		typeofWorker: typeof window.Worker,
		typeofAudioContext: typeof (window.AudioContext ?? window.webkitAudioContext),
		h264Encoder: null,
	};
	if (support.barcodeDetectorInWindow) {
		try {
			support.barcodeDetectorFormats = await window.BarcodeDetector.getSupportedFormats();
		} catch (err) {
			support.barcodeDetectorFormats = `lỗi: ${errText(err)}`;
		}
	}
	if (typeof window.VideoEncoder === 'function') {
		// Bộ mã hóa H.264 có nhận từng độ phân giải không (tự chọn / phần cứng / phần mềm).
		const fps = readOptions().frameRate;
		const bitrate = readOptions().bitrate;
		const codecFor = (w, h) => (w * h <= 1280 * 720 ? 'avc1.64001f' : w * h <= 1920 * 1088 ? 'avc1.640028' : 'avc1.640032');
		support.h264Encoder = {};
		for (const [w, h] of RESOLUTIONS) {
			const row = { codec: codecFor(w, h) };
			for (const [key, pref] of [
				['noPreference', 'no-preference'],
				['hardware', 'prefer-hardware'],
				['software', 'prefer-software'],
			]) {
				try {
					const res = await VideoEncoder.isConfigSupported({
						codec: row.codec,
						width: w,
						height: h,
						bitrate,
						framerate: fps,
						latencyMode: 'realtime',
						hardwareAcceleration: pref,
						avc: { format: 'avc' },
					});
					row[key] = !!res.supported;
				} catch {
					row[key] = false;
				}
			}
			support.h264Encoder[`${w}x${h}`] = row;
		}
	}
	state.support = support;
	return support;
}

// ───────────────────────── Camera ─────────────────────────

async function listCamerasImpl() {
	let cams = [];
	if (navigator.mediaDevices?.enumerateDevices) {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			cams = devices
				.filter((d) => d.kind === 'videoinput')
				.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1} (chưa cấp quyền nên chưa có tên)` }));
		} catch (err) {
			log(`Không liệt kê được camera: ${errText(err)}`, undefined, 'warn');
		}
	}
	state.cameras = cams;
	ui.fillCameras(cams, FAKE_ID, FAKE_CAMERA_LABEL);
	return cams;
}

const preferredCamera = (cams) => cams.find((c) => c.deviceId && /web camera/i.test(c.label)) ?? null;

function cameraErrorText(err) {
	switch (err?.name) {
		case 'NotAllowedError':
			return 'Chưa được cấp quyền dùng camera (bấm biểu tượng camera trên thanh địa chỉ để cho phép)';
		case 'NotFoundError':
			return 'Không tìm thấy camera nào';
		case 'NotReadableError':
			return 'Không đọc được camera – kiểm tra dây USB (nên cắm thẳng vào máy, không qua bộ chia) hoặc đóng ứng dụng khác đang dùng camera';
		case 'OverconstrainedError':
			return `Camera không đáp ứng được yêu cầu (${err.constraint ?? 'không rõ ràng buộc nào'})`;
		default:
			return errText(err);
	}
}

function closeCameraImpl() {
	cancelMonitor();
	if (rt.fake) rt.fake.stop();
	rt.fake = null;
	for (const t of rt.stream?.getTracks() ?? []) t.stop();
	rt.stream = null;
	rt.track = null;
	video.srcObject = null;
	state.camera = null;
	ui.setFakeTools(false);
}

async function waitForVideo(timeoutMs = 6000) {
	const started = performance.now();
	try {
		await video.play();
	} catch {
		// autoplay bị chặn cũng không sao vì video đã tắt tiếng
	}
	while (performance.now() - started < timeoutMs) {
		if (video.videoWidth > 0 && video.readyState >= 2) return true;
		await sleep(50);
	}
	return false;
}

async function openCameraImpl(opts = {}) {
	const o = { ...readOptions(), ...opts };
	const explicitDevice = opts.deviceId ?? ($('sel-camera').value || null);
	const wantFake = !!opts.fake || explicitDevice === FAKE_ID;
	closeCameraImpl();
	writeOptions({ ...o, fake: wantFake });

	let stream;
	let note = null;
	if (wantFake) {
		rt.fake = createFakeCamera({ width: o.width, height: o.height, frameRate: o.frameRate });
		stream = rt.fake.stream;
		log(`Mở camera giả ${o.width}×${o.height} @ ${o.frameRate}`);
	} else {
		if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
			return { ok: false, unsupported: true, error: 'Trình duyệt không có getUserMedia (cần mở trang qua http://127.0.0.1 hoặc https)' };
		}
		let deviceId = explicitDevice;
		if (!deviceId) deviceId = preferredCamera(await listCamerasImpl())?.deviceId ?? null;
		const constraints = (id, audio) => ({
			video: {
				...(id ? { deviceId: { exact: id } } : {}),
				width: { ideal: o.width },
				height: { ideal: o.height },
				frameRate: { ideal: o.frameRate },
			},
			audio: !!audio,
		});
		// Thấy thật 16/11/2026: webcam USB cắm qua bộ chia tự rớt rồi nối lại; trong vài chục giây sau đó Chrome trả
		// NotReadableError ("không đọc được camera") dù Windows đã thấy thiết bị và không ứng dụng nào đang giữ.
		// → thử lại vài lần cách nhau 1,5 giây trước khi báo lỗi cho người dùng.
		const RETRYABLE = new Set(['NotReadableError', 'AbortError']);
		const gum = async (c) => {
			for (let attempt = 1; ; attempt++) {
				try {
					const stream = await navigator.mediaDevices.getUserMedia(c);
					if (attempt > 1) log(`Mở camera được ở lần thử ${attempt}`);
					return stream;
				} catch (err) {
					if (!RETRYABLE.has(err?.name) || attempt >= 6) throw err;
					log(`Mở camera lỗi ${err.name} (lần ${attempt} / 6) – chờ 1,5 giây rồi thử lại`, undefined, 'warn');
					await sleep(1500);
				}
			}
		};
		const open = async (id) => {
			try {
				return await gum(constraints(id, o.audio));
			} catch (err) {
				if (o.audio && err?.name !== 'NotAllowedError') {
					note = `Không mở được micro (${errText(err)}) – mở camera không tiếng`;
					log(note, undefined, 'warn');
					return await gum(constraints(id, false));
				}
				throw err;
			}
		};
		try {
			stream = await open(deviceId);
			// Có quyền rồi mới thấy tên camera: nếu người dùng chưa chọn mà có "Web Camera" thì chuyển sang nó.
			const cams = await listCamerasImpl();
			const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
			const preferred = preferredCamera(cams);
			if (!explicitDevice && preferred && preferred.deviceId !== current) {
				log(`Chuyển sang camera ưu tiên: ${preferred.label}`);
				for (const t of stream.getTracks()) t.stop();
				stream = await open(preferred.deviceId);
			}
		} catch (err) {
			const error = cameraErrorText(err);
			log(`Không mở được camera: ${error}`, undefined, 'error');
			return { ok: false, error, errorName: err?.name ?? null };
		}
	}

	const track = stream.getVideoTracks()[0];
	if (!track) {
		for (const t of stream.getTracks()) t.stop();
		return { ok: false, error: 'Luồng không có đường hình' };
	}
	rt.stream = stream;
	rt.track = track;
	video.srcObject = new MediaStream([track]);
	const gotFrames = await waitForVideo();

	const settings = track.getSettings();
	let capabilities = null;
	try {
		const caps = track.getCapabilities?.();
		if (caps) {
			capabilities = {
				widthMax: caps.width?.max ?? null,
				heightMax: caps.height?.max ?? null,
				frameRateMax: caps.frameRate?.max ?? null,
			};
		}
	} catch {
		// không có cũng được
	}
	state.camera = {
		open: true,
		fake: wantFake,
		label: wantFake ? FAKE_CAMERA_LABEL : track.label,
		deviceId: settings.deviceId ?? null,
		requested: { width: o.width, height: o.height, frameRate: o.frameRate, audio: o.audio },
		settings: {
			width: settings.width ?? null,
			height: settings.height ?? null,
			frameRate: round(settings.frameRate ?? NaN, 2),
			deviceId: settings.deviceId ?? null,
			label: wantFake ? FAKE_CAMERA_LABEL : track.label,
		},
		videoWidth: video.videoWidth,
		videoHeight: video.videoHeight,
		capabilities,
		audioTracks: stream.getAudioTracks().length,
		gotFrames,
		ended: false,
		note,
		liveFps: null,
	};
	track.addEventListener('ended', () => {
		log('Camera bị ngắt (track ended)', undefined, 'error');
		if (state.camera) state.camera.ended = true;
		render();
		void onCameraLost(track);
	});
	if (!wantFake && settings.deviceId) $('sel-camera').value = settings.deviceId;
	ui.setFakeTools(wantFake);
	startMonitor();
	log(
		`Đã mở camera "${state.camera.label}": getSettings ${settings.width}×${settings.height} @ ${round(settings.frameRate ?? NaN, 2)}, khung thật ${video.videoWidth}×${video.videoHeight}`,
	);
	render();
	return { ok: true, ...state.camera };
}

// Đếm khung tới ô xem trước suốt lúc camera mở (để hiện tốc độ khung trực tiếp và theo dõi lúc tab ẩn).
function startMonitor() {
	cancelMonitor();
	if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
	const tick = (now) => {
		rt.monitorHandle = video.requestVideoFrameCallback(tick);
		counters.monitorFrames++;
		rt.monitorTimes.push(now);
		while (rt.monitorTimes.length > 2 && now - rt.monitorTimes[0] > 2000) rt.monitorTimes.shift();
	};
	rt.monitorHandle = video.requestVideoFrameCallback(tick);
}

function cancelMonitor() {
	try {
		if (rt.monitorHandle) video.cancelVideoFrameCallback(rt.monitorHandle);
	} catch {
		// không sao
	}
	rt.monitorHandle = 0;
	rt.monitorTimes = [];
}

function liveFps() {
	const times = rt.monitorTimes;
	if (times.length < 2 || performance.now() - times[times.length - 1] > 1500) return null;
	return round(((times.length - 1) * 1000) / (times[times.length - 1] - times[0]), 1);
}

// Đo tốc độ khung thật trong N giây bằng requestVideoFrameCallback.
async function measureFpsImpl(seconds = 5) {
	if (!state.camera?.open) return { ok: false, error: 'Chưa mở camera' };
	if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
		return { ok: false, unsupported: true, error: 'Trình duyệt không có requestVideoFrameCallback' };
	}
	const times = [];
	let firstMeta = null;
	let lastMeta = null;
	let running = true;
	let handle = 0;
	const hiddenAtStart = document.hidden;
	const tick = (now, meta) => {
		if (!running) return;
		handle = video.requestVideoFrameCallback(tick);
		times.push(now);
		firstMeta ??= meta;
		lastMeta = meta;
	};
	handle = video.requestVideoFrameCallback(tick);
	await sleep(seconds * 1000);
	running = false;
	try {
		video.cancelVideoFrameCallback(handle);
	} catch {
		// không sao
	}
	if (times.length < 2) {
		return {
			ok: false,
			seconds,
			frames: times.length,
			fps: 0,
			error: document.hidden || hiddenAtStart ? 'Không có khung hình nào tới – tab đang bị ẩn' : 'Không có khung hình nào tới ô xem trước',
		};
	}
	const span = times[times.length - 1] - times[0];
	let maxGap = 0;
	for (let i = 1; i < times.length; i++) maxGap = Math.max(maxGap, times[i] - times[i - 1]);
	return {
		ok: true,
		method: 'requestVideoFrameCallback',
		seconds,
		frames: times.length,
		fps: round(((times.length - 1) * 1000) / span, 2),
		avgIntervalMs: round(span / (times.length - 1), 2),
		maxIntervalMs: round(maxGap, 2),
		presentedFrames: lastMeta && firstMeta ? lastMeta.presentedFrames - firstMeta.presentedFrames + 1 : null,
		frameWidth: lastMeta?.width ?? video.videoWidth,
		frameHeight: lastMeta?.height ?? video.videoHeight,
		tabHiddenDuringMeasure: hiddenAtStart || document.hidden,
	};
}

async function gate1Impl(seconds = 5, opts = {}) {
	setGate(1, { status: 'running', reason: null });
	const support = await checkSupportImpl();
	const camera = await openCameraImpl(opts);
	if (!camera.ok) {
		const status = camera.unsupported ? 'unsupported' : 'fail';
		setGate(1, { status, reason: camera.error, result: { camera, fps: null, support } });
		return { ok: false, status, reason: camera.error, camera, support };
	}
	const fps = await measureFpsImpl(seconds);
	return evaluateGate1(camera, fps, support);
}

function evaluateGate1(camera, fps, support) {
	const req = camera.requested;
	const reasons = [];
	if (camera.videoWidth !== req.width || camera.videoHeight !== req.height) {
		reasons.push(`camera trả ${camera.videoWidth}×${camera.videoHeight} thay vì ${req.width}×${req.height}`);
	}
	if (!fps?.ok) reasons.push(fps?.error ?? 'không đo được tốc độ khung');
	else if (fps.fps < req.frameRate * THRESHOLDS.fpsRatio) {
		reasons.push(`chỉ đo được ${fps.fps} khung/giây, cần ít nhất ${round(req.frameRate * THRESHOLDS.fpsRatio, 1)}`);
	}
	const status = reasons.length ? (fps?.unsupported ? 'unsupported' : 'fail') : 'pass';
	const reason = reasons.length ? `Không đạt: ${reasons.join('; ')}` : `Đạt: ${camera.videoWidth}×${camera.videoHeight}, ${fps.fps} khung/giây`;
	setGate(1, { status, reason, result: { camera, fps, support } });
	return { ok: status === 'pass', status, reason, camera, fps, support };
}

// ───────────────────────── Quay ─────────────────────────

// Điều kiện cần trước khi quay. Trả câu báo lỗi, hoặc null nếu camera sẵn sàng.
function cameraProblem() {
	if (!state.camera?.open || !rt.track) return 'Chưa mở camera (chạy cửa 1 trước)';
	if (rt.track.readyState !== 'live') return 'Camera đã bị ngắt, hãy mở lại';
	if (!video.videoWidth) return 'Camera chưa có khung hình nào';
	return null;
}

// Chưa đủ điều kiện thì KHÔNG đụng vào kết quả cửa nào – chỉ báo lại.
function needCamera(name, fn) {
	const problem = cameraProblem();
	if (problem) {
		log(`Chưa chạy được "${name}": ${problem}`, undefined, 'warn');
		return Promise.resolve({ ok: false, notRun: true, error: problem });
	}
	return fn();
}

function recordingContext(opts = {}) {
	const problem = cameraProblem();
	if (problem) throw new Error(problem);
	const o = { ...readOptions(), ...opts };
	const pumpMode = resolvePumpMode(o.pump);
	return {
		o,
		pumpMode,
		width: video.videoWidth,
		height: video.videoHeight,
	};
}

async function loadWc() {
	rt.wcModule ??= await import('./modules/wc-pipeline.js');
	return rt.wcModule;
}

async function startScanner({ usePumpFrames, onRead }) {
	const info = await scanner.init();
	if (!info.ready) return info;
	scanner.resetCounters();
	scanner.decodes.length = 0;
	scanner.start({ video, usePumpFrames, onRead });
	return info;
}

async function recordMediaRecorderImpl(seconds, opts = {}) {
	const { o, pumpMode, width, height } = recordingContext(opts);
	const secs = seconds ?? o.seconds;
	if (o.overlay && !pumpMode) throw new Error('Không có cách lấy từng khung hình để vẽ ngày giờ');
	let scanInfo = null;
	if (o.scan) scanInfo = await startScanner({ usePumpFrames: o.overlay });
	const result = await recordWithMediaRecorder({
		seconds: secs,
		stream: rt.stream,
		track: rt.track,
		video,
		width,
		height,
		fps: o.frameRate,
		bitrate: o.bitrate,
		overlay: o.overlay,
		audio: o.audio,
		pumpMode,
		composer,
		scanner: o.scan ? scanner : null,
		name: opts.name ?? 'mr',
	});
	scanner.stop();
	result.requestedSeconds = secs;
	result.width = width;
	result.height = height;
	result.frameRate = o.frameRate;
	if (o.overlay) {
		result.draw = composer.stats();
		result.stamp = composer.inspectStamp();
	}
	if (o.scan) result.scan = { ...scanner.stats(), init: scanInfo };
	return result;
}

async function recordWebCodecsImpl(seconds, opts = {}) {
	const { o, pumpMode, width, height } = recordingContext(opts);
	const secs = seconds ?? o.seconds;
	const { WcPipeline, webCodecsSupport } = await loadWc();
	const support = webCodecsSupport();
	if (!support.supported) return { ok: false, path: 'webcodecs', unsupported: true, error: support.reason };
	if (!pumpMode) return { ok: false, path: 'webcodecs', unsupported: true, error: 'Không có cách lấy từng khung hình' };

	let scanInfo = null;
	if (o.scan) scanInfo = await startScanner({ usePumpFrames: true });
	const pipeline = new WcPipeline({
		track: rt.track,
		video,
		width,
		height,
		fps: o.frameRate,
		bitrate: o.bitrate,
		overlay: o.overlay,
		pumpMode,
		composer,
		scanner: o.scan ? scanner : null,
		hardwareAcceleration: o.hardwareAcceleration,
	});
	rt.pipeline = pipeline;
	let result;
	try {
		await pipeline.open();
		pipeline.beginClip(opts.name ?? 'wc', { fileName: `${opts.name ?? 'wc'}_${fileStamp()}.mp4` });
		await sleep(secs * 1000);
		result = (await pipeline.endClip()) ?? { ok: false, path: 'webcodecs', error: 'Không có clip nào' };
	} catch (err) {
		result = { ok: false, path: 'webcodecs', error: errText(err) };
	} finally {
		scanner.stop();
		await pipeline.close().catch(() => {});
		rt.pipeline = null;
	}
	result.requestedSeconds = secs;
	result.frameRate = o.frameRate;
	result.bitrate = o.bitrate;
	result.overlay = o.overlay;
	result.pipeline = pipeline.stats();
	if (o.overlay) {
		result.draw = composer.stats();
		result.stamp = composer.inspectStamp();
	}
	if (o.scan) result.scan = { ...scanner.stats(), init: scanInfo };
	return result;
}

function evaluateRecording(result) {
	if (result.unsupported) return { status: 'unsupported', reason: `Không hỗ trợ: ${result.error}` };
	if (!result.ok) return { status: 'fail', reason: `Không đạt: ${result.error}` };
	const reasons = [];
	if (!result.bytes) reasons.push('tệp rỗng');
	if (result.path === 'webcodecs') {
		const expected = result.requestedSeconds * result.frameRate;
		if (result.moovBeforeMdat !== true) reasons.push('phần mục lục (moov) không nằm trước dữ liệu (mdat)');
		if (result.framesEncoded < expected * THRESHOLDS.framesRatio) {
			reasons.push(`chỉ mã hóa được ${result.framesEncoded}/${Math.round(expected)} khung`);
		}
	}
	if (reasons.length) return { status: 'fail', reason: `Không đạt: ${reasons.join('; ')}` };
	const note = result.fallbackToWebm ? ' (đã lùi về WebM, không phải MP4)' : '';
	return { status: 'pass', reason: `Đạt: ${result.container ?? 'mp4'}, ${result.bytes} byte${note}` };
}

function updateGate2() {
	const g = state.gates[2];
	const parts = [g.a.status, g.b.status];
	let status = 'not-run';
	if (parts.includes('running')) status = 'running';
	else if (parts.includes('fail')) status = 'fail';
	else if (parts.includes('unsupported')) status = 'unsupported';
	else if (parts.every((s) => s === 'pass')) status = 'pass';
	g.status = status;
	g.reason = status === 'pass' ? 'Đạt cả hai đường' : status === 'not-run' && parts.includes('pass') ? 'Mới chạy một trong hai đường' : null;
	render();
}

async function gate2Path(which, seconds, opts) {
	const slot = state.gates[2][which];
	Object.assign(slot, { status: 'running', reason: null });
	updateGate2();
	let result;
	try {
		result = which === 'a' ? await recordMediaRecorderImpl(seconds, opts) : await recordWebCodecsImpl(seconds, opts);
	} catch (err) {
		result = { ok: false, error: errText(err) };
	}
	Object.assign(slot, evaluateRecording(result), { result: toPlain(result) });
	updateGate2();
	return { ...result, status: slot.status, reason: slot.reason };
}

// Cửa 3: quay hai lần (có / không có ngày giờ) để so chi phí.
async function compareOverlayImpl(seconds, opts = {}) {
	setGate(3, { status: 'running', reason: null });
	const record = opts.path === 'mediarecorder' ? recordMediaRecorderImpl : recordWebCodecsImpl;
	let withStamp;
	let withoutStamp;
	try {
		withStamp = await record(seconds, { ...opts, overlay: true, name: 'co-ngay-gio' });
		withoutStamp = await record(seconds, { ...opts, overlay: false, name: 'khong-ngay-gio' });
	} catch (err) {
		const reason = `Không đạt: ${errText(err)}`;
		setGate(3, { status: 'fail', reason, result: null });
		return { ok: false, status: 'fail', reason };
	}
	const fps = withStamp.frameRate ?? readOptions().frameRate;
	const budgetMs = round((1000 / fps) * THRESHOLDS.drawBudgetRatio, 2);
	const avgDrawMs = withStamp.draw?.totalMs?.avg ?? null;
	const result = {
		path: opts.path === 'mediarecorder' ? 'mediarecorder' : 'webcodecs',
		avgDrawMsPerFrame: avgDrawMs,
		maxDrawMsPerFrame: withStamp.draw?.totalMs?.max ?? null,
		avgDrawImageMs: withStamp.draw?.drawImageMs?.avg ?? null,
		avgTextMs: withStamp.draw?.textMs?.avg ?? null,
		drawBudgetMs: budgetMs,
		stamp: withStamp.stamp ?? null,
		withStamp,
		withoutStamp,
	};
	const reasons = [];
	if (withStamp.unsupported || withoutStamp.unsupported) {
		const reason = `Không hỗ trợ: ${withStamp.error ?? withoutStamp.error}`;
		setGate(3, { status: 'unsupported', reason, result: toPlain(result) });
		return { ok: false, status: 'unsupported', reason, ...result };
	}
	if (!withStamp.ok) reasons.push(`lần có ngày giờ lỗi: ${withStamp.error}`);
	if (!withoutStamp.ok) reasons.push(`lần không có ngày giờ lỗi: ${withoutStamp.error}`);
	if (withStamp.ok) {
		if (!withStamp.stamp?.looksRight) reasons.push('đọc lại canvas không thấy hộp ngày giờ đúng chỗ');
		if (avgDrawMs === null) reasons.push('không đo được chi phí vẽ');
		else if (avgDrawMs > budgetMs) reasons.push(`vẽ trung bình ${avgDrawMs} ms/khung, vượt mức ${budgetMs} ms`);
	}
	if (withStamp.ok && withoutStamp.ok && withStamp.framesEncoded != null && withoutStamp.framesEncoded) {
		if (withStamp.framesEncoded < withoutStamp.framesEncoded * THRESHOLDS.overlayFramesRatio) {
			reasons.push(`có ngày giờ chỉ còn ${withStamp.framesEncoded} khung so với ${withoutStamp.framesEncoded} khung khi không có`);
		}
	}
	const status = reasons.length ? 'fail' : 'pass';
	const reason = reasons.length
		? `Không đạt: ${reasons.join('; ')}`
		: `Đạt: vẽ trung bình ${avgDrawMs} ms/khung (mức cho phép ${budgetMs} ms), chữ "${withStamp.stamp?.text}"`;
	setGate(3, { status, reason, result: toPlain(result) });
	return { ok: status === 'pass', status, reason, ...result };
}

// Cửa 4: quay + đọc mã cùng lúc.
async function recordWithScanImpl(seconds, opts = {}) {
	setGate(4, { status: 'running', reason: null });
	const record = opts.path === 'mediarecorder' ? recordMediaRecorderImpl : recordWebCodecsImpl;
	let recording;
	try {
		recording = await record(seconds, { ...opts, scan: true, name: opts.name ?? 'doc-ma' });
	} catch (err) {
		recording = { ok: false, error: errText(err) };
	}
	const scan = recording.scan ?? scanner.stats();
	const result = { scan, decodes: scanner.decodes.slice(-50), recording };
	const reasons = [];
	let status = 'pass';
	if (recording.unsupported) {
		status = 'unsupported';
		reasons.push(recording.error);
	} else if (scan.init && !scan.init.ready) {
		status = 'unsupported';
		reasons.push(`bộ đọc mã không khởi động được: ${scan.init.error}`);
	} else {
		if (!recording.ok) reasons.push(`quay lỗi: ${recording.error}`);
		const secs = recording.requestedSeconds ?? seconds ?? readOptions().seconds;
		const expected = (secs * 1000) / SCAN_INTERVAL_MS;
		if (scan.attempts < expected * THRESHOLDS.scanAttemptRatio) {
			reasons.push(`chỉ thử đọc được ${scan.attempts}/${Math.round(expected)} lần (không giữ được nhịp 200 ms)`);
		}
		if (scan.errors) reasons.push(`${scan.errors} lần đọc bị lỗi: ${scan.lastError}`);
		if (!scan.successes) reasons.push('không đọc được mã nào – hãy đưa tem ra trước camera rồi chạy lại');
		if (reasons.length) status = 'fail';
	}
	const reason = reasons.length
		? `${status === 'unsupported' ? 'Không hỗ trợ' : 'Không đạt'}: ${reasons.join('; ')}`
		: `Đạt: đọc được ${scan.successes}/${scan.attempts} lần, trung bình ${scan.decodeMs.avg} ms, lâu nhất ${scan.decodeMs.max} ms (${scan.engine}, ${scan.thread === 'worker' ? 'Worker' : 'luồng chính'})`;
	setGate(4, { status, reason, result: toPlain(result) });
	return { ok: status === 'pass', status, reason, ...result };
}

// ───────────────────────── Cửa 5: tự cắt theo tem ─────────────────────────

async function startAutoImpl(opts = {}) {
	if (state.busy) return { ok: false, error: `Đang bận: ${state.busy}` };
	state.busy = 'tự cắt theo tem';
	setGate(5, { status: 'running', reason: null, result: null });
	try {
		unlockAudio(); // mở sẵn AudioContext: lần tạo đầu tiên chậm, không để nó rơi vào đúng lúc bắt đầu clip
		const { o, pumpMode, width, height } = recordingContext(opts);
		const { WcPipeline, webCodecsSupport } = await loadWc();
		const support = webCodecsSupport();
		if (!support.supported || !pumpMode) {
			throw Object.assign(new Error(support.reason ?? 'Không có cách lấy từng khung hình'), { unsupported: true });
		}
		const scanInfo = await scanner.init();
		if (!scanInfo.ready) throw Object.assign(new Error(`Bộ đọc mã không khởi động được: ${scanInfo.error}`), { unsupported: true });

		const pipeline = new WcPipeline({
			track: rt.track,
			video,
			width,
			height,
			fps: o.frameRate,
			bitrate: o.bitrate,
			overlay: o.overlay,
			pumpMode,
			composer,
			scanner,
			hardwareAcceleration: o.hardwareAcceleration,
		});
		await pipeline.open();
		const auto = new AutoCut({
			pipeline,
			sounds: { ting: playTing, boop: playBoop, done: playDone },
			onChange: refreshLive,
			confirmReads: opts.confirmReads ?? 2,
			repeatNoticeMs: opts.repeatNoticeMs ?? 3000,
		});
		rt.pipeline = pipeline;
		rt.auto = auto;
		scanner.resetCounters();
		scanner.decodes.length = 0;
		scanner.start({ video, usePumpFrames: true, onRead: (codes) => auto.onRead(codes) });
		log('Bật tự cắt theo tem – đang chờ mã vận đơn');
		refreshLive();
		return { ok: true, armed: true, scan: scanInfo, pipeline: pipeline.stats() };
	} catch (err) {
		state.busy = null;
		rt.pipeline = null;
		rt.auto = null;
		const status = err?.unsupported ? 'unsupported' : 'fail';
		const reason = `${status === 'unsupported' ? 'Không hỗ trợ' : 'Không đạt'}: ${errText(err)}`;
		setGate(5, { status, reason });
		return { ok: false, status, error: errText(err) };
	}
}

async function finishClipImpl() {
	if (!rt.auto) return { ok: false, error: 'Chưa bật tự cắt theo tem' };
	const result = await rt.auto.finishClip();
	refreshLive();
	return result;
}

// Quay tay bằng hai nút "Bắt đầu quay" / "Dừng" – không cần tem. Một lần bấm lo đủ: chưa mở camera thì mở,
// chưa bật máy trạng thái thì bật (bộ đọc mã vẫn chạy, nên đang quay tay mà đưa tem vào vẫn tự cắt).
async function startManualImpl() {
	unlockAudio();
	// Camera đã chết (rút dây) mà chưa kịp dọn → coi như chưa mở, mở lại từ đầu.
	if (rt.track && rt.track.readyState !== 'live') {
		if (rt.auto) await stopAutoImpl().catch(() => {});
		state.busy = null;
		closeCameraImpl();
	}
	if (!rt.track) {
		const opened = await run.openCamera();
		if (!opened?.ok && !rt.track) return { ok: false, error: `Chưa mở được camera: ${opened?.error ?? 'không rõ lý do'}` };
	}
	if (!rt.auto) {
		const armed = await startAutoImpl();
		if (!armed.ok) return armed;
	}
	const started = rt.auto.startManual();
	refreshLive();
	return started;
}

async function stopAutoImpl() {
	if (!rt.auto || !rt.pipeline) return { ok: false, error: 'Chưa bật tự cắt theo tem' };
	const auto = rt.auto;
	const pipeline = rt.pipeline;
	await auto.stop();
	scanner.stop();
	await pipeline.close().catch(() => {});
	rt.auto = null;
	rt.pipeline = null;
	const snapshot = auto.snapshot();
	const result = { ...snapshot, scan: scanner.stats(), pipeline: pipeline.stats(), overlayDraw: pipeline.overlay ? composer.stats() : null };

	const reasons = [];
	const saved = snapshot.clips.filter((c) => c.status === 'saved');
	const failed = snapshot.clips.filter((c) => c.status === 'failed');
	if (failed.length) reasons.push(`${failed.length} clip hỏng (${failed[0].error})`);
	if (saved.length < 2) reasons.push(`mới lưu được ${saved.length} clip, cần ít nhất 2`);
	if (!snapshot.cuts.length) reasons.push('chưa có lần cắt nào (đưa lần lượt hai tem khác nhau ra trước camera)');
	const slowCut = snapshot.cuts.find((c) => c.msDecisionToFirstFrame === null || c.msDecisionToFirstFrame > THRESHOLDS.cutMaxMs);
	if (slowCut) reasons.push(`lần cắt ${slowCut.from} → ${slowCut.to} mất ${slowCut.msDecisionToFirstFrame ?? '?'} ms, vượt mức ${THRESHOLDS.cutMaxMs} ms`);
	if (saved.some((c) => c.moovBeforeMdat !== true)) reasons.push('có clip mà moov không nằm trước mdat');
	if (saved.some((c) => c.keyFrameAtCut === false)) reasons.push('có clip không bắt đầu đúng khung khóa tại chỗ cắt');
	const names = saved.map((c) => c.code);
	if (new Set(names).size !== names.length) reasons.push('một mã bị quay thành hai clip');

	const status = reasons.length ? 'fail' : 'pass';
	const reason = reasons.length
		? `Không đạt: ${reasons.join('; ')}`
		: `Đạt: ${saved.length} clip, ${snapshot.cuts.length} lần cắt, chậm nhất ${snapshot.cutMsMax} ms`;
	state.busy = null;
	state.auto = toPlain(result);
	setGate(5, { status, reason, result: toPlain(result) });
	log(`Tắt tự cắt theo tem – ${reason}`);
	return { ok: status === 'pass', status, reason, ...toPlain(result) };
}

// ───────────────────────── Cập nhật trực tiếp + tab ẩn ─────────────────────────

function refreshLive() {
	state.options = readOptions();
	if (state.camera) state.camera.liveFps = liveFps();
	state.scan = scanner.stats();
	state.decodes = scanner.decodes.slice(-50);
	state.audio = audioState();
	if (rt.auto) state.auto = toPlain({ ...rt.auto.snapshot(), scan: state.scan });
	state.pipeline = rt.pipeline ? toPlain(rt.pipeline.stats()) : null;
	if (rt.hiddenSnap) state.visibility.sinceHidden = hiddenDelta();
	render();
}

function hiddenDelta() {
	const snap = rt.hiddenSnap;
	const hiddenMs = performance.now() - snap.at;
	const pumpFrames = counters.pumpFrames - snap.pumpFrames;
	return {
		hiddenAt: snap.iso,
		hiddenMs: Math.round(hiddenMs),
		activity: snap.busy,
		monitorFrames: counters.monitorFrames - snap.monitorFrames,
		pumpFrames,
		pumpFps: round(pumpFrames / (hiddenMs / 1000), 1),
		encodedChunks: counters.encodedChunks - snap.encodedChunks,
		scanAttempts: counters.scanAttempts - snap.scanAttempts,
	};
}

document.addEventListener('visibilitychange', () => {
	state.visibility.current = document.visibilityState;
	if (document.hidden) {
		rt.hiddenSnap = { at: performance.now(), iso: new Date().toISOString(), busy: state.busy, ...counters };
		log(`Tab bị ẩn (visibilitychange → hidden)${state.busy ? ` trong lúc: ${state.busy}` : ''}`, undefined, 'warn');
		return;
	}
	if (!rt.hiddenSnap) return;
	const d = hiddenDelta();
	rt.hiddenSnap = null;
	// Khung "còn về" tính theo đường quay nếu đang quay, còn không thì theo ô xem trước.
	d.framesKeptArriving = d.activity ? d.pumpFrames > 0 || d.encodedChunks > 0 : d.monitorFrames > 0;
	state.visibility.events.push(d);
	state.visibility.sinceHidden = null;
	log(
		`Tab hiện lại sau ${d.hiddenMs} ms. Trong lúc ẩn: ô xem trước nhận ${d.monitorFrames} khung, đường quay nhận ${d.pumpFrames} khung (${d.pumpFps} khung/giây), ` +
			`bộ mã hóa ra ${d.encodedChunks} gói, thử đọc mã ${d.scanAttempts} lần → khung hình ${d.framesKeptArriving ? 'VẪN về' : 'KHÔNG về'}`,
		d,
		d.framesKeptArriving ? 'info' : 'warn',
	);
	render();
});

// Nhật ký bền: cứ 10 giây có dòng mới thì ghi cả nhật ký của phiên ra thư mục lưu clip (POST /save),
// để tải lại trang không mất dấu vết lỗi. Tên tệp theo giờ mở trang.
const LOG_FILE = `nhat-ky_${fileStamp()}.txt`;
let logSavedCount = 0;
setInterval(() => {
	if (logEntries.length === logSavedCount) return;
	const count = logEntries.length;
	const NL = String.fromCharCode(10);
	const body = logEntries.map((e) => `${e.t} ${e.level} ${e.msg}`).join(NL) + NL;
	fetch(`/save?name=${encodeURIComponent(LOG_FILE)}`, { method: 'POST', body })
		.then((res) => {
			if (res.ok) logSavedCount = count;
		})
		.catch(() => {});
}, 10000);

window.addEventListener('error', (event) => log(`Lỗi trang: ${event.message}`, undefined, 'error'));
window.addEventListener('unhandledrejection', (event) => log(`Lỗi chưa bắt: ${errText(event.reason)}`, undefined, 'error'));
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
	log('Danh sách thiết bị thay đổi (cắm / rút camera)');
	listCamerasImpl();
	scheduleCameraRecovery();
});

// ───────────────────────── Mất camera giữa chừng ─────────────────────────
// Thấy thật 16/11/2026: webcam USB rớt kết nối lúc đang thử (track "ended" + danh sách thiết bị đổi liên tục).
// Cách xử lý: (1) báo to bằng tiếng + dải đỏ; (2) LƯU NGAY clip đang quay tới lúc mất hình rồi đóng đường quay;
// (3) camera có lại thì tự mở lại và bật lại chế độ chờ tem. KHÔNG tự quay tiếp clip quay tay – người đóng hàng tự bấm.

function setCamBanner(text) {
	const el = $('cam-banner');
	if (!el) return;
	el.hidden = !text;
	el.textContent = text ?? '';
}

async function onCameraLost(track) {
	if (rt.cameraLost || track !== rt.track) return; // camera cũ đã được thay / đã xử lý rồi
	const lost = { at: Date.now(), label: state.camera?.label ?? null, wasArmed: !!rt.auto, clip: rt.auto?.current?.code ?? null };
	rt.cameraLost = lost;
	state.cameraLost = { at: new Date(lost.at).toISOString(), label: lost.label, clip: lost.clip, recoveredAt: null };
	playAlarm();
	setCamBanner(
		lost.clip
			? `Mất camera – kiểm tra dây USB. Clip ${lost.clip} đã được lưu tới lúc mất hình.`
			: 'Mất camera – kiểm tra dây USB. Cắm lại là trang tự mở lại camera.',
	);
	if (rt.auto) await stopAutoImpl().catch((err) => log(`Đóng đường quay sau khi mất camera lỗi: ${errText(err)}`, undefined, 'error'));
	state.busy = null;
	closeCameraImpl();
	render();
	scheduleCameraRecovery();
}

let recoveryTimer = null;
function scheduleCameraRecovery() {
	if (!rt.cameraLost) return;
	clearTimeout(recoveryTimer);
	// Windows báo đổi thiết bị vài lần liền nhau khi cắm lại → chờ yên 1,5 giây rồi mới thử.
	recoveryTimer = setTimeout(tryRecoverCamera, 1500);
}

async function tryRecoverCamera() {
	const lost = rt.cameraLost;
	if (!lost || rt.track) return;
	const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
	const back = devices.some((d) => d.kind === 'videoinput' && lost.label && d.label === lost.label);
	if (!back) return; // chưa cắm lại – lần đổi thiết bị sau sẽ thử tiếp
	const opened = await run.openCamera();
	if (!opened?.ok || !rt.track) {
		log(`Camera đã có lại nhưng chưa mở được: ${opened?.error ?? 'không rõ lý do'}`, undefined, 'warn');
		recoveryTimer = setTimeout(tryRecoverCamera, 3000);
		return;
	}
	rt.cameraLost = null;
	if (state.cameraLost) state.cameraLost.recoveredAt = new Date().toISOString();
	const downSec = round((Date.now() - lost.at) / 1000, 1);
	log(`Camera đã có lại sau ${downSec} giây – tự mở lại`);
	setCamBanner(null);
	if (lost.wasArmed) await startAutoImpl().catch(() => {});
	playTing();
	render();
}

// ───────────────────────── window.__thu ─────────────────────────

const run = {
	getOptions: () => safe(() => readOptions()),
	setOptions: (opts) => safe(() => (writeOptions(opts), readOptions())),
	checkSupport: () => safe(checkSupportImpl),
	listCameras: () => safe(listCamerasImpl),
	openCamera: (opts) => exclusive('mở camera', () => openCameraImpl(opts)),
	closeCamera: () => exclusive('tắt camera', () => (closeCameraImpl(), { ok: true })),
	measureFps: (seconds = 5) => exclusive('đo tốc độ khung', () => measureFpsImpl(seconds)),
	// Cửa 1 trọn gói: kiểm API + mở camera + đo tốc độ khung.
	gate1: (seconds = 5, opts) => exclusive('cửa 1 – mở camera', () => gate1Impl(seconds, opts)),
	// Cửa 2.
	recordMediaRecorder: (seconds, opts) =>
		needCamera('quay bằng MediaRecorder', () => exclusive('quay bằng MediaRecorder', () => gate2Path('a', seconds, opts))),
	recordWebCodecs: (seconds, opts) =>
		needCamera('quay bằng WebCodecs', () => exclusive('quay bằng WebCodecs', () => gate2Path('b', seconds, opts))),
	// Cửa 3. opts.path = 'webcodecs' (mặc định) hoặc 'mediarecorder'.
	compareOverlay: (seconds, opts) =>
		needCamera('so sánh có / không có ngày giờ', () => exclusive('so sánh có / không có ngày giờ', () => compareOverlayImpl(seconds, opts))),
	// Cửa 4. opts.path như trên.
	recordWithScan: (seconds, opts) => needCamera('quay và đọc mã', () => exclusive('quay và đọc mã', () => recordWithScanImpl(seconds, opts))),
	// Cửa 5.
	startAuto: (opts) => needCamera('tự cắt theo tem', () => safe(() => startAutoImpl(opts))),
	finishClip: () => safe(finishClipImpl),
	// Quay tay: Bắt đầu quay / Dừng (Dừng = finishClip).
	startManual: () => safe(startManualImpl),
	stopManual: () => safe(finishClipImpl),
	stopAuto: () => safe(stopAutoImpl),
	// Giả lập một lần đọc mã cho máy trạng thái (không cần tem thật). times = 2 → đủ "2 lần liên tiếp".
	injectRead: (code, { format = 'code_128', times = 1 } = {}) =>
		safe(() => {
			if (!rt.auto) return { ok: false, error: 'Chưa bật tự cắt theo tem' };
			for (let i = 0; i < times; i++) rt.auto.onRead([{ rawValue: code, format }]);
			log(`Giả lập ${times} lần đọc mã ${format}: ${code}`);
			refreshLive();
			return { ok: true, auto: rt.auto.snapshot() };
		}),
	// Khởi động lại bộ đọc mã theo cách khác để so chi phí: { forceMainThread: true } hoặc { forcePonyfill: true }.
	resetScanner: (opts = {}) =>
		exclusive('khởi động lại bộ đọc mã', async () => {
			scanner.reset();
			const info = await scanner.init(opts);
			return { ok: info.ready, ...info };
		}),
	looksLikeTracking: (code) => safe(() => ({ ok: true, input: code, accepted: looksLikeTracking(code) })),
	// Camera giả: đưa một mã ra trước ống kính (code rỗng = cất đi).
	fakeShowCode: (code, format = 'code_128') =>
		safe(async () => {
			if (!rt.fake) return { ok: false, error: 'Camera giả chưa mở (chọn "Camera giả" rồi mở camera)' };
			return rt.fake.showCode(code, format);
		}),
	playSound: (kind) => safe(() => ({ ok: true, ...(kind === 'boop' ? playBoop() : playTing()), audio: audioState() })),
	listFiles: () => safe(async () => (await fetch('/list')).json()),
	snapshot: () => safe(() => (refreshLive(), state)),
};

window.__thu = { state, log: logEntries, run };

// ───────────────────────── Nút bấm ─────────────────────────

function bind(id, fn) {
	$(id).addEventListener('click', () => {
		unlockAudio(); // người dùng vừa bấm → mở tiếng cho ting-ting / boop-boop
		fn();
	});
}

bind('btn-g1', () => run.gate1(Math.min(readOptions().seconds, 10)));
bind('btn-g1-measure', async () => {
	const fps = await run.measureFps(Math.min(readOptions().seconds, 10));
	if (state.camera && state.gates[1].result) evaluateGate1(state.camera, fps, state.gates[1].result.support ?? state.support);
});
bind('btn-close-camera', () => run.closeCamera());
bind('btn-g2a', () => run.recordMediaRecorder());
bind('btn-g2b', () => run.recordWebCodecs());
bind('btn-g3', () => run.compareOverlay());
bind('btn-g4', () => run.recordWithScan());
bind('btn-quick-start', () => run.startManual());
bind('btn-quick-stop', () => run.stopManual());
// Đồng hồ + trạng thái của thanh quay nhanh, cập nhật 4 lần / giây (không đi qua ui.js để khỏi vẽ lại cả trang).
setInterval(() => {
	const el = $('quick-status');
	if (!el) return;
	const cur = rt.auto?.current;
	const startBtn = $('btn-quick-start');
	const stopBtn = $('btn-quick-stop');
	if (cur) {
		const sec = Math.max(0, Math.floor((Date.now() - Date.parse(cur.startedAtIso)) / 1000));
		const mm = String(Math.floor(sec / 60)).padStart(2, '0');
		const ss = String(sec % 60).padStart(2, '0');
		el.textContent = `Đang quay ${cur.code} · ${mm}:${ss}`;
		el.dataset.state = 'recording';
	} else {
		el.textContent = rt.auto ? 'Đang chờ: bấm Bắt đầu quay, hoặc đưa tem vào camera' : 'Chưa quay';
		el.dataset.state = 'idle';
	}
	if (startBtn) startBtn.disabled = !!cur;
	if (stopBtn) stopBtn.disabled = !cur;
}, 250);
bind('btn-g5-start', () => run.startAuto());
bind('btn-g5-finish', () => run.finishClip());
bind('btn-g5-stop', () => run.stopAuto());
bind('btn-fake-show', () => run.fakeShowCode($('inp-fake-code').value.trim()));
bind('btn-fake-hide', () => run.fakeShowCode(null));
bind('btn-clear-log', () => ui.clearLog());

for (const id of ['sel-camera', 'sel-resolution', 'sel-fps', 'inp-bitrate', 'sel-pump', 'inp-seconds', 'chk-overlay', 'chk-audio']) {
	$(id).addEventListener('change', () => {
		state.options = readOptions();
		render();
	});
}

onLog((entry) => ui.appendLog(entry));
setInterval(refreshLive, 500);

// Khởi động: kiểm API, liệt kê camera. Không tự mở camera – chờ người dùng / phiên điều khiển.
(async () => {
	state.options = readOptions();
	await listCamerasImpl();
	await checkSupportImpl().catch((err) => log(`Kiểm API lỗi: ${errText(err)}`, undefined, 'error'));
	log('Trang thử đã sẵn sàng. Bấm "Mở camera và đo" để bắt đầu từ cửa 1.');
	render();
})();
