import { limit } from '../audio/timeline.js';

/** Use video.currentTime as the master clock; processed stems are already in RAM. */
export class SyncedMixer {
  constructor(video, original, vocals, settings, onError = () => {}) {
    this.video = video;
    this.original = original;
    this.vocals = vocals;
    this.settings = settings;
    this.onError = onError;
    this.context = new AudioContext({ latencyHint: 'interactive', sampleRate: original.sampleRate });
    this.dry = this.context.createGain();
    this.vocal = this.context.createGain();
    this.master = this.context.createGain();
    this.dry.connect(this.master); this.vocal.connect(this.master);
    const headroom = this.context.createGain(); headroom.gain.value = 0.5;
    const limiter = this.context.createWaveShaper();
    limiter.curve = Float32Array.from({ length: 4097 }, (_, i) => limit(2 * (i / 2048 - 1)));
    this.master.connect(headroom).connect(limiter).connect(this.context.destination);
    this.update(settings);
    video.muted = true;
    this.events = {
      playing: () => { this.waiting = false; this.sync(); },
      pause: () => this.stop(),
      seeking: () => this.stop(),
      seeked: () => { if (!video.paused && video.readyState >= 3) this.sync(); },
      waiting: () => { this.waiting = true; this.stop(); },
      ended: () => this.stop(),
      ratechange: () => { if (!video.paused) this.sync(); },
    };
    for (const [event, callback] of Object.entries(this.events)) video.addEventListener(event, callback);
    this.timer = setInterval(() => this.reconcile(), 200);
  }
  update(settings) {
    this.settings = settings;
    const now = this.context.currentTime;
    this.dry.gain.setTargetAtTime(settings.background, now, 0.015);
    this.vocal.gain.setTargetAtTime(settings.voice - settings.background, now, 0.015);
    this.master.gain.setTargetAtTime(settings.volume, now, 0.015);
  }
  async play() { await this.context.resume(); await this.video.play(); }
  sync() { this.start().catch(error => { this.video.pause(); this.onError(error); }); }
  async start() {
    const generation = this.generation = (this.generation || 0) + 1;
    await this.context.resume();
    if (generation !== this.generation || this.video.paused || this.video.seeking || this.waiting) return;
    this.stop(false);
    const offset = Math.min(this.original.duration, Math.max(0, this.video.currentTime));
    if (offset >= this.original.duration) return;
    const now = this.context.currentTime;
    const dry = this.context.createBufferSource(), vocal = this.context.createBufferSource();
    dry.buffer = this.original; vocal.buffer = this.vocals;
    const rate = this.video.playbackRate;
    dry.playbackRate.value = vocal.playbackRate.value = rate;
    dry.connect(this.dry); vocal.connect(this.vocal);
    dry.onended = () => dry.disconnect(); vocal.onended = () => vocal.disconnect();
    dry.start(now, offset); vocal.start(now, offset);
    this.active = { dry, vocal, offset, rate, started: now };
  }
  stop(invalidate = true) {
    if (invalidate) this.generation = (this.generation || 0) + 1;
    if (this.active) {
      this.active.dry.stop(); this.active.vocal.stop(); this.active = null;
    }
  }
  reconcile() {
    if (this.video.paused || this.video.seeking || this.video.ended || this.waiting || this.video.readyState < 3) {
      this.stop();
      return;
    }
    if (!this.active) { this.sync(); return; }
    const audioTime = this.active.offset + (this.context.currentTime - this.active.started) * this.active.rate;
    if (Math.abs(audioTime - this.video.currentTime) > 0.08) this.sync();
  }
  async dispose() {
    clearInterval(this.timer); this.stop();
    for (const [event, callback] of Object.entries(this.events)) this.video.removeEventListener(event, callback);
    await this.context.close();
  }
}
