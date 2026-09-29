export const MEDIA_ORIGINS = ['https://*.bilivideo.com/*', 'https://*.bilivideo.cn/*', 'https://*.bilivideo.net/*'];
export const MAX_DURATION = 600;
export function isMediaURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      /(^|\.)bilivideo\.(com|cn|net)$/.test(url.hostname) && (!url.port || url.port === '443');
  } catch { return false; }
}
export function validateSource(source) {
  if (!source || source.error) throw new Error(source?.error || '未找到当前视频音轨。');
  if (!Number.isFinite(source.duration) || source.duration <= 0) throw new Error('不能预处理直播或未知长度的视频。');
  if (source.duration > MAX_DURATION) throw new Error('当前实验版预处理支持最长 10 分钟的视频，以控制浏览器内存占用。');
  const audio = source.audio?.filter(isMediaURL) || [];
  const video = source.video?.filter(isMediaURL) || [];
  if (!audio.length || !video.length) throw new Error('当前视频的音轨或画面地址不在支持的 B 站 CDN 范围内。');
  return { title: String(source.title || 'B 站视频').slice(0, 240), duration: source.duration,
    audio: audio.slice(0, 3), video: video.slice(0, 3), mime: String(source.mime || 'video/mp4') };
}

/** Runs in the page's MAIN world. It must remain entirely self-contained. */
export function readBilibiliSource() {
  if (location.hostname !== 'www.bilibili.com' || !location.pathname.startsWith('/video/')) {
    return { error: '请在 B 站普通视频播放页打开插件；暂不支持直播、番剧和课程页面。' };
  }
  const state = window.__INITIAL_STATE__ || {};
  const bvid = location.pathname.match(/\/video\/(BV[^/]+)/)?.[1];
  const stateBvid = state.bvid || state.videoData?.bvid;
  if (bvid && stateBvid && bvid !== stateBvid) return { error: '页面刚切换过视频，请刷新页面后再预处理。' };
  const pageNumber = Number(new URL(location.href).searchParams.get('p') || 1);
  const pageCid = state.videoData?.pages?.[pageNumber - 1]?.cid;
  if (pageCid && state.cid && String(pageCid) !== String(state.cid)) return { error: '分 P 信息尚未更新，请刷新当前分 P 后重试。' };
  const info = window.__playinfo__?.data || window.__playinfo__;
  const dash = info?.dash;
  const element = document.querySelector('.bpx-player-video-wrap video') || document.querySelector('video');
  if (!dash?.audio?.length || !dash?.video?.length) {
    return { error: '没有读到可预处理的 DASH 音轨。请先播放几秒再打开插件；当前页面若仍失败则暂不支持。' };
  }
  if (info.drm_tech_type || dash.drm_tech_type) return { error: '不支持受保护的音轨。' };
  const duration = Number(dash.duration);
  if (element && Number.isFinite(element.duration) && Math.abs(element.duration - duration) > 3) {
    return { error: '音轨与当前视频长度不一致，请刷新页面后重试，避免处理到上一段视频。' };
  }
  const audio = [...dash.audio].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
  const representations = dash.video.filter(item => /^avc1/i.test(item.codecs || '') && item.height <= 1080);
  if (!representations.length) return { error: '当前页面未提供支持的 H.264 画面流，请在 B 站切换普通清晰度后重试。' };
  const preferred = representations.filter(item => item.height <= 720);
  const video = (preferred.length ? preferred : representations).sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth)[0];
  const urls = item => [item.baseUrl || item.base_url, ...(item.backupUrl || item.backup_url || [])].filter(Boolean);
  return { title: state.videoData?.title || document.title, duration,
    audio: urls(audio), video: urls(video), mime: `${video.mimeType || video.mime_type || 'video/mp4'}; codecs="${video.codecs}"` };
}
