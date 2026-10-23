#!/usr/bin/env node
// Stands in for `claude -p --output-format stream-json`: records how it was started, then streams the same kinds of
// events Claude Code does. The prompt picks the behaviour: SLOW keeps working until stopped, BROKEN exits with an error.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, prompt, cwd: process.cwd(), teamCode: 'TEAM_CODE' in process.env, pid: process.pid }) + '\n');
const out = event => process.stdout.write(JSON.stringify(event) + '\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const resume = flag('--resume'), session = resume || flag('--session-id');
if (resume && (process.env.FAKE_MISSING || '').split(',').includes(resume)) {
  console.error(`No conversation found with session ID: ${resume}`);
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, num_turns: 0, session_id: resume, errors: [`No conversation found with session ID: ${resume}`] });
  process.exit(1);
}
out({ type: 'system', subtype: 'init', session_id: session, model: flag('--model'), tools: [] });
if (prompt.includes('BROKEN')) { console.error('something broke'); process.exit(3); }
const tool = 'toolu_' + randomUUID().slice(0, 8), first = 'msg_' + randomUUID().slice(0, 8), second = 'msg_' + randomUUID().slice(0, 8);
out({ type: 'stream_event', event: { type: 'message_start', message: { id: first } } });
out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } });
out({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: tool, name: 'Bash', input: {} } } });
out({ type: 'assistant', message: { id: first, content: [{ type: 'tool_use', id: tool, name: 'Bash', input: { command: 'python3 scripts/validate.py', description: 'Validate slides' } }] } });
if (prompt.includes('SLOW')) { process.on('SIGTERM', () => process.exit(143)); await sleep(60_000); }
out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: tool, content: 'All 11 slides valid', is_error: false }] } });
out({ type: 'stream_event', event: { type: 'message_start', message: { id: second } } });
out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
for (const piece of ['已检查', '完毕，', `模型 ${flag('--model')}`]) { out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } }); await sleep(5); }
out({ type: 'assistant', message: { id: second, content: [{ type: 'text', text: `已检查完毕，模型 ${flag('--model')}` }] } });
out({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } });
out({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, session_id: session, result: `已检查完毕，模型 ${flag('--model')}` });
