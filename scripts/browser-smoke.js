import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { openSession } from '../src/browser-session.js';

// Run with an explicitly supplied browser; never touch the user's real profiles.
const bundled = process.argv[2] === '--bundled';
const executablePath = bundled
  ? await (await import('cloakbrowser')).ensureBinary() : process.argv[2];
if (!executablePath) throw Error('Supply a Chromium executable path');
const cwd = process.cwd(), root = await mkdtemp(join(tmpdir(), 'myfav-browser-test-'));
const server = createServer((_req, res) => { res.end('<title>myFav fixture</title>'); });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let processBrowser, observer, session;
try {
  process.chdir(root);
  const env = { MYFAV_BROWSER: 'chromium', MYFAV_BROWSER_EXECUTABLE_PATH: executablePath };
  session = await openSession('bilibili', true, { env });
  await session.context.addCookies([{ name: 'fixture', value: 'persisted', url: origin, expires: Math.floor(Date.now() / 1000) + 3600 }]);
  await session.close();
  session = await openSession('bilibili', true, { env });
  assert.equal((await session.context.cookies(origin)).find(c => c.name === 'fixture')?.value, 'persisted');
  await session.close();
  console.log('Custom Chromium persistent login fixture verified');

  processBrowser = spawn(executablePath, ['--headless=new', '--remote-debugging-port=0',
    `--user-data-dir=${join(root, 'external')}`, '--no-first-run', '--no-default-browser-check', ...(bundled ? ['--no-sandbox'] : [])], { stdio: 'ignore' });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(root, 'external', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { if (processBrowser.exitCode !== null || processBrowser.signalCode !== null) throw Error('External browser exited'); await setTimeout(100); }
  }
  if (!port) throw Error('CDP endpoint not ready');
  const endpoint = `http://127.0.0.1:${port}`;
  observer = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  const context = observer.contexts()[0], original = await context.newPage();
  await original.goto(origin);
  await original.evaluate(() => localStorage.setItem('fixture', 'shared'));
  await context.addCookies([{ name: 'fixture', value: 'external', url: origin }]);
  const count = context.pages().length;
  for (const platform of ['bilibili', 'douyin', 'xiaohongshu']) {
    const attached = await openSession(platform, true, { env: { MYFAV_BROWSER: 'cdp', MYFAV_CDP_URL: endpoint } });
    await attached.page.goto(origin);
    assert.equal(await attached.page.evaluate(() => localStorage.getItem('fixture')), 'shared');
    assert.equal((await attached.context.cookies(origin)).find(c => c.name === 'fixture')?.value, 'external');
    await attached.close(); await attached.close();
    assert.equal(context.pages().length, count);
    assert.equal(await original.title(), 'myFav fixture');
    assert.equal(processBrowser.exitCode, null);
  }
  console.log('Three-platform CDP login reuse, original tabs and browser survival verified');
} finally {
  await session?.close();
  await observer?.close();
  if (processBrowser && processBrowser.exitCode === null && processBrowser.signalCode === null) {
    const ended = once(processBrowser, 'exit'); processBrowser.kill('SIGTERM'); await ended;
  }
  server.close(); process.chdir(cwd); await rm(root, { recursive: true, force: true });
}
