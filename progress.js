export const stages = {accepted:'已接管',editing:'正在修改',validating:'正在验证',publishing:'正在发布',completed:'已发布',blocked:'等待补充',failed:'处理受阻'};
const pipeline = ['accepted','editing','validating','publishing','completed'];
const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
export async function verifyProgress(reply, parent, publicKey) {
  try {
    const envelope = JSON.parse(reply.content);
    if(envelope.type!=='203-ai-progress/v1' || !publicKey)return null;
    const key = await crypto.subtle.importKey('jwk',publicKey,{name:'Ed25519'},false,['verify']);
    const bytes=decode(envelope.payload);
    if(!await crypto.subtle.verify('Ed25519',key,decode(envelope.signature),bytes))return null;
    const data=JSON.parse(new TextDecoder().decode(bytes));
    if(data.requestId!==parent.id || data.version!==parent.version || data.slide!==parent.slide || !(data.stage in stages) || typeof data.detail!=='string' || !Number.isFinite(Date.parse(data.at)))return null;
    // Server creation time orders events; never trust a visitor-supplied clock for sequencing.
    return {...data,id:reply.id,createdAt:reply.created_at};
  } catch {return null;}
}
function node(tag,text,className) {const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;}
export function progressCard(events) {
  const card=node('section',null,'ai-progress');card.setAttribute('aria-label','AI 处理进度');
  const latest=events.at(-1), stage=latest?.stage;
  card.dataset.stage=stage || 'queued';
  const heading=node('div',null,'ai-progress-heading');
  heading.append(node('strong',latest ? stages[stage] : '等待 AI 接管'),node('span',latest ? '已验证进度' : '需求队列'));
  card.append(heading);
  if(!latest) {card.append(node('p','团队成员可在顶栏「Agent」面板把这条需求交给 Claude Code 处理。'));return card;}
  const steps=node('ol',null,'ai-progress-steps');
  pipeline.forEach((value,index)=>{
    const step=node('li',stages[value]);
    if(pipeline.indexOf(stage)>index || events.some(event=>event.stage===value))step.classList.add('reached');
    if(value===stage)step.setAttribute('aria-current','step');
    steps.append(step);
  });
  card.append(steps,node('p',latest.detail,'ai-progress-detail'));
  const time=node('time',`更新于 ${new Date(latest.createdAt).toLocaleString('zh-CN')}`);time.dateTime=new Date(latest.createdAt).toISOString();card.append(time);
  if(!['completed','blocked','failed'].includes(stage) && Date.now()-latest.createdAt>15*60*1000)card.append(node('p','超过 15 分钟没有新进度，可能仍在处理或维护端离线。','ai-progress-stale'));
  if(stage==='completed' && latest.url) {
    try {const url=new URL(latest.url);if(url.origin==='https://203-systems.github.io' && url.pathname.startsWith('/personalized-hardware-talk/')){const link=node('a','查看已发布版本 ↗');link.href=url.href;card.append(link);}}catch{}
  }
  const history=node('details');history.append(node('summary',`处理记录 · ${events.length}`));
  const timeline=node('ol',null,'ai-progress-history');
  for(const event of events){const entry=node('li');entry.append(node('small',`${new Date(event.createdAt).toLocaleTimeString('zh-CN')} · ${stages[event.stage]}`),node('p',event.detail));timeline.append(entry);}
  history.append(timeline);card.append(history);return card;
}
