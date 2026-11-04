import { config } from './config.js';
import { Store } from './store.js';
import { Archive } from './archive.js';
import { Engine } from './engine.js';
import { Codex } from './codex.js';
import { Whisper } from './whisper.js';
import { AudioProcessor } from './processor.js';
import { SemanticSearch } from './search.js';
import { Integrations } from './integrations.js';
import { createDashboard } from './dashboard.js';
import { lockData } from './lock.js';
import { createPublisher, publishSummary } from './publish.js';
import { join } from 'node:path';

process.umask(0o077);lockData(config.dataDir);
const store=new Store(join(config.dataDir,'chronicle.sqlite'));store.recover();
const archive=new Archive(store),ai=new Codex(config),whisper=new Whisper(config),audio=new AudioProcessor(store,whisper,config);
const search=process.env.SEMANTIC_SEARCH==='1'?new SemanticSearch(archive,config):null;
const engine=new Engine({archive,ai,audio,search});engine.recover();
const integrations=new Integrations(archive,config);
const publisher=createPublisher({archive,config});
engine.onEvent=(campaign,event,data)=>{
  if (event==='session_approved') void publisher.auto(campaign).then(result=>result&&console.log(publishSummary(result,publisher.options().url))).catch(error=>console.error(`Campaign site publish failed: ${error.message}`));
  return integrations.notify(campaign,event,data);
};
const dashboard=await createDashboard({archive,engine,config,search,integrations,publisher});
console.log(`Chronicle dashboard: ${dashboard.url}/#token=${dashboard.token}\nKeep this host link private. Issue individual member keys in Settings.\nThe Discord recorder runs with npm start; use this dashboard-only mode for imports and campaign management.`);
void audio.kick();
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;engine.closing=true;await dashboard.close();audio.stopping=true;ai.close();whisper.close();await audio.running?.catch(()=>{});await Promise.all(engine.running.values());store.close();process.exit(0);}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
