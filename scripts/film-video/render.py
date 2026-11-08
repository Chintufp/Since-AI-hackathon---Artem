#!/usr/bin/env python3
"""Lumi demo edit v1 renderer.

Stage 1 renders every segment (speed, freeze, eased crop-zoom) to tmp/seg_NN.mp4.
Stage 2 joins them with cross-dissolves, overlays captions and encodes the final file.
Only reads the raw take / cards; writes inside edit-v1/.
Coordinates for zooms are macOS screen points (1512 x 982); source pixels = points * 2.
"""
import os, sys, subprocess, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = os.path.join(HERE, 'tmp')
TAKE = os.path.join(HERE, '..', 'take-good-1.mov')
SCR = '/private/tmp/claude-501/-Users-artevil-Since-AI-hackathon---Artem/63017ac0-f7e4-45c9-8e26-a11f1e3509fd/scratchpad/film'
FILES = {'intro': '/Users/artevil/Downloads/LoomOpening.mp4', 'card1': f'{SCR}/card1.mp4', 'card2': f'{SCR}/card2.mp4', 'card3': f'{SCR}/card3.mp4'}
OW, OH, FPS = 1920, 1248, 60
SW, SH = 3024, 1964
PW, PH = 1512.0, 982.0

FULL = (756, 491, 1.0)

def kf(*items):
    """items: (t, (cx, cy, z)) pairs"""
    return [(t, v) for t, v in items]

# ---------------------------------------------------------------- EDL
# each segment: name, src, tin, dur (output s), speed (0 = freeze), zoom keyframes, xfade (frames into this seg), captions [(text, local_in, local_out)], vo (voice-over cue)
RAW = (378, 545, 2.0)
FILT = (620, 455, 2.3)
LINK = (960, 465, 2.6)
HYPO = (1285, 455, 2.4)
SLACK_Z = (905, 560, 1.35)
SLACK_LOW = (880, 640, 1.4)
CARD = (1310, 640, 2.0)
WHY = (1310, 558, 1.45)
RECEIPT = (1310, 641, 2.0)
QZ = (560, 560, 1.45)
CHAIN_L = (480, 330, 1.6)
CHAIN_R = (1050, 330, 1.6)
TERM = (420, 270, 2.0)
MARK = (1340, 760, 2.0)

