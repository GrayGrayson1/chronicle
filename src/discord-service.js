import { AppError } from './archive.js';

export async function discordAction(integrations,campaign,actor,input) {
  const {archive,discord}=integrations;archive.require(campaign,actor);
  if(!discord)throw new AppError('The Discord bot is not running.');
  if(actor.share)throw new AppError('Discord access requires campaign membership.',403);
  const info=archive.store.get('SELECT * FROM campaigns WHERE id=?',campaign);
  let channel=await discord.channels.fetch(info.channel);
  if(!channel?.isTextBased()||channel.guildId!==info.guild)throw new AppError('Campaign channel is not available.');
  if(input.thread){const thread=await discord.channels.fetch(input.thread);if(!thread?.isThread()||thread.parentId!==info.channel)throw new AppError('Choose a thread within this campaign’s channel.',403);channel=thread;}
  const render=message=>({id:message.id,author:message.author.username,content:message.content,date:message.createdTimestamp,url:message.url,attachments:[...message.attachments.values()].map(a=>({name:a.name,url:a.url}))});
  if(input.action==='messages'){const options={limit:Math.min(100,Math.max(1,Number(input.limit)||30))};if(input.before)options.before=input.before;return [...(await channel.messages.fetch(options)).values()].map(render);}
  if(input.action==='pins'){const pins=await channel.messages.fetchPins();return pins.items.map(item=>render(item.message));}
  if(input.action==='threads'){const threads=await channel.threads.fetchActive();return [...threads.threads.values()].map(t=>({id:t.id,name:t.name,archived:t.archived}));}
  archive.require(campaign,actor,true);
  if(input.confirm!==true)throw new AppError('Confirm the exact Discord action and content before executing it.');
  const content=String(input.content||'').slice(0,1900);
  if(input.action==='send'||input.action==='reply'){
    if(!content.trim())throw new AppError('Message content is required.');
    if(input.action==='reply'){const message=await channel.messages.fetch(input.message);return render(await message.reply({content,allowedMentions:{parse:[],repliedUser:false}}));}
    return render(await channel.send({content,allowedMentions:{parse:[]}}));
  }
  if(input.action==='edit'||input.action==='delete'){
    const message=await channel.messages.fetch(input.message);if(message.author.id!==discord.user.id)throw new AppError('Chronicle can edit or delete only its own messages.',403);
    if(input.action==='delete'){await message.delete();return {deleted:true};}return render(await message.edit({content,allowedMentions:{parse:[]}}));
  }
  if(input.action==='react'){const message=await channel.messages.fetch(input.message);await message.react(String(input.emoji).slice(0,100));return {reacted:true};}
  if(input.action==='thread'){const message=await channel.messages.fetch(input.message);const thread=await message.startThread({name:String(input.name||'Campaign thread').slice(0,100),autoArchiveDuration:1440});return {id:thread.id,name:thread.name};}
  if(input.action==='poll'){
    const answers=Array.isArray(input.answers)?input.answers.slice(0,10).map(text=>({text:String(text).slice(0,55)})):[];
    if(answers.length<2)throw new AppError('A poll needs 2–10 answers.');
    const message=await channel.send({poll:{question:{text:String(input.question||'Campaign poll').slice(0,300)},answers,duration:24,allowMultiselect:!!input.multiselect},allowedMentions:{parse:[]}});return render(message);
  }
  throw new AppError('Unknown Discord action.');
}
