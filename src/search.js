import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runProcess, childEnvironment } from './process.js';

export class SemanticSearch {
  constructor(archive,config,runner=runProcess) {this.archive=archive;this.store=archive.store;this.config=config;this.runner=runner;}
  async embed(texts) {
    const result=JSON.parse(await this.runner(this.config.pythonBin,[fileURLToPath(new URL('../scripts/embed.py',import.meta.url))],{input:JSON.stringify({texts}),env:childEnvironment(),timeout:15*60000,maxOutput:15000000}));
    if (!Array.isArray(result.vectors) || result.vectors.length!==texts.length || result.vectors.some(v=>!Array.isArray(v)||!v.length||v.some(x=>!Number.isFinite(x)))) throw new Error('Invalid local embeddings.');
    return result;
  }
  documents(campaign,actor) {
    const entries=this.archive.records(campaign,actor).map(r=>({id:r.id,kind:r.kind,text:`${r.name}\n${r.body}`,source:{entry:r.id,name:r.name}}));
    const sessions=this.archive.sessions(campaign,actor).filter(s=>s.state==='approved');
    for (const session of sessions) for (const chunk of this.store.chunks(session.id).filter(c=>c.text)) entries.push({id:chunk.id,kind:'transcript',text:`${chunk.speaker}: ${chunk.text}`,source:{session:session.id,time:chunk.offset,speaker:chunk.speaker}});
    return entries;
  }
  async index(campaign,actor,progress=()=>{}) {
    this.archive.require(campaign,actor,true);
    const docs=this.documents(campaign,actor),model=process.env.EMBED_MODEL || 'sentence-transformers/all-MiniLM-L6-v2';
    const pending=docs.filter(doc=>{
      doc.hash=createHash('sha256').update(doc.text).digest('hex');
      const previous=this.store.get('SELECT content_hash,model FROM vectors WHERE id=?',doc.id);return !previous || previous.content_hash!==doc.hash || previous.model!==model;
    });
    for (let i=0;i<pending.length;i+=64) {
      const batch=pending.slice(i,i+64);progress(`Indexing ${Math.min(i+64,pending.length)} / ${pending.length}`);
      const result=await this.embed(batch.map(d=>d.text.slice(0,12000)));
      batch.forEach((doc,index)=>this.store.run('INSERT INTO vectors VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET content_hash=excluded.content_hash,model=excluded.model,vector=excluded.vector',doc.id,campaign,doc.kind,doc.hash,result.model,JSON.stringify(result.vectors[index])));
    }
    return {indexed:pending.length,total:docs.length};
  }
  async query(campaign,actor,question) {
    this.archive.require(campaign,actor);
    const allowed=new Map(this.documents(campaign,actor).map(doc=>[doc.id,doc]));
    const rows=this.store.all('SELECT * FROM vectors WHERE campaign=?',campaign).filter(row=>allowed.has(row.id));
    if (!rows.length) return [];
    const result=await this.embed([question]);const query=result.vectors[0];
    return rows.filter(row=>row.model===result.model).map(row=>{
      const vector=JSON.parse(row.vector);return {...allowed.get(row.id),score:vector.length===query.length ? vector.reduce((sum,value,index)=>sum+value*query[index],0):-1};
    }).sort((a,b)=>b.score-a.score).slice(0,12).map(doc=>({text:doc.text.slice(0,3000),source:doc.source,score:doc.score}));
  }
}
