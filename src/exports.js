import { zipSync,strToU8 } from 'fflate';
import PDFDocument from 'pdfkit';
import { transcript } from './store.js';
import { existsSync,readFileSync } from 'node:fs';
import { join } from 'node:path';

export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function slug(value) {return value.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,100) || 'entry';}
export function markdownHtml(text) {
  return '<article>'+escapeHtml(text).split('\n').map(line=>line.startsWith('# ')?`<h1>${line.slice(2)}</h1>`:line.startsWith('## ')?`<h2>${line.slice(3)}</h2>`:line.startsWith('### ')?`<h3>${line.slice(4)}</h3>`:`<p>${line || '&nbsp;'}</p>`).join('')+'</article>';
}
export function pdfBuffer({title,body,theme='parchment'}) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margin:48,info:{Title:title,Author:'Chronicle'}}),parts=[];
    const regular=process.env.PDF_FONT || ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','C:/Windows/Fonts/segoeui.ttf'].find(path=>existsSync(path));
    const bold=process.env.PDF_FONT_BOLD || ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','C:/Windows/Fonts/segoeuib.ttf'].find(path=>existsSync(path));
    if(regular)doc.registerFont('ChronicleRegular',regular);if(bold)doc.registerFont('ChronicleBold',bold);
    const regularName=regular?'ChronicleRegular':'Helvetica',boldName=bold?'ChronicleBold':regularName;
    doc.on('data',part=>parts.push(part));doc.on('end',()=>resolve(Buffer.concat(parts)));doc.on('error',reject);
    const themes={parchment:['#f8f4e9','#302b25','#8c6934'],night:['#111b29','#f0eee8','#90c2b0'],azure:['#f5f9ff','#1f3450','#356ab0'],verdant:['#f3f8f1','#243c2a','#527d4d'],infernal:['#fff8f5','#352321','#a64234']};
    const [bg,fg,accent]=themes[theme]||themes.parchment;
    const decorate=()=>{doc.save().rect(0,0,doc.page.width,doc.page.height).fill(bg).restore();doc.fillColor(fg);};
    decorate();doc.on('pageAdded',decorate);doc.fillColor(accent).font(boldName).fontSize(25).text(title);doc.moveDown();
    for (const line of body.split('\n')) {
      if (/^#{1,3} /.test(line)) doc.fillColor(accent).font(boldName).fontSize(15).text(line.replace(/^#+ /,''));
      else doc.fillColor(fg).font(regularName).fontSize(10).text(line.replace(/\*\*/g,''),{lineGap:3});
      doc.moveDown(0.3);
    }
    doc.end();
  });
}
export async function exportZip(archive,campaign,actor,{format='markdown',sessions:selection=[],plainLinks=false,dataDir=null}={}) {
  archive.require(campaign,actor);
  const info=archive.store.get('SELECT * FROM campaigns WHERE id=?',campaign);
  const sessions=archive.sessions(campaign,actor).filter(s=>s.state==='approved' && (!selection.length || selection.includes(s.id)));
  const ids=new Set(sessions.map(s=>s.id));
  const records=archive.records(campaign,actor).filter(r=>!selection.length || r.sources.some(source=>ids.has(source.session)));
  const files={};let totalBytes=0;
  const append=(name,text)=>{const bytes=strToU8(text);totalBytes+=bytes.length;if(totalBytes>64*1024*1024)throw new Error('Export exceeds 64 MB; select fewer sessions.');files[name]=bytes;};
  const add=(path,text)=>{
    if (plainLinks) text=text.replace(/\[\[([^\]]+)\]\]/g,'$1');
    append(path+(format==='html'?'.html':'.md'),format==='html'?`<!doctype html><meta charset="utf-8"><title>${escapeHtml(path)}</title><style>body{max-width:850px;margin:50px auto;font:17px/1.7 system-ui;padding:20px}h1,h2{color:#314e49}</style>${markdownHtml(text)}`:text);
  };
  add('README',`# ${info.name}\nExported from Chronicle.\nOnly material visible to the exporting member is included.\n`);
  for (const session of sessions) {add(`Sessions/${slug(session.title)}-${session.id}`,`# ${session.title}\n\n${session.recap}`);add(`Transcripts/${session.id}`,transcript(session,archive.store.chunks(session.id)));}
  for (const record of records) add(`${slug(record.kind)}/${slug(record.name)}-${record.id.slice(0,8)}`,`# ${record.name}\n\n${record.body}\n\n## Properties\n\n${JSON.stringify(record.properties,null,2)}`);
  append('campaign.json',JSON.stringify({formatVersion:2,campaign:{name:info.name,settings:archive.settings(campaign,actor)},sessions:sessions.map(({owner,...session})=>({...session,chunks:archive.store.chunks(session.id).filter(c=>c.text).map(({path,error,...chunk})=>chunk)})),records:records.map(({acl,author,...record})=>record)},null,2));
  if(dataDir)for(const asset of new Set(records.map(row=>row.properties.asset).filter(value=>typeof value==='string'&&/^[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(value)))) {
    const path=join(dataDir,'assets',asset);if(existsSync(path)){const bytes=new Uint8Array(readFileSync(path));totalBytes+=bytes.length;if(totalBytes>64*1024*1024)throw new Error('Export exceeds 64 MB; select fewer sessions.');files['assets/'+asset]=bytes;}
  }
  if (format==='obsidian') append('.obsidian/app.json',JSON.stringify({showInlineTitle:true}));
  return Buffer.from(zipSync(files,{level:6}));
}
