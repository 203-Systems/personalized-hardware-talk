#!/usr/bin/env python3
"""Collect the public website into a directory, exactly as GitHub Pages serves it.

The GitHub Actions workflow and scripts/verify_deploy.py both use this, so what is deployed and what is checked are the
same thing. Every browser-loaded script and stylesheet is referenced as `name?r=<token>`; the token is replaced here by
a hash of the code files, so every release gets new URLs and a browser can never mix an old script with a new page
(GitHub Pages lets browsers reuse a file for 10 minutes). Nobody has to remember to bump the token by hand.

    python3 scripts/build_site.py .build/site

Also writes build.json (commit, code hash, build time) so the live site can say which commit it is running.
"""
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ['index.html', 'app.js', 'agent.js', 'collaboration.js', 'progress.js', 'collaboration-config.json',
         'styles.css', 'slides.json', 'versions.json', '.nojekyll']
DIRS = ['assets', 'slides', 'source', 'versions']
# Files the browser loads as code; their content decides the release token.
CODE = ['index.html', 'app.js', 'agent.js', 'collaboration.js', 'progress.js', 'styles.css']
TOKEN = re.compile(r'\?r=[A-Za-z0-9._-]+')


def release_token(root: Path = ROOT) -> str:
    digest = hashlib.sha256()
    for name in CODE:
        digest.update(name.encode() + b'\0')
        digest.update(TOKEN.sub('?r=', (root / name).read_text(encoding='utf-8')).encode())
    return digest.hexdigest()[:10]


def build(out: Path, commit: str = '') -> dict:
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for name in FILES:
        shutil.copy2(ROOT / name, out / name)
    for name in DIRS:
        shutil.copytree(ROOT / name, out / name)
    token = release_token()
    stamped = 0
    for name in CODE:
        path = out / name
        text = path.read_text(encoding='utf-8')
        text, count = TOKEN.subn(f'?r={token}', text)
        stamped += count
        path.write_text(text, encoding='utf-8')
    info = {'commit': commit, 'release': token,
            'builtAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'stamped': stamped}
    (out / 'build.json').write_text(json.dumps(info, ensure_ascii=False) + '\n', encoding='utf-8')
    return info


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    info = build(Path(sys.argv[1]), os.environ.get('GITHUB_SHA', ''))
    print(f"site built in {sys.argv[1]}: release {info['release']}, {info['stamped']} asset references stamped")
