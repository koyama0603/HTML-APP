export class AudioEngine {
  constructor(getSettings, bgmTracks = []) {
    this.getSettings = getSettings;
    this.bgmTracks = bgmTracks;
    this.currentTrackId = "";
    this.bgmAudio = null;
    this.bgmFadeTimer = 0;
    this.ctx = null;
    this.master = null;
    this.supported = Boolean(globalThis.AudioContext || globalThis.webkitAudioContext);
  }

  settings() {
    return this.getSettings?.() || {};
  }

  clampVolume(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.max(0, Math.min(1, number));
  }

  bgmEnabled() {
    return this.settings().bgmEnabled !== false;
  }

  sfxEnabled() {
    return this.settings().sfxEnabled !== false;
  }

  bgmVolume() {
    return this.clampVolume(this.settings().bgmVolume, 0.15);
  }

  sfxVolume() {
    return this.clampVolume(this.settings().sfxVolume, 0.7);
  }

  setTracks(tracks) {
    this.bgmTracks = Array.isArray(tracks) ? tracks : [];
  }

  clearBgmFade() {
    if (this.bgmFadeTimer) {
      clearInterval(this.bgmFadeTimer);
      this.bgmFadeTimer = 0;
    }
  }

  init() {
    if (!this.supported) {
      return false;
    }
    if (!this.ctx) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    this.master.gain.value = this.sfxVolume();
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  noteToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  playTone(frequency, start, duration, type, gainValue, destination = this.master) {
    if (!this.ctx || !this.sfxEnabled() || !destination) {
      return;
    }
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }

  playNoise(start, duration, gainValue) {
    if (!this.ctx || !this.sfxEnabled()) {
      return;
    }
    const sampleRate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filter.type = "highpass";
    filter.frequency.value = 900;
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(start);
  }

  chooseTrack(restart = false) {
    if (!this.bgmTracks.length) {
      return null;
    }

    const requested = this.settings().bgmTrack || "random";
    if (requested !== "random") {
      return this.bgmTracks.find((track) => track.id === requested) || this.bgmTracks[0];
    }

    if (!restart && this.currentTrackId) {
      return this.bgmTracks.find((track) => track.id === this.currentTrackId) || this.bgmTracks[0];
    }

    const index = Math.floor(Math.random() * this.bgmTracks.length);
    return this.bgmTracks[index] || this.bgmTracks[0];
  }

  ensureBgmAudio(track, restart = false) {
    if (!track || !globalThis.Audio) {
      return null;
    }
    if (!this.bgmAudio) {
      this.bgmAudio = new Audio(track.src);
      this.bgmAudio.loop = true;
      this.bgmAudio.preload = "auto";
    }
    if (this.currentTrackId !== track.id) {
      this.bgmAudio.src = track.src;
      restart = true;
    }
    this.currentTrackId = track.id;
    this.bgmAudio.loop = true;
    this.bgmAudio.volume = this.bgmVolume();
    if (restart) {
      this.bgmAudio.currentTime = 0;
    }
    return this.bgmAudio;
  }

  startBgm(getPhase, options = {}) {
    if (!this.bgmEnabled() || getPhase() !== "playing" || !globalThis.Audio) {
      return;
    }
    this.clearBgmFade();
    const track = this.chooseTrack(Boolean(options.restart));
    const audio = this.ensureBgmAudio(track, Boolean(options.restart));
    if (!audio) {
      return;
    }
    audio.play().catch(() => {
      // Browsers can reject playback until the next direct user gesture.
    });
  }

  applySettings(getPhase) {
    if (this.master) {
      this.master.gain.value = this.sfxVolume();
    }
    if (this.bgmAudio) {
      this.bgmAudio.volume = this.bgmVolume();
    }
    if (!this.bgmEnabled()) {
      this.stopBgm();
      return;
    }
    if (getPhase?.() === "playing") {
      this.startBgm(getPhase);
    }
  }

  stopBgm() {
    this.clearBgmFade();
    if (this.bgmAudio) {
      this.bgmAudio.pause();
    }
  }

  fadeOutBgm(durationMs = 1200) {
    if (!this.bgmAudio || this.bgmAudio.paused) {
      return;
    }
    this.clearBgmFade();
    const audio = this.bgmAudio;
    const startVolume = audio.volume;
    const startedAt = Date.now();
    this.bgmFadeTimer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      audio.volume = startVolume * (1 - progress);
      if (progress >= 1) {
        this.clearBgmFade();
        audio.pause();
        audio.volume = this.bgmVolume();
      }
    }, 40);
  }

  playSfx(kind) {
    if (!this.sfxEnabled() || !this.init()) {
      return;
    }
    this.master.gain.value = this.sfxVolume();
    const now = this.ctx.currentTime;
    if (kind === "start") {
      this.playTone(523.25, now, 0.08, "triangle", 0.08);
      this.playTone(659.25, now + 0.08, 0.09, "triangle", 0.075);
      this.playTone(783.99, now + 0.16, 0.12, "triangle", 0.07);
    } else if (kind === "correct") {
      this.playTone(659.25, now, 0.07, "triangle", 0.085);
      this.playTone(880, now + 0.065, 0.1, "triangle", 0.08);
    } else if (kind === "wrong") {
      this.playTone(220, now, 0.12, "sawtooth", 0.055);
      this.playTone(164.81, now + 0.07, 0.16, "sawtooth", 0.045);
    } else if (kind === "miss") {
      this.playNoise(now, 0.16, 0.055);
      this.playTone(196, now + 0.04, 0.16, "square", 0.032);
    } else if (kind === "finish") {
      this.playTone(783.99, now, 0.09, "triangle", 0.08);
      this.playTone(659.25, now + 0.09, 0.1, "triangle", 0.075);
      this.playTone(523.25, now + 0.18, 0.2, "triangle", 0.07);
    } else if (kind === "toggle") {
      this.playTone(740, now, 0.08, "triangle", 0.055);
    }
  }
}
