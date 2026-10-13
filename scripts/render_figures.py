"""Kayıtlı sonuçlardan PNG, SVG ve PDF üret. API isteği göndermez."""
import argparse
import hashlib
import json
import textwrap
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "results/chart-data.json"
DATA = json.loads(SOURCE.read_text(encoding="utf-8"))
BANK = json.loads((ROOT / "data/sample.json").read_text(encoding="utf-8"))
P = json.loads((ROOT / "assets/theme.json").read_text())["palette"]
plt.rcParams.update({"svg.fonttype": "path", "pdf.fonttype": 42,
                     "axes.unicode_minus": False})
SERIF = "Georgia" if any(f.name == "Georgia" for f in font_manager.fontManager.ttflist) else "DejaVu Serif"
LABELS = {
    "Perplexity Decider V1.1": "Perplexity\nDecider V1.1",
    "Jev Latest": "Jev Latest", "Clef": "Clef",
    "Mercury Decide (free)": "Mercury Decide\n(ücretsiz)",
    "Mercury Decide (ücretsiz)": "Mercury Decide\n(ücretsiz)",
    "GPT-6 Luna Decisions": "GPT-6 Luna\nDecisions",
    "Liquid d1": "Liquid d1", "Solar Decide": "Solar Decide",
    "Clef Flash": "Clef Flash", "Tev1 4B": "Tev1 4B", "Kev 4B": "Kev 4B",
    "Solar Decide Flash": "Solar Decide\nFlash", "Span 01": "Span 01",
    "Span 01 Lite": "Span 01 Lite",
}

def pct(value):
    return "%" + f"{value:.1f}".replace(".", ",")

class Canvas:
    def __init__(self, width=1920, height=1080):
        self.width, self.height, self.texts = width, height, []
        self.fig = plt.figure(figsize=(width / 100, height / 100), dpi=100,
                              facecolor=P["background"])
        self.ax = self.fig.add_axes([0, 0, 1, 1])
        self.ax.set_xlim(0, width)
        self.ax.set_ylim(height, 0)
        self.ax.axis("off")

    def text(self, x, y, value, size, *, bold=False, serif=False, color=None,
             ha="left", va="top"):
        t = self.ax.text(x, y, value, fontsize=size * .72,
                         family=SERIF if serif else "DejaVu Sans",
                         weight="bold" if bold else "normal", color=color or P["ink"],
                         ha=ha, va=va, linespacing=1.2, zorder=5)
        self.texts.append(t)
        return t

    def line(self, x1, y1, x2, y2, *, color=None, width=1, z=1):
        self.ax.add_line(Line2D([x1, x2], [y1, y2], color=color or P["grid"],
                               linewidth=width * .72, zorder=z))

    def export(self, folder, stem):
        self.fig.canvas.draw()
        renderer = self.fig.canvas.get_renderer()
        for t in self.texts:
            b = t.get_window_extent(renderer)
            assert 20 <= b.x0 and b.x1 <= self.width - 20, t.get_text()
            assert 20 <= b.y0 and b.y1 <= self.height - 20, t.get_text()
        for ext in ["png", "svg", "pdf"]:
            self.fig.savefig(folder / f"{stem}.{ext}", dpi=100, facecolor=P["background"])
        plt.close(self.fig)

