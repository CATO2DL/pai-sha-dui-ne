/* Source attribution and licenses: assets/CREDITS.txt and assets/audio-sources.json.
 * Animal calls use species-matched recordings at their supplied pitch.
 * Quiet/unmatched species use soft movement foley, never a borrowed animal voice. */
(function (global) {
  'use strict';

  const FILES = {
    music: ['music.ogg', 'music.mp3'], sheep: ['sheep.wav'], dog: ['dog.wav'],
    cat: ['cat-real.wav'], pig: ['pig.wav'], cow: ['cow-real.wav'], frog: ['frog-real.wav'],
    chicken: ['chicken-real.wav'], duck: ['duck-real.wav'], elephant: ['elephant-real.wav'],
    penguin: ['penguin-real.wav'], panda: ['panda-chirp.wav'], fox: ['fox-real.wav'],
    step: ['soft-step.wav'], turtle: ['turtle-shell.wav'], pop: ['pop.wav'],
    move: ['move.wav'], rise: ['rise.mp3'], win: ['win.wav'], lose: ['lose.mp3']
  };
  const VOICES = {
    sheep: { sound: 'sheep', seconds: .73, volume: .32, rate: 1 },
    dog: { sound: 'dog', seconds: .24, volume: .3, rate: 1 },
    cat: { sound: 'cat', seconds: .72, volume: .32, rate: 1 },
    duck: { sound: 'duck', seconds: .43, volume: .24, rate: 1 },
    pig: { sound: 'pig', seconds: .6, volume: .25, rate: 1 },
    rabbit: { sound: 'step', seconds: .24, volume: .17, rate: 1 },
    cow: { sound: 'cow', seconds: .9, volume: .2, rate: 1 },
    frog: { sound: 'frog', seconds: .62, volume: .68, rate: 1 },
    panda: { sound: 'panda', seconds: .45, volume: .3, rate: 1 },
    raccoon: { sound: 'step', seconds: .24, volume: .18, rate: 1 },
    capybara: { sound: 'step', seconds: .24, volume: .18, rate: 1 },
    elephant: { sound: 'elephant', seconds: .9, volume: .28, rate: 1 },
    penguin: { sound: 'penguin', seconds: .47, volume: .21, rate: 1 },
    chicken: { sound: 'chicken', seconds: .6, volume: .2, rate: 1 },
    fox: { sound: 'fox', seconds: .85, volume: .38, rate: 1 },
    turtle: { sound: 'turtle', seconds: .4, volume: .24, rate: 1 }
  };

  class GameAudio {
    constructor() {
      this.musicEnabled = true;
      this.sfxEnabled = true;
      this.unlocked = false;
      this.suspended = false;
      this.context = null;
      this.buffers = new Map();
      this.clips = new Map();
      this.loading = null;
      this.musicVoice = null;
      this.animalVoice = null;
      this.feedbackVoices = [];
      this.lastAnimal = -Infinity;
      this.lastSpecies = new Map();
      this.lastClear = -Infinity;
      this.combo = 0;
      this.musicOffset = 0;
      this.musicStartedAt = 0;
    }

    async unlock() {
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext || global.document?.hidden) return false;
      try {
        if (!this.context) this.context = new AudioContext();
        this.suspended = false;
        await this.context.resume();
        this.unlocked = true;
        // A visibility/pagehide event can run while resume() is pending.
        // Preserve the newer suspended state instead of restarting background audio.
        if (this.suspended || global.document?.hidden) {
          this.suspended = true;
          this.context.suspend().catch(() => {});
        }
        if (!this.loading) {
          this.loading = Promise.all(Object.entries(FILES).map(async ([name, files]) => {
            for (const file of files) {
              try {
                const response = await fetch('assets/audio/' + file);
                if (!response.ok) throw new Error('Audio unavailable');
                const data = await response.arrayBuffer();
                const buffer = await this.context.decodeAudioData(data);
                this.buffers.set(name, buffer);
                if (name === 'music') this.startMusic();
                return;
              } catch (_) { /* Try the next format; missing effects stay silent. */ }
            }
          }));
        }
        this.startMusic();
        await this.loading;
        return true;
      } catch (_) { return false; }
    }

    setMusic(enabled) {
      this.musicEnabled = Boolean(enabled);
      if (this.musicEnabled) this.startMusic();
      else this.stopMusic();
    }

    setSfx(enabled) {
      this.sfxEnabled = Boolean(enabled);
      if (!this.sfxEnabled) this.stopEffects();
    }

    startMusic() {
      const buffer = this.buffers.get('music');
      if (!this.context || !this.unlocked || this.suspended || global.document?.hidden || this.context.state !== 'running' || !this.musicEnabled || !buffer || this.musicVoice) return;
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = .14;
      source.connect(gain);
      gain.connect(this.context.destination);
      this.musicStartedAt = this.context.currentTime;
      source.start(0, this.musicOffset % buffer.duration);
      this.musicVoice = { source, gain };
    }

    stopMusic() {
      if (!this.musicVoice) return;
      this.musicOffset += this.context.currentTime - this.musicStartedAt;
      this.stopVoice(this.musicVoice);
      this.musicVoice = null;
    }

    stopVoice(voice) {
      if (!voice) return;
      try { voice.source.stop(); } catch (_) { /* Already stopped. */ }
      try { voice.source.disconnect(); voice.gain.disconnect(); } catch (_) { /* Already disconnected. */ }
    }

    // Clip silence before the first transient, then normalize and fade the result.
    clip(name, seconds) {
      const key = name + ':' + seconds;
      if (this.clips.has(key)) return this.clips.get(key);
      const source = this.buffers.get(name);
      if (!source || !this.context) return null;
      const channels = Array.from({ length: source.numberOfChannels }, (_, i) => source.getChannelData(i));
      let peak = 0;
      for (let c = 0; c < channels.length; c++) {
        for (let i = 0; i < source.length; i++) peak = Math.max(peak, Math.abs(channels[c][i]));
      }
      if (peak < .0001) return null;
      const threshold = peak * .035;
      let start = 0;
      outer: for (let i = 0; i < source.length; i++) {
        for (let c = 0; c < channels.length; c++) if (Math.abs(channels[c][i]) > threshold) { start = Math.max(0, i - Math.floor(source.sampleRate * .005)); break outer; }
      }
      const length = Math.max(1, Math.min(source.length - start, Math.floor(seconds * source.sampleRate)));
      const clip = this.context.createBuffer(source.numberOfChannels, length, source.sampleRate);
      let clipPeak = 0;
      channels.forEach(channel => { for (let i = start; i < start + length; i++) clipPeak = Math.max(clipPeak, Math.abs(channel[i])); });
      const normalization = Math.min(4, .8 / Math.max(.001, clipPeak));
      const fadeIn = Math.max(1, source.sampleRate * .006);
      const fadeOut = Math.max(1, source.sampleRate * .035);
      channels.forEach((channel, c) => {
        const out = clip.getChannelData(c);
        for (let i = 0; i < length; i++) {
          const envelope = Math.min(1, i / fadeIn, (length - 1 - i) / fadeOut);
          out[i] = channel[start + i] * normalization * envelope;
        }
      });
      this.clips.set(key, clip);
      return clip;
    }

    play(name, seconds, volume, rate = 1, kind = 'feedback') {
      if (!this.context || !this.unlocked || this.suspended || global.document?.hidden || !this.sfxEnabled || this.context.state !== 'running') return null;
      const buffer = this.clip(name, seconds * rate);
      if (!buffer) return null; // Never replay a stale click after decoding completes.
      if (kind === 'animal') this.stopVoice(this.animalVoice);
      else while (this.feedbackVoices.length >= 2) this.stopVoice(this.feedbackVoices.shift());
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(this.context.destination);
      const voice = { source, gain };
      source.onended = () => {
        if (this.animalVoice === voice) this.animalVoice = null;
        this.feedbackVoices = this.feedbackVoices.filter(item => item !== voice);
        try { source.disconnect(); gain.disconnect(); } catch (_) { /* Already disconnected. */ }
      };
      if (kind === 'animal') this.animalVoice = voice;
      else this.feedbackVoices.push(voice);
      source.start();
      return voice;
    }

    select(species) {
      const now = global.performance.now();
      if (now - this.lastAnimal < 220 || now - (this.lastSpecies.get(species) ?? -Infinity) < 700) return;
      const { sound, seconds, volume, rate } = VOICES[species] || VOICES.turtle;
      const voice = this.play(sound, seconds, volume, rate, 'animal');
      if (voice) { this.lastAnimal = now; this.lastSpecies.set(species, now); }
    }

    move() { this.play('move', .15, .3); }

    clear(comboIndex) {
      const now = global.performance.now();
      this.combo = comboIndex === undefined ? (now - this.lastClear <= 1500 ? Math.min(3, this.combo + 1) : 0) : Math.max(0, Math.min(3, comboIndex));
      this.lastClear = now;
      this.stopVoice(this.animalVoice);
      this.animalVoice = null;
      this.feedbackVoices.forEach(voice => this.stopVoice(voice));
      this.feedbackVoices = [];
      const rate = Math.pow(2, [0, 2, 4, 7][this.combo] / 12);
      this.play('pop', .2, .55, rate);
      this.play('rise', .3, .32, rate);
    }

    invalid() { this.play('move', .2, .2, .55); }
    win() { this.stopEffects(); this.play('win', .75, .45, 1.12); }
    // Short electronic downward cue, without the previous vocal/beatbox sound.
    lose() { this.stopEffects(); this.play('lose', .78, .32); }

    stopEffects() {
      this.stopVoice(this.animalVoice);
      this.animalVoice = null;
      this.feedbackVoices.forEach(voice => this.stopVoice(voice));
      this.feedbackVoices = [];
      this.lastAnimal = -Infinity;
      this.lastSpecies.clear();
      this.lastClear = -Infinity;
      this.combo = 0;
    }

    suspend() {
      this.suspended = true;
      this.stopMusic();
      this.stopEffects();
      if (this.context) this.context.suspend().catch(() => {});
    }

    resume() {
      if (!this.context || global.document?.hidden) return;
      this.suspended = false;
      this.context.resume().then(() => {
        if (this.suspended || global.document?.hidden) this.context.suspend().catch(() => {});
        else this.startMusic();
      }).catch(() => {});
    }
  }

  global.GameAudio = GameAudio;
})(window);
