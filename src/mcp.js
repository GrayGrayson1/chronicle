import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const base=new URL(process.env.CHRONICLE_URL || 'http://127.0.0.1:8787');
const token=process.env.CHRONICLE_ACCESS_TOKEN;
if(!token)throw new Error('Set CHRONICLE_ACCESS_TOKEN to a scoped campaign member key.');
const server=new McpServer({name:'chronicle-campaign',version:'0.2.0'});
async function call(path,method='GET',body) {
  const response=await fetch(new URL(path,base),{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(300000)});
  const result=await response.json();if(!response.ok)throw new Error(result.error || 'Chronicle request failed.');return result;
}
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const schema={campaign:z.string().describe('Campaign ID from list_campaigns')};
function tool(name,description,inputSchema,fn,write=false) {
  server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:!write,destructiveHint:write,openWorldHint:false}},async args=>{
    try{return result(await fn(args));}catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
  });
}
tool('list_campaigns','List campaigns allowed by this member key.',{},()=>call('/api/campaigns'));
tool('list_sessions','List sessions visible to the current member.',schema,a=>call(`/api/campaigns/${a.campaign}/sessions`));
tool('get_transcript','Read a visible session transcript and its timestamps.',{...schema,session:z.string()},a=>call(`/api/campaigns/${a.campaign}/sessions/${a.session}/transcript`));
tool('list_entries','List accessible compendium entries, quests, journals and artifacts.',{...schema,kind:z.string().optional()},a=>call(`/api/campaigns/${a.campaign}/records${a.kind?'?kind='+encodeURIComponent(a.kind):''}`));
tool('get_entry','Read one accessible campaign entry.',{...schema,entry:z.string()},a=>call(`/api/campaigns/${a.campaign}/records/${a.entry}`));
tool('search_campaign','Search accessible reference entries and approved transcript excerpts.',{...schema,query:z.string().max(3000)},a=>call(`/api/campaigns/${a.campaign}/search?q=${encodeURIComponent(a.query)}`));
tool('ask_campaign','Ask Chronicle to answer from the member’s permitted campaign material. Uses host Codex quota.',{...schema,question:z.string().max(3000)},a=>call(`/api/campaigns/${a.campaign}/ask`,'POST',{question:a.question}));
tool('create_journal','Create a new private journal. This writes campaign data.',{...schema,title:z.string().min(1),body:z.string().max(100000),folder:z.string().optional()},a=>call(`/api/campaigns/${a.campaign}/records`,'POST',{kind:'journal',name:a.title,body:a.body,visibility:'private',properties:{folder:a.folder||''}}),true);
tool('update_entry','Update an existing entry with an explicit current version. Confirm the exact edit with the user before calling.',{...schema,entry:z.string(),version:z.number().int(),name:z.string().optional(),body:z.string().max(100000).optional()},async a=>{
  const old=await call(`/api/campaigns/${a.campaign}/records/${a.entry}`);
  return call(`/api/campaigns/${a.campaign}/records/${a.entry}`,'PUT',{...old,version:a.version,...(a.name?{name:a.name}:{}),...(a.body!==undefined?{body:a.body}:{})});
},true);
tool('relationship_map','Read connections among entries the member can see.',schema,a=>call(`/api/campaigns/${a.campaign}/graph`));
tool('participation_report','Read per-speaker transcript participation metrics.',schema,a=>call(`/api/campaigns/${a.campaign}/analytics`));
tool('discord_messages','Read messages, pins, or thread names in this campaign’s configured Discord channel. Message Content intent is needed for message text.',{...schema,action:z.enum(['messages','pins','threads']),thread:z.string().optional(),before:z.string().optional(),limit:z.number().int().min(1).max(100).optional()},a=>call(`/api/campaigns/${a.campaign}/discord`,'POST',a));
tool('discord_action','Write in the campaign Discord channel or one of its threads. Obtain explicit user confirmation of the exact content/action before calling. Requires campaign admin and a write key.',{...schema,action:z.enum(['send','reply','edit','delete','react','thread','poll']),thread:z.string().optional(),content:z.string().max(1900).optional(),message:z.string().optional(),emoji:z.string().optional(),name:z.string().optional(),question:z.string().optional(),answers:z.array(z.string()).optional(),multiselect:z.boolean().optional(),confirm:z.literal(true)},a=>call(`/api/campaigns/${a.campaign}/discord`,'POST',a),true);
tool('deliver_artifact','Send a party-visible artifact to its campaign Discord channel or verified explicit email recipients. Obtain user confirmation of content and recipients first.',{...schema,entry:z.string(),mode:z.enum(['discord','email']),recipients:z.array(z.string().email()).optional(),confirm:z.literal(true)},a=>call(`/api/campaigns/${a.campaign}/deliver`,'POST',a),true);
await server.connect(new StdioServerTransport());
