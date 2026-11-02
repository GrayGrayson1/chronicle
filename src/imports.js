import { AppError } from './archive.js';
export function importCampaign(archive,campaign,actor,data) {
  archive.require(campaign,actor,true);
  if(data.formatVersion!==2||!Array.isArray(data.records)||!Array.isArray(data.sessions)||data.records.length>10000||data.sessions.length>1000)throw new AppError('Use a Chronicle formatVersion 2 campaign.json export.');
  const store=archive.store,sessionMap=new Map(),chunkMap=new Map(),entryMap=new Map();
  const mapped=value=>typeof value==='string'?(entryMap.get(value)||sessionMap.get(value)||chunkMap.get(value)||value):Array.isArray(value)?value.map(mapped):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,mapped(v)])):value;
  store.db.exec('BEGIN');
  try {
    for(const source of data.sessions){
      const session=store.createSession(campaign,String(source.title||'Imported session').slice(0,150),actor.subject,'approved');sessionMap.set(source.id,session.id);
      const started=Number(source.started);if(Number.isFinite(started))store.run('UPDATE sessions SET started=? WHERE id=?',started,session.id);
      store.updateSession(session.id,'approved',String(source.recap||'').slice(0,100000));
      for(const chunk of source.chunks||[]){if(!chunk.text)continue;const offset=Math.max(0,Number(chunk.offset)||0),duration=Math.max(0,Number(chunk.duration)||0);const id=store.addText(session.id,String(chunk.speaker||'Imported').slice(0,100),offset,String(chunk.text).slice(0,20000),duration);chunkMap.set(chunk.id,id);}
    }
    const pairs=[];
    for(const source of data.records){
      const row=archive.save(campaign,actor,{kind:source.kind,name:source.name,body:source.body,properties:{},tags:source.tags||[],visibility:source.visibility==='party'?'party':'private'});entryMap.set(source.id,row.id);pairs.push([source,row]);
    }
    for(const [source,row] of pairs)archive.save(campaign,actor,{...row,properties:mapped(source.properties||{}),sources:mapped(source.sources||[])},row.id);
    archive.audit(campaign,actor,'campaign.import',String(pairs.length));store.db.exec('COMMIT');
    return {sessions:sessionMap.size,entries:entryMap.size};
  }catch(error){store.db.exec('ROLLBACK');throw error;}
}
