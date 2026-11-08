"""Lumi demo v2: the picture cut to Artem's voice-over (7 Loom clips), webcam bubble, subtle subtitles, music bed.

python3 render2.py plan      -> print the timeline, write edl2.txt
python3 render2.py segs      -> render all segments (tmp2/)
python3 render2.py assemble  -> lumi-demo-v2.mp4 (video + voice [+ music.* if present in this folder])
"""
import os, sys, json, copy, subprocess, re
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from multiprocessing import Pool
import render as R

HERE = R.HERE
R.TMP = TMP = os.path.join(HERE, 'tmp2')
FPS, OW, OH = R.FPS, R.OW, R.OH
DL = '/Users/artevil/Downloads/'
SCR = '/private/tmp/claude-501/-Users-artevil-Since-AI-hackathon---Artem/63017ac0-f7e4-45c9-8e26-a11f1e3509fd/scratchpad'
CLIP = {
    1: DL + 'Turning Hidden Outage Knowledge into Usable Help.mp4',
    2: DL + 'Preserving Key Work Insights in Slack.mp4',
    3: DL + 'Simple AI Pipeline for Problem Discovery.mp4',
    4: DL + 'Loom - 8.11.2026, 5.53.mp4',
    5: DL + 'How Loomy Confirms Facts with Engineers.mp4',   # "knowing a problem isn't enough"
    6: DL + 'How Loomy Boosts Knowledge Confidence.mp4',    # "second biggest problem... we ask"
    7: DL + 'How Loom Stops AI Agent Hallucinations.mp4',
}
TR = json.load(open(f'{SCR}/vo/transcripts.json'))
for k, v in CLIP.items():
    R.FILES[f'cam{k}'] = v
CAM_VF = f'fps={FPS},scale=-2:{OH},crop={OW}:{OH}'
PAD = 0.32
EDL_NAME = 'edl2.txt'
LUMI_X = 1268  # Lumi's resting centre in the logo shots
NO_CAM = set()  # voice blocks without a picture of Artem (no bubble)
LEAD = 0.0  # a breath before the first word
EXTRA = []  # overlay cards: dict(a, b, arr, x, y, slide)          # breath after each voice block before the next picture change
OLD = {s['name']: s for s in R.SEGS}

def take(name, dur=None, **kw):
    s = copy.deepcopy(OLD[name]); s.pop('caps', None); s['vo'] = ''
    if dur is not None and abs(dur - s['dur']) > 1e-6:
        f = dur / s['dur']
        if s['speed']:
            s['speed'] = s['speed'] / f
        if s.get('zoom'):
            s['zoom'] = [(t * f, v) for t, v in s['zoom']]
        s['dur'] = dur
    s.update(kw)
    return s

def cam(k, dur, xf=22, tr='swoosh'):
    return dict(name=f'cam{k}', src=f'cam{k}', tin=0.0, dur=dur, speed=1, zoom=None, xf=xf, tr=tr, vf=CAM_VF, cam=k)

def card(n):
    return dict(name=f'card{n}', src=f'card{n}', tin=0, dur=2.5, speed=1, zoom=None, xf=22, tr='swoosh')

# Voice blocks: (clip, voice in, voice out, segments; the last segment stretches to fit the voice)
BLOCKS = [
    (1, 0.0, 23.4, [dict(name='intro', src='intro', tin=0, dur=10.0, speed=1, zoom=None, xf=0),
                    cam(1, 14.0, xf=18, tr=None)]),
    ('card', 1),
    (2, 0.5, 20.3, [cam(2, 6.4), take('slack-1', 8.0, tr='swoosh', xf=22), take('slack-1-hold', 6.0)]),
    (3, 0.0, 28.0, [take('pipeline', 28.0, tr='swoosh', xf=22)]),
    (4, 0.8, 8.3, [cam(4, 8.0)]),
    ('card', 2),
    (6, 0.4, 30.8, [cam(6, 5.6), take('slack-2-type', 2.6, tr='swoosh', xf=22), take('slack-2-send'), take('flip-pre'),
                    take('flip'), take('flip-hold', 1.4), take('lumi-card'), take('lumi-card-hold', 2.0),
                    take('why-open'), take('why-hold', 1.4), take('why', 6.0)]),
    (5, 0.4, 27.1, [take('slack-3-type', 2.0, tr='swoosh', xf=22), take('slack-3-send'), take('questions', 11.0, tr='swoosh', xf=22),
                    take('slack-4a', 2.8, tr='swoosh', xf=22), take('slack-4b', 0.6), take('slack-4c', 2.4), take('slack-4d', 0.9),
                    take('chain', 8.0, tr='swoosh', xf=22)]),
    ('card', 3),
    (7, 0.4, 31.9, [cam(7, 6.0), take('terminal', 13.0, tr='swoosh', xf=22), take('terminal-hold', 1.4),
                    take('mark-lumi', 6.5, tr='swoosh', xf=22),
                    dict(name='end-logo', src='intro', tin=3.0, dur=6.0, speed=1, zoom=None, xf=24)]),
]
END_HOLD = 1.1

