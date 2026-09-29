import test from 'node:test';
import assert from 'node:assert/strict';
import { isMediaURL, validateSource, readBilibiliSource } from '../src/preplay/source.js';

test('preplay source accepts only HTTPS Bilibili CDN URLs and rejects deceptive hosts', () => {
  assert.ok(isMediaURL('https://upos-sz-mirror.bilivideo.com/audio.m4s?token=example'));
  for (const value of ['https://bilivideo.com.attacker.test/a', 'http://a.bilivideo.com/a',
    'https://user:pass@a.bilivideo.com/a', 'https://127.0.0.1/a', 'https://a.bilivideo.com:8443/a', 'file:///a']) {
    assert.equal(isMediaURL(value), false, value);
  }
  const source = { duration: 120, audio: ['https://a.bilivideo.com/audio'], video: ['https://b.bilivideo.cn/video'] };
  assert.equal(validateSource(source).duration, 120);
  assert.throws(() => validateSource({ ...source, duration: Infinity }), /未知/);
  assert.throws(() => validateSource({ ...source, duration: 601 }), /10 分钟/);
});
test('page reader selects AVC video and refuses stale Bilibili page data', () => {
  const keys = ['window', 'document', 'location'];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  try {
    Object.assign(globalThis, {
      location: { hostname: 'www.bilibili.com', pathname: '/video/BVexample', href: 'https://www.bilibili.com/video/BVexample' },
      document: { title: 'Demo', querySelector: () => ({ duration: 60 }) },
      window: {
        __INITIAL_STATE__: { bvid: 'BVexample', videoData: { title: 'Demo' } },
        __playinfo__: { data: { dash: { duration: 60, audio: [{ bandwidth: 192000, baseUrl: 'https://a.bilivideo.com/audio' }],
          video: [{ height: 720, codecs: 'avc1.640028', baseUrl: 'https://a.bilivideo.com/video' },
            { height: 1080, codecs: 'hev1', baseUrl: 'https://a.bilivideo.com/hevc' }] } } },
      },
    });
    assert.equal(readBilibiliSource().video[0], 'https://a.bilivideo.com/video');
    window.__INITIAL_STATE__.bvid = 'BVprevious';
    assert.match(readBilibiliSource().error, /刷新/);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
