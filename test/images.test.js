import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { PlatformService } from '../src/platform-service.js';
import { validateImageUrl, downloadImage } from '../src/images.js';
import { createApp } from '../src/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('image downloads enforce platform URLs, redirects, actual format and bounded body', async () => {
  for (const url of ['https://127.0.0.1/x','https://evil.test/x','https://xhscdn.com.evil.test/x','https://user:pass@a.xhscdn.com/x']) assert.throws(() => validateImageUrl(url, 'xiaohongshu'));
  assert.equal(validateImageUrl('http://a.xhscdn.com/x', 'xiaohongshu'), 'https://a.xhscdn.com/x');
  for (const [platform, host] of [['bilibili','i0.hdslb.com'],['douyin','p3.douyinpic.com'],['xiaohongshu','sns-webpic-qc.xhscdn.com']]) {
    const image = await downloadImage(`https://${host}/x`, platform, async (_url, options) => { assert.equal(options.redirect, 'error'); return new Response(png); });
    assert.equal(image.mime, 'image/png'); assert.deepEqual(image.data, png);
  }
  await assert.rejects(downloadImage('https://a.xhscdn.com/x','xiaohongshu',async()=>new Response('<html>')), /格式/);
  await assert.rejects(downloadImage('https://a.xhscdn.com/x','xiaohongshu',async()=>new Response(png,{headers:{'content-length':'11000000'}})), /10MiB/);
  await assert.rejects(downloadImage('https://a.xhscdn.com/x','xiaohongshu',async()=>new Response(Buffer.alloc(10*1024*1024+1))), /10MiB/);
});

test('SDK delivers native image bytes, ordered descriptors and cached reads without browser', async () => {
  const store = new Store(':memory:');
  store.apply({platform:'xiaohongshu',uid:'1',syncedAt:'now',folders:[{id:'10',title:'myFav',items:[{id:'1',type:'image'}]}]});
  const itemId=store.currentItems('xiaohongshu')[0].itemId;
  let reads=0, downloads=0;
  const service=new PlatformService(store,{xiaohongshu:{imageSources:async()=>{reads++;return [{kind:'image',url:'https://a.xhscdn.com/1'},{kind:'image',url:'https://a.xhscdn.com/2'}];}}},async()=>{downloads++;return {mime:'image/png',data:png};});
  await assert.rejects(service.image(itemId,0,false),/prepare/);
  assert.deepEqual(await service.imageList(itemId,true),[{index:0,kind:'image',cached:false},{index:1,kind:'image',cached:false}]);
  const hosts=['pending'], token='test-only-image-credential-1234567890';
  const server=createApp(service,{token,allowedHosts:hosts}).listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r)); hosts[0]=`127.0.0.1:${server.address().port}`;
  const client=new Client({name:'test',version:'1'});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://${hosts[0]}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
    const result=await client.callTool({name:'get_image',arguments:{itemId,index:1}});
    assert.equal(result.content[0].type,'image'); assert.equal(result.content[0].mimeType,'image/png');
    assert.deepEqual(Buffer.from(result.content[0].data,'base64'),png);
    assert.deepEqual(Buffer.from((await service.image(itemId,1,false)).data),png);
    assert.equal(reads,1);assert.equal(downloads,1);
    assert.equal(service.cachedContent(itemId).images[1].cached,true);
    assert.equal((await client.callTool({name:'get_image',arguments:{itemId,index:3}})).isError,true);
    store.apply({platform:'xiaohongshu',uid:'1',syncedAt:'now',folders:[{id:'10',title:'myFav',items:[]}]});
    await assert.rejects(service.image(itemId,1,false),/当前收藏/);
  } finally {await client.close();await new Promise(r=>server.close(r));store.close();}
});

test('platform source extraction preserves galleries and video covers', async () => {
  const { DouyinService } = await import('../src/douyin-service.js');
  const { FavoriteService } = await import('../src/service.js');
  const { readXhsNote } = await import('../src/xiaohongshu.js');
  const extractionStore=new Store(':memory:');
  extractionStore.apply({platform:'douyin',uid:'1',syncedAt:'now',folders:[{id:'10',title:'myFav',items:[{id:'1',type:'image'},{id:'2',type:'video'}]}]});
  const dy=new DouyinService(extractionStore);
  dy.withBrowser=async fn=>fn(async()=>({aweme_detail:{images:[{url_list:['https://p3.douyinpic.com/1']},{url_list:['https://p3.douyinpic.com/2']}],video:{cover:{url_list:['https://p3.douyinpic.com/cover']}}}}));
  assert.deepEqual((await dy.imageSources(extractionStore.currentItems('douyin')[0])).map(s=>s.url),['https://p3.douyinpic.com/1','https://p3.douyinpic.com/2']);
  assert.equal((await dy.imageSources(extractionStore.currentItems('douyin')[1]))[0].kind,'cover');
  extractionStore.apply({uid:1,syncedAt:'now',folders:[{id:10,title:'myFav',items:[{id:1,type:2,bvid:'BV1'}]}]});
  const bili=new FavoriteService(extractionStore);bili.withBrowser=async fn=>fn(async()=>({pic:'https://i0.hdslb.com/cover'}));
  assert.equal((await bili.imageSources(extractionStore.currentItems()[0]))[0].kind,'cover');
  extractionStore.close();
  const id='333333333333333333333333', board='111111111111111111111111';
  const page={goto:async()=>{},waitForFunction:async()=>{},evaluate:async(fn,arg)=>{
    globalThis.window={__INITIAL_STATE__:{note:{noteDetailMap:{[id]:{note:{type:'normal',imageList:[{urlDefault:'https://a.xhscdn.com/1'},{urlDefault:'https://a.xhscdn.com/2'}]}}}}}};
    try{return fn(arg);}finally{delete globalThis.window;}
  }};
  const note=await readXhsNote(page,`https://www.xiaohongshu.com/board/${board}/${id}`,{id,itemId:`xiaohongshu:${board}:image:${id}`});
  assert.deepEqual(note.images.map(s=>s.url),['https://a.xhscdn.com/1','https://a.xhscdn.com/2']);
});

