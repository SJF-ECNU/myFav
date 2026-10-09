import { Access } from './access.js';
import { createOAuth } from './oauth.js';
import { Store } from './store.js';
import { XiaohongshuService } from './xiaohongshu-service.js';
import { DouyinService } from './douyin-service.js';
import { PlatformService } from './platform-service.js';
import { FavoriteService } from './service.js';
import { createApp } from './mcp.js';
import { resolve } from 'node:path';

const host = process.env.MYFAV_HOST || '127.0.0.1';
const port = Number(process.env.MYFAV_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效');
const token = process.env.MYFAV_TOKEN;
const allowedHosts = (process.env.MYFAV_ALLOWED_HOSTS || `127.0.0.1:${port},localhost:${port}`).split(',');
const allowedOrigins = (process.env.MYFAV_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const store = new Store(resolve('.local/myfav.sqlite'));
const service = new PlatformService(store, {
  bilibili: new FavoriteService(store, process.env.MYFAV_FOLDER || 'myFav'),
  douyin: new DouyinService(store, process.env.MYFAV_DOUYIN_FOLDER || 'myFav'),
  xiaohongshu: new XiaohongshuService(store, process.env.MYFAV_XIAOHONGSHU_FOLDER || 'myFav'),
});
const access = new Access(resolve('.local/access.sqlite'));
const oauth = await createOAuth();
const app = createApp(service, { token, access, oauth, allowedHosts, allowedOrigins, rateLimit: Number(process.env.MYFAV_RATE_LIMIT_PER_MINUTE || 60) });
const listener = app.listen(port, host, () => console.log(`myFav MCP 已启动：http://${host}:${port}/mcp。喵～`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  listener.close(async () => { await service.drain(); store.close(); access.close(); });
});
