// Publishes a campaign's party-safe material to the static player site in ./site (GitHub Pages).
// Only what a read-only share link could see is included: approved sessions and party-visible,
// non-journal entries. Transcripts are left out unless explicitly enabled. Discord user IDs and
// local file paths never leave the host. The bundle is encrypted with a group passphrase so a
// public repository only ever holds ciphertext.
import { webcrypto, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import { runProcess } from './process.js';

export const SITE_FORMAT = 1;
const KDF_ITERATIONS = 310000;
const MAX_IMAGE_BYTES = 12*1024*1024;
// Fields that identify real people or point at the host's disk.
const HIDDEN_PROPERTIES = new Set(['playerSubject', 'subject', 'asset', 'voice_path', 'voicePath', 'path']);
const IMAGE_TYPES = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
const b64 = bytes => Buffer.from(bytes).toString('base64');

export function siteSlug(value) {
  return String(value || 'campaign').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'campaign';
}

/** Same visibility as a read-only share link with no selection. */
export function siteViewer(campaign) { return { subject:'site-publish', campaign, share:true, scopes:['read'], selection:[] }; }

export function buildSiteData(archive, campaign, { dataDir = null, includeTranscripts = false } = {}) {
  const viewer = siteViewer(campaign), store = archive.store;
  const info = store.get('SELECT * FROM campaigns WHERE id=?', campaign);
  if (!info) throw new Error('Campaign not found.');
  const settings = archive.settings(campaign, viewer);
  const sessions = archive.sessions(campaign, viewer).filter(s => s.state === 'approved').sort((a, b) => a.started - b.started);
  const published = new Set(sessions.map(s => s.id));
  const chunkTimes = new Map();
  const sessionRows = sessions.map((session, index) => {
    const chunks = store.chunks(session.id);
    for (const chunk of chunks) chunkTimes.set(chunk.id, { session:session.id, at:Math.round(chunk.offset) });
    const row = { id:session.id, number:index+1, title:session.title, date:new Date(session.started).toISOString(), recap:session.recap || '' };
    if (includeTranscripts) row.transcript = chunks.filter(c => c.state === 'done' && c.text).map(c => ({ at:Math.round(c.offset), speaker:c.speaker, text:c.text }));
    return row;
  });
  let imageBytes = 0;
  const records = archive.records(campaign, viewer).map(record => {
    const properties = Object.fromEntries(Object.entries(record.properties || {}).filter(([key]) => !HIDDEN_PROPERTIES.has(key)));
    const sources = [];
    for (const source of record.sources || []) {
      if (!published.has(source.session)) continue;
      const time = source.chunk ? chunkTimes.get(source.chunk) : null;
      const entry = { session:source.session, ...(time && time.session === source.session ? { at:time.at } : {}) };
      if (!sources.some(old => old.session === entry.session && old.at === entry.at)) sources.push(entry);
    }
    const row = { id:record.id, kind:record.kind, name:record.name, body:record.body, tags:record.tags || [], properties, sources, updated:record.updated };
    const asset = record.properties?.asset;
    if (dataDir && typeof asset === 'string' && /^[a-f0-9-]+\.(png|jpe?g|webp|gif)$/i.test(asset)) {
      const path = join(dataDir, 'assets', asset);
      if (existsSync(path)) {
        const bytes = readFileSync(path);
        if (imageBytes + bytes.length <= MAX_IMAGE_BYTES) { imageBytes += bytes.length; row.image = `data:${IMAGE_TYPES[extname(asset).toLowerCase()]};base64,${b64(bytes)}`; }
      }
    }
    return row;
  });
  const links = archive.graph(campaign, viewer).edges;
  return {
    format:SITE_FORMAT, generated:new Date().toISOString(),
    campaign:{ name:info.name, system:settings.system || '', description:settings.description || '' },
    sessions:sessionRows, records, links, transcripts:!!includeTranscripts,
  };
}

async function deriveKey(passphrase, salt, iterations, usage) {
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(String(passphrase).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return webcrypto.subtle.deriveKey({ name:'PBKDF2', hash:'SHA-256', salt, iterations }, base, { name:'AES-GCM', length:256 }, false, [usage]);
}

/** AES-256-GCM over gzipped JSON, key from PBKDF2-SHA256. The site decrypts with the browser's WebCrypto. */
export async function encryptSiteData(data, passphrase, { iterations = KDF_ITERATIONS } = {}) {
  if (typeof passphrase !== 'string' || passphrase.trim().length < 8) throw new Error('Set SITE_PASSPHRASE to at least 8 characters.');
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt, iterations, 'encrypt');
  const cipher = await webcrypto.subtle.encrypt({ name:'AES-GCM', iv }, key, gzipSync(Buffer.from(JSON.stringify(data))));
  return { chronicleSite:SITE_FORMAT, encrypted:true, compression:'gzip',
    kdf:{ name:'PBKDF2', hash:'SHA-256', iterations, salt:b64(salt) }, cipher:{ name:'AES-GCM', iv:b64(iv) }, data:b64(cipher) };
}

export async function decryptSiteData(envelope, passphrase) {
  if (!envelope.encrypted) return envelope.data;
  const key = await deriveKey(passphrase, Buffer.from(envelope.kdf.salt, 'base64'), envelope.kdf.iterations, 'decrypt');
  const plain = await webcrypto.subtle.decrypt({ name:'AES-GCM', iv:Buffer.from(envelope.cipher.iv, 'base64') }, key, Buffer.from(envelope.data, 'base64'));
  return JSON.parse(gunzipSync(Buffer.from(plain)).toString('utf8'));
}

function writeAtomic(path, text) { const temp = `${path}.${process.pid}.tmp`; writeFileSync(temp, text); renameSync(temp, path); }

export async function writeSite(siteDir, slug, title, envelope) {
  const dir = join(siteDir, 'data'); mkdirSync(dir, { recursive:true });
  const file = join(dir, `${slug}.json`);
  writeAtomic(file, JSON.stringify(envelope));
  const indexPath = join(dir, 'index.json');
  let index = { chronicleSite:SITE_FORMAT, campaigns:[] };
  try { const parsed = JSON.parse(readFileSync(indexPath, 'utf8')); if (Array.isArray(parsed.campaigns)) index = parsed; } catch {}
  index.campaigns = [...index.campaigns.filter(entry => entry.slug !== slug), { slug, title, file:`data/${slug}.json`, encrypted:!!envelope.encrypted, updated:new Date().toISOString() }]
    .sort((a, b) => a.title.localeCompare(b.title));
  writeAtomic(indexPath, JSON.stringify(index, null, 2)+'\n');
  return [file, indexPath];
}

/** Commit only the published files and push. Never touches other changes in the working tree. */
export async function gitPublish(repoDir, files, message, run = runProcess) {
  const paths = files.map(file => relative(repoDir, file));
  const changed = await run('git', ['-C', repoDir, 'status', '--porcelain', '--', ...paths], { timeout:30000 });
  if (!changed.trim()) return { committed:false, pushed:false };
  try {
    await run('git', ['-C', repoDir, 'add', '--', ...paths], { timeout:30000 });
    await run('git', ['-C', repoDir, 'commit', '-m', message, '--', ...paths], { timeout:30000 });
  } catch (error) {
    console.error(`Site publish: git commit failed: ${error.message}`);
    return { committed:false, pushed:false, error:'The site files were written, but git could not commit them. Check "git status" in the Chronicle folder (is a git name/email set?).' };
  }
  try { await run('git', ['-C', repoDir, 'push'], { timeout:120000 }); }
  catch (error) { return { committed:true, pushed:false, error:'git push was rejected or failed. Run "git pull" in the Chronicle folder, then publish again.' }; }
  return { committed:true, pushed:true };
}

export function siteOptions(env = process.env) {
  return {
    siteDir:resolve(env.SITE_DIR || './site'),
    passphrase:env.SITE_PASSPHRASE || '',
    allowPublic:env.SITE_PUBLIC === '1',
    includeTranscripts:env.SITE_INCLUDE_TRANSCRIPTS === '1',
    autoPublish:env.SITE_AUTO_PUBLISH === '1',
    push:env.SITE_GIT_PUSH === '1',
    url:(env.SITE_URL || '').trim(),
    title:(env.SITE_TITLE || '').trim(),
  };
}

export async function publishSite(archive, campaign, options = {}) {
  const opts = { ...siteOptions(), ...options };
  if (!opts.passphrase && !opts.allowPublic) throw new Error('Set SITE_PASSPHRASE in .env (or SITE_PUBLIC=1 to publish without a password).');
  const data = buildSiteData(archive, campaign, { dataDir:opts.dataDir, includeTranscripts:opts.includeTranscripts });
  const envelope = opts.passphrase ? await encryptSiteData(data, opts.passphrase) : { chronicleSite:SITE_FORMAT, encrypted:false, data };
  const slug = siteSlug(data.campaign.name), title = opts.title || data.campaign.name;
  const files = await writeSite(opts.siteDir, slug, title, envelope);
  const result = { slug, title, sessions:data.sessions.length, records:data.records.length, encrypted:!!envelope.encrypted, files, committed:false, pushed:false };
  if (opts.push) Object.assign(result, await gitPublish(opts.repoDir || resolve(opts.siteDir, '..'), files, `Publish campaign site: ${title} (${result.sessions} approved session${result.sessions === 1 ? '' : 's'})`, opts.run));
  return result;
}

/** One publish at a time; used by the bot (/publish and auto-publish after approval) and the dashboard host. */
export function createPublisher({ archive, config, env = process.env }) {
  let tail = Promise.resolve();
  const publish = (campaign, overrides = {}) => {
    const task = tail.then(() => publishSite(archive, campaign, { dataDir:config.dataDir, ...siteOptions(env), ...overrides }));
    tail = task.catch(() => {});
    return task;
  };
  return {
    options:() => siteOptions(env),
    publish,
    auto:campaign => siteOptions(env).autoPublish ? publish(campaign) : Promise.resolve(null),
  };
}

export function publishSummary(result, url = '') {
  const parts = [`Campaign site ${result.pushed ? 'updated' : 'files written'}: **${result.title}**, ${result.sessions} approved session(s), ${result.records} entries${result.encrypted ? ', password-locked' : ', NOT password-locked'}.`];
  if (result.error) parts.push(result.error);
  else if (!result.pushed) parts.push('Not pushed to GitHub (set SITE_GIT_PUSH=1, or commit and push the site/data folder yourself).');
  if (url && result.pushed) parts.push(`${url} (GitHub Pages refreshes in about a minute.)`);
  return parts.join('\n');
}