test('image sources and binary cache survive restart', async () => {
  const { mkdtemp, rm }=await import('node:fs/promises');
  const { tmpdir }=await import('node:os');
  const { join }=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'myfav-images-')),path=join(dir,'store.sqlite');
  let store=new Store(path);
  try {
    store.apply({uid:1,syncedAt:'now',folders:[{id:10,title:'myFav',items:[{id:1,type:2}]}]});
    store.saveImageSources('10:2:1',[{url:'https://i0.hdslb.com/cover',kind:'cover'}]);
    store.saveImage('10:2:1',0,{mime:'image/png',data:png});store.close();store=new Store(path);
    const service=new PlatformService(store,{});
    assert.equal((await service.imageList('10:2:1'))[0].cached,true);
    assert.deepEqual(Buffer.from((await service.image('10:2:1',0,false)).data),png);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('preparation batch permits cached images without downloads or unlocking the batch', async () => {
  const store=new Store(':memory:');
  const snapshot={platform:'douyin',uid:'1',syncedAt:'now',folders:[{id:'10',title:'myFav',items:[{id:'1',type:'image'}]}]};
  store.apply(snapshot);
  const itemId=store.currentItems('douyin')[0].itemId;
  store.saveImage(itemId,0,{mime:'image/png',data:png});
  let release, requests=0;
  const batch=new Promise(resolve=>{release=resolve;});
  const service=new PlatformService(store,{douyin:{sync:async()=>({added:0}),imageSources:async()=>{requests++;throw new Error('browser must not start');}}},async()=>{requests++;throw new Error('download must not start');});
  service.drain=()=>batch;
  const hosts=['pending'],token='test-only-batch-credential-1234567890';
  const server=createApp(service,{token,allowedHosts:hosts}).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));hosts[0]=`127.0.0.1:${server.address().port}`;
  const client=new Client({name:'test',version:'1'});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://${hosts[0]}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}));
    assert.equal((await client.callTool({name:'sync_favorites',arguments:{platform:'douyin'}})).isError,undefined);
    const result=await client.callTool({name:'get_image',arguments:{itemId,index:0}});
    assert.equal(result.isError,undefined);
    assert.equal(result.content[0].type,'image');assert.equal(result.content[0].mimeType,'image/png');
    assert.deepEqual(Buffer.from(result.content[0].data,'base64'),png);
    assert.equal((await client.callTool({name:'get_image',arguments:{itemId,index:1}})).isError,true);
    assert.equal((await client.callTool({name:'sync_favorites',arguments:{platform:'douyin'}})).isError,true);
    store.apply({...snapshot,folders:[{id:'10',title:'myFav',items:[]}]});
    assert.equal((await client.callTool({name:'get_image',arguments:{itemId,index:0}})).isError,true);
    assert.equal(requests,0);
  } finally {release();await client.close();await new Promise(resolve=>server.close(resolve));store.close();}
});

test('unavailable Douyin members never prepare new content or images but retain historical cache', async () => {
  const {DouyinService}=await import('../src/douyin-service.js');
  const store=new Store(':memory:');
  store.apply({platform:'douyin',uid:'1',syncedAt:'now',folders:[{id:'10',title:'myFav',items:[{id:'1',type:'video',metadataStatus:'unavailable',unavailableReason:'作品不可用'}]}]});
  const itemId=store.currentItems('douyin')[0].itemId;let requests=0;
  const dy=new DouyinService(store);dy.withBrowser=async()=>{requests++;throw Error('browser must not start');};
  const service=new PlatformService(store,{douyin:dy},async()=>{requests++;throw Error('download must not start');});
  try {
    assert.equal((await service.content(itemId)).reason,'作品不可用');
    assert.deepEqual(await service.imageList(itemId,true),[]);
    await assert.rejects(service.image(itemId,0,true),/不可用/);
    store.saveImage(itemId,0,{mime:'image/png',data:png});
    assert.deepEqual(Buffer.from((await service.image(itemId,0,true)).data),png);
    assert.equal(requests,0);
  }finally{store.close();}
});
