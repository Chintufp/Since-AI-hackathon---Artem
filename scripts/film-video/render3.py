"""Lumi demo v3: the ~2:00 cut in the organizers' structure (problem, solution, live demo, business impact).

Sentences are cut out of Artem's clips (no speed change). Each voice block is first joined into one file
(tmp3/blocks/<id>.mp4), then the v2 machinery (render2) lays the picture on top.

python3 render3.py plan | segs | assemble | all
"""
import os, sys, json, subprocess, copy
import render as R
import render2 as M

HERE = R.HERE
R.TMP = M.TMP = TMP = os.path.join(HERE, 'tmp3')
BLK = os.path.join(TMP, 'blocks')
SCR = M.SCR
SRC = dict(M.CLIP)
SRC[8] = M.DL + 'How Elisa Uses Local AI for Onboarding.mp4'
SRC[9] = f'{SCR}/vo/newline.mp4'   # voice memo, audio only (black picture; no bubble)
R.FILES['conn'] = f'{SCR}/film/conn-motion.mp4'
R.FILES['cluster'] = f'{SCR}/film/cluster.mp4'
TR0 = json.load(open(f'{SCR}/vo/transcripts.json'))

# Voice blocks as pieces (clip, in, out), cut between words.
TEMPO = 1.12
PIECES = {
    'b1': [(1, 0.0, 5.6), (1, 11.22, 18.25), (1, 21.02, 23.4)],                 # problem, solution, I'm Artem
    'b2': [(2, 0.55, 8.05)],                                                     # connections, we chose Slack
    'b3': [(3, 3.22, 17.2), (3, 21.25, 23.72), (3, 26.04, 27.8)],                                 # classification .. one precise sentence
    'b4': [(4, 0.95, 3.55), (4, 6.25, 8.2)],                                    # just a hypothesis. how do you know?
    'b5': [(6, 5.70, 6.95), (6, 8.70, 13.7), (6, 19.48, 23.7)],                                  # we ask, Lumi; asks the reporter
    'b6n': [(9, 3.30, 14.95)],                                                   # many candidate questions, decentralised
    'b6': [(5, 10.55, 26.8)],                                  # binary questions, RL, every fact confirmed
    'b7': [(7, 6.12, 8.6), (7, 12.42, 21.0)],                                                     # MCP
    'b8': [(8, 0.0, 8.0), (8, 13.78, 26.9), (7, 27.05, 31.85)],                 # business impact, real/simulated, tagline
}

def _words(k):
    return [w for seg in TR0[str(k)]['segments'] for w in seg.get('words', [])]

def refine(k, a, z):
    ws = _words(k)
    inside = [w for w in ws if a - 0.02 <= w['start'] < z]
    if not inside: return a, z
    before = [w for w in ws if w['end'] <= inside[0]['start'] and w is not inside[0] and w['start'] < inside[0]['start']]
    after = [w for w in ws if w['start'] > inside[-1]['start']]
    a2 = max(before[-1]['end'] + 0.06 if before else 0.0, inside[0]['start'] - 0.16)
    z2 = min(after[0]['start'] - 0.06 if after else inside[-1]['end'] + 0.6, inside[-1]['end'] + 0.32)
    return round(min(a, a2) if a2 >= (before[-1]['end'] + 0.06 if before else 0) else a, 3), round(max(z, z2), 3)

PIECES = {b: [(k, *refine(k, a, z)) for k, a, z in ps] for b, ps in PIECES.items()}

def make_blocks():
    os.makedirs(BLK, exist_ok=True)
    for b, ps in PIECES.items():
        out = os.path.join(BLK, f'{b}.mp4')
        if os.path.exists(out): continue
        ins, fl = [], []
        for i, (k, a, z) in enumerate(ps):
            ins += ['-ss', f'{a:.3f}', '-t', f'{z - a:.3f}', '-i', SRC[k]]
            fl.append(f'[{i}:v]fps=30,scale=1920:1080,setsar=1,setpts=(PTS-STARTPTS)/{TEMPO}[v{i}];'
                      f'[{i}:a]aresample=48000,aformat=channel_layouts=mono,afftdn=nr=8:nf=-34,afade=t=in:d=0.07,afade=t=out:st={max(0, z - a - 0.14):.3f}:d=0.14,atempo={TEMPO},asetpts=PTS-STARTPTS[a{i}]')
        cat = ''.join(f'[v{i}][a{i}]' for i in range(len(ps))) + f'concat=n={len(ps)}:v=1:a=1[v][a]'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', ';'.join(fl) + ';' + cat,
                        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '14', '-c:a', 'pcm_s16le', out.replace('.mp4', '.mov')], check=True)
        os.replace(out.replace('.mp4', '.mov'), out)

def block_len(b):
    return sum(z - a for _, a, z in PIECES[b]) / TEMPO

def block_words(b):
    out, off = [], 0.0
    for k, a, z in PIECES[b]:
        for s in TR0[str(k)]['segments']:
            for w in s.get('words', []):
                if a - 0.02 <= w['start'] < z:
                    out.append(dict(w, start=(w['start'] - a) / TEMPO + off, end=(min(w['end'], z) - a) / TEMPO + off))
        off += (z - a) / TEMPO
    return out

make_blocks()
M.CLIP = {b: os.path.join(BLK, f'{b}.mp4') for b in PIECES}
for b in PIECES:
    R.FILES[f'cam{b}'] = M.CLIP[b]
M.TR = {b: {'segments': [{'words': block_words(b)}]} for b in PIECES}
M.WFIX.append((['there', 'are', 'no', '-how', 'stay.'], ['their', 'know-how', 'stays.', '', '']))
M.EDL_NAME = 'edl3.txt'
M.WFIX.append((['Arial'], ['RL']))
M.WFIX.append((['tabs'], ['taps']))

