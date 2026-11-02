import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runProcess,childEnvironment } from './process.js';

export function enrichParticipation(store,sessions,report) {
  const speakers=new Map(report.speakers.map(row=>[row.speaker,{...row,responses:0,speechSeconds:0,longestAbsenceSeconds:0,bins:[],sentiment:{positive:0,neutral:0,negative:0,segments:0}}]));
  let transitions=0;
  for(const session of sessions){const chunks=store.chunks(session.id).filter(c=>c.text&&c.state==='done'),length=Math.max(1,...chunks.map(c=>c.offset+c.duration));const bins=new Map([...speakers.keys()].map(key=>[key,Array(Math.max(1,Math.ceil(length/300))).fill(0)]));const lastSeen=new Map();let lastSpeaker=null;
    for(const chunk of chunks){const row=speakers.get(chunk.speaker);if(!row)continue;const words=(chunk.text.match(/[\p{L}\p{N}']+/gu)||[]).length;bins.get(chunk.speaker)[Math.min(bins.get(chunk.speaker).length-1,Math.floor(chunk.offset/300))]+=words;
      if(lastSpeaker&&lastSpeaker!==chunk.speaker){row.responses++;transitions++;}lastSpeaker=chunk.speaker;row.speechSeconds+=chunk.duration||0;row.longestAbsenceSeconds=Math.max(row.longestAbsenceSeconds,chunk.offset-(lastSeen.get(chunk.speaker)||0));lastSeen.set(chunk.speaker,chunk.offset+chunk.duration);
      const tone=store.get('SELECT * FROM sentiment_scores WHERE chunk=?',chunk.id);if(tone&&tone.content_hash===createHash('sha256').update(chunk.text).digest('hex')){for(const key of ['positive','neutral','negative'])row.sentiment[key]+=tone[key];row.sentiment.segments++;}
    }
    for(const [speaker,values]of bins){const row=speakers.get(speaker);row.bins.push(...values);row.longestAbsenceSeconds=Math.max(row.longestAbsenceSeconds,length-(lastSeen.get(speaker)||0));}
  }
  report.speakers=[...speakers.values()].map(row=>{const mean=row.bins.reduce((a,b)=>a+b,0)/Math.max(1,row.bins.length),variance=row.bins.reduce((sum,v)=>sum+(v-mean)**2,0)/Math.max(1,row.bins.length),cv=mean?Math.sqrt(variance)/mean:0;const {bins,...output}=row;for(const key of ['positive','neutral','negative'])output.sentiment[key]/=Math.max(1,output.sentiment.segments);return {...output,radar:{talkShare:row.share,questionRate:Math.min(1,row.questions*20/Math.max(1,row.words)),responseShare:row.responses/Math.max(1,transitions),consistency:1/(1+cv),variability:cv/(1+cv)}};});
  report.methodology+=' Radar: talk share uses words; question rate is capped at 5 questions per 100 words; response share counts speaker changes; consistency is 1/(1+CV) of word counts in five-minute bins; variability is CV/(1+CV). Longest absences use transcript timestamps. Optional sentiment scores classify text, not people’s emotions or mental states.';return report;
}

export class ToneAnalyzer {
  constructor(archive,config,runner=runProcess){this.archive=archive;this.config=config;this.runner=runner;}
  async run(campaign,actor,progress=()=>{}){
    this.archive.require(campaign,actor,true);const store=this.archive.store,model=process.env.SENTIMENT_MODEL||'cardiffnlp/twitter-roberta-base-sentiment-latest';
    const chunks=this.archive.sessions(campaign,actor).filter(s=>s.state==='approved').flatMap(s=>store.chunks(s.id)).filter(c=>c.text&&c.state==='done');
    const pending=chunks.filter(c=>{c.hash=createHash('sha256').update(c.text).digest('hex');const row=store.get('SELECT content_hash,model FROM sentiment_scores WHERE chunk=?',c.id);return !row||row.content_hash!==c.hash||row.model!==model;});
    for(let i=0;i<pending.length;i+=256){const batch=pending.slice(i,i+256);progress(`Local text-tone analysis ${Math.min(i+256,pending.length)} / ${pending.length}`);const result=JSON.parse(await this.runner(this.config.pythonBin,[fileURLToPath(new URL('../scripts/sentiment.py',import.meta.url))],{input:JSON.stringify({texts:batch.map(c=>c.text)}),env:childEnvironment(),timeout:30*60000}));
      if(!Array.isArray(result.scores)||result.scores.length!==batch.length)throw new Error('Invalid sentiment model output.');
      result.scores.forEach((score,index)=>{if(!['positive','neutral','negative'].every(key=>Number.isFinite(score[key])&&score[key]>=0&&score[key]<=1))throw new Error('Invalid sentiment scores.');const chunk=batch[index];store.run('INSERT INTO sentiment_scores VALUES(?,?,?,?,?,?) ON CONFLICT(chunk) DO UPDATE SET model=excluded.model,content_hash=excluded.content_hash,positive=excluded.positive,neutral=excluded.neutral,negative=excluded.negative',chunk.id,result.model,chunk.hash,score.positive,score.neutral,score.negative);});
    }return {analyzed:pending.length};
  }
}
