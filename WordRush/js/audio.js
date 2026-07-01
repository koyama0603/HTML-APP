export class AudioEngine {
  constructor(isEnabled, bgmSrc = "assets/audio/Coffee_and_Logic.mp3") {
    this.isEnabled = isEnabled;
    this.bgmSrc = bgmSrc;
    this.bgmVolume = 0.16;
    this.bgmAudio = null;
    this.ctx = null;
    this.master = null;
    this.supported = Boolean(globalThis.AudioContext || globalThis.webkitAudioContext);
  }

  init() {
    if (!this.supported) {
      return false;
    }
    if (!this.ctx) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.52;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  noteToFrequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  playTone(frequency, start, duration, type, gainValue, destination = this.master) {
    if (!this.ctx || !this.isEnabled() || !destination) {
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
    if (!this.ctx || !this.isEnabled()) {
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

  startBgm(getPhase, options = {}) {
    if (!this.isEnabled() || getPhase() !== "playing" || !globalThis.Audio) {
      return;
    }
    if (!this.bgmAudio) {
      this.bgmAudio = new Audio(this.bgmSrc);
      this.bgmAudio.loop = true;
      this.bgmAudio.preload = "auto";
    }
    this.bgmAudio.volume = this.bgmVolume;
    if (options.restart) {
      this.bgmAudio.currentTime = 0;
    }
    this.bgmAudio.play().catch(() => {
      // Browsers can reject playback until the next direct user gesture.
    });
  }

  stopBgm() {
    if (this.bgmAudio) {
      this.bgmAudio.pause();
    }
  }

  playSfx(kind) {
    if (!this.isEnabled() || !this.init()) {
      return;
    }
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
