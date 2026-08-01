import type { WeatherKind } from "./render/WeatherSystem.ts";

type WebkitAudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

/** Procedural ambience avoids heavyweight streamed assets and starts only after user intent. */
export class EnvironmentAudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private caveGain: GainNode | null = null;
  private weather: WeatherKind = "clear";
  private strength = 0;
  private stratumId = "surface";

  async resume() {
    this.ensureGraph();
    if (this.context?.state === "suspended") await this.context.resume();
  }

  setWeather(kind: WeatherKind, strength: number) {
    this.weather = kind;
    this.strength = Math.max(0, Math.min(1, strength));
    this.apply(0.8);
  }

  setStratum(stratumId: string) {
    this.stratumId = stratumId;
    this.apply(1.2);
  }

  dispose() {
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.windGain = null;
    this.caveGain = null;
  }

  private ensureGraph() {
    if (this.context || typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext ?? (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const master = context.createGain();
    master.gain.value = 0.075;
    master.connect(context.destination);

    const windGain = context.createGain();
    windGain.gain.value = 0;
    const windFilter = context.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 540;
    windFilter.Q.value = 0.42;
    const windBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const windData = windBuffer.getChannelData(0);
    let noise = 0;
    for (let index = 0; index < windData.length; index += 1) {
      noise = noise * 0.94 + (Math.random() * 2 - 1) * 0.06;
      windData[index] = noise;
    }
    const wind = context.createBufferSource();
    wind.buffer = windBuffer;
    wind.loop = true;
    wind.connect(windFilter).connect(windGain).connect(master);
    wind.start();

    const caveGain = context.createGain();
    caveGain.gain.value = 0;
    const caveFilter = context.createBiquadFilter();
    caveFilter.type = "lowpass";
    caveFilter.frequency.value = 150;
    const hum = context.createOscillator();
    hum.type = "sine";
    hum.frequency.value = 48;
    hum.connect(caveFilter).connect(caveGain).connect(master);
    hum.start();

    this.context = context;
    this.master = master;
    this.windGain = windGain;
    this.caveGain = caveGain;
    this.apply(0.05);
  }

  private apply(seconds: number) {
    if (!this.context || !this.windGain || !this.caveGain) return;
    const now = this.context.currentTime;
    const underground = this.stratumId !== "surface";
    const windTarget = underground ? 0.025 : 0.14 + this.strength * (this.weather === "electrical_storm" ? 0.72 : 0.42);
    const caveTarget = underground ? 0.34 : 0;
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.setTargetAtTime(windTarget, now, Math.max(0.03, seconds * 0.3));
    this.caveGain.gain.cancelScheduledValues(now);
    this.caveGain.gain.setTargetAtTime(caveTarget, now, Math.max(0.03, seconds * 0.3));
  }
}
