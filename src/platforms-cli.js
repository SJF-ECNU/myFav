import { Store } from './store.js';
const [command, platform] = process.argv.slice(2);
if (!['status', 'resume'].includes(command) || !['bilibili', 'douyin', 'xiaohongshu'].includes(platform)) throw new Error('用法：npm run platforms -- status|resume bilibili|douyin|xiaohongshu');
const store = new Store('.local/myfav.sqlite');
try {
  if (command === 'resume') store.resumePlatform(platform);
  console.log(JSON.stringify({ platform, pause: store.platformPause(platform), recentTriggers: store.pauseHistory(platform) }) + ' 喵～');
} finally { store.close(); }