def build():
    segs, groups = [], []
    for b in BLOCKS:
        if b[0] == 'card':
            segs.append(card(b[1])); continue
        k, v0, v1, ss = b
        i0 = len(segs)
        segs.extend(copy.deepcopy(ss))
        groups.append(dict(clip=k, v0=v0, v1=v1, first=i0, last=len(segs) - 1))
    return segs, groups

def fit(segs, groups):
    """Stretch each block's last segment so the picture ends PAD after the voice; place the voice at the block start."""
    for _ in range(3):
        R.SEGS = segs
        starts, total = R.timeline()
        for gi, g in enumerate(groups):
            starts, total = R.timeline()
            first = segs[g['first']]
            vstart = (starts[g['first']] + (first['xf'] if g['first'] else 0)) / FPS + (LEAD if g['first'] == 0 else 0)
            g['vstart'] = vstart
            vend = vstart + (g['v1'] - g['v0'])
            last = segs[g['last']]
            nxt = segs[g['last'] + 1] if g['last'] + 1 < len(segs) else None
            want_end = vend + (PAD if nxt else END_HOLD)
            new = want_end + (nxt['xf'] / FPS if nxt else 0) - starts[g['last']] / FPS
            if new < 0.4:
                print('WARNING', g, 'last segment would be', new)
                new = 0.4
            if last['src'] == 'take' and last['speed']:
                span = last['dur'] * last['speed']
                f = new / last['dur']
                last['speed'] = span / new
                if last.get('zoom'):
                    last['zoom'] = [(t * f, v) for t, v in last['zoom']]
            elif last.get('zoom'):
                f = new / last['dur']; last['zoom'] = [(t * f, v) for t, v in last['zoom']]
            last['dur'] = new
    R.SEGS = segs
    starts, total = R.timeline()
    # webcam segments play the clip in sync with the voice
    for g in groups:
        for i in range(g['first'], g['last'] + 1):
            if segs[i].get('cam'):
                segs[i]['tin'] = max(0.0, g['v0'] + starts[i] / FPS - g['vstart'])
    return starts, total

SEGS, GROUPS = build()
STARTS, TOTAL = fit(SEGS, GROUPS)
R.SEGS = SEGS

# ---------------------------------------------------------------- subtitles
WFIX = [(['lifts', 'the'], ['lives', 'in']), (['caches'], ['catches']), (['set.'], ['said.']), (['set,'], ['said,']),
        (['themes,'], ['Teams,']), (['github,'], ['GitHub,']), (['element'], ['LLM']), (['date', 'with'], ['stay', 'with']),
        (["they've", 'worked'], ['they', 'work'])]

def fix_words(ws):
    ws = [dict(w) for w in ws]
    for i in range(len(ws)):
        for a, b in WFIX:
            seg = [x['word'].strip() for x in ws[i:i + len(a)]]
            if seg == a:
                for j, t in enumerate(b): ws[i + j]['word'] = ' ' + t
    return [w for w in ws if w['word'].strip()]

