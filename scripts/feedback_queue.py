#!/usr/bin/env python3
"""Read the public request queue, or post an idempotent AI progress reply."""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import subprocess
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parents[1]
API = json.loads((ROOT / 'collaboration-config.json').read_text())['api']


def call(params=None, payload=None, edit_key=None):
    url = API + ('?' + urllib.parse.urlencode(params) if params else '')
    command = ['curl', '--silent', '--show-error', '--fail-with-body', '--max-time', '45', url]
    if payload is not None:
        command += ['-H', 'Content-Type: application/json', '-H', 'X-Edit-Key: ' + edit_key, '--data-binary', '@-']
    result = subprocess.run(command, input=json.dumps(payload, ensure_ascii=False) if payload else None,
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def scan_page(pair):
    version, slide = pair
    offset = 0
    requests = []
    while True:
        page = call({'version': version, 'slide': slide, 'offset': offset})
        for item in page['items']:
            if item['kind'] == 'request':
                item['replies'] = [r for r in page['replies'] if r['parent_id'] == item['id']]
                requests.append(item)
        if not page['hasMore']:
            return requests
        offset += 30


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('list', help='Read all archived versions/pages, including replies')
    reply = sub.add_parser('reply', help='Post a real progress/result reply; never use for production tests')
    reply.add_argument('--version', required=True)
    reply.add_argument('--slide', required=True, type=int)
    reply.add_argument('--request', required=True)
    reply.add_argument('--stage', required=True, help='Stable stage ID for retry deduplication, e.g. accepted or released-v6')
    reply.add_argument('--file', required=True, help='UTF-8 reply text file')
    args = parser.parse_args()
    if args.command == 'list':
        versions = json.loads((ROOT / 'versions.json').read_text())['versions']
        pairs = []
        for version in versions:
            manifest = json.loads((ROOT / version['manifest']).read_text())
            pairs.extend((version['id'], s['number']) for s in manifest['slides'])
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            items = [item for group in pool.map(scan_page, pairs) for item in group]
        print(json.dumps(sorted(items, key=lambda item: item['created_at']), ensure_ascii=False, indent=2))
        return
    content = Path(args.file).read_text().strip()
    if not 1 <= len(content) <= 2000:
        parser.error('Reply must be between 1 and 2000 characters')
    state = ROOT / '.automation'
    state.mkdir(mode=0o700, exist_ok=True)
    key_path = state / 'feedback-edit-key'
    try:
        fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, 'w') as handle:
            handle.write(secrets.token_hex(32))
    key = key_path.read_text().strip()
    if len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
        parser.error('Local feedback credential is invalid; do not print it')
    reply_id = str(uuid.uuid5(uuid.NAMESPACE_URL, API + '/' + args.request + '/' + args.stage))
    result = call(payload={'id': reply_id, 'parentId': args.request, 'version': args.version,
                          'slide': args.slide, 'kind': 'comment', 'author': '203 AI 项目维护',
                          'content': content}, edit_key=key)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
