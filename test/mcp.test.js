import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { Engine } from '../src/engine.js';
import { createDashboard } from '../src/dashboard.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';

test('real stdio MCP transport lists tools, enforces scoped campaign access and creates a private journal',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'chronicle-mcp-')),store=new Store(':memory:'),archive=new Archive(store),root={subject:'host',root:true};
  const campaign=archive.createCampaign(root,'MCP campaign');archive.member(campaign.id,root,'player','player','Jon');
  const token=archive.issueToken(root,campaign.id,'player',['read','write']);
  archive.save(campaign.id,root,{kind:'journal',name:'Private GM note',body:'NEVER_LEAK_THIS',visibility:'private'});
  const engine=new Engine({archive,ai:{text:async()=> 'Answer'}}),dashboard=await createDashboard({archive,engine,config:{dataDir:directory},port:0,rootToken:'test-host'});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('src/mcp.js')],env:{...process.env,CHRONICLE_URL:dashboard.url,CHRONICLE_ACCESS_TOKEN:token},stderr:'pipe'});
  const client=new Client({name:'chronicle-test',version:'1.0.0'});
  try {
    await client.connect(transport);const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='discord_action'));
    const listed=await client.callTool({name:'list_entries',arguments:{campaign:campaign.id}});assert.doesNotMatch(JSON.stringify(listed),/NEVER_LEAK_THIS/);
    const created=await client.callTool({name:'create_journal',arguments:{campaign:campaign.id,title:'My note',body:'A personal reminder'}});assert.equal(created.isError,undefined);assert.match(JSON.stringify(created),/private/);
    const other=archive.createCampaign(root,'Other');const blocked=await client.callTool({name:'list_entries',arguments:{campaign:other.id}});assert.equal(blocked.isError,true);
  }finally{await client.close();await dashboard.close();store.close();rmSync(directory,{recursive:true,force:true});}
});
