import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runProcess,childEnvironment } from './process.js';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { AppError } from './archive.js';
import { escapeHtml,markdownHtml,pdfBuffer } from './exports.js';

export class Integrations {
  constructor(archive,config,{discord=null,fetcher=fetch,mailer=nodemailer.createTransport}={}) {this.archive=archive;this.config=config;this.discord=discord;this.fetch=fetcher;this.mailer=mailer;}
  async image(campaign,actor,{entry,prompt='',style='fantasy illustration',type='portrait',save=true}) {
    this.archive.require(campaign,actor,true);
    if (!process.env.COMFYUI_CHECKPOINT) throw new AppError('Configure a local ComfyUI checkpoint before generating images.');
    const base=new URL(process.env.COMFYUI_URL || 'http://127.0.0.1:8188');
    if (!['127.0.0.1','localhost','[::1]'].includes(base.hostname)) throw new AppError('Image generation is restricted to a local ComfyUI server.');
    const row=this.archive.record(campaign,actor,entry);
    const text=`${style}, ${type==='sprite'?'isolated full-body token on a plain background, centered, entire silhouette visible, no text':type==='card'?'collectible fantasy card art without text or border':'detailed character or environment art'}, ${row.name}, ${row.body.slice(0,2000)}, ${String(prompt).slice(0,2000)}`;
    const workflow={
      '1':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:process.env.COMFYUI_CHECKPOINT}},
      '2':{class_type:'CLIPTextEncode',inputs:{text,clip:['1',1]}},
      '3':{class_type:'CLIPTextEncode',inputs:{text:'text, watermark, logo, cropped, low quality',clip:['1',1]}},
      '4':{class_type:'EmptyLatentImage',inputs:{width:type==='spritesheet'?1024:512,height:type==='portrait'?768:512,batch_size:1}},
      '5':{class_type:'KSampler',inputs:{seed:Math.floor(Math.random()*Number.MAX_SAFE_INTEGER),steps:24,cfg:7,sampler_name:'euler',scheduler:'normal',denoise:1,model:['1',0],positive:['2',0],negative:['3',0],latent_image:['4',0]}},
      '6':{class_type:'VAEDecode',inputs:{samples:['5',0],vae:['1',2]}},
      '7':{class_type:'SaveImage',inputs:{filename_prefix:'Chronicle',images:['6',0]}},
    };
    if(type==='spritesheet' && row.properties.asset) {
      if(!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(row.properties.asset))throw new AppError('A valid portrait is required.');
      const bytes=await readFile(join(this.config.dataDir,'assets',row.properties.asset));const upload=new FormData();upload.append('image',new Blob([bytes]),row.properties.asset);
      const uploaded=await this.fetch(new URL('/upload/image',base),{method:'POST',body:upload,signal:AbortSignal.timeout(30000)});if(!uploaded.ok)throw new AppError('Could not send portrait to the local image generator.');
      const image=await uploaded.json();workflow['8']={class_type:'LoadImage',inputs:{image:image.name}};
      // The portrait is supplied for reference through img2img, then scaled to
      // the sheet aspect ratio expected by the deterministic GIF assembler.
      workflow['9']={class_type:'ImageScale',inputs:{image:['8',0],upscale_method:'nearest-exact',width:1024,height:512,crop:'disabled'}};
      workflow['10']={class_type:'VAEEncode',inputs:{pixels:['9',0],vae:['1',2]}};
      workflow['5'].inputs.latent_image=['10',0];workflow['5'].inputs.denoise=0.85;
    }
    const response=await this.fetch(new URL('/prompt',base),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:workflow,client_id:randomUUID()}),signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new AppError('ComfyUI rejected the workflow. Check your configured checkpoint.');
    const queued=await response.json();let output;
    for (let attempt=0;attempt<600;attempt++) {
      const historyResponse=await this.fetch(new URL(`/history/${encodeURIComponent(queued.prompt_id)}`,base),{signal:AbortSignal.timeout(15000)});
      const history=await historyResponse.json();const current=history[queued.prompt_id];
      if(current?.status?.status_str==='error') throw new AppError('ComfyUI image generation failed.');
      output=Object.values(current?.outputs||{}).flatMap(node=>node.images||[])[0];
      if (output)break;await new Promise(resolve=>setTimeout(resolve,2000));
    }
    if (!output)throw new AppError('ComfyUI image generation timed out.');
    const imageUrl=new URL('/view',base);for(const name of ['filename','subfolder','type'])imageUrl.searchParams.set(name,output[name]||'');
    const result=await this.fetch(imageUrl,{signal:AbortSignal.timeout(30000)});if(!result.ok)throw new AppError('Generated image could not be retrieved.');
    const bytes=Buffer.from(await result.arrayBuffer());if(bytes.length>20*1024*1024)throw new AppError('Generated image exceeds the size limit.');
    const asset=randomUUID()+'.png';await mkdir(join(this.config.dataDir,'assets'),{recursive:true});await writeFile(join(this.config.dataDir,'assets',asset),bytes,{mode:0o600});
    if(!save)return {asset,prompt:text};
    const current=this.archive.record(campaign,actor,entry);
    return this.archive.save(campaign,actor,{...current,properties:{...current.properties,asset,imageType:type,imagePrompt:text}},entry);
  }
  async card(campaign,actor,{entry,theme='parchment',body,subtitle='',stats=[],panX=0.5,panY=0.5,zoom=1}) {
    this.archive.require(campaign,actor,true);const row=this.archive.record(campaign,actor,entry);
    if(!row.properties.asset || !/^[a-f0-9-]+\.(png|jpg|webp)$/.test(row.properties.asset))throw new AppError('Attach or generate a portrait before creating a card.');
    const asset=randomUUID()+'.png';await mkdir(join(this.config.dataDir,'assets'),{recursive:true});
    await runProcess(this.config.pythonBin,[fileURLToPath(new URL('../scripts/render_art.py',import.meta.url))],{env:childEnvironment(),input:JSON.stringify({portrait:join(this.config.dataDir,'assets',row.properties.asset),output:join(this.config.dataDir,'assets',asset),title:row.name,kind:row.kind,body:body||row.body,subtitle,theme,stats,panX,panY,zoom}),timeout:60000});
    return this.archive.save(campaign,actor,{kind:'artifact',name:'Card · '+row.name,body:body||row.body,visibility:row.visibility,properties:{artifactType:'card',asset,entity:row.id,theme,stats},sources:row.sources});
  }
  async sprite(campaign,actor,{entry,animation='idle',tags=[]}) {
    this.archive.require(campaign,actor,true);const row=this.archive.record(campaign,actor,entry);
    if(!row.properties.asset)throw new AppError('Attach a portrait before generating a sprite.');
    if(!['victory','hello','attack','cast','laugh','defeat','idle','angry'].includes(animation))throw new AppError('Choose a supported animation.');
    const sheet=await this.image(campaign,actor,{entry,type:'spritesheet',style:'pixel art, consistent character design',prompt:`An exactly aligned 4-column by 2-row sprite sheet, 8 equal-sized panels. Each panel shows the same full-body character from the reference portrait doing one consecutive frame of a ${animation} animation. Consistent size and plain background. ${tags.slice(0,5).join(', ')}`,save:false});
    const asset=randomUUID()+'.gif';
    await runProcess(this.config.pythonBin,[fileURLToPath(new URL('../scripts/render_art.py',import.meta.url))],{env:childEnvironment(),input:JSON.stringify({type:'sprite',portrait:join(this.config.dataDir,'assets',sheet.asset),output:join(this.config.dataDir,'assets',asset)}),timeout:60000});
    return this.archive.save(campaign,actor,{kind:'artifact',name:`${animation} sprite · ${row.name}`,body:'AI-generated looping sprite. Review frame alignment and character consistency before use.',visibility:row.visibility,properties:{artifactType:'sprite',asset,animation,entity:row.id,sheet:sheet.asset},sources:row.sources});
  }
  async deliver(campaign,actor,{entry,mode,recipients=[],channel,confirm=false,theme='parchment'}) {
    this.archive.require(campaign,actor,true);
    if (confirm!==true)throw new AppError('Confirm the recipients and content before sending.');
    const row=this.archive.record(campaign,actor,entry);
    if (row.visibility!=='party')throw new AppError('Only party-visible entries can be delivered. Review sharing first.');
    if (mode==='discord') {
      if(!this.discord)throw new AppError('Start the Discord bot before sending to a channel.');
      const campaignRow=this.archive.store.get('SELECT * FROM campaigns WHERE id=?',campaign);
      const destination=await this.discord.channels.fetch(channel||campaignRow.channel);
      if(!destination?.isTextBased() || destination.guildId!==campaignRow.guild)throw new AppError('Choose a text channel in this campaign’s server.');
      // Delivery is deliberately limited to the campaign channel to preserve its
      // audience boundary; cross-channel publishing uses explicit share links.
      if(destination.id!==campaignRow.channel)throw new AppError('Direct posting is restricted to the campaign text channel.');
      await destination.send({content:`**${row.name}**\n${row.body.slice(0,1700)}`,allowedMentions:{parse:[]},files:[{attachment:Buffer.from(row.body),name:'chronicle-handout.md'}]});return {sent:true,mode};
    }
    if(mode==='email') {
      if(!process.env.SMTP_HOST || !process.env.SMTP_FROM)throw new AppError('Configure SMTP_HOST and SMTP_FROM on the host computer.');
      if(!Array.isArray(recipients)||!recipients.length||recipients.length>20||recipients.some(v=>typeof v!=='string'||!/^\S+@\S+\.\S+$/.test(v)||/[\r\n,;]/.test(v)))throw new AppError('Enter 1–20 individual email addresses.');
      const smtp=this.mailer({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='1',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined});
      const pdf=await pdfBuffer({title:row.name,body:row.body,theme});
      // Send separately so players’ addresses are not disclosed to each other.
      for(const to of recipients)await smtp.sendMail({from:process.env.SMTP_FROM,to,subject:row.name.replace(/[\r\n]/g,' '),text:row.body,html:`<h1>${escapeHtml(row.name)}</h1>${markdownHtml(row.body)}`,attachments:[{filename:'chronicle-handout.pdf',content:pdf}]});
      return {sent:true,mode,count:recipients.length};
    }
    throw new AppError('Choose email or Discord delivery.');
  }
  async cleanupPosts(){
    if(!this.discord)return;
    const rows=this.archive.store.all('SELECT * FROM discord_posts WHERE expires<?',Date.now());
    for(const row of rows){try{const channel=await this.discord.channels.fetch(row.channel);await channel.messages.delete(row.message);}catch(error){if(![10003,10008].includes(error.code))continue;}this.archive.store.run('DELETE FROM discord_posts WHERE message=?',row.message);}
  }
  async notify(campaign,event,data) {
    const root={subject:'host',root:true},settings=this.archive.settings(campaign,root);
    const text=event==='session_approved'?`Session approved: ${data.title}\n\n${data.recap||''}`:`Session ready for review: ${data.title}\nOpen your Chronicle dashboard to review the suggested changes.`;
    if(event==='session_approved'&&settings.postGems&&this.discord){const info=this.archive.store.get('SELECT * FROM campaigns WHERE id=?',campaign);if(info.guild!=='local'){const channel=await this.discord.channels.fetch(info.channel);const gems=this.archive.records(campaign,root).filter(r=>['moment','award','quote'].includes(r.kind)&&r.visibility==='party'&&r.sources.some(s=>s.session===data.id));const posted=await channel.send({content:`**${data.title}** · approved\n${data.recap.slice(0,1100)}\n\n${gems.slice(0,3).map(g=>`**${g.name}**: ${g.body.slice(0,150)}`).join('\n')}`.slice(0,1950),allowedMentions:{parse:[]}});this.archive.store.run('INSERT INTO discord_posts VALUES(?,?,?,?)',posted.id,campaign,info.channel,Date.now()+24*3600000);}}
    if(!process.env.SMTP_HOST||!process.env.SMTP_FROM)return {skipped:'SMTP not configured'};
    const rows=this.archive.store.all('SELECT p.*,m.role FROM notification_prefs p JOIN members m ON m.campaign=p.campaign AND m.subject=p.subject WHERE p.campaign=?',campaign).filter(row=>row.email&&(event==='session_approved'?row.gems:row.activity&&['owner','admin'].includes(row.role)));
    if(!rows.length)return {sent:0};
    const smtp=this.mailer({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='1',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined});
    for(const row of rows)await smtp.sendMail({from:process.env.SMTP_FROM,to:row.email,subject:event==='session_approved'?'Chronicle: your session is approved':'Chronicle: session review ready',text});
    return {sent:rows.length};
  }
}