SEGS = [
    dict(name='intro', src='intro', tin=0, dur=10.0, speed=1, zoom=None, xf=0,
         vo='Lumi drops in, the lumi wordmark fades in and out, Lumi hides at the screen edge.'),
    dict(name='hook-peek', src='take', tin=7.7, dur=4.0, speed=1,
         zoom=kf((0, FULL), (0.6, FULL), (3.6, (1180, 680, 1.4)), (4.0, (1180, 680, 1.4))), xf=10,
         vo='Cursor comes near: Lumi peeks out. This is the only interface.'),
    dict(name='card1', src='card1', tin=0, dur=2.5, speed=1, zoom=None, xf=10,
         vo='Part 1: How to capture invisible knowledge.'),
    dict(name='slack-1', src='take', tin=11.95, dur=4.35, speed=1,
         zoom=kf((0, FULL), (0.8, FULL), (3.6, SLACK_Z), (4.35, SLACK_Z)), xf=10,
         vo='Real Slack, #field-ops: oat milk, pizza, and in between a real fault on TRN-418.'),
    dict(name='slack-1-hold', src='take', tin=16.2, dur=5.0, speed=0, zoom=kf((0, SLACK_Z)), xf=0,
         vo='(hold) Mark guesses: probably the v6 template cannot address the N5 port layout.'),
    dict(name='pipeline', src='take', tin=16.5, dur=28.0, speed=20.45 / 28.0,
         zoom=kf((0, FULL), (2.8, FULL), (4.2, RAW), (9.0, RAW), (10.2, FILT), (14.4, FILT),
                 (15.6, LINK), (21.0, LINK), (22.2, HYPO), (26.4, HYPO), (28.0, FULL)), xf=8,
         caps=[('Chatter is ignored.', 4.5, 8.8), ('One case. Evidence 3 of 4.', 16.0, 20.8)],
         vo='Backend page. 1 raw: chatter greyed. 2 filtered. 3 linked: one case, evidence 3 of 4, not enough to ask anyone. 4 hypothesis: Mark\'s guess, what supports it, what is open.'),
    dict(name='card2', src='card2', tin=0, dur=2.5, speed=1, zoom=None, xf=10,
         vo='Part 2: How to be confident in the captured knowledge.'),
    dict(name='slack-2-type', src='take', tin=37.2, dur=4.0, speed=6.4 / 4.0,
         zoom=kf((0, FULL), (1.4, SLACK_LOW), (4.0, SLACK_LOW)), xf=10,
         vo='Artem adds one more line in Slack.'),
    dict(name='slack-2-send', src='take', tin=43.6, dur=1.4, speed=1, zoom=kf((0, SLACK_LOW)), xf=0,
         vo='"Yes, older N5 unit, installed 2019." Sent.'),
    dict(name='flip-pre', src='take', tin=45.1, dur=1.8, speed=0,
         zoom=kf((0, FULL), (0.3, FULL), (1.8, LINK)), xf=8,
         vo='Back on the backend page: evidence 3 of 4...'),
    dict(name='flip', src='take', tin=45.1, dur=2.45, speed=1, zoom=kf((0, LINK)), xf=0,
         caps=[('One more message → 4 of 4.', 1.6, 5.4)],
         vo='...flips to 4 of 4. Enough: Lumi asked.'),
    dict(name='flip-hold', src='take', tin=47.55, dur=3.2, speed=0, zoom=kf((0, LINK)), xf=0,
         vo='(hold on 4 of 4)'),
    dict(name='lumi-card', src='take', tin=47.75, dur=5.95, speed=1,
         zoom=kf((0, FULL), (1.3, FULL), (2.6, CARD), (5.95, CARD)), xf=8,
         caps=[('Lumi asks only now.', 1.4, 5.6)],
         vo='Nobody clicks anything: Lumi comes in from the edge with one line. "TRN-418 (older N5 unit): the v6 template cannot address the N5 port layout. Is that the problem?"'),
    dict(name='lumi-card-hold', src='take', tin=53.7, dur=3.0, speed=0, zoom=kf((0, CARD)), xf=0,
         vo='(hold on the card)'),
    dict(name='why-open', src='take', tin=53.7, dur=1.8, speed=1,
         zoom=kf((0, CARD), (1.2, WHY), (1.8, WHY)), xf=0, vo='"Why this question?" opens.'),
    dict(name='why-hold', src='take', tin=55.5, dur=2.0, speed=0, zoom=kf((0, WHY)), xf=0, vo='(hold on the reasons)'),
    dict(name='why', src='take', tin=55.5, dur=9.0, speed=1,
         zoom=kf((0, WHY), (4.6, WHY), (5.6, RECEIPT), (7.6, RECEIPT), (9.0, FULL)), xf=0,
         caps=[('One tap. Now it’s a fact.', 4.5, 8.5)],
         vo='"Why this question?" shows the evidence behind it. Artem taps Yes: a confirmed problem, his answer is the evidence.'),
    dict(name='slack-3-type', src='take', tin=68.3, dur=2.8, speed=2.0,
         zoom=kf((0, FULL), (1.4, SLACK_LOW), (2.8, SLACK_LOW)), xf=10,
         vo='Artem posts the fix: "Applied the v7.1 patch on TRN-418."'),
    dict(name='slack-3-send', src='take', tin=73.9, dur=0.95, speed=1, zoom=kf((0, SLACK_LOW)), xf=0, vo=''),
    dict(name='questions', src='take', tin=75.0, dur=17.0, speed=1,
         zoom=kf((0, FULL), (1.6, FULL), (3.0, QZ), (15.8, QZ), (17.0, FULL)), xf=10,
         caps=[('Lumi asks the people who can know.', 3.2, 8.4)],
         vo='Colleagues (simulated) hit the same symptom. Lumi decides what to ask and whom: who was asked and why, who else could answer, what changed.'),
    dict(name='slack-4a', src='take', tin=92.4, dur=6.6 / 1.5, speed=1.5,
         zoom=kf((0, FULL), (1.4, SLACK_LOW), (6.6 / 1.5, SLACK_LOW)), xf=10,
         vo='Back in Slack: "TRN-418 traffic restored after the v7.1 patch, no alarms."'),
    dict(name='slack-4b', src='take', tin=99.0, dur=1.2, speed=1, zoom=kf((0, SLACK_LOW)), xf=0, vo=''),
    dict(name='slack-4c', src='take', tin=100.2, dur=6.2 / 1.5, speed=1.5, zoom=kf((0, SLACK_LOW)), xf=0,
         vo='"TRN-418 traffic still stable 2 h after the v7.1 patch."'),
    dict(name='slack-4d', src='take', tin=106.4, dur=2.0, speed=1, zoom=kf((0, SLACK_LOW)), xf=0, vo=''),
    dict(name='chain', src='take', tin=108.7, dur=15.0, speed=5.9 / 15.0,
         zoom=kf((0, FULL), (1.6, FULL), (3.0, CHAIN_L), (7.6, CHAIN_L), (9.2, CHAIN_R), (13.6, CHAIN_R), (15.0, FULL)), xf=10,
         caps=[('Problem → cause → fix → outcome.', 3.2, 13.2)],
         vo='What we know about TRN-418: problem, condition, cause, fix, outcome. Built from chat, no forms.'),
    dict(name='card3', src='card3', tin=0, dur=2.5, speed=1, zoom=None, xf=10,
         vo='Part 3: Autonomy and MCP.'),
    dict(name='terminal', src='take', tin=130.3, dur=15.6, speed=1,
         zoom=kf((0, FULL), (1.6, FULL), (3.0, TERM), (15.6, TERM)), xf=10,
         caps=[('Same knowledge, reused by an agent.', 3.4, 8.8)],
         vo='An AI agent asks Lumi over MCP about TRN-423. Lumi\'s answer comes from TRN-418, quoting Artem and Mark. The agent\'s own question goes to Mark, through Lumi.'),
    dict(name='terminal-hold', src='take', tin=145.9, dur=4.4, speed=0,
         zoom=kf((0, TERM), (3.0, TERM), (4.4, FULL)), xf=0, vo='(pull back)'),
    dict(name='mark-lumi', src='take', tin=146.35, dur=11.4, speed=1,
         zoom=kf((0, FULL), (5.0, FULL), (6.8, MARK), (11.4, MARK)), xf=10,
         caps=[('The agent asks Mark — through Lumi.', 1.6, 10.6, 1060)],
         vo='On Mark\'s side, his Lumi drops in by itself, carrying the agent\'s question.'),
    dict(name='mark-lumi-hold', src='take', tin=157.7, dur=1.5, speed=0, zoom=kf((0, MARK)), xf=0, vo=''),
    dict(name='end-logo', src='intro', tin=4.0, dur=3.0, speed=1, zoom=None, xf=24,
         vo='Lumi logo. End.'),
]

