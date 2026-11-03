import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, extname, basename } from 'node:path';
import { AppError } from './archive.js';
import { exportZip, pdfBuffer, markdownHtml, escapeHtml } from './exports.js';
import { runProcess, childEnvironment } from './process.js';
import { splitText } from './codex.js';
import { transcript } from './store.js';
import { discordAction } from './discord-service.js';
import { importCampaign } from './imports.js';
import { ToneAnalyzer } from './analysis.js';

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg'};
function equal(a,b) {const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length && timingSafeEqual(aa,bb);}
async function jsonBody(req,max=2*1024*1024) {
  const parts=[];let size=0;
  for await (const part of req) {size+=part.length;if(size>max) throw new AppError('Request is too large.',413);parts.push(part);}
  try {return JSON.parse(Buffer.concat(parts).toString() || '{}');} catch {throw new AppError('Invalid JSON request.');}
}
function send(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function upload(req,path,max) {
  let bytes=0;
  if (Number(req.headers['content-length'])>max) throw new AppError('Upload exceeds the size limit.',413);
  const limiter=new Transform({transform(part,encoding,callback){bytes+=part.length;callback(bytes>max?new AppError('Upload exceeds the size limit.',413):null,part);}});
  try {await pipeline(req,limiter,createWriteStream(path,{mode:0o600}));} catch(error) {await unlink(path).catch(()=>{});throw error;}
  if (!bytes) {await unlink(path).catch(()=>{});throw new AppError('Empty upload.');}
}
function filename(value) {return basename(value || 'upload').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,100);}

