"""Generate original, calm DeepHUD timer cues using only the Python standard library.

Warm midrange tones, rounded attacks, and audible decays replace sharp alarm
recordings. Files are mono PCM for consistent speaker and earbud playback.
"""
import json
import math
from pathlib import Path
import struct
import wave

ROOT = Path(__file__).resolve().parents[1]
RATE = 24000
OUT = ROOT / 'public' / 'audio' / 'timer'
OUT.mkdir(parents=True, exist_ok=True)


def write(name, samples):
    assert all(math.isfinite(x) and abs(x) < 1 for x in samples), 'Invalid or clipped audio'
    with wave.open(str(OUT / name), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(b''.join(struct.pack('<h', round(x * 32767)) for x in samples))


def normalize(samples, peak):
    scale = peak / max(abs(x) for x in samples)
    return [sample * scale for sample in samples]


def tick():
    # A rounded wooden clock tap: low-passed contact noise, a warm body,
    # and one quiet escapement contact. No piercing high-frequency transient.
    samples = []
    seed, filtered = 173, 0
    length = round(RATE * .24)
    for i in range(length):
        time = i / RATE
        seed = (seed * 1664525 + 1013904223) & 0xffffffff
        noise = (seed / 0xffffffff) * 2 - 1
        filtered += .20 * (noise - filtered)
        value = 0
        for impact, strength in [(0, 1), (.022, .18)]:
            t = time - impact
            if t < 0:
                continue
            attack = 1 - math.exp(-t / .004)
            value += strength * attack * (
                .72 * math.sin(2 * math.pi * 640 * t) * math.exp(-t / .042)
                + .24 * math.sin(2 * math.pi * 1040 * t) * math.exp(-t / .025)
                + .18 * math.sin(2 * math.pi * 380 * t) * math.exp(-t / .050)
                + .12 * filtered * math.exp(-t / .010)
            )
        fade = min(1, (length - 1 - i) / (RATE * .025))
        samples.append(value * fade)
    return normalize(samples, .76)


def chime(notes):
    # Rounded mallet-like notes with an audible body and a slow, smooth fade.
    # Complementary ascending/descending intervals identify the transition.
    samples = [0.] * round(RATE * 2.8)
    for note, frequency in enumerate(notes):
        offset = round(note * .48 * RATE)
        length = round(RATE * 2.25)
        for i in range(length):
            t = i / RATE
            attack = 1 - math.exp(-t / .022)
            envelope = attack * math.exp(-t / .68)
            tail = min(1, (length - 1 - i) / (RATE * .18))
            tone = (
                math.sin(2 * math.pi * frequency * t)
                + .12 * math.sin(2 * math.pi * frequency * 2 * t) * math.exp(-t / .30)
                + .035 * math.sin(2 * math.pi * frequency * 3 * t) * math.exp(-t / .16)
            )
            samples[offset + i] += envelope * tail * tone
    return normalize(samples, .86)


click = tick()
for name, seconds in [('countdown.wav', 10), ('preview.wav', 3)]:
    samples = [0.] * (RATE * seconds)
    for second in range(seconds):
        start = second * RATE
        samples[start:start + len(click)] = click
    write(name, samples)

write('work.wav', chime([440, 554.37]))
write('break.wav', chime([554.37, 440]))
write('silence.wav', [0.] * round(RATE * .1))

# Playback watchdogs use these exact generated clip lengths.
durations = {}
for name in ['countdown', 'preview', 'work', 'break', 'silence']:
    with wave.open(str(OUT / (name + '.wav')), 'rb') as audio:
        durations[name] = audio.getnframes() / audio.getframerate()
(ROOT / 'src/services/timerSoundDurations.json').write_text(json.dumps(durations, indent=2) + '\n')
