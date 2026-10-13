"""Yayın içeriğini ve belge bağlantılarını ağ isteği olmadan kontrol et."""
import copy
import csv
import gzip
import hashlib
import json
import re
import struct
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {".git", ".venv", "node_modules", "__pycache__", "out", "experiments"}
EXPECTED_PALETTE = {
    "background": "#FFFFFF", "primary": "#3D3BF3", "accent": "#FF2929",
    "ink": "#17162F", "muted": "#6F6C86", "grid": "#D9D8F3",
    "rule": "#9694FF", "pale": "#F7F7FB",
}
SENSITIVE = [
    re.compile(rb"sk-or-v1-[0-9a-fA-F]{48,}"),
    re.compile(rb"sk-[A-Za-z0-9_-]{32,}"),
    re.compile(rb"(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}"),
    re.compile(rb"hf_[A-Za-z0-9]{30,}"),
    re.compile(rb"AKIA[0-9A-Z]{16}"),
    re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(rb"/(?:Users|home)/[A-Za-z0-9_.-]+/"),
]
errors = []

def require(condition, message):
    if not condition:
        errors.append(message)

def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))

def projection(bank):
    result = copy.deepcopy({k: v for k, v in bank.items() if k != "meta"})
    for family in result["families"]:
        for case in family["cases"]:
            case.get("review", {}).pop("audit", None)
    return result

files = sorted(p for p in ROOT.rglob("*") if p.is_file() and
               not any(part in EXCLUDED for part in p.relative_to(ROOT).parts))
total_payload = 0
for file in files:
    relative = file.relative_to(ROOT).as_posix()
    require(file.stat().st_size < 100 * 1024 ** 2, f"GitHub dosya sınırı: {relative}")
    require(not file.is_symlink(), f"Sembolik bağlantı: {relative}")
    require(not (file.name.startswith(".env") and file.name != ".env.example"),
            f"Özel ortam dosyası: {relative}")
    require(file.suffix not in {".safetensors", ".gguf", ".pt", ".sqlite", ".db"},
            f"Yayın kapsamı dışındaki dosya: {relative}")
    reader = gzip.open if file.suffix == ".gz" else open
    hits = set()
    # Büyük arşivler belleğe tamamen alınmaz. Sınırdaki örüntüler de taranır.
    with reader(file, "rb") as handle:
        overlap = b""
        while chunk := handle.read(1024 * 1024):
            total_payload += len(chunk)
            block = overlap + chunk
            for index, pattern in enumerate(SENSITIVE):
                if pattern.search(block):
                    hits.add(index)
            overlap = block[-4096:]
    require(not hits, f"Hassas içerik örüntüsü: {relative} ({len(hits)} tür)")
    if file.suffix == ".md":
        text = file.read_text(encoding="utf-8")
        require("â" not in text.casefold(), f"Yazım tercihi uyuşmazlığı: {relative}")
        for target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", text):
            target = target.strip().split(' "', 1)[0].strip("<>")
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
                continue
            target = unquote(target.split("#", 1)[0])
            require((file.parent / target).exists(), f"Eksik belge bağlantısı: {relative} -> {target}")
    if file.suffix == ".svg":
        svg = file.read_text(encoding="utf-8")
        require(not re.search(r"(?:xlink:)?href=[\"'](?:https?://|file:)", svg),
                f"Dış kaynak kullanan SVG: {relative}")

example = (ROOT / ".env.example").read_text()
require(re.search(r"^OPENROUTER_API_KEY=\s*$", example, re.MULTILINE), "Örnek anahtar alanı boş değil")
registry = load("model-registry.json")
require(set(registry) == {"catalogSnapshot", "hosted", "notScheduled"}, "Model kaydı kapsamı uyuşmuyor")
api_ids = {m["id"] for m in registry["hosted"]}
require(len(api_ids) == 13, "13 API kimliği bulunamadı")
chart = load("results/chart-data.json")
require(all(r["cohort"] == "full-hosted" and r["modelId"] in api_ids for r in chart["rows"]),
        "Grafikte API kapsamı dışındaki satır var")
require(load("assets/theme.json")["palette"] == EXPECTED_PALETTE, "Renk paleti uyuşmuyor")

bank = load("data/sample.json")
sha = hashlib.sha256(json.dumps(projection(bank), ensure_ascii=False, sort_keys=True,
                              separators=(",", ":")).encode()).hexdigest()
receipt = load("audit/scientific-projection.json")
require(sha == receipt["sourceProjectionSha256"] == receipt["publishedProjectionSha256"],
        "Bilimsel veri alanları değişti")

for stem, expected in {"full-hosted": (1920, 1080), "evidence-questions": (1920, 1080),
                       "question-family": (1920, 880)}.items():
    raw = (ROOT / f"assets/{stem}.png").read_bytes()
    require(raw[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", raw[16:24]) == expected,
            f"Görsel boyutu uyuşmuyor: {stem}")

analysis = load("results/hosted/analysis.json")
with (ROOT / "results/leaderboard.csv").open(encoding="utf-8", newline="") as handle:
    rows = list(csv.DictReader(handle))
    for row in rows:
        key = "|".join([row["api_id"], row["condition"], row["track"], "base", row["split"]])
        group = analysis["summary"][key]
        require(int(row["cases"]) == group["expected"], f"CSV paydası uyuşmuyor: {key}")
        require(abs(float(row["accuracy_percent"]) - 100 * group["accuracyEndToEnd"]) < 1e-8,
                f"CSV doğruluğu uyuşmuyor: {key}")
require(len(rows) == len(chart["rows"]), "CSV satır sayısı uyuşmuyor")

checksum_file = ROOT / "audit/release-files.sha256"
if checksum_file.exists():
    expected = {}
    for line in checksum_file.read_text().splitlines():
        checksum, path = line.split("  ", 1)
        expected[path] = checksum
    actual = {f.relative_to(ROOT).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest()
              for f in files if f != checksum_file}
    require(expected == actual, "Yayın dosyalarının SHA-256 listesi uyuşmuyor")

if errors:
    for error in errors:
        print(error, file=sys.stderr)
    raise SystemExit(1)
print(json.dumps({"status": "passed", "filesScanned": len(files),
                  "payloadMiB": round(total_payload / 1024 ** 2, 2),
                  "links": "valid", "figures": "source matched", "scope": "API",
                  "networkCalls": 0}, ensure_ascii=False, indent=2))
