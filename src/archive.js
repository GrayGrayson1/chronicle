import { randomUUID, randomBytes, createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status=400) { super(message); this.status=status; }
}
const id=()=>randomUUID();
const hash=value=>createHash('sha256').update(value).digest('hex');
export const recordKinds=['pc','npc','item','location','faction','quest','event','moment','award','quote','journal','artifact','arc','collection'];
const parse=row=>row ? {...row, properties:JSON.parse(row.properties),tags:JSON.parse(row.tags),sources:JSON.parse(row.sources),acl:JSON.parse(row.acl)} : null;
const json=value=>JSON.stringify(value);
const clean=(value,max=100000)=>String(value ?? '').slice(0,max);

export function migrateArchive(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_settings(campaign TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE, data TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS members(campaign TEXT REFERENCES campaigns(id) ON DELETE CASCADE,subject TEXT,role TEXT NOT NULL,display TEXT NOT NULL DEFAULT '',PRIMARY KEY(campaign,subject));
    CREATE TABLE IF NOT EXISTS records(
      id TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',properties TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',sources TEXT NOT NULL DEFAULT '[]',visibility TEXT NOT NULL DEFAULT 'party',
      author TEXT NOT NULL,acl TEXT NOT NULL DEFAULT '{}',version INTEGER NOT NULL DEFAULT 1,updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS records_campaign ON records(campaign,kind);
    CREATE TABLE IF NOT EXISTS revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,campaign TEXT NOT NULL,record TEXT NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,session TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,state TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS reviews_session ON reviews(session,created);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,kind TEXT NOT NULL,state TEXT NOT NULL,progress TEXT NOT NULL DEFAULT '',result TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS api_tokens(hash TEXT PRIMARY KEY,subject TEXT NOT NULL,campaign TEXT,scopes TEXT NOT NULL,label TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER);
    CREATE TABLE IF NOT EXISTS public_shares(hash TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,label TEXT NOT NULL,selection TEXT NOT NULL DEFAULT '[]',created INTEGER NOT NULL,expires INTEGER);
    CREATE TABLE IF NOT EXISTS chat(id TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,subject TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,campaign TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY,campaign TEXT NOT NULL,kind TEXT NOT NULL,content_hash TEXT NOT NULL,model TEXT NOT NULL,vector TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS replacement_rules(id TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,find_text TEXT NOT NULL,replacement TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cast_profiles(id TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,subject TEXT NOT NULL DEFAULT '',player TEXT NOT NULL,character TEXT NOT NULL DEFAULT '',role TEXT NOT NULL DEFAULT 'player',aliases TEXT NOT NULL DEFAULT '[]',voice_path TEXT,entity TEXT);
    CREATE TABLE IF NOT EXISTS notification_prefs(campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,subject TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',gems INTEGER NOT NULL DEFAULT 0,activity INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(campaign,subject));
    CREATE TABLE IF NOT EXISTS discord_posts(message TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,channel TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sentiment_scores(chunk TEXT PRIMARY KEY,model TEXT NOT NULL,content_hash TEXT NOT NULL,positive REAL NOT NULL,neutral REAL NOT NULL,negative REAL NOT NULL);
  `);
}

export class Archive {
  constructor(store) { this.store=store; migrateArchive(store); }
  audit(campaign,actor,action,target) { this.store.run('INSERT INTO audit(campaign,actor,action,target,created) VALUES(?,?,?,?,?)',campaign,actor.subject,action,target,Date.now()); }
  role(campaign,actor) {
    if (actor.root) return 'owner';
    if (actor.campaign && actor.campaign!==campaign) return null;
    if (actor.share) return actor.campaign===campaign ? 'viewer':null;
    return this.store.get('SELECT role FROM members WHERE campaign=? AND subject=?',campaign,actor.subject)?.role || null;
  }
  require(campaign,actor,write=false,owner=false) {
    const role=this.role(campaign,actor);
    if (!role) throw new AppError('Campaign not found or access denied.',404);
    if (actor.scopes && !actor.scopes.includes(write?'write':'read')) throw new AppError('This access key does not allow that action.',403);
    if ((write && !['owner','admin'].includes(role)) || (owner && role!=='owner')) throw new AppError('This action requires a campaign administrator.',403);
    return role;
  }
  isAdmin(campaign,actor) { return ['owner','admin'].includes(this.role(campaign,actor)); }
  campaigns(actor) {
    if (actor.root) return this.store.all('SELECT * FROM campaigns ORDER BY name');
    if (actor.share) return this.store.all('SELECT * FROM campaigns WHERE id=?',actor.campaign);
    return this.store.all('SELECT c.* FROM campaigns c JOIN members m ON m.campaign=c.id WHERE m.subject=?'+(actor.campaign?' AND c.id=?':'')+' ORDER BY c.name',...[actor.subject,...(actor.campaign?[actor.campaign]:[])]);
  }
  createCampaign(actor,name) {
    if (!actor.root) throw new AppError('Create campaigns from the host account or Discord.',403);
    const campaign=this.store.createCampaign('local',`dashboard:${id()}`,clean(name,100));
    this.store.run('INSERT INTO members VALUES(?,?,?,?)',campaign.id,actor.subject,'owner',actor.subject);
    return campaign;
  }
  settings(campaign,actor) {
    this.require(campaign,actor);
    const data=JSON.parse(this.store.get('SELECT data FROM campaign_settings WHERE campaign=?',campaign)?.data || '{}');
    return {system:'D&D 5e',language:'en',tone:'Clear, grounded fantasy',extraction:'balanced',retainAudio:false,...data};
  }
  setSettings(campaign,actor,data) {
    this.require(campaign,actor,true);
    const allowed={};
    for (const key of ['system','language','tone','extraction','description','retainAudio','archive','outputLanguage','postGems']) if (Object.hasOwn(data,key)) allowed[key]=typeof data[key]==='boolean' ? data[key]:clean(data[key],3000);
    const next={...this.settings(campaign,actor),...allowed};
    this.store.run('INSERT INTO campaign_settings(campaign,data) VALUES(?,?) ON CONFLICT(campaign) DO UPDATE SET data=excluded.data,version=version+1',campaign,json(next));
    this.audit(campaign,actor,'settings.update',campaign); return next;
  }
  canRead(row,actor) {
    if (!row || !this.role(row.campaign,actor)) return false;
    if (actor.share) return row.visibility==='party' && row.kind!=='journal' && (!actor.selection?.length || actor.selection.includes(row.id));
    return this.isAdmin(row.campaign,actor) || row.visibility==='party' || row.author===actor.subject || ['view','edit','manage'].includes(row.acl?.[actor.subject]);
  }
  canEdit(row,actor) {
    if (actor.share || (actor.scopes && !actor.scopes.includes('write'))) return false;
    return this.isAdmin(row.campaign,actor) || row.author===actor.subject || ['edit','manage'].includes(row.acl?.[actor.subject]) || (row.kind==='pc' && row.properties?.playerSubject===actor.subject);
  }
  records(campaign,actor,kind=null) {
    this.require(campaign,actor);
    return this.store.all('SELECT * FROM records WHERE campaign=?'+(kind?' AND kind=?':'')+' ORDER BY name COLLATE NOCASE',...[campaign,...(kind?[kind]:[])]).map(parse).filter(row=>this.canRead(row,actor));
  }
  record(campaign,actor,recordId) {
    this.require(campaign,actor);
    const row=parse(this.store.get('SELECT * FROM records WHERE campaign=? AND id=?',campaign,recordId));
    if (!row || !this.canRead(row,actor)) throw new AppError('Entry not found.',404);
    return row;
  }
  save(campaign,actor,data,recordId=null) {
    this.require(campaign,actor);
    const previous=recordId ? this.record(campaign,actor,recordId):null;
    if (previous && !this.canEdit(previous,actor)) throw new AppError('You cannot edit this entry.',403);
    const kind=previous?.kind || data.kind;
    if (!recordKinds.includes(kind)) throw new AppError('Unknown entry type.');
    const ownedArc=kind==='arc'&&data.properties?.character&&this.records(campaign,actor,'pc').some(r=>r.id===data.properties.character&&r.properties.playerSubject===actor.subject);
    if (!previous && !['journal'].includes(kind) && !ownedArc && !this.isAdmin(campaign,actor)) throw new AppError('Only administrators can create campaign reference entries.',403);
    if (previous && data.version!==previous.version) throw new AppError('This entry changed. Reload it before saving.',409);
    const properties=structuredClone(data.properties ?? previous?.properties ?? {});
    if (typeof properties!=='object' || Array.isArray(properties) || properties===null || json(properties).length>50000) throw new AppError('Invalid properties.');
    const name=clean(data.name ?? previous?.name,300).trim(); if (!name) throw new AppError('A name is required.');
    const visibility=data.visibility || previous?.visibility || (kind==='journal'?'private':'party');
    if (!['party','private','selected'].includes(visibility)) throw new AppError('Invalid visibility.');
    const mayManage=!previous || this.isAdmin(campaign,actor) || previous.author===actor.subject || previous.acl?.[actor.subject]==='manage';
    if (!mayManage && (data.visibility && data.visibility!==previous.visibility || data.acl && json(data.acl)!==json(previous.acl))) throw new AppError('You cannot change this entry’s sharing.',403);
    const limitedCharacter=previous?.kind==='pc' && !this.isAdmin(campaign,actor) && previous.author!==actor.subject;
    if (limitedCharacter && (json(properties)!==json(previous.properties) || visibility!==previous.visibility)) throw new AppError('Players can edit their character name and description; properties and permissions require an administrator.',403);
    const tags=data.tags ?? previous?.tags ?? []; const sources=data.sources ?? previous?.sources ?? [];
    const acl=data.acl ?? previous?.acl ?? {};
    if (!Array.isArray(tags) || tags.some(t=>typeof t!=='string') || tags.length>100 || !Array.isArray(sources) || sources.length>2000 || !acl || typeof acl!=='object' || Array.isArray(acl) || Object.values(acl).some(v=>!['view','edit','manage'].includes(v))) throw new AppError('Invalid tags, citations, or permissions.');
    const record={id:previous?.id || id(),campaign,kind,name,body:clean(data.body ?? previous?.body),properties,tags,sources,visibility,author:previous?.author || actor.subject,acl,version:(previous?.version||0)+1,updated:Date.now()};
    if (previous) this.store.run('INSERT INTO revisions(campaign,record,payload,actor,created) VALUES(?,?,?,?,?)',campaign,previous.id,json(previous),actor.subject,Date.now());
    this.store.run(`INSERT INTO records(id,campaign,kind,name,body,properties,tags,sources,visibility,author,acl,version,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,body=excluded.body,properties=excluded.properties,tags=excluded.tags,sources=excluded.sources,visibility=excluded.visibility,acl=excluded.acl,version=excluded.version,updated=excluded.updated`,record.id,campaign,kind,name,record.body,json(properties),json(tags),json(sources),visibility,record.author,json(acl),record.version,record.updated);
    this.store.run('DELETE FROM vectors WHERE id=?',record.id);
    this.audit(campaign,actor,previous?'entry.update':'entry.create',record.id);
    return record;
  }
  remove(campaign,actor,recordId) {
    const row=this.record(campaign,actor,recordId);
    if (!this.isAdmin(campaign,actor) && !(row.kind==='journal' && row.author===actor.subject)) throw new AppError('Only administrators or a journal author can delete this entry.',403);
    if (actor.scopes && !actor.scopes.includes('write')) throw new AppError('Read-only access key.',403);
    this.store.run('INSERT INTO revisions(campaign,record,payload,actor,created) VALUES(?,?,?,?,?)',campaign,row.id,json(row),actor.subject,Date.now());
    this.store.run('DELETE FROM records WHERE campaign=? AND id=?',campaign,recordId); this.store.run('DELETE FROM vectors WHERE id=?',recordId);
    this.audit(campaign,actor,'entry.delete',recordId);
  }
  history(campaign,actor,recordId) { this.require(campaign,actor,true); return this.store.all('SELECT * FROM revisions WHERE campaign=? AND record=? ORDER BY id DESC LIMIT 100',campaign,recordId).map(r=>({...r,payload:JSON.parse(r.payload)})); }
  restore(campaign,actor,revision) {
    this.require(campaign,actor,true);
    const row=this.store.get('SELECT * FROM revisions WHERE campaign=? AND id=?',campaign,revision); if (!row) throw new AppError('Revision not found.',404);
    const old=JSON.parse(row.payload), current=parse(this.store.get('SELECT * FROM records WHERE campaign=? AND id=?',campaign,old.id));
    return this.save(campaign,actor,{...old,version:current?.version},current?.id || null);
  }
  merge(campaign,actor,sourceId,targetId) {
    this.require(campaign,actor,true); if (sourceId===targetId) throw new AppError('Choose two different entries.');
    const source=this.record(campaign,actor,sourceId), target=this.record(campaign,actor,targetId);
    if (source.kind!==target.kind) throw new AppError('Only entries of the same type can be merged.');
    if (source.visibility!==target.visibility) throw new AppError('Set both entries to the same visibility before merging.');
    this.store.db.exec('BEGIN');
    try {
      const result=this.save(campaign,actor,{...target,body:target.body+'\n\n'+source.body,properties:{...source.properties,...target.properties,aliases:[...new Set([...(target.properties.aliases||[]),...(source.properties.aliases||[]),source.name])]},tags:[...new Set([...source.tags,...target.tags])],sources:[...target.sources,...source.sources]},targetId);
      for (const row of this.records(campaign,actor)) {
        const next=row.body.split(`[[${source.name}]]`).join(`[[${target.name}]]`);
        const props=JSON.parse(JSON.stringify(row.properties).replaceAll(sourceId,targetId));
        if (next!==row.body || json(props)!==json(row.properties)) this.save(campaign,actor,{...row,body:next,properties:props},row.id);
      }
      this.remove(campaign,actor,sourceId); this.store.db.exec('COMMIT'); return result;
    } catch(error) { this.store.db.exec('ROLLBACK'); throw error; }
  }
  sessions(campaign,actor) {
    this.require(campaign,actor);
    const admin=this.isAdmin(campaign,actor);
    return this.store.all('SELECT * FROM sessions WHERE campaign=? ORDER BY started DESC',campaign).filter(s=>admin || s.state==='approved').filter(s=>!actor.share || !actor.selection?.length || actor.selection.includes(s.id));
  }
  session(campaign,actor,sessionId) { const row=this.sessions(campaign,actor).find(s=>s.id===sessionId); if (!row) throw new AppError('Session not found.',404); return row; }
  members(campaign,actor) { this.require(campaign,actor,true); return this.store.all('SELECT * FROM members WHERE campaign=?',campaign); }
  member(campaign,actor,subject,role,display='') {
    this.require(campaign,actor,true,role==='admin' || role==='owner');
    if (!['owner','admin','player'].includes(role)) throw new AppError('Invalid role.');
    const previous=this.store.get('SELECT * FROM members WHERE campaign=? AND subject=?',campaign,subject);
    if (previous?.role==='owner') this.require(campaign,actor,true,true);
    if (previous?.role==='owner' && role!=='owner' && this.store.get("SELECT COUNT(*) AS n FROM members WHERE campaign=? AND role='owner'",campaign).n<=1) throw new AppError('The last owner cannot be demoted.');
    this.store.run('INSERT INTO members VALUES(?,?,?,?) ON CONFLICT(campaign,subject) DO UPDATE SET role=excluded.role,display=excluded.display',campaign,clean(subject,100),role,clean(display,100));
    this.audit(campaign,actor,'member.update',subject);
  }
  issueToken(actor,campaign,subject,scopes=['read'],label='Access key',days=30) {
    this.require(campaign,actor,true);
    const target=this.store.get('SELECT * FROM members WHERE campaign=? AND subject=?',campaign,subject);
    if (!target) throw new AppError('Add this member to the campaign first.');
    if (['owner','admin'].includes(target.role) && subject!==actor.subject && !actor.root) this.require(campaign,actor,true,true);
    if (scopes.some(s=>!['read','write'].includes(s))) throw new AppError('Invalid key scope.');
    const token=randomBytes(32).toString('base64url');
    this.store.run('INSERT INTO api_tokens VALUES(?,?,?,?,?,?,?)',hash(token),subject,campaign,json(scopes),clean(label,100),Date.now(),Date.now()+Math.min(Math.max(days,1),365)*86400000);
    return token;
  }
  tokenActor(token) {
    const row=this.store.get('SELECT * FROM api_tokens WHERE hash=?',hash(token));
    if (!row || row.expires && row.expires<Date.now()) return null;
    return {subject:row.subject,campaign:row.campaign,scopes:JSON.parse(row.scopes)};
  }
  share(campaign,actor,label,selection=[],days=30) {
    this.require(campaign,actor,true);
    const allowed=new Set([...this.records(campaign,actor).filter(r=>r.visibility==='party' && r.kind!=='journal').map(r=>r.id),...this.sessions(campaign,actor).filter(s=>s.state==='approved').map(s=>s.id)]);
    if (selection.some(value=>!allowed.has(value))) throw new AppError('Only approved sessions and party reference entries can be shared.');
    const token=randomBytes(32).toString('base64url');
    this.store.run('INSERT INTO public_shares VALUES(?,?,?,?,?,?)',hash(token),campaign,clean(label,100),json(selection),Date.now(),Date.now()+Math.min(Math.max(days,1),365)*86400000);
    this.audit(campaign,actor,'share.create',label); return token;
  }
  shareActor(token) { const row=this.store.get('SELECT * FROM public_shares WHERE hash=?',hash(token)); return row && (!row.expires || row.expires>Date.now()) ? {subject:'share',campaign:row.campaign,share:true,scopes:['read'],selection:JSON.parse(row.selection)}:null; }
  graph(campaign,actor) {
    const records=this.records(campaign,actor), names=new Map();
    for (const row of records) for (const name of [row.name,...(row.properties.aliases||[])]) names.set(name.toLowerCase(),row.id);
    const ids=new Set(records.map(r=>r.id)), edges=[];
    for (const row of records) {
      for (const match of row.body.matchAll(/\[\[([^\]]+)\]\]/g)) { const target=names.get(match[1].toLowerCase()); if (target && target!==row.id) edges.push({from:row.id,to:target,kind:'wikilink'}); }
      for (const [field,value] of Object.entries(row.properties)) {
        for (const target of Array.isArray(value)?value:[value]) if (typeof target==='string' && ids.has(target) && target!==row.id) edges.push({from:row.id,to:target,kind:field});
      }
    }
    return {nodes:records.map(r=>({id:r.id,name:r.name,kind:r.kind,tags:r.tags,sessions:[...new Set(r.sources.map(s=>s.session).filter(Boolean))]})),edges};
  }
  bulk(campaign,actor,items,patch) {
    this.require(campaign,actor,true);
    if(!Array.isArray(items)||!items.length||items.length>500)throw new AppError('Select 1–500 entries.');
    this.store.db.exec('BEGIN');
    try {
      const results=[];
      for(const item of items){const row=this.record(campaign,actor,item.id);if(row.version!==item.version)throw new AppError('An entry changed. Reload before applying a bulk edit.',409);
        const properties={...row.properties,...(patch.properties||{}),...(item.properties||{})},tags=[...new Set([...row.tags,...(patch.addTags||[])])].filter(tag=>!(patch.removeTags||[]).includes(tag));
        results.push(this.save(campaign,actor,{...row,properties,tags},row.id));}
      this.store.db.exec('COMMIT');return results;
    }catch(error){this.store.db.exec('ROLLBACK');throw error;}
  }
  replace(campaign,actor,find,replacement,apply=false,sessionId=null) {
    this.require(campaign,actor,true);
    if (!find || find.length>200 || replacement.length>300) throw new AppError('Enter a search string (up to 200 characters) and replacement (up to 300).');
    const changes=[];
    for (const record of this.records(campaign,actor)) {
      const name=record.name.split(find).join(replacement),body=record.body.split(find).join(replacement);
      if (name!==record.name || body!==record.body) changes.push({type:'entry',id:record.id,name,before:record.body,after:body,record});
    }
    const chunks=this.store.all(`SELECT c.* FROM chunks c JOIN sessions s ON s.id=c.session WHERE s.campaign=? AND c.text<>''`+(sessionId?' AND s.id=?':''),...[campaign,...(sessionId?[sessionId]:[])]);
    for (const chunk of chunks) if (chunk.text.includes(find)) changes.push({type:'transcript',id:chunk.id,before:chunk.text,after:chunk.text.split(find).join(replacement)});
    if (apply) {
      this.store.db.exec('BEGIN');
      try {
        for (const change of changes) if (change.type==='entry') this.save(campaign,actor,{...change.record,name:change.name,body:change.after},change.id); else { this.store.run('UPDATE chunks SET text=? WHERE id=?',change.after,change.id); this.store.run('DELETE FROM vectors WHERE id=?',change.id); }
        this.store.run('INSERT INTO replacement_rules VALUES(?,?,?,?,?)',id(),campaign,find,replacement,Date.now());
        this.audit(campaign,actor,'text.replace',find); this.store.db.exec('COMMIT');
      } catch(error) { this.store.db.exec('ROLLBACK'); throw error; }
    }
    return changes.map(({record,...change})=>change);
  }
  cast(campaign,actor) { this.require(campaign,actor); return this.store.all('SELECT id,campaign,subject,player,character,role,aliases,entity FROM cast_profiles WHERE campaign=?',campaign).map(r=>({...r,aliases:JSON.parse(r.aliases)})); }
  saveCast(campaign,actor,data,castId=null) {
    this.require(campaign,actor,true);
    const value={id:castId || id(),subject:clean(data.subject,100),player:clean(data.player,100),character:clean(data.character,100),role:data.role==='gm'?'gm':'player',aliases:(data.aliases||[]).map(v=>clean(v,100)).slice(0,30),entity:data.entity || null};
    if (!value.player) throw new AppError('Player name is required.');
    if (castId && !this.store.get('SELECT id FROM cast_profiles WHERE id=? AND campaign=?',castId,campaign)) throw new AppError('Cast member not found.',404);
    this.store.run('INSERT INTO cast_profiles(id,campaign,subject,player,character,role,aliases,entity) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subject=excluded.subject,player=excluded.player,character=excluded.character,role=excluded.role,aliases=excluded.aliases,entity=excluded.entity',value.id,campaign,value.subject,value.player,value.character,value.role,json(value.aliases),value.entity);
    return value;
  }
  preferences(campaign,actor,data=null) {
    this.require(campaign,actor);if(actor.share)throw new AppError('Share links do not have notification preferences.',403);
    if(data){if(actor.root&&!this.store.get('SELECT role FROM members WHERE campaign=? AND subject=?',campaign,actor.subject))this.store.run('INSERT INTO members VALUES(?,?,?,?)',campaign,actor.subject,'owner','Host');if(actor.scopes&&!actor.scopes.includes('write'))throw new AppError('Read-only key.',403);const email=String(data.email||'').trim();if(email&&!/^\S+@\S+\.\S+$/.test(email)||/[\r\n,;]/.test(email))throw new AppError('Enter one valid email address.');
      this.store.run('INSERT INTO notification_prefs VALUES(?,?,?,?,?) ON CONFLICT(campaign,subject) DO UPDATE SET email=excluded.email,gems=excluded.gems,activity=excluded.activity',campaign,actor.subject,email,data.gems?1:0,data.activity?1:0);}
    return this.store.get('SELECT email,gems,activity FROM notification_prefs WHERE campaign=? AND subject=?',campaign,actor.subject)||{email:'',gems:0,activity:0};
  }
}
