// The Agent service end to end, with a stand-in for Claude: sign-in, one session across turns, model and effort per
// message, live replies and steps, stop, queue, retry, new session, attachments and cross-site protection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'talk-agent-test-'));
const fake = path.join(here, 'fake-claude.mjs'), calls = path.join(dir, 'calls.jsonl');
chmodSync(fake, 0o755);
Object.assign(process.env, { STATE_DIR: path.join(dir, 'state'), PROJECT_DIR: dir, CLAUDE_BIN: fake, FAKE_CLAUDE_LOG: calls, TEAM_CODE: 'team-code-for-tests', BASE_PATH: '/talk-agent' });
const { server } = await import('../server.mjs');
const site = 'https://203-systems.github.io';
let root, token;

before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { root = `http://127.0.0.1:${server.address().port}/talk-agent`; resolve(); })));
after(() => { server.close(); server.closeAllConnections?.(); rmSync(dir, { recursive: true, force: true }); });

async function api(route, { method = 'GET', body, auth = token, origin = site } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) };
  const response = await fetch(root + route, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
}
const started = () => readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const arg = (call, name) => call.args[call.args.indexOf(name) + 1];
// Follows the conversation the way the panel does (long polls), until the condition holds.
async function until(check, ms = 8000) {
  let rev = 0, messages = new Map(), status;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const { data } = await api(`/api/state?rev=${rev}&wait=2`);
    if (data.full) messages = new Map();
    for (const m of data.messages) messages.set(m.id, m);
    rev = data.rev; status = data.status;
    const list = [...messages.values()];
    if (check(list, status)) return { list, status, data };
  }
  throw new Error('timed out waiting for the Agent');
}
const turnOf = (list, id) => list.filter(m => m.turn === id);

test('signs in with the team code only', async () => {
  assert.equal((await api('/api/state', { auth: null })).status, 401);
  assert.equal((await api('/api/login', { method: 'POST', body: { code: 'wrong', name: 'lm' }, auth: null })).status, 401);
  assert.equal((await api('/api/login', { method: 'POST', body: { code: 'team-code-for-tests', name: '' }, auth: null })).status, 400);
  const ok = await api('/api/login', { method: 'POST', body: { code: 'team-code-for-tests', name: 'lm' }, auth: null });
  assert.equal(ok.status, 200);
  assert.match(ok.data.token, /^[a-f0-9]{64}$/);
  token = ok.data.token;
  const state = await api('/api/state');
  assert.equal(state.data.me.name, 'lm');
  assert.ok(state.data.models.some(m => m.id === 'claude-sonnet-5-5') && state.data.efforts.some(e => e.id === 'xhigh'));
  assert.ok(!readFileSync(path.join(dir, 'state', 'state.json'), 'utf8').includes(token), 'only a hash of the sign-in is stored');
});

test('a message runs with the chosen model and effort, and the reply and steps stream back', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const sent = await api('/api/messages', { method: 'POST', body: { text: '检查一下第 3 页', model: 'claude-sonnet-5-5', effort: 'low',
    context: { version: 'v7', slide: 3, title: '开放硬件', url: 'https://203-systems.github.io/personalized-hardware-talk/?v=v7#/3' }, files: [{ name: '../截图.png', type: 'image/png', data: png }] } });
  assert.equal(sent.status, 200);
  const id = sent.data.message.id;
  const { list, status } = await until((l, s) => l.find(m => m.id === id)?.status === 'done' && !s.running);
  assert.equal(status.running, null);
  const turn = turnOf(list, id);
  assert.equal(turn.find(m => m.role === 'assistant').text, '已检查完毕，模型 claude-sonnet-5-5');
  const step = turn.find(m => m.role === 'tool');
  assert.deepEqual([step.label, step.text, step.status, step.detail], ['运行命令', 'Validate slides', 'done', 'All 11 slides valid']);
  assert.match(turn.find(m => m.role === 'event').text, /^完成 · .* · 2 步 · Sonnet 5\.5 · 强度 低$/);
  const call = started().at(-1);
  assert.equal(arg(call, '--model'), 'claude-sonnet-5-5');
  assert.equal(arg(call, '--effort'), 'low');
  assert.ok(call.args.includes('--session-id') && !call.args.includes('--resume'));
  assert.equal(call.cwd, dir);
  assert.equal(call.teamCode, false, 'the team code never reaches Claude');
  assert.match(call.prompt, /【网页 Agent 面板 · lm · .* · 正在看 v7 第 3 页「开放硬件」/);
  const file = sent.data.message.files[0];
  assert.equal(file.name, '__截图.png', 'no path tricks in file names');
  assert.ok(call.prompt.includes(file.path) && existsSync(file.path));
  const download = await fetch(`${root}/api/files/${id}/0`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(download.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await download.arrayBuffer()).toString('base64'), png);
  assert.equal((await fetch(`${root}/api/files/${id}/0`)).status, 401);
});

