import { checkResponse } from './platform-access.js';
const limit = 10 * 1024 * 1024;
export function validateImageUrl(value, platform) {
  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  const domains = platform === 'bilibili' ? ['hdslb.com'] : platform === 'douyin' ? ['douyinpic.com', 'byteimg.com', 'ibytedtos.com'] : platform === 'xiaohongshu' ? ['xhscdn.com'] : [];
  if (url.protocol === 'http:' && domains.some(d => url.hostname.endsWith(`.${d}`))) url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !domains.some(d => url.hostname.endsWith(`.${d}`))) throw new Error('不支持的图片地址');
  return url.href;
}
export async function downloadImage(url, platform, request = fetch) {
  const response = await request(validateImageUrl(url, platform), { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Referer: `https://www.${platform === 'xiaohongshu' ? 'xiaohongshu' : platform === 'douyin' ? 'douyin' : 'bilibili'}.com/` } });
  checkResponse(response.status, response.headers.get('retry-after'));
  if (!response.ok || Number(response.headers.get('content-length')) > limit) throw new Error('图片下载失败或超过10MiB');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('图片超过10MiB'); }
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  const mime = data.subarray(0, 3).equals(Buffer.from([255,216,255])) ? 'image/jpeg'
    : data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : /^GIF8[79]a/.test(data.subarray(0, 6).toString()) ? 'image/gif'
    : data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP' ? 'image/webp' : null;
  if (!mime) throw new Error('不支持的图片格式');
  return { mime, data };
}
