// Demo safety limits: file size and type, and simple sliding-window rate limits.
import { config } from './config.js';
import { fileExt, fmtBytes, fmtDuration } from '../lib/util.js';

export function checkFileLimits(files, cfg = config) {
  const errors = [];
  const L = cfg.limits;
  if (files.length > L.maxFilesPerSubmission) errors.push(`At most ${L.maxFilesPerSubmission} files per submission.`);
  let total = 0;
  for (const f of files) {
    total += f.size;
    const ext = fileExt(f.name);
    if (!L.allowedExtensions.includes(ext)) errors.push(`${f.name}: .${ext || '?'} files aren't accepted in the demo.`);
    if (f.size > L.maxFileBytes) errors.push(`${f.name} is ${fmtBytes(f.size)}; the limit is ${fmtBytes(L.maxFileBytes)}.`);
  }
  if (total > L.maxSubmissionBytes) errors.push(`Files total ${fmtBytes(total)}; the limit is ${fmtBytes(L.maxSubmissionBytes)}.`);
  return errors;
}

export function rateLimitCheck(timestamps, max, windowMs, now) {
  const recent = timestamps.filter((t) => now - t < windowMs);
  if (recent.length < max) return { ok: true, retryInMs: 0 };
  const retryInMs = windowMs - (now - Math.min(...recent));
  return { ok: false, retryInMs, message: `Rate limit reached. Try again in ${fmtDuration(retryInMs)}.` };
}