# swoosh (whip-pan push with motion blur) on every scene change; soft dissolve into the first desktop shot and the closing logo
SWOOSH_F = 22
for _i, _seg in enumerate(SEGS):
    if _i > 0 and _seg['xf'] > 0 and _seg['name'] not in ('hook-peek', 'end-logo'):
        _seg['tr'] = 'swoosh'; _seg['xf'] = SWOOSH_F

def _hblur(img, k):
    """box blur along x, width k (frames already float32)"""
    if k < 2:
        return img
    c = np.cumsum(np.pad(img, ((0, 0), (k, 0), (0, 0)), mode='edge'), axis=1)
    return (c[:, k:] - c[:, :-k]) / k

def swoosh(prev, new, n, N):
    def pos(x):  # ease in-out (quintic-ish), 0..1
        return x * x * x * (x * (6 * x - 15) + 10)
    u = pos((n + 1) / (N + 1)); u0 = pos(n / (N + 1))
    off = int(round(u * OW))
    out = np.empty((OH, OW, 3), np.float32)
    out[:, :OW - off] = prev[:, off:]
    out[:, OW - off:] = new[:, :off]
    k = int(abs(u - u0) * OW * 0.9)
    out = _hblur(out, min(k, 400))
    return (out + 0.5).astype(np.uint8)

