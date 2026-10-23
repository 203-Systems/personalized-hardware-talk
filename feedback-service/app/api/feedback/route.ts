import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';
const columns = 'id,parent_id,version,slide,kind,content,author,x,y,status,created_at,updated_at';
const origins = new Set(['https://203-systems.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000']);
const statuses = new Set(['open', 'planned', 'done', 'resolved']);
const idPattern = /^[a-zA-Z0-9-]{16,64}$/;
const versionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/;

function headers(request: Request) {
  const origin = request.headers.get('origin');
  const ownOrigin = new URL(request.url).origin;
  return {
    'Access-Control-Allow-Origin': origin && (origins.has(origin) || origin === ownOrigin) ? origin : ownOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Edit-Key',
    'Vary': 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  };
}
function json(request: Request, data: unknown, status = 200) {
  return Response.json(data, {status, headers: headers(request)});
}
async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
function key(request: Request) {
  const value = request.headers.get('x-edit-key') || '';
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('缺少本机管理凭证，请刷新后重试。');
  return value;
}
async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('请使用 JSON 请求。');
  if (Number(request.headers.get('content-length')) > 14000) throw new Error('提交内容过长。');
  const text = await request.text();
  if (text.length > 10000) throw new Error('提交内容过长。');
  return JSON.parse(text);
}
function permittedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origins.has(origin) || origin === new URL(request.url).origin;
}
async function rateLimit(request: Request, editKey: string) {
  const db = env.DB!;
  const now = Date.now();
  // Only one-way daily buckets are persisted; never store raw IP addresses.
  const ip = request.headers.get('cf-connecting-ip');
  const buckets: [string,number][] = [['key:' + await digest(editKey),30]];
  if (ip) buckets.push(['ip:' + await digest(`${ip}:${Math.floor(now / 86400000)}`),300]);
  for (const [bucket,maximum] of buckets) {
    const row = await db.prepare(`INSERT INTO rate_limits(bucket,count,reset_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END RETURNING count`).bind(bucket, now + 3600000, now, now).first<{count:number}>();
    if ((row?.count || 0) > maximum) return false;
  }
  await db.prepare('DELETE FROM rate_limits WHERE reset_at<?').bind(now - 86400000).run();
  return true;
}

export async function OPTIONS(request: Request) {
  return new Response(null, {status: permittedOrigin(request) ? 204 : 403, headers: headers(request)});
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const version = params.get('version') || '';
    const slide = Number(params.get('slide'));
    const offset = Math.max(0, Math.min(100000, Math.floor(Number(params.get('offset')) || 0)));
    if (!versionPattern.test(version) || !Number.isInteger(slide) || slide < 1 || slide > 1000) return json(request, {error:'无效的版本或页码。'}, 400);
    const thread=params.get('thread');
    if(thread && !idPattern.test(thread))return json(request,{error:'无效讨论链接。'},400);
    const {results} = thread
      ? await env.DB!.prepare(`SELECT ${columns} FROM feedback WHERE version=? AND slide=? AND id=? AND parent_id IS NULL`).bind(version,slide,thread).all()
      : await env.DB!.prepare(`SELECT ${columns} FROM feedback WHERE version=? AND slide=? AND parent_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?`).bind(version, slide, offset).all();
    const items = results.slice(0, 30);
    const ids = items.map(item => item.id);
    const replies = ids.length ? (await env.DB!.prepare(`SELECT ${columns} FROM feedback WHERE parent_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC LIMIT 1000`).bind(...ids).all()).results : [];
    return json(request, {items, replies, hasMore:results.length > 30});
  } catch (error) { console.error(error); return json(request, {error:'评论加载失败，请稍后重试。'}, 503); }
}
export async function POST(request: Request) {
  if (!permittedOrigin(request)) return json(request, {error:'来源不受支持。'}, 403);
  try {
    const editKey = key(request);
    const data = await body(request);
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    const author = typeof data.author === 'string' ? data.author.trim() || '匿名访客' : '匿名访客';
    if (!idPattern.test(data.id || '') || !versionPattern.test(data.version || '') || !Number.isInteger(data.slide) || data.slide < 1 || data.slide > 1000 || !['comment','request'].includes(data.kind) || content.length < 1 || content.length > 2000 || author.length > 40) return json(request, {error:'请检查内容、版本和页码。内容最多 2000 字，昵称最多 40 字。'}, 400);
    const editHash = await digest(editKey);
    const existing = await env.DB!.prepare('SELECT id,edit_hash FROM feedback WHERE id=?').bind(data.id).first<{id:string,edit_hash:string}>();
    if (existing) return json(request, existing.edit_hash === editHash ? {id:existing.id} : {error:'提交编号冲突，请刷新。'}, existing.edit_hash === editHash ? 200 : 409);
    const parentId = data.parentId || null;
    if (parentId) {
      const parent = await env.DB!.prepare('SELECT id FROM feedback WHERE id=? AND version=? AND slide=? AND parent_id IS NULL').bind(parentId, data.version, data.slide).first();
      if (!parent) return json(request, {error:'原讨论已不存在，请刷新。'}, 404);
    }
    const point = data.point;
    if (point && (typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return json(request, {error:'无效标注位置。'}, 400);
    if (!await rateLimit(request, editKey)) return json(request, {error:'提交过于频繁，请一小时后重试。'}, 429);
    const now = Date.now();
    await env.DB!.prepare('INSERT INTO feedback(id,parent_id,version,slide,kind,content,author,x,y,status,edit_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(data.id,parentId,data.version,data.slide,data.kind,content,author,parentId ? null : point?.x ?? null,parentId ? null : point?.y ?? null,'open',editHash,now,now).run();
    return json(request, {id:data.id}, 201);
  } catch (error) { console.error(error); return json(request, {error: error instanceof SyntaxError ? '无法读取提交内容。' : '提交失败，请检查连接后重试。'}, 400); }
}
export async function PATCH(request: Request) {
  if (!permittedOrigin(request)) return json(request,{error:'来源不受支持。'},403);
  try {
    const data = await body(request);
    if (!idPattern.test(data.id || '') || !statuses.has(data.status)) return json(request,{error:'无效状态。'},400);
    const result = await env.DB!.prepare('UPDATE feedback SET status=?,updated_at=? WHERE id=? AND edit_hash=? AND parent_id IS NULL').bind(data.status,Date.now(),data.id,await digest(key(request))).run();
    return result.meta.changes ? json(request,{ok:true}) : json(request,{error:'只有提交者可在原设备更新状态。'},403);
  } catch { return json(request,{error:'更新失败。'},400); }
}
export async function DELETE(request: Request) {
  if (!permittedOrigin(request)) return json(request,{error:'来源不受支持。'},403);
  try {
    const data = await body(request);
    if (!idPattern.test(data.id || '')) return json(request,{error:'无效编号。'},400);
    const hash = await digest(key(request));
    const own = await env.DB!.prepare('SELECT id FROM feedback WHERE id=? AND edit_hash=?').bind(data.id,hash).first();
    if (!own) return json(request,{error:'只有提交者可在原设备撤回。'},403);
    // Keep replies from other visitors; mark the original content as withdrawn.
    await env.DB!.prepare("UPDATE feedback SET content='（提交者已撤回）',author='匿名访客',x=NULL,y=NULL,status='resolved',updated_at=? WHERE id=? AND edit_hash=?").bind(Date.now(),data.id,hash).run();
    return json(request,{ok:true});
  } catch { return json(request,{error:'撤回失败。'},400); }
}