test('the next message continues the same Claude session, with defaults when nothing is picked', async () => {
  const first = started().at(-1), session = arg(first, '--session-id');
  const sent = await api('/api/messages', { method: 'POST', body: { text: '继续', model: 'gpt', effort: 'huge' } });
  await until(l => l.find(m => m.id === sent.data.message.id)?.status === 'done');
  const call = started().at(-1);
  assert.equal(arg(call, '--resume'), session);
  assert.equal(arg(call, '--model'), 'claude-opus-5-5');
  assert.equal(arg(call, '--effort'), 'xhigh');
  assert.equal((await api('/api/state')).data.conversation.session, session.slice(0, 8));
});

test('stop ends Claude at once; queued messages wait their turn and can be cancelled or retried', async () => {
  const slow = (await api('/api/messages', { method: 'POST', body: { text: 'SLOW 大改' } })).data.message;
  const queued = (await api('/api/messages', { method: 'POST', body: { text: '排队的第二条' } })).data.message;
  const third = (await api('/api/messages', { method: 'POST', body: { text: '排队的第三条', model: 'claude-haiku-5-5', effort: 'medium' } })).data.message;
  await until((l, s) => s.running?.id === slow.id && s.running.phase === 'tool' && l.some(m => m.turn === slow.id && m.role === 'tool'));
  assert.equal((await until((l, s) => s.queue.length === 2)).status.queue[0], queued.id);
  assert.equal((await api('/api/cancel', { method: 'POST', body: { id: queued.id } })).status, 200);
  assert.equal((await api('/api/new-session', { method: 'POST' })).status, 409, 'no new session while working');
  const pid = started().at(-1).pid;
  assert.equal((await api('/api/stop', { method: 'POST' })).status, 200);
  const { list } = await until(l => l.find(m => m.id === slow.id)?.status === 'stopped' && l.find(m => m.id === third.id)?.status === 'done');
  assert.match(turnOf(list, slow.id).find(m => m.role === 'event').text, /^已由 lm 停止/);
  assert.equal(turnOf(list, slow.id).find(m => m.role === 'tool').status, 'stopped');
  assert.equal(list.find(m => m.id === queued.id).status, 'cancelled');
  assert.throws(() => process.kill(pid, 0), 'the stopped Claude process is gone');
  assert.ok(!started().some(c => c.prompt.includes('排队的第二条')), 'a cancelled message never runs');
  assert.equal(arg(started().at(-1), '--model'), 'claude-haiku-5-5');
  assert.equal((await api('/api/stop', { method: 'POST' })).status, 409);
  const retry = await api('/api/retry', { method: 'POST', body: { id: queued.id } });
  assert.equal(retry.status, 200);
  await until(l => l.find(m => m.id === retry.data.message.id)?.status === 'done');
  assert.equal((await api('/api/retry', { method: 'POST', body: { id: third.id } })).status, 409, 'a finished message is not resent');
});

test('a failed run says why', async () => {
  const sent = (await api('/api/messages', { method: 'POST', body: { text: 'BROKEN' } })).data.message;
  const { list } = await until(l => l.find(m => m.id === sent.id)?.status === 'failed');
  assert.match(turnOf(list, sent.id).find(m => m.role === 'event').text, /Claude 运行失败（退出码 3）：something broke/);
});

test('a new session forgets the old one; a lost session is replaced automatically', async () => {
  const old = arg(started().find(c => c.args.includes('--session-id')), '--session-id');
  assert.equal((await api('/api/new-session', { method: 'POST' })).status, 200);
  const fresh = await api('/api/state');
  assert.equal(fresh.data.full, true);
  assert.equal(fresh.data.conversation.session, null);
  assert.deepEqual(fresh.data.messages.map(m => m.kind), ['session']);
  const sent = (await api('/api/messages', { method: 'POST', body: { text: '新的开始' } })).data.message;
  await until(l => l.find(m => m.id === sent.id)?.status === 'done');
  const created = arg(started().at(-1), '--session-id');
  assert.ok(created && created !== old);
  process.env.FAKE_MISSING = created;
  const again = (await api('/api/messages', { method: 'POST', body: { text: '会话丢了也能继续' } })).data.message;
  const { list } = await until(l => l.find(m => m.id === again.id)?.status === 'done');
  assert.ok(turnOf(list, again.id).some(m => m.kind === 'session'));
  const [lost, replaced] = started().slice(-2);
  assert.equal(arg(lost, '--resume'), created);
  assert.ok(arg(replaced, '--session-id') && arg(replaced, '--session-id') !== created);
});

test('only the presentation may call it from a browser', async () => {
  const preflight = await fetch(root + '/api/messages', { method: 'OPTIONS', headers: { Origin: site, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), site);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  const other = await api('/api/messages', { method: 'POST', body: { text: 'hi' }, origin: 'https://evil.example' });
  assert.equal(other.status, 403);
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  assert.equal((await api('/api/state', { auth: 'f'.repeat(64) })).status, 401);
  assert.equal((await api('/api/logout', { method: 'POST' })).status, 200);
  assert.equal((await api('/api/state')).status, 401, 'signed out');
});
