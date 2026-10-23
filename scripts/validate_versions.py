#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
history = json.loads((root / 'versions.json').read_text())
ids = [item['id'] for item in history['versions']]
assert len(ids) == len(set(ids)) and history['current'] in ids
for item in history['versions']:
    directory = root / 'versions' / item['id']
    manifest = json.loads((root / item['manifest']).read_text())
    assert len(manifest['slides']) == item['slideCount']
    checksums = json.loads((directory / 'checksums.json').read_text())
    assert len(checksums) == item['slideCount'] * 2 + 1
    for relative, expected in checksums.items():
        assert hashlib.sha256((directory / relative).read_bytes()).hexdigest() == expected, f'Archived version changed: {item["id"]}/{relative}'
    for slide in manifest['slides']:
        assert (root / slide['image']).is_file() and (root / slide['pptx']).is_file()
    print(f'OK archived {item["id"]}: {item["slideCount"]} slides and original file checksums')
