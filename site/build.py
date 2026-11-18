"""Builds the project site into an output folder.

python site/build.py OUT [--release release.json] [--base-url URL]

release.json is the GitHub API answer for releases/latest. Without it the
download links point at the latest release page.
"""
import argparse
import hashlib
import html
import re
import json
import shutil
import time
from datetime import datetime
from pathlib import Path

REPO = "https://github.com/pcanilho/edge-cockpit"
ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
FONTS = {"chakra-petch": [600, 700], "inter": [400, 500, 600], "jetbrains-mono": [500]}
IMAGES = ["panel", "panel-armistice", "panel-mining", "panel-alert", "panel-settings", "panel-log", "panel-world", "social-preview"]


def release_fields(path):
    latest = f"{REPO}/releases/latest"
    f = {"VERSION": "Latest release", "DATE": "", "DATE_SEP": "", "RELEASE_URL": latest,
         "SETUP_URL": latest, "PORTABLE_URL": latest, "SUMS_URL": latest}
    try:
        rel = json.loads(Path(path).read_text(encoding="utf-8")) if path else {}
    except (OSError, ValueError):
        rel = {}
    if not rel.get("tag_name"):
        return f
    f["VERSION"] = rel["tag_name"]
    f["RELEASE_URL"] = rel.get("html_url") or latest
    if rel.get("published_at"):
        d = datetime.fromisoformat(rel["published_at"].replace("Z", "+00:00"))
        f["DATE"], f["DATE_SEP"] = f"{d.day} {d:%b %Y}", " · "
    for a in rel.get("assets", []):
        name, url = a.get("name", ""), a.get("browser_download_url", "")
        if name.endswith("-setup.exe"):
            f["SETUP_URL"] = url
        elif name.endswith("-portable.exe"):
            f["PORTABLE_URL"] = url
        elif name.startswith("SHA256SUMS"):
            f["SUMS_URL"] = url
    return f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--release")
    ap.add_argument("--base-url", default="https://edge-cockpit.canilho.net/")
    args = ap.parse_args()
    out = Path(args.out)
    shutil.rmtree(out, ignore_errors=True)
    (out / "img").mkdir(parents=True)
    (out / "fonts").mkdir()

    fields = release_fields(args.release)
    # Pages reports http:// until HTTPS is enforced; the site is served over HTTPS.
    fields["BASE_URL"] = re.sub(r"^http://", "https://", args.base_url.rstrip("/") + "/")
    fields["STAMP"] = str(int(time.time()))
    page = (SITE / "index.html").read_text(encoding="utf-8")
    # Images are cached for hours: a hash of each one in its URL makes a retaken screenshot show at once.
    for name in IMAGES:
        tag = hashlib.sha256((ROOT / "docs" / f"{name}.png").read_bytes()).hexdigest()[:10]
        page = page.replace(f'img/{name}.png"', f'img/{name}.png?v={tag}"')
    page = page.replace('<html lang="en">', f'<html lang="en" data-version="{html.escape(fields["VERSION"])}">', 1)
    for k, v in fields.items():
        page = page.replace("{{" + k + "}}", html.escape(v))
    assert "{{" not in page, "unfilled placeholder in index.html"
    (out / "index.html").write_text(page, encoding="utf-8")

    for name in ("style.css", "site.js", "robots.txt"):
        shutil.copy(SITE / name, out / name)
    missing = (SITE / "404.html").read_text(encoding="utf-8").replace("{{BASE_URL}}", html.escape(fields["BASE_URL"]))
    (out / "404.html").write_text(missing, encoding="utf-8")
    for name in IMAGES:
        shutil.copy(ROOT / "docs" / f"{name}.png", out / "img" / f"{name}.png")
    shutil.copy(ROOT / "docs" / "logo.svg", out / "img" / "logo.svg")
    icons = ROOT / "app" / "src-tauri" / "icons"
    shutil.copy(icons / "32x32.png", out / "img" / "favicon-32.png")
    shutil.copy(icons / "128x128@2x.png", out / "img" / "apple-touch-icon.png")
    fontsource = ROOT / "app" / "node_modules" / "@fontsource"
    for fam, weights in FONTS.items():
        for w in weights:
            shutil.copy(fontsource / fam / "files" / f"{fam}-latin-{w}-normal.woff2", out / "fonts" / f"{fam}-{w}.woff2")
    print(f"site built in {out} ({fields['VERSION']})")


if __name__ == "__main__":
    main()