# ---------------------------------------------------------------- zoom maths
def box_of(v):
    cx, cy, z = v
    w, h = PW / z, PH / z
    x0 = min(max(cx - w / 2, 0), PW - w)
    y0 = min(max(cy - h / 2, 0), PH - h)
    return np.array([x0, y0, x0 + w, y0 + h]) * 2.0  # source px

def ease(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u) if u < 1 else 1.0

def ease_c(u):  # smoother (quintic) for slow push-ins
    u = min(max(u, 0.0), 1.0)
    return u * u * u * (u * (u * 6 - 15) + 10)

def box_at(zoom, t):
    if t <= zoom[0][0]:
        return box_of(zoom[0][1])
    for (t0, v0), (t1, v1) in zip(zoom, zoom[1:]):
        if t0 <= t <= t1:
            b0, b1 = box_of(v0), box_of(v1)
            if t1 == t0:
                return b1
            u = ease_c((t - t0) / (t1 - t0))
            return b0 + (b1 - b0) * u
    return box_of(zoom[-1][1])

# ---------------------------------------------------------------- stage 1
def nframes(seg):
    return int(round(seg['dur'] * FPS))

def render_seg(i):
    seg = SEGS[i]
    out = os.path.join(TMP, f'seg_{i:02d}.mp4')
    N = nframes(seg)
    enc = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                            '-s', f'{OW}x{OH}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'veryfast',
                            '-crf', '6', '-pix_fmt', 'yuv444p', out], stdin=subprocess.PIPE)
    if seg['src'] == 'take':
        w, h = SW, SH
        if seg['speed'] == 0:
            cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(seg['tin']), '-i', TAKE,
                   '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
        else:
            s = seg['speed']
            cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(seg['tin']),
                   '-t', f'{seg["dur"] * s + 0.2:.3f}', '-i', TAKE, '-vf', f'setpts=(PTS-STARTPTS)/{s:.6f},fps={FPS}',
                   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    else:
        w, h = OW, OH
        cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(seg['tin']), '-i', FILES[seg['src']],
               '-t', f'{seg["dur"] + 0.2:.3f}', '-vf', seg.get('vf', f'fps={FPS},scale={OW}:{OH}'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    cmd = [c if c != 'error' else 'fatal' for c in cmd]
    dec = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    fsz = w * h * 3
    last = None
    got = 0
    for n in range(N):
        buf = None
        if not (seg['src'] == 'take' and seg['speed'] == 0 and last is not None):
            b = dec.stdout.read(fsz)
            if len(b) == fsz:
                buf = b
                got += 1
        if buf is not None:
            last = Image.frombuffer('RGB', (w, h), buf, 'raw', 'RGB', 0, 1)
        img = last
        if seg['src'] == 'take':
            box = box_at(seg['zoom'], n / FPS)
            img = img.resize((OW, OH), Image.LANCZOS, box=tuple(float(x) for x in box))
        enc.stdin.write(img.tobytes())
    dec.stdout.close(); dec.kill(); dec.wait()
    enc.stdin.close(); enc.wait()
    if seg['src'] != 'take' or seg['speed'] != 0:
        if got < N:
            print(f'WARNING seg {i} {seg["name"]}: only {got}/{N} frames decoded', flush=True)
    return i

# ---------------------------------------------------------------- captions
FONT = '/System/Library/Fonts/SFNS.ttf'

def caption_img(text):
    S = 3  # supersample
    f = ImageFont.truetype(FONT, 34 * S)
    try:
        f.set_variation_by_name('Medium')
    except Exception:
        pass
    l, t, r, b = f.getbbox(text)
    asc, desc = f.getmetrics()
    padx, pady = 26 * S, 16 * S
    tw = r - l
    th = asc + desc
    W, H = tw + 2 * padx, int(th * 0.92) + 2 * pady
    im = Image.new('RGBA', (W + 2 * S, H + 2 * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((S, S, W + S - 1, H + S - 1), radius=12 * S, fill=(255, 255, 255, 250),
                        outline=(17, 17, 17, 255), width=S)
    d.text((S + padx - l, S + pady + int(th * 0.92 - th) // 2 + 2 * S), text, font=f, fill=(17, 17, 17, 255))
    im = im.resize(((W + 2 * S) // S, (H + 2 * S) // S), Image.LANCZOS)
    return im

CAP_X, CAP_BOTTOM = 72, 1112
CAP_FADE = 0.3

# ---------------------------------------------------------------- stage 2
def timeline():
    starts = []
    t = 0.0  # in frames
    for i, seg in enumerate(SEGS):
        if i == 0:
            s = 0
        else:
            s = t - seg['xf']
        starts.append(s)
        t = s + nframes(seg)
    return starts, t

def assemble(out):
    starts, total = timeline()
    caps = []
    for i, seg in enumerate(SEGS):
        for c in seg.get('caps', []):
            text, a, b = c[:3]
            im = caption_img(text)
            arr = np.asarray(im).astype(np.float32) / 255.0
            caps.append(dict(text=text, a=starts[i] / FPS + a, b=starts[i] / FPS + b, arr=arr,
                             bottom=c[3] if len(c) > 3 else CAP_BOTTOM))
    enc = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                            '-s', f'{OW}x{OH}', '-r', str(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'slow',
                            '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out],
                           stdin=subprocess.PIPE)
    fsz = OW * OH * 3

    def reader(i):
        p = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', os.path.join(TMP, f'seg_{i:02d}.mp4'),
                              '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
        N = nframes(SEGS[i]); last = None
        for n in range(N):
            b = p.stdout.read(fsz)
            if len(b) == fsz:
                last = np.frombuffer(b, np.uint8).reshape(OH, OW, 3)
            yield last
        p.stdout.close(); p.kill(); p.wait()

    def emit(frame, fidx):
        t = fidx / FPS
        fr = None
        for c in caps:
            if c['a'] - 0.001 <= t <= c['b']:
                alpha = min(1.0, (t - c['a']) / CAP_FADE, (c['b'] - t) / CAP_FADE)
                alpha = max(0.0, alpha)
                alpha = alpha * alpha * (3 - 2 * alpha)
                if fr is None:
                    fr = frame.astype(np.float32)
                h, w = c['arr'].shape[:2]
                y0 = c['bottom'] - h
                reg = fr[y0:y0 + h, CAP_X:CAP_X + w]
                a = c['arr'][..., 3:4] * alpha
                reg[:] = reg * (1 - a) + c['arr'][..., :3] * 255.0 * a
        if fr is not None:
            frame = np.clip(fr + 0.5, 0, 255).astype(np.uint8)
        enc.stdin.write(np.ascontiguousarray(frame).tobytes())

    fidx = 0
    pending = []  # tail frames of previous segment held back for the dissolve
    for i, seg in enumerate(SEGS):
        nxt_xf = SEGS[i + 1]['xf'] if i + 1 < len(SEGS) else 0
        N = nframes(seg)
        for n, fr in enumerate(reader(i)):
            if n < seg['xf'] and pending:
                prev = pending.pop(0)
                if seg.get('tr') == 'swoosh':
                    emit(swoosh(prev.astype(np.float32), fr.astype(np.float32), n, seg['xf']), fidx); fidx += 1
                    continue
                u = (n + 1) / (seg['xf'] + 1)
                u = u * u * (3 - 2 * u)
                fr = (prev.astype(np.float32) * (1 - u) + fr.astype(np.float32) * u + 0.5).astype(np.uint8)
                emit(fr, fidx); fidx += 1
                continue
            if n >= N - nxt_xf:
                pending.append(fr.copy())
                continue
            emit(fr, fidx); fidx += 1
    for fr in pending:
        emit(fr, fidx); fidx += 1
    enc.stdin.close(); enc.wait()
    return starts, fidx

def tc(sec):
    m = int(sec // 60); s = sec - 60 * m
    return f'{m}:{s:05.2f}'

def write_docs(starts, total):
    lines = ['LUMI DEMO EDIT v1 - EDL', f'Output 1920x1248, 60 fps, H.264 CRF 18, no audio. Total {tc(total / FPS)} ({total / FPS:.2f} s).',
             'Zoom notation: (cx, cy in screen points of the 1512x982 take, zoom factor). FULL = whole screen.',
             'Source times are seconds in take-good-1.mov. xfade = dissolve length (frames @60) into the segment.', '']
    names = {FULL: 'FULL', RAW: 'RAW col', FILT: 'FILTERED col', LINK: 'LINKED/evidence', HYPO: 'HYPOTHESIS col',
             SLACK_Z: 'Slack msgs', SLACK_LOW: 'Slack lower msgs+composer', CARD: "Lumi's card", WHY: 'card + Why panel',
             RECEIPT: 'receipt card', QZ: 'chain+latest question', CHAIN_L: 'chain left', CHAIN_R: 'chain right',
             TERM: 'Terminal output', MARK: "Mark's Lumi"}
    for i, seg in enumerate(SEGS):
        a = starts[i] / FPS; b = a + nframes(seg) / FPS
        if seg['src'] == 'take':
            if seg['speed'] == 0:
                src = f'take {seg["tin"]:.2f} FREEZE'
            else:
                src = f'take {seg["tin"]:.2f}-{seg["tin"] + seg["dur"] * seg["speed"]:.2f} @{seg["speed"]:.2f}x'
        else:
            src = f'{seg["src"]}.mp4 0-{seg["dur"]:.1f}'
        lines.append(f'[{i:02d}] {tc(a)} - {tc(b)}  {seg["name"]:<15} {src}   xfade {seg["xf"]}f')
        if seg.get('zoom'):
            zs = ', '.join(f'{t:.1f}s {names.get(v, str(v))}' for t, v in seg['zoom'])
            lines.append(f'       zoom: {zs}')
        for text, ca, cb, *_ in seg.get('caps', []):
            lines.append(f'       CAPTION "{text}"  {tc(a + ca)} - {tc(a + cb)}')
    open(os.path.join(HERE, 'edl.txt'), 'w').write('\n'.join(lines) + '\n')
    vo = ['LUMI DEMO EDIT v1 - VOICE-OVER CUES (output timecode -> on screen)', '']
    for i, seg in enumerate(SEGS):
        if seg.get('vo'):
            vo.append(f'{tc(starts[i] / FPS)}  {seg["vo"]}')
        for text, ca, cb, *_ in seg.get('caps', []):
            vo.append(f'{tc(starts[i] / FPS + ca)}    [caption] {text}')
    vo.append(f'{tc(total / FPS)}  END')
    open(os.path.join(HERE, 'voiceover-cues.txt'), 'w').write('\n'.join(vo) + '\n')

if __name__ == '__main__':
    os.makedirs(TMP, exist_ok=True)
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if which in ('all', 'segs'):
        idx = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else list(range(len(SEGS)))
        with Pool(5) as p:
            for i in p.imap_unordered(render_seg, idx):
                print('seg', i, SEGS[i]['name'], 'done', flush=True)
    if which in ('all', 'assemble'):
        starts, total = assemble(os.path.join(HERE, 'lumi-demo-edit-v1.mp4'))
        write_docs(starts, total)
        print('total', total / FPS)
    if which == 'times':
        starts, total = timeline()
        write_docs(starts, total)
        print('total', total / FPS)
