// Đường quay MediaRecorder: để trình duyệt tự mã hóa + tự đóng tệp.
// Bật ngày giờ: quay từ canvas ghép hình (captureStream). Tắt ngày giờ: quay thẳng luồng camera.

import { describeMp4, errText, fileStamp, log, round, saveToServer, sleep } from './core.js';
import { startPump } from './pump.js';

export const MIME_CANDIDATES = [
	'video/mp4;codecs=avc1.42E01E',
	'video/mp4;codecs=avc1.640028',
	'video/mp4',
	'video/webm;codecs=h264',
	'video/webm;codecs=vp9',
];

export function mediaRecorderSupport() {
	if (typeof window.MediaRecorder !== 'function') {
		return { supported: false, reason: 'Trình duyệt không có MediaRecorder', types: {} };
	}
	const types = {};
	for (const type of MIME_CANDIDATES) {
		try {
			types[type] = MediaRecorder.isTypeSupported(type);
		} catch {
			types[type] = false;
		}
	}
	return { supported: true, types };
}

export async function recordWithMediaRecorder({
	seconds,
	stream,
	track,
	video,
	width,
	height,
	fps,
	bitrate,
	overlay,
	audio,
	pumpMode,
	composer,
	scanner,
	name,
}) {
	const support = mediaRecorderSupport();
	if (!support.supported) return { ok: false, path: 'mediarecorder', unsupported: true, error: support.reason };

	const mimeRequested = MIME_CANDIDATES.find((type) => support.types[type]) ?? '';
	const isMp4 = mimeRequested.startsWith('video/mp4');
	if (!isMp4) {
		log(
			mimeRequested
				? `MediaRecorder không quay được MP4/H.264 – lùi về ${mimeRequested}`
				: 'MediaRecorder không nhận kiểu nào trong danh sách – để trình duyệt tự chọn',
			undefined,
			'warn',
		);
	}

	let pump = null;
	let canvasStream = null;
	let recordStream;
	try {
		if (overlay) {
			composer.resize(width, height);
			composer.resetStats();
			composer.draw(video, true); // vẽ sẵn một khung để luồng canvas có hình ngay
			canvasStream = composer.canvas.captureStream(); // không truyền fps: mỗi lần canvas đổi là một khung
			recordStream = new MediaStream(canvasStream.getVideoTracks());
			pump = startPump({
				mode: pumpMode,
				track,
				video,
				onFrame: async (source) => {
					if (scanner?.active) {
						const snap = scanner.offer(source, 'khung');
						if (snap) await snap;
					}
					composer.draw(source, true);
				},
			});
		} else {
			recordStream = new MediaStream([track]);
		}
		const audioTracks = audio ? stream.getAudioTracks() : [];
		for (const t of audioTracks) recordStream.addTrack(t);

		const options = { videoBitsPerSecond: bitrate };
		if (mimeRequested) options.mimeType = mimeRequested;
		const recorder = new MediaRecorder(recordStream, options);
		const chunks = [];
		let recorderError = null;
		recorder.ondataavailable = (event) => {
			if (event.data?.size) chunks.push(event.data);
		};
		recorder.onerror = (event) => {
			recorderError = errText(event.error ?? event);
		};
		const stopped = new Promise((resolve) => {
			recorder.onstop = resolve;
		});

		const qualityBefore = video.getVideoPlaybackQuality?.();
		const startedAt = performance.now();
		recorder.start(1000);
		log(`MediaRecorder bắt đầu: ${recorder.mimeType || mimeRequested || '(mặc định)'}, ${bitrate} bps, ${overlay ? 'qua canvas có ngày giờ' : 'thẳng từ camera'}`);
		await sleep(seconds * 1000);
		if (recorder.state !== 'inactive') recorder.stop();
		await stopped;
		const wallMs = performance.now() - startedAt;
		const qualityAfter = video.getVideoPlaybackQuality?.();
		if (recorderError) throw new Error(recorderError);

		const mimeActual = recorder.mimeType || mimeRequested || chunks[0]?.type || '';
		const blob = new Blob(chunks, { type: mimeActual });
		if (!blob.size) throw new Error('MediaRecorder không trả dữ liệu nào');
		const ext = mimeActual.includes('mp4') ? 'mp4' : mimeActual.includes('webm') ? 'webm' : 'bin';
		const buffer = await blob.arrayBuffer();
		const saved = await saveToServer(`${name ?? 'mr'}_${fileStamp()}.${ext}`, buffer, mimeActual || 'application/octet-stream');
		const mp4 = ext === 'mp4' ? describeMp4(buffer) : { boxOrder: null, moovBeforeMdat: null, fragmented: null };

		const result = {
			ok: true,
			path: 'mediarecorder',
			mimeRequested: mimeRequested || null,
			mime: mimeActual,
			container: ext,
			fallbackToWebm: ext !== 'mp4',
			bytes: saved.bytes,
			wallSeconds: round(wallMs / 1000, 2),
			// MediaRecorder không cho biết số khung đã mã hóa; chỉ biết số khung đã vẽ vào canvas (khi bật ngày giờ).
			framesEncoded: null,
			framesDrawnToCanvas: overlay ? composer.frames : null,
			droppedFrames: null,
			previewDroppedFrames:
				qualityBefore && qualityAfter ? qualityAfter.droppedVideoFrames - qualityBefore.droppedVideoFrames : null,
			overlay,
			audioTracks: audioTracks.length,
			bitrate,
			savedPath: saved.path,
			fileName: saved.name,
			uploadMs: saved.uploadMs,
			boxOrder: mp4.boxOrder,
			moovBeforeMdat: mp4.moovBeforeMdat,
			fragmented: mp4.fragmented,
			pump: pump ? { ...pump.stats } : null,
		};
		log(`MediaRecorder xong: ${result.fileName}, ${result.bytes} byte, ${result.wallSeconds} giây`);
		return result;
	} catch (err) {
		return { ok: false, path: 'mediarecorder', error: errText(err) };
	} finally {
		await pump?.stop().catch(() => {});
		for (const t of canvasStream?.getTracks() ?? []) t.stop();
	}
}