export async function createDashboard({archive,engine,config,search=null,integrations=null,live=()=>[],status=()=>null,rootToken=null,port=Number(process.env.DASHBOARD_PORT || 8787),host=process.env.DASHBOARD_HOST || '127.0.0.1'}) {
  const store=archive.store;
  const secretPath=join(config.dataDir,'dashboard-key');
  await mkdir(config.dataDir,{recursive:true,mode:0o700});
  if (!rootToken) {
    if (existsSync(secretPath)) rootToken=readFileSync(secretPath,'utf8').trim();
    else {rootToken=randomBytes(32).toString('base64url');await writeFile(secretPath,rootToken,{mode:0o600});}
  }
  const allowedOrigins=(process.env.DASHBOARD_ALLOWED_ORIGINS||'').split(',').filter(Boolean);
  let address;
  const rate=new Map();
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const origin=req.headers.origin;
      const ownOrigin=`http://${req.headers.host}`;
      if (origin && origin!==ownOrigin && !allowedOrigins.includes(origin)) throw new AppError('Origin is not allowed.',403);
      if (origin && allowedOrigins.includes(origin)) {res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
      if (req.method==='OPTIONS') {res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,X-File-Name'});res.end();return;}
      // Loopback hosting rejects DNS-rebinding Host values. LAN binding requires
      // explicit host configuration and still requires bearer authentication.
      const reqHost=(req.headers.host||'').split(':')[0];
      if (host==='127.0.0.1' && !['127.0.0.1','localhost'].includes(reqHost)) throw new AppError('Invalid Host header.',403);
      const url=new URL(req.url,'http://localhost');const path=url.pathname;
      if (!path.startsWith('/api/')) {
        const vendor={'/vendor/quill.js':'quill/dist/quill.js','/vendor/quill.css':'quill/dist/quill.snow.css','/vendor/marked.js':'marked/lib/marked.umd.js','/vendor/purify.js':'dompurify/dist/purify.min.js','/vendor/turndown.js':'turndown/dist/turndown.js'};
        if(vendor[path]&&req.method==='GET'){res.writeHead(200,{'Content-Type':path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});res.end(await readFile(fileURLToPath(new URL('../node_modules/'+vendor[path],import.meta.url))));return;}
        const files={'/':'index.html','/app.js':'app.js','/advanced.js':'advanced.js','/styles.css':'styles.css','/theme.css':'theme.css'};
        if (!files[path] || req.method!=='GET') throw new AppError('Not found.',404);
        const file=files[path];res.writeHead(200,{'Content-Type':mime[extname(file)]});res.end(await readFile(fileURLToPath(new URL(`../web/${file}`,import.meta.url))));return;
      }
      const credential=(req.headers.authorization||'').replace(/^Bearer /i,'');
      const actor=credential && equal(credential,rootToken) ? {subject:'host',root:true}:credential ? archive.tokenActor(credential) || archive.shareActor(credential):null;
      if (!actor) throw new AppError('Enter a valid Chronicle access key.',401);
      const rateKey=actor.subject+':'+(req.socket.remoteAddress||'');const now=Date.now();const count=rate.get(rateKey)||{start:now,n:0};
      if (now-count.start>60000) {count.start=now;count.n=0;}
      if (++count.n>360) throw new AppError('Too many requests. Please wait a moment.',429);rate.set(rateKey,count);
      if (rate.size>10000) rate.clear();
      const parts=path.split('/').filter(Boolean).slice(1);const method=req.method;
      if (path==='/api/me') return send(res,200,{subject:actor.subject,root:!!actor.root,share:!!actor.share,version:'0.2.0',live:actor.root?live():[],discord:status(),capabilities:{embeddings:!!search,images:!!process.env.COMFYUI_CHECKPOINT,diarization:!!process.env.HF_TOKEN,email:!!process.env.SMTP_HOST}});
      if (parts[0]!=='campaigns') throw new AppError('API route not found.',404);
      if (parts.length===1) {
        if (method==='GET') return send(res,200,archive.campaigns(actor));
        if (method==='POST') {const body=await jsonBody(req);return send(res,201,archive.createCampaign(actor,body.name));}
      }
      const campaign=parts[1],section=parts[2],itemId=parts[3],action=parts[4];
      archive.require(campaign,actor);
      if(!actor.root && !actor.share && integrations?.discord && /^\d{16,22}$/.test(actor.subject)) {
        const info=store.get('SELECT * FROM campaigns WHERE id=?',campaign);
        if(info.guild!=='local') {
          const guild=await integrations.discord.guilds.fetch(info.guild).catch(()=>null);
          const member=guild?await guild.members.fetch({user:actor.subject,force:true}).catch(()=>null):null;
          const channel=guild?await guild.channels.fetch(info.channel).catch(()=>null):null;
          if(!member || !channel?.permissionsFor(member)?.has('ViewChannel'))throw new AppError('Your Discord access to this campaign channel has ended.',403);
        }
      }
      if (section==='state' && method==='GET') return send(res,200,{campaign:store.get('SELECT * FROM campaigns WHERE id=?',campaign),role:archive.role(campaign,actor),settings:archive.settings(campaign,actor),records:archive.records(campaign,actor),sessions:archive.sessions(campaign,actor),cast:archive.cast(campaign,actor),rpImages:archive.isAdmin(campaign,actor)?archive.rpImages(campaign,actor):[],reviews:archive.isAdmin(campaign,actor)?engine.reviews(campaign,actor):[],jobs:archive.isAdmin(campaign,actor)?engine.jobs(campaign,actor):[],live:live().filter(r=>r.campaign===campaign)});
      if (section==='settings' && method==='PUT') return send(res,200,archive.setSettings(campaign,actor,await jsonBody(req)));
      if (section==='discord-channels' && method==='GET') {
        archive.require(campaign,actor,false,true);
        if (!integrations?.discord) throw new AppError('Discord bot is not running.',503);
        const info=store.get('SELECT * FROM campaigns WHERE id=?',campaign);
        if (!info || info.guild==='local') return send(res,200,[]);
        const guild=await integrations.discord.guilds.fetch(info.guild).catch(()=>null);
        if (!guild) throw new AppError('The Discord server is not available to Chronicle.',503);
        const channels=await guild.channels.fetch();
        return send(res,200,[...channels.values()].filter(channel=>channel && channel.guildId===info.guild && [0,5,15].includes(channel.type)).map(channel=>({id:channel.id,name:channel.name,type:channel.type,parentId:channel.parentId||''})).sort((a,b)=>a.name.localeCompare(b.name)));
      }
      if (section==='images' && method==='GET' && action==='file') {
        archive.require(campaign,actor,true,true); const row=store.get('SELECT * FROM rp_images WHERE campaign=? AND id=?',campaign,itemId);
        if (!row) throw new AppError('RP image not found.',404);
        res.writeHead(200,{'Content-Type':mime[extname(row.asset)]}); await pipeline(createReadStream(join(config.dataDir,'assets',row.asset)),res); return;
      }
      if (section==='images' && method==='PUT' && itemId) {
        archive.require(campaign,actor,true,true); const body=await jsonBody(req); const image=store.get('SELECT * FROM rp_images WHERE campaign=? AND id=?',campaign,itemId);
        if (!image) throw new AppError('RP image not found.',404);
        const entry=archive.record(campaign,actor,String(body.entry||''));
        if (!['npc','location'].includes(entry.kind)) throw new AppError('Assign RP images only to NPCs or locations.');
        archive.save(campaign,actor,{...entry,properties:{...entry.properties,asset:image.asset}},entry.id);
        store.run('DELETE FROM rp_images WHERE campaign=? AND id=?',campaign,itemId); return send(res,200,{ok:true,entry});
      }
      if(section==='preferences'&&method==='GET')return send(res,200,archive.preferences(campaign,actor));
      if(section==='preferences'&&method==='PUT')return send(res,200,archive.preferences(campaign,actor,await jsonBody(req)));
      if (section==='records') {
        if(method==='POST'&&itemId==='bulk'){const body=await jsonBody(req);return send(res,200,archive.bulk(campaign,actor,body.items,body.patch||{}));}
        if (method==='GET' && !itemId) return send(res,200,archive.records(campaign,actor,url.searchParams.get('kind')));
        if (method==='GET' && action==='history') return send(res,200,archive.history(campaign,actor,itemId));
        if (method==='POST' && itemId==='restore') {const body=await jsonBody(req);return send(res,200,archive.restore(campaign,actor,body.revision));}
        if (method==='POST' && itemId==='merge') {const body=await jsonBody(req);return send(res,200,archive.merge(campaign,actor,body.source,body.target));}
        if (method==='GET' && action==='pdf') {const row=archive.record(campaign,actor,itemId);const pdf=await pdfBuffer({title:row.name,body:row.body,theme:url.searchParams.get('theme')||'parchment'});res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${filename(row.name)}.pdf"`});res.end(pdf);return;}
        if (method==='GET' && action==='html') {const row=archive.record(campaign,actor,itemId);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(row.name)}</title>${markdownHtml(row.body)}`);return;}
        if (method==='GET' && action==='image') {
          const row=archive.record(campaign,actor,itemId),asset=row.properties.asset;
          if (!asset || !/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(asset)) throw new AppError('No image attached.',404);
          res.writeHead(200,{'Content-Type':mime[extname(asset)]});await pipeline(createReadStream(join(config.dataDir,'assets',asset)),res);return;
        }
        if (method==='PUT' && action==='image') {
          const row=archive.record(campaign,actor,itemId);if (!archive.canEdit(row,actor)) throw new AppError('You cannot edit this entry.',403);
          const extension=extname(filename(req.headers['x-file-name'])).toLowerCase();if (!['.png','.jpg','.webp'].includes(extension)) throw new AppError('Use PNG, JPG or WebP.');
          const asset=randomUUID()+extension;await mkdir(join(config.dataDir,'assets'),{recursive:true});await upload(req,join(config.dataDir,'assets',asset),10*1024*1024);
          // Preserve player character edit restrictions: image changes are allowed,
          // arbitrary identity/permission property changes are not.
          if (!archive.isAdmin(campaign,actor) && row.kind==='pc' && row.properties.playerSubject===actor.subject) {
            store.run('UPDATE records SET properties=?,version=version+1,updated=? WHERE id=?',JSON.stringify({...row.properties,asset}),Date.now(),row.id);
            return send(res,200,archive.record(campaign,actor,itemId));
          }
          return send(res,200,archive.save(campaign,actor,{...row,properties:{...row.properties,asset}},itemId));
        }
        if (method==='GET' && itemId) return send(res,200,archive.record(campaign,actor,itemId));
        if (method==='POST' && !itemId) return send(res,201,archive.save(campaign,actor,await jsonBody(req)));
        if (method==='PUT' && itemId) return send(res,200,archive.save(campaign,actor,await jsonBody(req),itemId));
        if (method==='DELETE' && itemId) {archive.remove(campaign,actor,itemId);return send(res,200,{ok:true});}
      }
      if(section==='characters'&&action==='arc'&&method==='POST'){const body=await jsonBody(req);return send(res,202,engine.job(campaign,actor,'character_arc',()=>engine.characterArc(campaign,actor,itemId,body.session),itemId));}
      if(section==='arcs'&&action==='approve'&&method==='POST'){const body=await jsonBody(req);return send(res,200,engine.approveArc(campaign,actor,itemId,body.version));}
      if (section==='sessions') {
        if (method==='GET' && !itemId) return send(res,200,archive.sessions(campaign,actor));
        if (method==='POST' && !itemId) {
          archive.require(campaign,actor,true);const body=await jsonBody(req);
          const session=store.createSession(campaign,String(body.title||'Untitled session').slice(0,150),actor.subject,'importing');
          if (body.date) {const date=new Date(body.date).getTime();if (!Number.isFinite(date)) throw new AppError('Invalid session date.');store.run('UPDATE sessions SET started=? WHERE id=?',date,session.id);}
          if (body.notes) splitText(String(body.notes).slice(0,1000000),2000).forEach((text,index)=>store.addText(session.id,'Imported notes',index/1000,text));
          return send(res,201,store.session(campaign,session.id));
        }
        const session=archive.session(campaign,actor,itemId);
        if (method==='GET' && action==='transcript') return send(res,200,{session,chunks:store.chunks(itemId).map(({path,error,...chunk})=>({...chunk,audioAvailable:!!path})),markdown:transcript(session,store.chunks(itemId))});
        if (method==='GET' && action==='audio') {
          if (actor.share) throw new AppError('Audio downloads require campaign membership.',403);
          const chunk=store.chunks(itemId).find(c=>c.id===url.searchParams.get('chunk'));
          if (!chunk?.path) throw new AppError('This audio was not retained. Enable retention before your next session.',404);
          res.writeHead(200,{'Content-Type':mime[extname(chunk.path)]||'application/octet-stream','Content-Disposition':`attachment; filename="${filename(basename(chunk.path))}"`});await pipeline(createReadStream(chunk.path),res);return;
        }
        if (method==='PUT' && action==='audio') {
          archive.require(campaign,actor,true);if (['recording','processing'].includes(session.state)) throw new AppError('This session is busy.');
          const extension=extname(filename(req.headers['x-file-name'])).toLowerCase();if (!['.wav','.mp3','.m4a','.ogg','.flac','.webm','.mp4','.mp2','.aac','.opus'].includes(extension)) throw new AppError('Unsupported audio type.');
          if (url.searchParams.get('consent')!=='true') throw new AppError('Confirm that everyone recorded agreed to this processing.');
          const folder=join(config.dataDir,'audio',itemId);await mkdir(folder,{recursive:true});const target=join(folder,randomUUID()+extension);
          await upload(req,target,2*1024*1024*1024);
          const offset=Number(url.searchParams.get('offset')||0);if (!Number.isFinite(offset)||offset<0||offset>86400) {await unlink(target);throw new AppError('Invalid track offset.');}
          const chunk=store.addAudio(itemId,String(url.searchParams.get('label')||'Uploaded recording (speakers unknown)').slice(0,100),offset,target);
          store.run("UPDATE chunks SET state='uploaded' WHERE id=?",chunk);return send(res,201,{chunk});
        }
        if (method==='POST' && action==='process') {
          archive.require(campaign,actor,true);
          store.run("UPDATE chunks SET state='pending',error='' WHERE session=? AND state IN ('uploaded','failed')",itemId);
          return send(res,202,engine.job(campaign,actor,'review',progress=>engine.generateReview(campaign,actor,itemId,progress)));
        }
        if (method==='POST' && action==='discover') {
          archive.require(campaign,actor,true);const source=store.chunks(itemId).find(c=>c.state==='uploaded');if (!source) throw new AppError('Upload one mixed audio file before speaker discovery.');
          return send(res,202,engine.job(campaign,actor,'speaker_discovery',async progress=>{
            progress('Running local speaker discovery; model access and pyannote.audio must be configured.');
            const result=JSON.parse(await runProcess(config.pythonBin,[fileURLToPath(new URL('../scripts/diarize.py',import.meta.url))],{env:childEnvironment(),input:JSON.stringify({path:source.path,output:join(config.dataDir,'audio',itemId)}),timeout:6*3600000,maxOutput:4000000}));
            for (const segment of result.segments) {const chunk=store.addAudio(itemId,segment.speaker,segment.offset,segment.path);store.run("UPDATE chunks SET state='discovered' WHERE id=?",chunk);}
            store.run("UPDATE chunks SET state='source_archive' WHERE id=?",source.id);store.updateSession(itemId,'speaker_review');return {speakers:result.speakers};
          }));
        }
        if (method==='POST' && action==='map-speakers') {
          archive.require(campaign,actor,true);const body=await jsonBody(req);const mapping=body.mapping||{};
          for (const [from,to] of Object.entries(mapping)) if (typeof to==='string' && to.trim()) store.run("UPDATE chunks SET speaker=?,state=CASE WHEN state='discovered' THEN 'pending' ELSE state END WHERE session=? AND speaker=?",to.slice(0,100),itemId,from);
          return send(res,200,{ok:true});
        }
        if (method==='PUT' && action==='chunk') {
          archive.require(campaign,actor,true);const body=await jsonBody(req),row=store.get('SELECT * FROM chunks WHERE session=? AND id=?',itemId,body.id);
          if (!row) throw new AppError('Transcript segment not found.',404);if (row.text!==body.before) throw new AppError('Transcript changed. Reload it.',409);
          store.run('UPDATE chunks SET text=?,speaker=? WHERE id=?',String(body.text).slice(0,20000),String(body.speaker||row.speaker).slice(0,100),row.id);store.run('DELETE FROM vectors WHERE id=?',row.id);archive.audit(campaign,actor,'transcript.edit',row.id);return send(res,200,{ok:true});
        }
        if (method==='PUT' && !action) {
          archive.require(campaign,actor,true);const body=await jsonBody(req);
          const started=body.date ? new Date(body.date).getTime():session.started;if(!Number.isFinite(started)) throw new AppError('Invalid session date.');
          store.run('UPDATE sessions SET title=?,started=? WHERE id=?',String(body.title||session.title).slice(0,150),started,itemId);return send(res,200,store.session(campaign,itemId));
        }
        if (method==='DELETE' && !action) {
          archive.require(campaign,actor,true);
          if (session.state==='recording'||engine.running.size||store.chunks(itemId).some(c=>['working','pending'].includes(c.state))) throw new AppError('Wait for recordings and jobs to finish before deletion.');
          for (const chunk of store.chunks(itemId)) if(chunk.path) await unlink(chunk.path).catch(()=>{});
          store.deleteSession(campaign,itemId);archive.audit(campaign,actor,'session.delete',itemId);return send(res,200,{ok:true});
        }
      }
      if (section==='reviews') {
        if (method==='GET') return send(res,200,itemId?engine.review(campaign,actor,itemId):engine.reviews(campaign,actor));
        const body=await jsonBody(req);
        if (method==='PUT') return send(res,200,engine.saveReview(campaign,actor,itemId,body.payload,body.version));
        if (method==='POST' && action==='approve') return send(res,200,engine.approve(campaign,actor,itemId,body.version));
        if (method==='POST' && action==='reject') return send(res,200,engine.rejectReview(campaign,actor,itemId));
      }
      if (section==='ask' && method==='POST') {const body=await jsonBody(req);return send(res,200,await engine.ask(campaign,actor,String(body.question||''),{creative:!!body.creative}));}
      if (section==='chat' && method==='GET') {if(actor.share)throw new AppError('Not available on share links.',403);return send(res,200,store.all('SELECT question,answer,created FROM chat WHERE campaign=? AND subject=? ORDER BY created',campaign,actor.subject));}
      if (section==='chat' && method==='DELETE') return send(res,200,engine.clearChat(campaign,actor));
      if (section==='jobs' && method==='GET') return send(res,200,engine.jobs(campaign,actor));
      if (section==='graph' && method==='GET') return send(res,200,archive.graph(campaign,actor));
      if (section==='analytics' && method==='GET') return send(res,200,engine.analytics(campaign,actor,(url.searchParams.get('sessions')||'').split(',').filter(Boolean)));
      if(section==='analyze-tone'&&method==='POST'){const analyzer=new ToneAnalyzer(archive,config);return send(res,202,engine.job(campaign,actor,'text_tone',progress=>analyzer.run(campaign,actor,progress)));}
      if (section==='artifacts' && method==='POST') {const body=await jsonBody(req);return send(res,202,engine.job(campaign,actor,body.kind||'handout',()=>engine.artifact(campaign,actor,body)));}
      if (section==='index' && method==='POST') {if(!search)throw new AppError('Semantic search is disabled. Enable SEMANTIC_SEARCH=1.');return send(res,202,engine.job(campaign,actor,'semantic_index',progress=>search.index(campaign,actor,progress)));}
      if (section==='search' && method==='GET') {
        const question=url.searchParams.get('q')||'';
        const entries=archive.records(campaign,actor).filter(r=>(r.name+' '+r.body).toLowerCase().includes(question.toLowerCase()));
        const sessionIds=new Set(archive.sessions(campaign,actor).filter(s=>s.state==='approved').map(s=>s.id));
        return send(res,200,{entries,excerpts:store.search(campaign,question,200).filter(c=>sessionIds.has(c.session)).slice(0,30).map(({path,error,...row})=>row),semantic:search?await search.query(campaign,actor,question):[]});
      }
      if (section==='replace' && method==='POST') {const body=await jsonBody(req);return send(res,200,archive.replace(campaign,actor,String(body.find||''),String(body.replacement||''),!!body.apply,body.session||null));}
      if (section==='members') {
        if (method==='GET') return send(res,200,archive.members(campaign,actor));
        if (method==='POST') {const body=await jsonBody(req);archive.member(campaign,actor,body.subject,body.role,body.display);return send(res,200,{ok:true});}
      }
      if (section==='tokens') {
        archive.require(campaign,actor,true);
        if (method==='GET') return send(res,200,store.all('SELECT hash,subject,scopes,label,created,expires FROM api_tokens WHERE campaign=?',campaign));
        if (method==='DELETE') {store.run('DELETE FROM api_tokens WHERE campaign=? AND hash=?',campaign,itemId);return send(res,200,{ok:true});}
        if (method==='POST') {const body=await jsonBody(req);return send(res,201,{token:archive.issueToken(actor,campaign,body.subject,body.scopes||['read'],body.label,body.days)});}
      }
      if (section==='shares') {
        archive.require(campaign,actor,true);
        if(method==='GET')return send(res,200,store.all('SELECT hash,label,selection,created,expires FROM public_shares WHERE campaign=?',campaign));
        if(method==='DELETE'){store.run('DELETE FROM public_shares WHERE campaign=? AND hash=?',campaign,itemId);return send(res,200,{ok:true});}
        if(method==='POST'){const body=await jsonBody(req);return send(res,201,{token:archive.share(campaign,actor,body.label||'Shared campaign',body.selection||[],body.days)});}
      }
      if (section==='cast') {
        if(method==='GET')return send(res,200,archive.cast(campaign,actor));
        if(method==='POST'||method==='PUT')return send(res,200,archive.saveCast(campaign,actor,await jsonBody(req),itemId));
      }
      if(section==='export' && method==='GET') {
        const buffer=await exportZip(archive,campaign,actor,{format:url.searchParams.get('format')||'markdown',sessions:(url.searchParams.get('sessions')||'').split(',').filter(Boolean),plainLinks:url.searchParams.get('plain')==='true',dataDir:config.dataDir});
        res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="chronicle-campaign.zip"'});res.end(buffer);return;
      }
      if(section==='restore-export' && method==='POST') {const body=await jsonBody(req,64*1024*1024);if(body.confirm!==true)throw new AppError('Confirm the campaign import.');return send(res,201,importCampaign(archive,campaign,actor,body.data));}
      if(section==='import-document' && method==='POST') {
        const extension=extname(filename(req.headers['x-file-name'])).toLowerCase();if(!['.pdf','.docx','.txt','.md'].includes(extension))throw new AppError('Supported: PDF, DOCX, TXT, MD.');
        const folder=join(config.dataDir,'temporary');await mkdir(folder,{recursive:true});const target=join(folder,randomUUID()+extension);
        await upload(req,target,10*1024*1024);
        try {const data=JSON.parse(await runProcess(config.pythonBin,[fileURLToPath(new URL('../scripts/import_document.py',import.meta.url)),target],{env:childEnvironment(),timeout:60000}));return send(res,201,archive.save(campaign,actor,{kind:'journal',name:url.searchParams.get('title')||filename(req.headers['x-file-name']),body:data.text,visibility:'private',properties:{folder:url.searchParams.get('folder')||''}}));}finally{await unlink(target).catch(()=>{});}
      }
      if(section==='cards' && method==='POST') {archive.require(campaign,actor,true);const body=await jsonBody(req);return send(res,202,engine.job(campaign,actor,'card',()=>integrations.card(campaign,actor,body)));}
      if(section==='sprites' && method==='POST') {archive.require(campaign,actor,true);const body=await jsonBody(req);return send(res,202,engine.job(campaign,actor,'sprite',()=>integrations.sprite(campaign,actor,body)));}
      if(section==='images' && method==='POST') {archive.require(campaign,actor,true);if(!integrations)throw new AppError('Image service unavailable.');const body=await jsonBody(req);return send(res,202,engine.job(campaign,actor,'image',()=>integrations.image(campaign,actor,body)));}
      if(section==='deliver' && method==='POST') {archive.require(campaign,actor,true);if(!integrations)throw new AppError('Delivery service unavailable.');const body=await jsonBody(req);return send(res,202,engine.job(campaign,actor,'delivery',()=>integrations.deliver(campaign,actor,body)));}
      if(section==='discord' && method==='POST') {if(!integrations)throw new AppError('Discord service unavailable.');return send(res,200,await discordAction(integrations,campaign,actor,await jsonBody(req)));}
      throw new AppError('API route not found.',404);
    } catch(error) {
      console.error(`Dashboard ${req.method} failed: ${error.message}`);
      if (!res.headersSent) send(res,error.status || 500,{error:error instanceof AppError?error.message:'Local processing failed. Check the host terminal.'});else res.destroy();
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  address=`http://${host==='0.0.0.0'?'127.0.0.1':host}:${server.address().port}`;
  return {server,url:address,token:rootToken,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
