#!/usr/bin/env python3
"""Archive the current editable deck as an immutable, browsable version."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('version', help='For example v6 or v5.1; existing IDs cannot be overwritten')
parser.add_argument('--notes', required=True, help='A concise description of the content changes')
args = parser.parse_args()
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,39}', args.version) or args.version in {'.','..'}:
    parser.error('Invalid version identifier')
destination = ROOT / 'versions' / args.version
if destination.exists():
    parser.error('This version already exists. Use a new version identifier.')
manifest = json.loads((ROOT / 'slides.json').read_text())
versions_path = ROOT / 'versions.json'
versions = json.loads(versions_path.read_text()) if versions_path.exists() else {'current':args.version,'versions':[]}
if any(item['id'] == args.version for item in versions['versions']):
    parser.error('This version ID is already registered')
try:
    destination.mkdir(parents=True)
    files = [manifest['source']]
    for slide in manifest['slides']:
        files.extend([slide['image'], slide['pptx']])
    hashes = {}
    for relative in files:
        source = ROOT / relative
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        hashes[relative] = hashlib.sha256(source.read_bytes()).hexdigest()
    manifest['source'] = f'versions/{args.version}/' + manifest['source']
    for slide in manifest['slides']:
        for key in ('image','pptx'):
            slide[key] = f'versions/{args.version}/' + slide[key]
    (destination / 'slides.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (destination / 'checksums.json').write_text(json.dumps(hashes,ensure_ascii=False,indent=2)+'\n')
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    # Date is recorded in China Standard Time, independent of the host timezone.
    date = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds')
    versions['versions'].insert(0,{'id':args.version,'date':date,'notes':args.notes,'slideCount':len(manifest['slides']),'manifest':f'versions/{args.version}/slides.json','sourceRevision':revision})
    versions['current'] = args.version
    temporary = versions_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(versions,ensure_ascii=False,indent=2)+'\n')
    temporary.replace(versions_path)
except Exception:
    shutil.rmtree(destination)
    raise
print(f'Archived {args.version}. Older versions are unchanged.')
