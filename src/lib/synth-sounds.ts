/** Small coin, point and lamp sounds made with Web Audio. */
import { soundLog, soundsAllowed } from "@/lib/sounds";

let audio: AudioContext | null = null;
let lastTick = -Infinity;

function context(volume: number): AudioContext | null {
  if (typeof window === "undefined" || document.hidden || !soundsAllowed() || volume === 0) return null;
  try {
    audio ??= new window.AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
    return audio;
  } catch {
    return null;
  }
}

const level = (volume: number): number => Number.isNaN(volume) ? 0 : Math.max(0, Math.min(1, volume));

function envelope(ctx: AudioContext, peak: number, duration: number, attack: number): GainNode {
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(peak * 0.0001, t + duration);
  gain.connect(ctx.destination);
  return gain;
}

function tone(ctx: AudioContext, frequency: number, peak: number, duration: number, attack = 0.003): void {
  const oscillator = ctx.createOscillator();
  const gain = envelope(ctx, peak, duration, attack);
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
  oscillator.connect(gain);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

export function playCoinStrike(volume = 1): boolean {
  const v = level(volume);
  const ctx = context(v);
  if (!ctx) return false;
  tone(ctx, 2100, 0.11 * v, 0.7);
  tone(ctx, 3200, 0.07 * v, 0.48);
  tone(ctx, 4700, 0.04 * v, 0.32);

  const duration = 0.012;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(6000, ctx.currentTime);
  filter.Q.setValueAtTime(0.5, ctx.currentTime);
  const gain = envelope(ctx, 0.02 * v, duration, 0.001);
  source.connect(filter).connect(gain);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  source.start(ctx.currentTime);
  source.stop(ctx.currentTime + duration);
  soundLog.push("coin");
  return true;
}

export function playTick(volume = 1): boolean {
  const v = level(volume);
  // Check the clock before creating even a context for a throttled call.
  const now = performance.now();
  if (now - lastTick < 45) return false;
  const ctx = context(v);
  if (!ctx) return false;
  tone(ctx, 760, 0.07 * v, 0.032, 0.002);
  lastTick = now;
  soundLog.push("tick");
  return true;
}

export function playLampChime(step: number, volume = 1): boolean {
  if (!Number.isFinite(step)) return false;
  const v = level(volume);
  const ctx = context(v);
  if (!ctx) return false;
  const index = ((Math.trunc(step) % 10) + 10) % 10;
  const semitones = [0, 2, 4, 7, 9][index % 5] + 12 * Math.floor(index / 5);
  const frequency = 523.25 * 2 ** (semitones / 12);
  tone(ctx, frequency, 0.16 * v, 1.2);
  tone(ctx, frequency * 2, 0.035 * v, 0.9);
  soundLog.push(`chime-${step}`);
  return true;
}
