(() => {
  globalThis.__qingshengMediaObserver?.stop();
  let previous = null;
  function report() {
    const videos = [...document.querySelectorAll('video')];
    const media = document.querySelector('.bpx-player-video-wrap video') ||
      videos.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ||
      document.querySelector('audio');
    if (!media) return;
    const paused = media.paused || media.ended || media.seeking;
    if (paused === previous) return;
    previous = paused;
    chrome.runtime.sendMessage({ target: 'worker', type: 'MEDIA_STATE', paused }).catch(() => {});
  }
  const events = ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked'];
  for (const event of events) document.addEventListener(event, report, true);
  const timer = setInterval(report, 500);
  const listener = (message, sender) => {
    if (sender.id === chrome.runtime.id && message.target === 'media-observer' && message.type === 'STOP') stop();
  };
  function stop() {
    clearInterval(timer);
    for (const event of events) document.removeEventListener(event, report, true);
    chrome.runtime.onMessage.removeListener(listener);
    delete globalThis.__qingshengMediaObserver;
  }
  chrome.runtime.onMessage.addListener(listener);
  globalThis.__qingshengMediaObserver = { stop };
  report();
})();
