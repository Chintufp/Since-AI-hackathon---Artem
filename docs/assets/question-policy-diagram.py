"""Render the proposed Knowledge Twin policy diagram; this is figure code only.

Requires matplotlib. Outputs PNG and SVG beside this file.
"""

from pathlib import Path
import os

os.environ.setdefault("MPLCONFIGDIR", "/tmp/knowledge-twin-mpl")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, PathPatch
from matplotlib.path import Path as MplPath

OUT = Path(__file__).resolve().parent
plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "mathtext.fontset": "stix",
    "svg.fonttype": "path",
    "font.size": 16,
    "savefig.facecolor": "white",
})

fig, ax = plt.subplots(figsize=(16, 11), dpi=120)
fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
ax.set(xlim=(0, 1600), ylim=(0, 1100))
ax.axis("off")

INK = "#242830"
MUTED = "#56616f"
BLUE = "#d9e8f7"
BLUE_INK = "#416a8b"
PINK = "#efd0d4"
PINK_INK = "#955565"
GOLD = "#f3e7ce"
GRAY = "#eef0f2"
TEXTS = []


def text(x, y, value, size=16, color=INK, ha="center", **kwargs):
    artist = ax.text(x, y, value, fontsize=size, color=color, ha=ha,
                     va="center", **kwargs)
    TEXTS.append(artist)
    return artist


def box(x, y, w, h, fill, title, title_size=16):
    ax.add_patch(FancyBboxPatch((x, y), w, h,
        boxstyle="round,pad=0,rounding_size=14", linewidth=0,
        facecolor=fill, zorder=2))
    text(x+w/2, y+h-30, title, title_size, fontweight="medium", zorder=3)


def arrow(start, end, color=INK, dashed=False, width=1.65):
    patch = FancyArrowPatch(start, end, arrowstyle="-|>",
        mutation_scale=14, linewidth=width, color=color,
        linestyle=(0, (4, 4)) if dashed else "-",
        shrinkA=2, shrinkB=2, zorder=1)
    ax.add_patch(patch)


def routed(points, color=INK, dashed=False, width=1.65):
    path = MplPath(points, [MplPath.MOVETO] + [MplPath.LINETO]*(len(points)-1))
    ax.add_patch(PathPatch(path, fill=False, color=color, linewidth=width,
        linestyle=(0, (4, 4)) if dashed else "-", capstyle="round", joinstyle="round", zorder=1))
    # The separate short tip keeps corners and the arrowhead crisp in vector output.
    p, q = points[-2], points[-1]
    tip = (q[0] + (p[0]-q[0])*0.16, q[1] + (p[1]-q[1])*0.16)
    arrow(tip, q, color=color, width=width)


text(60, 1057, "Knowledge Twin · Question and recipient selection", 25, ha="left", fontweight="medium")
text(60, 1018, "Proposed mathematical formulation  /  evidence updates online; policy changes after evaluation", 15.5, MUTED, ha="left")

text(60, 968, r"$s_t=(x_t,\mathcal{E}_t,\mathcal{H}_t,\mathcal{P}_t,b_t)$", 25, ha="left")
text(645, 972, "problem · evidence · candidate explanations/procedures", 14.5, MUTED, ha="left")
text(645, 948, "people and their contributions · budget/cooldown state", 14.5, MUTED, ha="left")

# Immediate knowledge feedback is distinct from the dashed model-update path.
routed([(1375, 835), (1375, 900), (175, 900), (175, 835)], color=BLUE_INK, width=1.9)
text(775, 917, r"New evidence $\rightarrow$ next investigation step $s_{t+1}$", 16, BLUE_INK,
     bbox=dict(facecolor="white", edgecolor="none", pad=2))

xs = [50, 350, 650, 950, 1250]
titles = ["1  CURRENT STATE", "2  PROPOSE PAIRS", "3  HARD FILTERS", "4  CHOOSE / DEFER", "5  UPDATE EVIDENCE"]
fills = [BLUE, PINK, GOLD, PINK, BLUE]
for x, title, fill in zip(xs, titles, fills):
    box(x, 670, 250, 165, fill, title, 14.8)

text(175, 754, r"$s_t$", 31)
text(175, 711, "Known facts, people\nand important gaps", 14.5, linespacing=1.45)

text(475, 751, r"$\mathcal{C}_t=G_{\phi}(s_t)$", 23)
text(475, 708, "Templates + LLM\nQuestion–person pairs", 13.9, linespacing=1.45)

text(775, 754, r"$\mathcal{A}_t$", 31)
text(775, 711, "Access, relevance,\nbudgets and cooldowns", 14.0, linespacing=1.45)

text(1075, 751, r"$a_t\sim\pi_{\theta}(\cdot\mid s_t)$", 21)
text(1075, 708, "Eligible pair or defer\nBaseline / learned selector", 13.1, linespacing=1.45)

