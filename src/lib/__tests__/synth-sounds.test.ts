import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sounds = vi.hoisted(() => ({ allowed: true, soundLog: [] as string[] }));
vi.mock("@/lib/sounds", () => ({ soundsAllowed: () => sounds.allowed, soundLog: sounds.soundLog }));

class Parameter {
  events: { value: number; time: number; kind: string }[] = [];
  setValueAtTime(value: number, time: number) { this.events.push({ value, time, kind: "set" }); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push({ value, time, kind: "linear" }); }
  exponentialRampToValueAtTime(value: number, time: number) { this.events.push({ value, time, kind: "exponential" }); }
}
class Node {
  connect = vi.fn((node: Node) => node);
  disconnect = vi.fn();
}
class Gain extends Node { gain = new Parameter(); }
class Source extends Node {
  frequency = new Parameter();
  type = "";
  buffer: unknown;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
class Filter extends Node {
  type = "";
  frequency = new Parameter();
  Q = new Parameter();
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 2;
  sampleRate = 48000;
  state = "suspended";
  destination = new Node();
  oscillators: Source[] = [];
  gains: Gain[] = [];
  sources: Source[] = [];
  filters: Filter[] = [];
  resume = vi.fn(async () => { this.state = "running"; });
  constructor() { FakeAudioContext.instances.push(this); }
  createOscillator() { const node = new Source(); this.oscillators.push(node); return node; }
  createGain() { const node = new Gain(); this.gains.push(node); return node; }
  createBufferSource() { const node = new Source(); this.sources.push(node); return node; }
  createBiquadFilter() { const node = new Filter(); this.filters.push(node); return node; }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
}

let synth: typeof import("@/lib/synth-sounds");
let now: number;
const plays = [
  ["coin", (volume?: number) => synth.playCoinStrike(volume)],
  ["tick", (volume?: number) => synth.playTick(volume)],
  ["chime", (volume?: number) => synth.playLampChime(3, volume)],
] as const;
const ctx = () => FakeAudioContext.instances[0];

beforeEach(async () => {
  vi.resetModules();
  sounds.allowed = true;
  sounds.soundLog.length = 0;
  FakeAudioContext.instances = [];
  now = 100;
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("window", { AudioContext: FakeAudioContext });
  vi.stubGlobal("document", { hidden: false });
  synth = await import("@/lib/synth-sounds");
});
afterEach(() => { vi.unstubAllGlobals(); });

describe.each(plays)("%s", (_name, play) => {
  it("creates nothing when sounds are disallowed", () => {
    sounds.allowed = false;
    expect(play()).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(sounds.soundLog).toEqual([]);
  });
  it("creates nothing in a hidden tab", () => {
    vi.stubGlobal("document", { hidden: true });
    expect(play()).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
  it("is safe without window", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    expect(play()).toBe(false);
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
  it("starts and resumes the context when allowed", () => {
    expect(play()).toBe(true);
    expect(ctx().oscillators.length).toBeGreaterThan(0);
    expect(ctx().resume).toHaveBeenCalledOnce();
    for (const source of [...ctx().oscillators, ...ctx().sources]) expect(source.start).toHaveBeenCalledOnce();
  });
  it.each([0.4, 2, -1, 0, NaN])("limits gain for volume %s", (volume) => {
    const clamped = Number.isNaN(volume) ? 0 : Math.max(0, Math.min(1, volume));
    expect(play(volume)).toBe(clamped > 0);
    if (!clamped) {
      expect(FakeAudioContext.instances).toHaveLength(0);
      return;
    }
    let totalPeak = 0;
    for (const gain of ctx().gains) {
      const values = gain.gain.events.map(event => event.value);
      expect(Math.max(...values)).toBeLessThanOrEqual(0.25 * clamped);
      totalPeak += Math.max(...values);
    }
    expect(totalPeak).toBeLessThanOrEqual(0.25 * clamped);
  });
  it("fades every envelope near zero before stopping and disconnects nodes", () => {
    play();
    for (const gain of ctx().gains) {
      const events = gain.gain.events;
      expect(events[0].value).toBe(0);
      expect(events.at(-1)!.kind).toBe("exponential");
      expect(events.at(-1)!.value).toBeGreaterThan(0);
      expect(events.at(-1)!.value).toBeLessThan(0.0001);
    }
    const sources = [...ctx().oscillators, ...ctx().sources];
    sources.forEach(source => {
      expect(source.stop.mock.calls[0][0]).toBeGreaterThan(ctx().currentTime);
      source.onended?.();
      expect(source.disconnect).toHaveBeenCalledOnce();
    });
    for (const node of [...ctx().gains, ...ctx().filters]) expect(node.disconnect).toHaveBeenCalledOnce();
  });
});

it("throttles ticks without creating nodes or logging suppressed calls", () => {
  expect(synth.playTick()).toBe(true);
  now += 10;
  expect(synth.playTick()).toBe(false);
  expect(ctx().oscillators).toHaveLength(1);
  expect(sounds.soundLog).toEqual(["tick"]);
  now += 50;
  expect(synth.playTick()).toBe(true);
  expect(ctx().oscillators).toHaveLength(2);
});
it("allows a tick exactly 45 ms later", () => {
  synth.playTick();
  now += 45;
  expect(synth.playTick()).toBe(true);
});
it("does not consume the tick window when blocked", () => {
  sounds.allowed = false;
  synth.playTick();
  sounds.allowed = true;
  expect(synth.playTick()).toBe(true);
});
it("follows the rising major pentatonic scale and wraps after two octaves", () => {
  for (let step = 0; step <= 10; step++) synth.playLampChime(step);
  const frequencies = ctx().oscillators.filter((_, i) => i % 2 === 0).map(node => node.frequency.events[0].value);
  const semitones = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 0];
  frequencies.forEach((frequency, i) => expect(frequency).toBeCloseTo(523.25 * 2 ** (semitones[i] / 12)));
  expect(frequencies[10]).toBe(frequencies[0]);
});
it("logs the sounds and reuses one context", () => {
  synth.playCoinStrike();
  synth.playTick();
  synth.playLampChime(3);
  expect(sounds.soundLog).toEqual(["coin", "tick", "chime-3"]);
  expect(FakeAudioContext.instances).toHaveLength(1);
});
it("uses metallic coin partials and a short filtered noise strike", () => {
  synth.playCoinStrike();
  expect(ctx().oscillators.map(node => node.frequency.events[0].value)).toEqual([2100, 3200, 4700]);
  expect(ctx().sources).toHaveLength(1);
  expect(ctx().sources[0].buffer).toBeDefined();
  expect(ctx().filters[0].type).toBe("lowpass");
  expect(ctx().gains.map(node => node.gain.events.at(-1)!.time - ctx().currentTime)).toEqual([0.7, 0.48, 0.32, 0.012].map(value => ctx().currentTime + value - ctx().currentTime));
});
it("uses a 32 ms tick and a 1.2 second bell", () => {
  synth.playTick();
  synth.playLampChime(0);
  expect(ctx().gains.map(node => node.gain.events.at(-1)!.time)).toEqual([2.032, 3.2, 2.9]);
});
it("returns false when Web Audio is unavailable", () => {
  vi.stubGlobal("window", {});
  expect(synth.playCoinStrike()).toBe(false);
  expect(sounds.soundLog).toEqual([]);
});
it("rejects non-finite lamp steps without creating a context", () => {
  expect(synth.playLampChime(NaN)).toBe(false);
  expect(synth.playLampChime(Infinity)).toBe(false);
  expect(FakeAudioContext.instances).toHaveLength(0);
});