def bars(folder, track):
    rows = sorted([r for r in DATA["rows"] if r["track"] == track and
                   r["split"] == "challenge"], key=lambda r: (-r["accuracy"], r["modelId"]))
    assert len(rows) == (11 if track == "B1" else 13)
    c = Canvas()
    title = ("Türkçe müşteri mesajlarında hangi yapay zeka en isabetli?" if track == "B1"
             else "İki kanıt sorusuyla 13 modelin karar doğruluğu")
    subtitle = ("Aynı 1.500 soruda doğru yanıt oranı. Evet, Hayır veya Anlaşılmıyor." if track == "B1"
                else "Aynı 1.500 örnek · Önerme ve karşıtı ayrı sorulur · Ortak A koşulu")
    c.text(60, 58, title, 51, bold=True, serif=True)
    c.text(60, 143, subtitle, 27, color=P["muted"])
    x0, x1, top, bottom = 108, 1860, 244, 850
    span = bottom - top
    step, bar_width = (x1 - x0) / len(rows), 76 if track == "B1" else 65
    for tick in range(0, 101, 20):
        y = bottom - span * tick / 100
        c.line(x0, y, x1, y, color=P["rule"] if tick == 0 else P["grid"])
        c.text(x0 - 12, y, f"%{tick}", 19, color=P["muted"], ha="right", va="center")
    names, values, geometry = [], [], []
    for i, row in enumerate(rows):
        assert row["cases"] == 1500 and row["families"] == 500
        assert abs(row["correct"] / row["cases"] * 100 - row["accuracy"]) < 1e-10
        x = x0 + step * (i + .5)
        y = bottom - span * row["accuracy"] / 100
        lo = bottom - span * row["ciLow"] / 100
        hi = bottom - span * row["ciHigh"] / 100
        color = P["accent"] if i == 0 else P["primary"]
        c.ax.add_patch(Rectangle((x - bar_width / 2, y), bar_width, bottom - y,
                                facecolor=color, edgecolor="none", zorder=2))
        c.line(x, hi, x, lo, color=P["ink"], width=2, z=4)
        for endpoint in [lo, hi]:
            c.line(x - 7, endpoint, x + 7, endpoint, color=P["ink"], width=2, z=4)
        value = c.text(x, hi - 20, pct(row["accuracy"]), 30 if track == "B1" else 27,
                       bold=True, ha="center", va="bottom")
        value.set_bbox({"facecolor": P["background"], "edgecolor": "none", "pad": 1.5})
        names.append(c.text(x, bottom + 22, LABELS[row["model"]],
                            21 if track == "B1" else 18, bold=i == 0, ha="center"))
        values.append(value)
        geometry.append({**row, "barOrigin": bottom, "barEndpoint": y, "color": color})
    c.line(60, 963, 1860, 963)
    c.text(60, 984, "Çizgiler: %95 güven aralıkları · 500 soru kümesiyle yeniden örnekleme · 8 Ekim 2026",
           18, color=P["muted"])
    c.text(60, 1019, "Geçici anahtar yapay zekayla incelendi; insan performansı ölçülmedi. Her sıra farkı anlamlı olmayabilir.",
           18, color=P["muted"])
    c.text(1860, 1018, "Can Kalecik", 21, bold=True, ha="right")
    c.fig.canvas.draw()
    renderer = c.fig.canvas.get_renderer()
    for ts in [names, values]:
        for a, b in zip(ts, ts[1:]):
            assert a.get_window_extent(renderer).x1 + 4 < b.get_window_extent(renderer).x0
    stem = "full-hosted" if track == "B1" else "evidence-questions"
    c.export(folder, stem)
    (folder / f"{stem}-alt.txt").write_text("\n".join([
        title, subtitle,
        *[f"{r['model'].replace('(free)', '(ücretsiz)')}: {pct(r['accuracy'])}. "
          f"%95 güven aralığı: {pct(r['ciLow'])}–{pct(r['ciHigh'])}." for r in rows],
        "Geçici yanıt anahtarı; insan performansı ölçülmedi.",
    ]) + "\n", encoding="utf-8")
    return {"file": stem, "track": track, "split": "challenge", "scale": [0, 100],
            "dimensions": [1920, 1080], "rows": geometry, "textBounds": "passed"}

def question_family(folder):
    family = next(f for f in BANK["families"] if f["id"] == "C001")
    c = Canvas(1920, 880)
    c.text(60, 54, "Bir soru kümesi, üç örnek", 55, bold=True, serif=True)
    c.text(60, 143, family["question"], 31, color=P["muted"])
    roles = [("Başlangıç", "İlk durumu belirle.", "Hayır"),
             ("Anlam değişir", "Yanıtın da değişmesi gerekir.", "Evet"),
             ("Anlam korunur", "Sözcükler değişse de yanıt aynı kalır.", "Hayır")]
    for i, (case, (title, subtitle, answer)) in enumerate(zip(family["cases"], roles)):
        x = 60 + 610 * i
        c.ax.add_patch(Rectangle((x, 242), 580, 470, facecolor=P["pale"], edgecolor="none"))
        c.ax.add_patch(Rectangle((x, 242), 580, 5, facecolor=P["accent"] if i == 1 else P["primary"]))
        c.text(x + 30, 281, f"{case['id']}  /  {title}", 25, bold=True)
        c.text(x + 30, 331, subtitle, 20, color=P["muted"])
        lines = textwrap.fill(case["message"], width=37)
        c.text(x + 30, 400, lines, 26)
        c.text(x + 30, 639, answer, 36, bold=True, color=P["primary"])
    c.line(60, 777, 1860, 777)
    c.text(60, 804, "Kayıtlı C001 kümesi · Core bölümü · Geçici yanıt anahtarı · İnsan doğrulaması yapılmadı.",
           21, color=P["muted"])
    c.export(folder, "question-family")
    return {"file": "question-family", "sourceFamily": "C001", "dimensions": [1920, 880],
            "messages": [x["message"] for x in family["cases"]], "textBounds": "passed"}

def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--out", type=Path, default=ROOT / "out/figures")
    args.add_argument("--only", choices=["all", "supplementary"], default="all")
    config = args.parse_args()
    config.out.mkdir(parents=True, exist_ok=True)
    figures = ([] if config.only == "supplementary" else [bars(config.out, "B1")])
    figures.extend([bars(config.out, "A"), question_family(config.out)])
    receipt = {"status": "passed", "dataSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
               "palette": P, "figures": figures, "networkCalls": 0}
    (config.out / "figure-checks.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "passed", "figures": len(figures), "networkCalls": 0}))

if __name__ == "__main__":
    main()
