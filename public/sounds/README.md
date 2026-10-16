# HelixOS sounds (ElevenLabs, Starter plan, commercial licence) - 16 Oct

| File | Plays when | Length | Level |
|---|---|---|---|
| cheer-top3 | member enters the Colosseum top 3 | 4.0 s | -16 LUFS |
| cheer-rankup | under the rank-up strike | 2.5 s | -16 LUFS |
| applause-milestone | Day 30 / 50 / 100 / 365 | 3.0 s | -17 LUFS |
| crowd-murmur | evening close-out (optional) | 6.0 s | -26 LUFS |
| fire-loop | under the streak flame, quiet, looping | 8.0 s | -28 LUFS, mono |

- One-shots: .webm (Opus) first, .mp3 fallback. Leading silence trimmed, short fade in, fade out at the end, peaks at -1.5 dBTP.
- fire-loop: seamless, no fades. Use fire-loop.wav with Web Audio (AudioBufferSourceNode.loop = true) so the loop is gapless; the .mp3 adds encoder padding and will click if looped with <audio loop>.
- Nothing plays without a user gesture; respect the sounds mute switch and reduced-motion/quiet settings.
