// Preview the host dashboard with the fictional demo campaign, without Discord, Whisper or Codex.
//   npm run preview   ->  open the printed link
// Data lives in a temporary folder and is thrown away when you stop it. "Ask Chronicle" answers come from a
// stand-in that only cites the evidence it was given; it is not the real Codex model.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { Engine } from '../src/engine.js';
import { createDashboard } from '../src/dashboard.js';
import { seedDemoCampaign } from './demo-site.js';

const dir = mkdtempSync(join(tmpdir(), 'chronicle-preview-'));
const store = new Store(join(dir, 'chronicle.sqlite')), archive = new Archive(store);
seedDemoCampaign(store, archive);
const ai = { text:async (task, material) => {
  const context = JSON.parse(material);
  if (!Array.isArray(context.evidence)) return 'Preview mode: the real Codex bridge is not running.';
  const ids = context.evidence.slice(0, 3).map(e => e.id);
  return JSON.stringify({ status:'answer', confidence:'medium',
    answer:`Preview mode (no AI): Chronicle found ${context.evidence.length} pieces of evidence for this question. The first ones are ${ids.map(id => `[${id}]`).join(', ')}.` });
} };
const engine = new Engine({ archive, ai });
const dashboard = await createDashboard({ archive, engine, config:{ dataDir:dir, pythonBin:'python3' }, port:Number(process.env.PREVIEW_PORT || 8790), rootToken:'preview' });
console.log(`Dashboard preview: ${dashboard.url}/#token=preview\nDemo data only. Press Ctrl+C to stop.`);
process.on('SIGINT', async () => { await dashboard.close(); store.close(); process.exit(0); });