def cues():
    out = []
    for g in GROUPS:
        words = [w for s in TR[str(g['clip'])]['segments'] for w in s.get('words', [])
                 if g['v0'] - 0.05 <= w['start'] <= g['v1']]
        words = fix_words(words)
        cur = []
        def flush():
            if not cur: return
            text = ''.join(w['word'] for w in cur).strip()
            a = g['vstart'] + cur[0]['start'] - g['v0']
            b = g['vstart'] + cur[-1]['end'] - g['v0'] + 0.25
            out.append([a, b, text]); cur.clear()
        end = lambda x: x['word'].rstrip()[-1:] in '.?!'
        for j, w in enumerate(words):
            cur.append(w)
            text = ''.join(x['word'] for x in cur).strip()
            ahead = words[j + 1:j + 3]
            near_end = any(end(x) for x in ahead)
            if end(w):
                flush()
            elif len(text) >= 34 and not near_end and (w['word'].rstrip()[-1:] in ',' or len(text) >= 44):
                flush()
            elif len(text) >= 60:
                flush()
        flush()
    for i in range(len(out) - 1):              # no overlap, no flicker on short gaps
        if out[i + 1][0] - out[i][1] < 0.35:
            out[i][1] = out[i + 1][0] - 0.02
    return out

FONT = '/System/Library/Fonts/SFNS.ttf'
def sub_img(text):
    f = ImageFont.truetype(FONT, 34)
    f.set_variation_by_axes([100, 28, 400, 500])  # width, optical size, grade, weight
    l, t, r, b = f.getbbox(text)
    w, h = r - l + 44, 58
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=14, fill=(18, 18, 20, 150))
    d.text((22 - l, (h - (b - t)) / 2 - t), text, font=f, fill=(255, 255, 255, 245))
    return np.asarray(im).astype(np.float32) / 255.0

# ---------------------------------------------------------------- webcam bubble
BUB = 300; BX, BY = 44, OH - 44 - BUB
def bubble_mask():
    m = Image.new('L', (BUB * 4, BUB * 4), 0)
    ImageDraw.Draw(m).ellipse((0, 0, BUB * 4 - 1, BUB * 4 - 1), fill=255)
    return np.asarray(m.resize((BUB, BUB), Image.LANCZOS)).astype(np.float32)[..., None] / 255.0
MASK = None

def bubble_intervals():
    """While a screen shot (not the webcam, a card or the logo) is on during a voice block."""
    out = []
    for g in GROUPS:
        if g['clip'] in NO_CAM: continue
        for i in range(g['first'], g['last'] + 1):
            s = SEGS[i]
            if s['src'] != 'take': continue
            a = STARTS[i] / FPS + (s['xf'] / FPS if s.get('tr') == 'swoosh' else 0)
            b = (STARTS[i] + R.nframes(s)) / FPS
            if i + 1 < len(SEGS) and SEGS[i + 1].get('tr') == 'swoosh' and SEGS[i + 1]['src'] != 'take':
                b -= SEGS[i + 1]['xf'] / FPS
            if out and out[-1]['clip'] == g['clip'] and a - out[-1]['b'] < 0.6:
                out[-1]['b'] = b
            else:
                out.append(dict(clip=g['clip'], a=a, b=b, toff=g['v0'] - g['vstart']))
    return out

class Cam:
    def __init__(self, iv):
        self.iv = iv
        k = iv['clip']; t0 = max(0, iv['a'] + iv['toff'])
        vf = f'fps={FPS},crop=ih:ih:(iw-ih)/2:0,scale={BUB}:{BUB}'
        self.p = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'fatal', '-ss', f'{t0:.3f}', '-i', CLIP[k], '-vf', vf,
                                   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
        self.last = None
    def frame(self):
        b = self.p.stdout.read(BUB * BUB * 3)
        if len(b) == BUB * BUB * 3:
            self.last = np.frombuffer(b, np.uint8).reshape(BUB, BUB, 3).astype(np.float32)
        return self.last
    def close(self):
        self.p.stdout.close(); self.p.kill(); self.p.wait()