text(1375, 763, r"$\mathcal{E}_{t+1}=$", 23)
text(1375, 729, r"$U(\mathcal{E}_t,a_t,y_t)$", 23)
text(1375, 694, "Attributed evidence", 14.0)

for left, right in zip(xs[:-1], xs[1:]):
    arrow((left+250, 752), (right, 752))
for x, label in [(325, r"$s_t$"), (625, r"$\mathcal{C}_t$"), (925, r"$\mathcal{A}_t$"), (1225, r"$a_t$")]:
    text(x, 777, label, 20)

text(590, 628,
     r"$\mathcal{A}_t=\{(q,p)\in\mathcal{C}_t:g(s_t,q,p)=1\}\cup\{\bot\}$",
     23)
text(590, 599, r"$\bot$ = defer; $\pi_{\theta}(a\mid s_t)=0$ for $a\notin\mathcal{A}_t$", 16, MUTED)

# External observation enters the factual update, never as a direct Yes=reward edge.
box(1130, 530, 210, 60, GRAY, "Engineer / simulator", 13.1)
arrow((1125, 670), (1185, 590))
text(1160, 651, r"$a_t\ne\bot$", 16, ha="left")
arrow((1235, 590), (1225, 750))
text(1260, 639, r"$y_t$", 21, ha="left")
text(1235, 510, "Defer: no human query", 12.8, MUTED)

# Downstream assessment receives an action/evidence trace plus independent outcome evidence.
box(1010, 300, 490, 180, GOLD, "6  ASSESS DECISION BENEFIT & EFFORT", 15.7)
text(1255, 402, r"$r_t=\Delta V_t-\lambda\kappa_t$", 29)
text(1255, 358, "Supported decision improvement − effort cost", 14.2)
text(1255, 328, "Delayed or missing benefit stays explicit", 13.2, MUTED)
arrow((1375, 670), (1375, 480))
text(1394, 503, "decision trace", 12.6, MUTED, ha="left")

text(1255, 250, "Scenario truth / independently assessed outcomes", 13.8, MUTED)
arrow((1255, 272), (1255, 299), color=MUTED)

box(275, 300, 515, 180, PINK, "7  LOG · TRAIN · EVALUATE", 16.4)
text(532.5, 411,
     r"$\mathcal{D}_k=\{(s_t,\mathcal{A}_t,a_t,\rho_t,y_t,r_t^{?},m_t)\}$", 20)
text(532.5, 370, r"$\theta^{\prime}=\mathrm{Train}(\mathcal{D}_k)$", 25)
text(532.5, 330, "Held-out evaluation + review before adoption", 14.0)
arrow((1010, 390), (790, 390))
text(900, 418, r"$r_t^{?}$ + trace", 17)

routed([(532.5, 480), (532.5, 545), (1075, 545), (1075, 670)], color=PINK_INK, dashed=True, width=1.9)
text(800, 568, r"Validated $\theta_{\mathrm{next}}$ · next batch", 15.4, PINK_INK,
     bbox=dict(facecolor="white", edgecolor="none", pad=2))

# Compact notation key keeps the figure interpretable without implementation details.
ax.plot([50, 1500], [211, 211], color="#d8dce1", linewidth=0.9)
text(50, 180, "NOTATION", 12.8, MUTED, ha="left", fontweight="medium")
text(50, 147, r"$q$: question;  $p$: recipient;  $g$: hard eligibility test;  $\phi$: candidate generator", 15.0, ha="left")
text(50, 115, r"$\rho_t$: logged action probability;  $m_t$: benefit observed;  $r_t^{?}$: may be missing", 15.0, ha="left")
text(50, 82, r"$y_t$: Yes / No / Unknown / Skip / timeout; factual Yes/No is not the reward", 15.0, ha="left")

text(1050, 147, "Hard limits cannot be traded for reward.", 13.0, MUTED, ha="left")
text(1050, 115, "Unknown/skip adds no positive or negative fact.", 12.7, MUTED, ha="left")
text(1050, 82, "Defer: no human query; no invented answer.", 13.0, MUTED, ha="left")

text(50, 34,
     r"Design sketch only · $\Delta V$, effort units, $\lambda$, estimator and model family remain experimental.",
     14.3, MUTED, ha="left")

fig.canvas.draw()
renderer = fig.canvas.get_renderer()
canvas = fig.bbox
for artist in TEXTS:
    bounds = artist.get_window_extent(renderer)
    if bounds.x0 < canvas.x0 or bounds.x1 > canvas.x1 or bounds.y0 < canvas.y0 or bounds.y1 > canvas.y1:
        raise RuntimeError(f"Text clipped by figure: {artist.get_text()}")

for suffix in ("png", "svg"):
    target = OUT / f"question-policy-diagram.{suffix}"
    fig.savefig(target, dpi=220, metadata={"Title": "Knowledge Twin — proposed question and recipient policy"})
    print(target)
plt.close(fig)
