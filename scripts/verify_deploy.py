#!/usr/bin/env python3
"""Wait for a commit to be deployed to GitHub Pages and check the live site against the repository.

    python3 scripts/verify_deploy.py            # the commit at HEAD (must already be pushed)
    python3 scripts/verify_deploy.py --commit SHA --wait 300

1. The GitHub Actions run of the Pages workflow for that commit has to finish successfully.
2. The live build.json has to name that commit (or a newer one that is a descendant, when runs were superseded).
3. Every file the site is built from has to be byte-identical to what scripts/build_site.py produces from the commit.
Exit code 0 only when all three hold; the reason is printed otherwise.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_site  # noqa: E402

SITE = 'https://203-systems.github.io/personalized-hardware-talk/'
REPO = '203-Systems/personalized-hardware-talk'
ROOT = build_site.ROOT


def git(*args):
    return subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True)


def fetch(name):
    request = urllib.request.Request(f'{SITE}{name}?t={time.time_ns()}', headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def run_state(commit):
    """(status, conclusion) of the Pages workflow run for the commit, or None when there is no run yet."""
    result = subprocess.run(['gh', 'run', 'list', '--repo', REPO, '--workflow', 'pages.yml', '--commit', commit, '--limit', '1',
                             '--json', 'status,conclusion,databaseId,url'], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f'gh run list failed: {result.stderr.strip()}')
    runs = json.loads(result.stdout or '[]')
    return runs[0] if runs else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--commit', default='', help='commit to verify (default: HEAD)')
    parser.add_argument('--wait', type=int, default=300, help='seconds to wait for the deployment (default 300)')
    args = parser.parse_args()
    commit = git('rev-parse', args.commit or 'HEAD').stdout.strip()
    if not commit:
        sys.exit('unknown commit')
    if git('fetch', 'origin', 'main', '--quiet').returncode == 0 and git('merge-base', '--is-ancestor', commit, 'origin/main').returncode:
        sys.exit(f'{commit[:7]} is not on origin/main yet: git push origin main first')
    print(f'verifying {commit[:7]} on {SITE}')
    deadline = time.time() + args.wait

    # 1. the workflow run
    while True:
        run = run_state(commit)
        if run and run['status'] == 'completed':
            break
        if time.time() > deadline:
            sys.exit(f"timed out: the Pages workflow for {commit[:7]} is {'still ' + run['status'] if run else 'not started'} ({run['url'] if run else 'no run found'})")
        time.sleep(5)
    print(f"workflow run: {run['conclusion']}  {run['url']}")
    if run['conclusion'] == 'cancelled':
        print('  (cancelled because a newer push superseded it; checking the newer deployment instead)')
    elif run['conclusion'] != 'success':
        sys.exit(f"deployment failed: gh run view {run['databaseId']} --repo {REPO} --log-failed")

    # 2. the live site runs this commit (or a later one)
    while True:
        try:
            live = json.loads(fetch('build.json'))
        except (urllib.error.URLError, ValueError) as error:
            live, problem = {}, str(error)
        else:
            problem = ''
        live_commit = live.get('commit', '')
        if live_commit and (live_commit == commit or git('merge-base', '--is-ancestor', commit, live_commit).returncode == 0):
            break
        if time.time() > deadline:
            sys.exit(f"live site still serves {live_commit[:7] or 'an unknown build'} {problem}, not {commit[:7]}")
        time.sleep(5)
    print(f"live build: commit {live_commit[:7]}, release {live['release']}, built {live['builtAt']}")
    if live_commit != commit:
        print(f'  (a newer commit {live_commit[:7]} is live; byte check is against that one)')
        commit = live_commit

    # 3. byte-for-byte against a fresh build of that commit
    with tempfile.TemporaryDirectory() as tmp:
        tree = Path(tmp) / 'tree'
        tree.mkdir()
        archive = subprocess.run(['git', '-C', str(ROOT), 'archive', commit], capture_output=True)
        if archive.returncode:
            sys.exit(f'cannot read commit {commit[:7]}: {archive.stderr.decode().strip()}')
        subprocess.run(['tar', '-x', '-C', str(tree)], input=archive.stdout, check=True)
        original_root = build_site.ROOT
        build_site.ROOT = tree
        try:
            info = build_site.build(Path(tmp) / 'site')
        finally:
            build_site.ROOT = original_root
        if info['release'] != live['release']:
            sys.exit(f"release mismatch: live {live['release']}, expected {info['release']}")
        bad = []
        names = [n for n in build_site.FILES if n != '.nojekyll']
        for name in names:
            expected = hashlib.sha256((Path(tmp) / 'site' / name).read_bytes()).hexdigest()
            try:
                actual = hashlib.sha256(fetch(name)).hexdigest()
            except urllib.error.URLError as error:
                bad.append(f'{name}: {error}')
                continue
            if actual != expected:
                bad.append(f'{name}: live file differs from the repository')
        # the newest version's manifest and first preview, since that is what visitors open
        current = json.loads((Path(tmp) / 'site' / 'versions.json').read_text())['current']
        for name in (f'versions/{current}/slides.json', f'versions/{current}/assets/previews/slide-01.png'):
            expected = hashlib.sha256((Path(tmp) / 'site' / name).read_bytes()).hexdigest()
            try:
                if hashlib.sha256(fetch(name)).hexdigest() != expected:
                    bad.append(f'{name}: live file differs from the repository')
            except urllib.error.URLError as error:
                bad.append(f'{name}: {error}')
        if bad:
            sys.exit('mismatch:\n  ' + '\n  '.join(bad))
    print(f'OK: {len(names) + 2} files on the live site are byte-identical to commit {commit[:7]} (current version {current})')


if __name__ == '__main__':
    main()