take, cam = M.take, M.cam
def card(n, dur=1.0):
    c = M.card(n); c['dur'] = dur; return c
L = {b: block_len(b) for b in PIECES}
M.BLOCKS = [
    ('b1', 0.0, L['b1'], [dict(name='intro', src='intro', tin=0, dur=7.4, speed=1, zoom=None, xf=0, vf=f'fps=60,scale=1920:1248,crop=1920:{1248 - 96}:0:96,pad=1920:1248:0:0:color=0xd4d5de'), cam('b1', 7.0, xf=18, tr=None)]),
    ('card', 1),
    ('b2', 0.0, L['b2'], [dict(name='conn', src='conn', tin=0.35, dur=5.9, speed=1, zoom=None, xf=22, tr='swoosh'), take('slack-1', 2.0, tr='swoosh', xf=22)]),
    ('b3', 0.0, L['b3'], [dict(name='cluster', src='cluster', tin=0.0, dur=22.5, speed=1, zoom=None, xf=22, tr='swoosh', vf=f'setpts=PTS/{TEMPO},fps=60,scale=1920:1248')]),
    ('b4', 0.0, L['b4'], [cam('b4', 4.5)]),
    ('card', 2),
    ('b5', 0.0, L['b5'], [take('hook-peek', 3.2, tr='swoosh', xf=22), take('lumi-card', 4.6), take('lumi-card-hold', 2.2), take('why', 3.0, tin=60.0, speed=1.5)]),
    ('b6n', 0.0, L['b6n'], [take('questions', 10.5, tr='swoosh', xf=22)]),
    ('b6', 0.0, L['b6'], [take('chain', 6.0, tr='swoosh', xf=22), take('slack-4a', 2.4, tr='swoosh', xf=22), take('slack-4c', 2.2)]),
    ('card', 3),
    ('b7', 0.0, L['b7'], [take('terminal', 11.0, tr='swoosh', xf=22), take('mark-lumi', 3.8, tr='swoosh', xf=22)]),
    ('b8', 0.0, L['b8'], [cam('b8', 14.3), dict(take('questions', 6.9, tr='swoosh', xf=22), name='questions-sim'),
                          dict(name='end-logo', src='intro', tin=3.0, dur=5.0, speed=1, zoom=None, xf=24, vf=f'trim=0:3.6,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=12,fps=60,scale=1920:1248,crop=1920:{1248 - 96}:0:96,pad=1920:1248:0:0:color=0xd4d5de,scale=3840:2496,zoompan=z=\'min(1+on/9000,1.05)\':d=1:x=\'iw/2-(iw/zoom/2)\':y=\'ih*0.55-(ih/zoom*0.55)\':s=1920x1248:fps=60')]),
]
M.PAD = 0.1
M.NO_CAM = {'b6n'}
M.END_HOLD = 2.0
M.LEAD = 0.5
SEGS, GROUPS = M.build()
for b in M.BLOCKS:                     # cards between blocks: shorter in this cut
    pass
for s in SEGS:
    if s['name'].startswith('card'): s['dur'] = 1.0
M.SEGS, M.GROUPS = SEGS, GROUPS
M.STARTS, M.TOTAL = M.fit(SEGS, GROUPS)
R.SEGS = SEGS

# Overlays: the 'No fancy UI here' note in the top-right corner over every backend shot; the MCP card in the agent scene
import overlays as OV
def seg_span(name):
    i = next(k for k, s in enumerate(SEGS) if s['name'] == name)
    return M.STARTS[i] / M.FPS, (M.STARTS[i] + R.nframes(SEGS[i])) / M.FPS
note = OV.no_fancy_ui(); mcp = OV.mcp_card()
spans = []
for n, delay in [('cluster', 2.4), ('questions', 0.5), ('chain', 0.3), ('questions-sim', 0.5)]:
    a, b = seg_span(n); a += delay
    if spans and a - spans[-1][1] < 1.4: spans[-1][1] = b
    else: spans.append([a, b - 0.25])
M.EXTRA = [dict(a=a, b=b, arr=note, x=M.OW - note.shape[1] - 6, y=6, slide=90) for a, b in spans]
ta, _ = seg_span('terminal'); _, tb = seg_span('terminal')
tg = OV.tagline()
ea, eb = seg_span('end-logo')
g8 = next(g for g in GROUPS if g['clip'] == 'b8')
v_end = g8['vstart'] + (g8['v1'] - g8['v0'])
M.EXTRA.append(dict(a=v_end - 0.4, b=eb + 1.0, arr=tg, x=376, y=632, slide=0))
M.EXTRA.append(dict(a=ta + 1.2, b=tb - 0.3, arr=mcp, x=M.OW - mcp.shape[1] - 10, y=M.OH - 46 - 58 - 14 - mcp.shape[0], slide=120))

if __name__ == '__main__':
    os.makedirs(TMP, exist_ok=True)
    which = sys.argv[1] if len(sys.argv) > 1 else 'plan'
    if which in ('plan', 'all'):
        M.plan()
    if which in ('segs', 'all'):
        from multiprocessing import Pool
        idx = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else list(range(len(SEGS)))
        with Pool(5) as p:
            for i in p.imap_unordered(R.render_seg, idx):
                print('seg', i, SEGS[i]['name'], 'done', flush=True)
    if which in ('assemble', 'all'):
        silent = os.path.join(TMP, 'video.mp4'); voice = os.path.join(TMP, 'voice.wav')
        n = M.assemble(silent)
        M.voice_track(voice, n / M.FPS)
        m = M.mux(silent, voice, os.path.join(HERE, 'lumi-demo-v3.mp4'), n / M.FPS)
        print('total', n / M.FPS, 'music', m)
