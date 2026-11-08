"""Part 1 film data, computed for real: the film channel's messages (from the running service), relevance from the
service's rules classifier, bge-m3 embeddings (local Ollama), scores against the open cases, hypotheses, and one
problem sentence from qwen3 (local). Read-only against the service."""
import json, math, urllib.request, datetime as dt
SVC = 'http://127.0.0.1:47831'
OLL = 'http://127.0.0.1:11434'
get = lambda p: json.load(urllib.request.urlopen(SVC + p))
def post(url, body):
    r = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'content-type': 'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=300))
pipe = get('/pipeline.json'); cases = get('/cases')
msgs = pipe['raw']
def embed(texts): return post(OLL + '/api/embed', {'model': 'bge-m3', 'input': texts})['embeddings']
def cos(a, b):
    return sum(x * y for x, y in zip(a, b)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))
rel = [m for m in msgs if m['useful']]
# open problems: the stored cases, by their card text (title + what was said)
def card(c):
    said = [n.get('detail', '') for n in c.get('timeline', []) if n.get('stage') == 'observation']
    return c['title'] + '. ' + ' '.join(said)[:400]
cards = [(c['caseId'], c['title'], card(c), c) for c in cases]
E_msg = embed([m['text'] for m in rel]); E_case = embed([x[2] for x in cards])
t_last = {}
for cid, title, txt, c in cards:
    times = [s.get('when') for s in c.get('sources', []) if s.get('when')]
    t_last[cid] = max(times) if times else None
now = dt.datetime.fromisoformat(msgs[-1]['time'].replace('Z', '+00:00'))
def time_score(cid):
    t = t_last.get(cid)
    if not t: return 0.2
    try: d = (now - dt.datetime.fromisoformat(t.replace('Z', '+00:00'))).total_seconds() / 86400
    except Exception: return 0.2
    return round(math.exp(-max(d, 0) / 7), 2)
live_case = pipe['cases'][0]['caseId'] if pipe['cases'] else None
rows = []
for m, e in zip(rel, E_msg):
    sc = []
    for (cid, title, txt, c), ec in zip(cards, E_case):
        meaning = cos(e, ec); tm = time_score(cid); conv = 1.0 if cid == live_case else 0.0
        total = 0.6 * meaning + 0.25 * tm + 0.15 * conv
        sc.append(dict(caseId=cid, title=title, meaning=round(meaning, 2), time=tm, conversation=conv, total=round(total, 2)))
    sc.sort(key=lambda x: -x['total'])
    rows.append(dict(author=m['author'], text=m['text'], vec=[round(v, 3) for v in e[:24]], scores=sc[:3]))
# hypotheses for the cluster: mean of the messages' scores per case, plus "a new problem"
agg = {}
for r in rows:
    for s in r['scores']: agg.setdefault(s['caseId'], []).append(s)
hyp = []
for cid, ss in agg.items():
    hyp.append(dict(kind='existing', caseId=cid, title=ss[0]['title'], score=round(sum(s['total'] for s in ss) / len(rows), 2)))
hyp.sort(key=lambda h: -h['score'])
best = hyp[0]['score'] if hyp else 0
hyp = hyp[:2] + [dict(kind='new', title='a new problem', score=round(max(0.05, 1 - best - 0.1), 2))]
hyp.sort(key=lambda h: -h['score'])
prompt = ('Messages from an engineers\' chat channel about one problem:\n' + '\n'.join(f'- {r["author"]}: {r["text"]}' for r in rows) +
          '\n\nWrite ONE precise sentence stating the problem: the unit, the symptom, the condition and the suspected cause. '
          'Use only facts from the messages; mark the cause as suspected. No preamble.')
g = post(OLL + '/api/generate', {'model': 'qwen3:4b', 'prompt': prompt, 'stream': False, 'think': False, 'options': {'temperature': 0.2}})
sentence = g['response'].strip().split('\n')[0].strip()
out = dict(messages=[dict(author=m['author'], text=m['text'], time=m['time'], relevant=m['useful'], type=(m['kept'][0]['type'] if m['kept'] else None)) for m in msgs],
           rows=rows, hypotheses=hyp, llm=dict(model='qwen3:4b (local)', sentence=sentence), embedModel='bge-m3 (local)', weights=dict(meaning=0.6, time=0.25, conversation=0.15))
json.dump(out, open('data.json', 'w'), indent=1)
print(json.dumps(dict(hyp=hyp, sentence=sentence, top=[(r['text'][:40], r['scores'][0]) for r in rows]), indent=1))
