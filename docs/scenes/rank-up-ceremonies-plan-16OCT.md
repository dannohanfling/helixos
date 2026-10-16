# Rank-up ceremonies: plan and Gemini prompts (16 Oct)

When a member reaches a new Colosseum rank, a short ceremony plays once. It has two parts:

1. **A clip.** An 8–10 s Gemini clip of a relic coming to life in a marble niche. Each rank gets its own relic.
2. **A gold card under it.** This is code: "You have risen to Sage", the points, the member's new seat in the Colosseum, and the next rank.

The clip is made once per rank and used for every member. The card is live data.

## The ranks (from the Colosseum design)

| Rank | Points | Seat in the Colosseum | Relic in the niche | What happens in the clip |
|---|---|---|---|---|
| Artisan | 0 | Top tier | (starting rank, no ceremony) | |
| Philosopher | 100 | Top tier | a rolled scroll beside an unlit bronze oil lamp | The lamp catches a small flame, and the scroll slowly unrolls across the pedestal, showing faint gold lines |
| Sage | 500 | Upper stands | a white marble owl, wings folded | The owl's eyes open with a soft gold glow, it turns its head to the camera, spreads its marble wings and settles |
| Alchemist | 1,500 | Middle stands | a bronze crucible holding dull grey stones | The stones melt into glowing molten gold, light flickers up the niche, a wisp of steam rises, then the gold settles mirror-smooth |
| Sentinel | 3,000 | Middle stands | a round marble shield leaning on a spear | A gold laurel pattern glows to life around the shield's rim, and the spear tip catches a glint |
| Centurion | 7,500 | Front row | a bronze centurion helmet with a dull crest | The crest fills with gold from front to back, and the bronze polishes to a shine |
| Oracle | 15,000 | Front row | a bronze tripod with a shallow bowl | Thin smoke rises from the bowl and curls into a slow, glowing gold spiral |
| Titan | 30,000 | Front row | a giant marble hand, a fragment of a colossal statue, closed in a fist | The hand slowly opens to reveal a glowing gold disc on its palm |
| Olympian | 60,000 | Front row | a marble bust of a generic laureate (not any real person) | A gold laurel wreath descends from above and settles on the bust's head, light brightens from above, and a few gold petals drift down |

**Making order:**
- **Tomorrow, 17 Oct:** Philosopher, Sage and Alchemist, the first ranks members hit.
- **Then 3 a day,** after the 8 PM PT Gemini reset.

## Step 1: the stills (Gemini images; these don't use the 3-a-day video limit)

All eight relics sit in the same niche, so the ceremonies feel like one place.

**Base still.** Make once, then save it as `rank-niche.jpg`:

```
Photorealistic photograph, 16:9 landscape. A shallow arched marble niche in the stone inner gallery of an ancient Roman amphitheatre, lit by warm torchlight. In the centre stands a plain white marble pedestal, waist high, square, with a simple moulded top. Bronze torch sconces on both side walls cast warm flickering light and soft shadows on travertine stone; a little dust hangs in the air. Camera straight on at pedestal height, centred and symmetrical; the pedestal top sits in the lower middle of the frame with empty space above it. Nothing on the pedestal. No people, no text, no letters, no logos.
```

**One still per rank.** Edit the base still once per rank. Always edit from `rank-niche.jpg`, never from another edit, so the quality and framing hold. Save each as `rank-{rank}-start.jpg`.

```
Edit this image. On the pedestal, place [RELIC]. It sits centred on the pedestal top, at a natural size, lit by the same torchlight. Keep everything else exactly the same: the niche, the stone, the torches, the light, the camera position and the framing. No people, no text.
```

The [RELIC] for each rank:
- **Philosopher:** a rolled papyrus scroll lying beside an unlit bronze oil lamp
- **Sage:** a white marble owl with its wings folded, eyes closed
- **Alchemist:** a dark bronze crucible bowl holding a few dull grey stones

## Step 2: the clips (Gemini video, Landscape, start frame = that rank's still)

Every prompt starts with this:

```
Locked-off static camera, no camera movement, no zoom. The niche, walls, torches and pedestal stay completely still. Slow, ceremonial and magical but realistic, like a museum relic coming to life. In the last two seconds everything settles and holds perfectly still. No people, no hands, no text, no letters.
```

Then add the rank's line:

**rank-philosopher**
```
The bronze oil lamp catches a small, real flame that grows steady, and its warm light spreads across the pedestal. The scroll beside it slowly unrolls across the pedestal top, revealing faint glowing gold lines (not readable writing). Dust motes drift through the light.
```

**rank-sage**
```
The white marble owl opens its eyes, which glow softly gold. It turns its head slowly to look straight at the camera, then spreads its marble wings wide in one slow, graceful movement, holds them open for a moment, and folds them back, staying white marble the whole time.
```

**rank-alchemist**
```
The dull grey stones in the bronze crucible begin to glow from within and melt into bright molten gold. Golden light flickers up the walls of the niche and a thin wisp of steam rises. The molten gold settles into a smooth, shining mirror surface that keeps a gentle glow.
```

## After each clip (Cowork)

1. Check it: the camera holds still, there are no people, hands or text, and the relic stays the same object.
2. Keep the full 10 s and don't loop it, since it plays once.
3. Save the last frame as a still for reduced motion and as the poster.
4. Encode it for the web: 1280×720 MP4 (H.264, faststart) plus WebM, no audio. Name the files `rank-{rank}.mp4|.webm` and `rank-{rank}-end.jpg`.
5. Attach the files to the Architectus brief through the inbox. Uploads now work from Danno's Mac.

## The card (code, see the "Rank-up ceremony" mockup)

**When it shows:**
- The first time a member's total crosses a rank's threshold. Once per rank, ever.
- If they jump more than one rank at once (for example, a coach adjustment), show only the highest new rank.
- If it lands on the same open as the daily welcome, it plays after the welcome.

**The sequence:**
1. The clip plays in a gold-framed 16:9 window at the top of the card.
2. The rank name is struck in gold.
3. The card shows the member's points, their new seat, and the next rank with how many points to go.
4. It offers two buttons: "See my seat", which opens the Colosseum, and "Share".

**When there's no clip:**
- A rank with no clip yet uses a code-drawn laurel seal instead, so the ceremony works from day one.
- With reduced motion, it shows the end still and the finished card.