def assemble(out):
    global MASK
    MASK = bubble_mask()
    ring = Image.new('L', (BUB * 4 + 32, BUB * 4 + 32), 0)
    ImageDraw.Draw(ring).ellipse((0, 0, BUB * 4 + 31, BUB * 4 + 31), fill=255)
    ring = np.asarray(ring.resize((BUB + 8, BUB + 8), Image.LANCZOS)).astype(np.float32)[..., None] / 255.0
    shadow = Image.fromarray((ring[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))
    shadow = np.asarray(shadow).astype(np.float32)[..., None] / 255.0 * 0.28
    subs = [(a, b, sub_img(t)) for a, b, t in cues()]
    ivs = bubble_intervals()
    starts, total = R.timeline()
    enc = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                            '-s', f'{OW}x{OH}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow',
                            '-crf', '18', '-pix_fmt', 'yuv420p', '-an', out], stdin=subprocess.PIPE)
    state = dict(cam=None, iv=None)
    # Lumi sits at the bottom centre in the logo shots: there the subtitle goes behind her
    lumi_shots = [(starts[i] / FPS, (starts[i] + R.nframes(s)) / FPS) for i, s in enumerate(SEGS) if s['src'] == 'intro']
    FADE = 0.25

    def overlay(frame, fidx):
        t = fidx / FPS
        fr = frame.astype(np.float32)
        iv = next((v for v in ivs if v['a'] <= t < v['b']), None)
        if iv is not state['iv']:
            if state['cam']: state['cam'].close()
            state['cam'] = Cam(iv) if iv else None; state['iv'] = iv
        if iv:
            c = state['cam'].frame()
            if c is not None:
                al = min(1.0, (t - iv['a']) / FADE, (iv['b'] - t) / FADE); al = al * al * (3 - 2 * al)
                y0, x0 = BY - 4, BX - 4
                reg = fr[y0 + 6:y0 + 6 + BUB + 8, x0:x0 + BUB + 8]
                reg[:] = reg * (1 - shadow * al)
                reg = fr[y0:y0 + BUB + 8, x0:x0 + BUB + 8]
                reg[:] = reg * (1 - ring * al) + 255.0 * ring * al
                reg = fr[BY:BY + BUB, BX:BX + BUB]
                m = MASK * al
                reg[:] = reg * (1 - m) + c * m
        for ov in EXTRA:
            if ov['a'] <= t < ov['b']:
                u = min(1.0, (t - ov['a']) / 0.45, (ov['b'] - t) / 0.35); u = max(0.0, u); e = u * u * (3 - 2 * u)
                arr = ov['arr']; h, w = arr.shape[:2]
                x0 = int(ov['x'] + (1 - e) * ov.get('slide', 0)); y0 = int(ov['y'])
                x1, y1 = min(OW, x0 + w), min(OH, y0 + h)
                reg = fr[y0:y1, x0:x1]; src = arr[:y1 - y0, :x1 - x0]
                aa = src[..., 3:4] * e
                reg[:] = reg * (1 - aa) + src[..., :3] * 255.0 * aa
        for a, b, arr in subs:
            if a <= t <= b:
                al = min(1.0, (t - a) / 0.12, (b - t) / 0.12)
                h, w = arr.shape[:2]
                x0 = (OW - w) // 2; y0 = OH - 46 - h
                if any(a0 <= a < b0 for a0, b0 in lumi_shots):   # a line that starts in a logo shot sits under Lumi (she stands on it) for its whole length
                    x0 = int(min(OW - w - 24, max(24, LUMI_X - w / 2)))
                reg = fr[y0:y0 + h, x0:x0 + w]
                aa = arr[..., 3:4] * al
                reg[:] = reg * (1 - aa) + arr[..., :3] * 255.0 * aa
                break
        enc.stdin.write(np.clip(fr + 0.5, 0, 255).astype(np.uint8).tobytes())

    # same segment walk as render.assemble (dissolves and swooshes), with the overlay on every emitted frame
    fidx = 0; pending = []
    for i, seg in enumerate(SEGS):
        nxt_xf = SEGS[i + 1]['xf'] if i + 1 < len(SEGS) else 0
        N = R.nframes(seg)
        p = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', os.path.join(TMP, f'seg_{i:02d}.mp4'),
                              '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
        last = None
        for n in range(N):
            b = p.stdout.read(OW * OH * 3)
            if len(b) == OW * OH * 3: last = np.frombuffer(b, np.uint8).reshape(OH, OW, 3)
            fr = last
            if n < seg['xf'] and pending:
                prev = pending.pop(0)
                if seg.get('tr') == 'swoosh':
                    fr = R.swoosh(prev.astype(np.float32), fr.astype(np.float32), n, seg['xf'])
                else:
                    u = (n + 1) / (seg['xf'] + 1); u = u * u * (3 - 2 * u)
                    fr = (prev.astype(np.float32) * (1 - u) + fr.astype(np.float32) * u + 0.5).astype(np.uint8)
                overlay(fr, fidx); fidx += 1; continue
            if n >= N - nxt_xf:
                pending.append(fr.copy()); continue
            overlay(fr, fidx); fidx += 1
        p.stdout.close(); p.kill(); p.wait()
    for fr in pending:
        overlay(fr, fidx); fidx += 1
    if state['cam']: state['cam'].close()
    enc.stdin.close(); enc.wait()
    return fidx

