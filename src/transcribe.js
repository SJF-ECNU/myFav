import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
export function validateAudioUrl(value, platform = 'bilibili') {
  const url = new URL(value);
  const allowed = platform === 'xiaohongshu' ? url.hostname.endsWith('.xhscdn.com') : platform === 'douyin' ? url.hostname.endsWith('.douyinvod.com') : platform === 'bilibili' && (url.hostname === 'bilivideo.com' || url.hostname.endsWith('.bilivideo.com') || url.hostname.endsWith('.bilivideo.cn'));
  if (url.protocol !== 'https:' || !allowed || url.port || url.username || url.password) throw new Error('不支持的音频地址');
  return url.href;
}

export async function transcribeAudio(url, platform = 'bilibili') {
  const directory = await mkdtemp(join(tmpdir(), 'myfav-audio-'));
  let stage = 'audio_download';
  try {
    const audio = join(directory, 'audio.wav');
    await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-user_agent', 'Mozilla/5.0', '-rw_timeout', '30000000', '-headers', `Referer: https://www.${platform === 'xiaohongshu' ? 'xiaohongshu' : platform === 'douyin' ? 'douyin' : 'bilibili'}.com/\r\n`, '-i', validateAudioUrl(url, platform), '-vn', '-ac', '1', '-ar', '16000', audio], { timeout: 30 * 60 * 1000, maxBuffer: 1024 * 1024 });
    stage = 'whisper';
    await run('whisper', [audio, '--model', process.env.MYFAV_WHISPER_MODEL || 'base', '--device', 'cpu', '--fp16', 'False', '--verbose', 'False', '--output_format', 'json', '--output_dir', directory], { timeout: 60 * 60 * 1000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(await readFile(join(directory, 'audio.json'), 'utf8'));
    if (!Array.isArray(result.segments) || !result.segments.length || result.segments.some(segment => !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || typeof segment.text !== 'string')) throw new Error('转写格式异常');
    return { language: result.language, segments: result.segments.map(segment => ({ from: segment.start, to: segment.end, text: segment.text })) };
  } catch (error) {
    const reason = error.code === 'ENOENT' ? 'command_missing' : /certificate/i.test(error.stderr ?? '') ? 'certificate' : /download|urlopen/i.test(error.stderr ?? '') ? 'model_download' : 'execution';
    throw new Error(`本地转写失败：${stage}/${reason}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
