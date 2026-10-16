/**
 * The living scenes' sounds (H-400): the crowd cheers, the applause, the murmur and the fire loop, Danno's own takes under
 * public/sounds. One module for every scene: nothing plays before the member has tapped or typed on the page (a gesture in
 * this document), one switch in Settings covers all of it (on by default), and a device asking for reduced motion hears
 * nothing. The one-shots play the Opus .webm with the .mp3 as the fallback; the fire loop is fire-loop.wav through Web Audio
 * with loop = true, so it is gapless, at a low volume, faded out when the welcome closes. Levels are set in the files: never
 * boosted here.
 */
export type OneShot = "cheer-rankup" | "cheer-top3" | "applause-milestone" | "crowd-murmur";

let on = true;
let armed = false;
let unlocked = false;
let audio: AudioContext | null = null;
let fire: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let firePending: number | null = null;
let fireBuffer: Promise<AudioBuffer | null> | null = null;
/** What played, for the walks: the names in order. */
export const soundLog: string[] = [];

const quiet = (): boolean => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The member's switch (memberships.sounds_on). Off stops the fire at once. */
export function setSoundsOn(v: boolean): void {
  on = v;
  if (!v) stopFireLoop(0);
}

/** Whether a sound may play now: the switch on, a gesture seen, no reduced-motion ask. */
export const soundsAllowed = (): boolean => on && unlocked && !quiet();

/** Installs the gesture listeners once. Call from any scene's first effect. */
export function armSounds(): void {
  if (armed || typeof window === "undefined") return;
  armed = true;
  const unlock = () => {
    unlocked = true;
    void audio?.resume();
    if (firePending !== null) startFireLoop(firePending);
  };
  for (const ev of ["pointerdown", "keydown", "touchend"] as const) window.addEventListener(ev, unlock, { capture: true, passive: true });
  // Nothing plays while the tab is hidden: the fire pauses with it and resumes when the member is back.
  document.addEventListener("visibilitychange", () => {
    if (!audio) return;
    if (document.hidden) void audio.suspend();
    else if (unlocked) void audio.resume();
  });
  if (typeof (window as unknown as { __hxSounds?: unknown }).__hxSounds === "undefined") (window as unknown as { __hxSounds: string[] }).__hxSounds = soundLog;
}

/** One short sound, once. Returns whether it was started. */
export function playSound(name: OneShot, volume = 1): boolean {
  if (!soundsAllowed()) return false;
  try {
    const a = new Audio();
    const opus = a.canPlayType('audio/webm; codecs="opus"');
    a.src = opus ? `/sounds/${name}.webm` : `/sounds/${name}.mp3`;
    a.volume = Math.max(0, Math.min(1, volume));
    a.preload = "auto";
    const p = a.play();
    if (p) p.catch(() => {});
    soundLog.push(name);
    return true;
  } catch {
    return false;
  }
}

async function loadFire(ctx: AudioContext): Promise<AudioBuffer | null> {
  try {
    const res = await fetch("/sounds/fire-loop.wav");
    if (!res.ok) return null;
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** The fire loop under the streak flame, quiet, gapless. Before a gesture it waits and starts on the first one. */
export function startFireLoop(volume = 0.25): void {
  if (fire) return;
  firePending = volume;
  if (!soundsAllowed()) return;
  try {
    audio ??= new AudioContext();
  } catch {
    return;
  }
  const ctx = audio;
  fireBuffer ??= loadFire(ctx);
  void fireBuffer.then((buf) => {
    if (!buf || fire || firePending === null || !soundsAllowed()) return;
    const source = ctx.createBufferSource();
    source.buffer = buf;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 1.5);
    source.connect(gain).connect(ctx.destination);
    source.start();
    fire = { source, gain };
    soundLog.push("fire-loop");
    void ctx.resume();
  });
}

/** Fades the fire out and stops it. */
export function stopFireLoop(fadeMs = 1200): void {
  firePending = null;
  if (!fire || !audio) return;
  const { source, gain } = fire;
  fire = null;
  const t = audio.currentTime;
  try {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0.0001, t + fadeMs / 1000);
    source.stop(t + fadeMs / 1000 + 0.05);
  } catch {
    try {
      source.stop();
    } catch {}
  }
}