def voice_track(path, total_s):
    sr = 48000
    buf = np.zeros(int((total_s + 1) * sr), np.float32)
    for g in GROUPS:
        raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(g['v0']), '-t', str(g['v1'] - g['v0'] + 0.3),
                              '-i', CLIP[g['clip']], '-vn', '-ac', '1', '-ar', str(sr),
                              '-af', 'highpass=f=80,afade=t=in:d=0.12,acompressor=threshold=-22dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7',
                              '-f', 'f32le', '-'], capture_output=True).stdout
        a = np.frombuffer(raw, np.float32)
        fade = int(0.22 * sr)
        if len(a) > fade: a = a.copy(); a[-fade:] *= np.linspace(1, 0, fade)
        i0 = int(g['vstart'] * sr)
        buf[i0:i0 + len(a)] += a[:len(buf) - i0]
    import wave
    pcm = (np.clip(buf, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())

def mux(video, voice, out, total_s):
    music = next((os.path.join(HERE, f) for f in sorted(os.listdir(HERE)) if f.startswith('music.')), None)
    if music:
        flt = (f'[1:a]aformat=channel_layouts=stereo[v];'
               f'[2:a]aloop=loop=-1:size=2e9,atrim=0:{total_s:.2f},volume=0.16,afade=t=in:d=2,afade=t=out:st={total_s - 3:.2f}:d=3[m];'
               f'[m][v]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=500[md];'
               f'[v][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]')
        cmd = ['ffmpeg', '-y', '-v', 'error', '-i', video, '-i', voice, '-i', music, '-filter_complex', flt, '-map', '0:v', '-map', '[a]']
    else:
        cmd = ['ffmpeg', '-y', '-v', 'error', '-i', video, '-i', voice, '-map', '0:v', '-map', '1:a', '-af', f'aformat=channel_layouts=stereo,afade=t=out:st={total_s - 1.4:.2f}:d=1.4']
    vf = f'fade=t=in:st=0:d=0.8:color=0xd4d5de,fade=t=out:st={total_s - 1.3:.2f}:d=1.3:color=0xd4d5de'
    subprocess.run(cmd + ['-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], check=True)
    return music

def plan():
    lines = [f'LUMI DEMO v2 (voice-driven). Total {R.tc(TOTAL / FPS)}', '']
    for i, s in enumerate(SEGS):
        lines.append(f'[{i:02d}] {R.tc(STARTS[i] / FPS)}  {s["name"]:<15} dur {s["dur"]:5.2f}  src {s["src"]} tin {s["tin"]:.2f} speed {s["speed"]:.2f}')
    lines.append('')
    for g in GROUPS:
        lines.append(f'voice clip {g["clip"]}: {R.tc(g["vstart"])} - {R.tc(g["vstart"] + g["v1"] - g["v0"])}')
    lines.append('')
    for a, b, t in cues():
        lines.append(f'SUB {R.tc(a)} - {R.tc(b)}  {t}')
    open(os.path.join(HERE, EDL_NAME), 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines[:len(SEGS) + 12]))

if __name__ == '__main__':
    os.makedirs(TMP, exist_ok=True)
    which = sys.argv[1] if len(sys.argv) > 1 else 'plan'
    if which == 'plan':
        plan()
    if which in ('segs', 'all'):
        idx = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else list(range(len(SEGS)))
        with Pool(5) as p:
            for i in p.imap_unordered(R.render_seg, idx):
                print('seg', i, SEGS[i]['name'], 'done', flush=True)
    if which in ('assemble', 'all'):
        silent = os.path.join(TMP, 'video.mp4'); voice = os.path.join(TMP, 'voice.wav')
        n = assemble(silent)
        voice_track(voice, n / FPS)
        m = mux(silent, voice, os.path.join(HERE, 'lumi-demo-v2.mp4'), n / FPS)
        plan()
        print('total', n / FPS, 'music', m)
