// Import a Craig multi-track ZIP into a running Chronicle (bot or dashboard must be running).
//   npm run import-craig -- recording.zip --title "Session 4" --consent
//   npm run import-craig -- recording.zip --title "Session 4" --campaign "Lantern" --map "callidus=Brian / Kael" --consent
// Options: --campaign <name or id>, --map "craig name=Label" (repeatable), --dry-run,
//          --url (default CHRONICLE_URL or http://127.0.0.1:DASHBOARD_PORT), --token (default CHRONICLE_ACCESS_TOKEN or data/dashboard-key)
// --consent confirms that everyone in the recording agreed to transcription and AI summaries.
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { unzipSync } from 'fflate';
import { config } from '../src/config.js';
import { craigTracks, parseSpeakerMap } from '../src/craig.js';

const argv = process.argv.slice(2), options = { map:[] }, positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--consent' || arg === '--dry-run') options[arg.slice(2)] = true;
  else if (['--title', '--campaign', '--url', '--token'].includes(arg)) options[arg.slice(2)] = argv[++i];
  else if (arg === '--map') options.map.push(argv[++i]);
  else positional.push(arg);
}
const fail = message => { console.error(message); process.exit(1); };
const zipPath = positional[0];
if (!zipPath || !existsSync(zipPath)) fail('Usage: npm run import-craig -- <craig.zip> --title "Session title" --consent [--campaign "name"] [--map "craig name=Label"]');
const tracks = craigTracks(unzipSync(new Uint8Array(readFileSync(zipPath))), parseSpeakerMap(options.map));
if (!tracks.length) fail('No audio tracks found in that ZIP. Download the multi-track FLAC (or AAC/Ogg) ZIP from Craig.');
console.log(`Found ${tracks.length} track(s):`);
for (const track of tracks) console.log(`  ${basename(track.path)}  ->  ${track.label}  (${(track.bytes.length/1048576).toFixed(1)} MB)`);
if (options['dry-run']) process.exit(0);
if (!options.consent) fail('Add --consent to confirm everyone in this recording agreed to transcription and AI summaries.');

const url = (options.url || process.env.CHRONICLE_URL || `http://127.0.0.1:${process.env.DASHBOARD_PORT || 8787}`).replace(/\/$/, '');
const keyPath = join(config.dataDir, 'dashboard-key');
const token = options.token || process.env.CHRONICLE_ACCESS_TOKEN || (existsSync(keyPath) ? readFileSync(keyPath, 'utf8').trim() : '');
if (!token) fail('No access key. Start Chronicle once (it creates data/dashboard-key) or pass --token.');
async function api(path, init = {}) {
  const response = await fetch(`${url}/api${path}`, { ...init, headers:{ Authorization:`Bearer ${token}`, ...(init.json ? { 'Content-Type':'application/json' } : {}), ...(init.headers || {}) }, body:init.json ? JSON.stringify(init.json) : init.body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Chronicle returned HTTP ${response.status}`);
  return data;
}
try {
  const campaigns = await api('/campaigns');
  const query = (options.campaign || '').toLowerCase();
  const matches = query ? campaigns.filter(c => c.id.toLowerCase() === query || c.name.toLowerCase().includes(query)) : campaigns;
  if (matches.length !== 1) fail(`${matches.length ? 'Choose one campaign with --campaign:' : 'No campaign matches.'}\n${campaigns.map(c => `  ${c.name}  (${c.id})`).join('\n')}`);
  const campaign = matches[0];
  const title = options.title || basename(zipPath).replace(/\.zip$/i, '');
  const session = await api(`/campaigns/${campaign.id}/sessions`, { method:'POST', json:{ title } });
  for (const track of tracks) {
    process.stdout.write(`Uploading ${track.label}… `);
    await api(`/campaigns/${campaign.id}/sessions/${session.id}/audio?consent=true&offset=0&label=${encodeURIComponent(track.label)}`, { method:'PUT', headers:{ 'X-File-Name':basename(track.path) }, body:track.bytes });
    console.log('done');
  }
  await api(`/campaigns/${campaign.id}/sessions/${session.id}/process`, { method:'POST', json:{} });
  console.log(`Session ${session.id} imported into "${campaign.name}". Transcription and the review are running; check the dashboard's review queue.`);
} catch (error) { fail(`Import failed: ${error.message}`); }
