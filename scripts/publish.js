// Publish the player site from the command line (run while Chronicle is stopped):
//   npm run publish-site                -> lists campaigns
//   npm run publish-site -- "Lantern"    -> publishes the campaign whose name or ID matches
//   add --no-push to only write site/data without committing or pushing
import { join } from 'node:path';
import { config } from '../src/config.js';
import { lockData } from '../src/lock.js';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { publishSite, siteOptions, publishSummary } from '../src/publish.js';

const args = process.argv.slice(2), noPush = args.includes('--no-push'), query = args.filter(a => !a.startsWith('--')).join(' ').trim().toLowerCase();
lockData(config.dataDir);
const store = new Store(join(config.dataDir, 'chronicle.sqlite')), archive = new Archive(store);
try {
  const campaigns = archive.campaigns({ subject:'host', root:true });
  const matches = query ? campaigns.filter(c => c.id.toLowerCase() === query || c.name.toLowerCase().includes(query)) : [];
  if (matches.length !== 1) {
    console.log(query ? (matches.length ? 'More than one campaign matches. Be more specific:' : `No campaign matches "${query}".`) : 'Choose a campaign: npm run publish-site -- "<name>"');
    for (const c of campaigns) console.log(`  ${c.name}  (${c.id})`);
    process.exitCode = 1;
  } else {
    const result = await publishSite(archive, matches[0].id, { dataDir:config.dataDir, ...siteOptions(), ...(noPush ? { push:false } : {}) });
    console.log(publishSummary(result, siteOptions().url));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store.close(); }
