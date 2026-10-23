// New code goes live by itself: the service notices that server.mjs changed on disk and, when no turn is running and the
// new file parses, exits cleanly so systemd starts the new version. Queued messages carry on; a broken edit is ignored.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, chmodSync, appendFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'talk-agent-reload-'));
const fake = path.join(here, 'fake-claude.mjs');
chmodSync(fake, 0o755);
const children = new Set();
after(() => { for (const child of children) child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); });

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A copy of the service in its own folder, so the test can edit "its" server.mjs.
async function start(name, state = path.join(dir, name, 'state')) {
  const home = path.join(dir, name);
  const file = path.join(home, 'server.mjs');
  if (!existsSync(file)) { mkdirSync(home, { recursive: true }); copyFileSync(path.join(here, '..', 'server.mjs'), file); }
  const port = await freePort(), log = [];
  const child = spawn(process.execPath, [file], { cwd: home, env: { ...process.env, PORT: String(port), STATE_DIR: state, PROJECT_DIR: home, CLAUDE_BIN: fake,
    FAKE_CLAUDE_LOG: path.join(home, 'calls.jsonl'), TEAM_CODE: 'team-code-for-tests', BASE_PATH: '/talk-agent', RELOAD_POLL_MS: '200' } });
  children.add(child);
  child.stdout.on('data', c => log.push(String(c))); child.stderr.on('data', c => log.push(String(c)));
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const root = `http://127.0.0.1:${port}/talk-agent`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(root + '/api/health')).ok) break; } catch {} await sleep(50); }
  return { child, file, root, state, log, exited, text: () => log.join('') };
}
const within = (promise, ms, what) => Promise.race([promise, sleep(ms).then(() => { throw new Error(`timed out: ${what}`); })]);
async function login(svc) {
  const response = await fetch(svc.root + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'team-code-for-tests', name: 'lm' }) });
  return (await response.json()).token;
}
const call = (svc, token, route, body) => fetch(svc.root + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
const touch = svc => appendFileSync(svc.file, `\n// edited ${Date.now()}\n`);

test('an idle service loads an edited server.mjs by itself', async () => {
  const svc = await start('idle');
  await sleep(600);
  assert.equal(svc.child.exitCode, null, 'unchanged code keeps running');
  touch(svc);
  const { code } = await within(svc.exited, 5000, 'the service to restart on new code');
  assert.equal(code, 0, 'clean exit, so systemd (Restart=always) starts the new version');
  assert.match(svc.text(), /server\.mjs changed, loading the new version/);
});

test('an edit that does not parse is ignored, and a later good edit still loads', async () => {
  const svc = await start('broken');
  appendFileSync(svc.file, '\nconst oops = ;\n');
  await sleep(1200);
  assert.equal(svc.child.exitCode, null, 'a broken edit is not loaded');
  assert.equal((await fetch(svc.root + '/api/health')).ok, true);
  assert.match(svc.text(), /does not parse; keeping the running version/);
  assert.equal(svc.text().match(/does not parse/g).length, 1, 'reported once, not every poll');
  writeFileSync(svc.file, readFileSync(path.join(here, '..', 'server.mjs'), 'utf8') + '\n// fixed\n');
  const { code } = await within(svc.exited, 5000, 'the fixed file to load');
  assert.equal(code, 0);
});

test('never restarts in the middle of a turn; queued messages carry on with the new code', async () => {
  const svc = await start('busy'), token = await login(svc);
  const a = (await call(svc, token, '/api/messages', { text: 'SLOW first' })).message;
  const b = (await call(svc, token, '/api/messages', { text: 'second one' })).message;
  await sleep(500);
  touch(svc);
  await sleep(1200);
  assert.equal(svc.child.exitCode, null, 'a turn is running, so the service keeps going');
  await call(svc, token, '/api/stop', {});
  const { code } = await within(svc.exited, 8000, 'the service to restart once the turn ended');
  assert.equal(code, 0);
  const saved = JSON.parse(readFileSync(path.join(svc.state, 'state.json'), 'utf8'));
  assert.equal(saved.messages.find(m => m.id === a.id).status, 'stopped');
  assert.deepEqual(saved.queue, [b.id], 'the next message was not started and is still queued');

  const next = await start('busy', svc.state);   // systemd starting the new version
  const token2 = await login(next);
  let done;
  for (let i = 0; i < 60 && !done; i++) {
    const snapshot = await call(next, token2, '/api/state?rev=0');
    done = snapshot.messages.find(m => m.id === b.id)?.status === 'done';
    if (!done) await sleep(100);
  }
  assert.ok(done, 'the queued message ran after the restart');
});
