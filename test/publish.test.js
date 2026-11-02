import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../src/store.js';
import { Archive } from '../src/archive.js';
import { buildSiteData, encryptSiteData, decryptSiteData, publishSite, siteSlug } from '../src/publish.js';

function campaignFixture() {
  const store = new Store(':memory:'), archive = new Archive(store), host = { subject:'host', root:true };
  const campaign = archive.createCampaign(host, 'The Lantern Road');
  const approved = store.createSession(campaign.id, 'The letter at the inn', 'host', 'approved');
  store.updateSession(approved.id, 'approved', '- Mara lent us the brass key.');
  const line = store.addText(approved.id, 'Mara', 4354, 'Bring the key back before sunset.');
  store.addText(approved.id, 'Jon / Zafir', 10, 'SECRET_TRANSCRIPT_LINE');
  const pending = store.createSession(campaign.id, 'Unreviewed night', 'host', 'awaiting_review');
  store.updateSession(pending.id, 'awaiting_review', 'UNAPPROVED_RECAP');
  archive.save(campaign.id, host, { kind:'npc', name:'Mara Vale', body:'Innkeeper of the [[Lantern Inn]].', properties:{ likes:'apple cider', playerSubject:'123456789012345678', asset:'../../etc/passwd' }, sources:[{ session:approved.id, chunk:line }] });
  archive.save(campaign.id, host, { kind:'quote', name:'Bring the key back', body:'Bring the key back before sunset.', sources:[{ session:approved.id, chunk:line }, { session:pending.id, chunk:'x' }] });
  archive.save(campaign.id, host, { kind:'npc', name:'Hidden villain', body:'PRIVATE_GM_NOTE', visibility:'private' });
  archive.save(campaign.id, host, { kind:'journal', name:'GM prep', body:'JOURNAL_TEXT', visibility:'party' });
  return { store, archive, campaign, approved };
}

test('site data holds only approved, party-visible material and no Discord IDs, transcripts or paths', () => {
  const { store, archive, campaign, approved } = campaignFixture();
  const data = buildSiteData(archive, campaign.id);
  const text = JSON.stringify(data);
  assert.equal(data.campaign.name, 'The Lantern Road');
  assert.deepEqual(data.sessions.map(s => [s.number, s.title]), [[1, 'The letter at the inn']]);
  assert.deepEqual(data.records.map(r => r.name).sort(), ['Bring the key back', 'Mara Vale']);
  for (const secret of ['SECRET_TRANSCRIPT_LINE', 'UNAPPROVED_RECAP', 'PRIVATE_GM_NOTE', 'JOURNAL_TEXT', '123456789012345678', 'passwd', 'playerSubject'])
    assert.doesNotMatch(text, new RegExp(secret), `${secret} must not be published`);
  const quote = data.records.find(r => r.kind === 'quote');
  assert.deepEqual(quote.sources, [{ session:approved.id, at:4354 }], 'quote keeps its timestamp; unapproved sources are dropped');
  assert.equal(data.records.find(r => r.name === 'Mara Vale').properties.likes, 'apple cider');
  const withTranscripts = buildSiteData(archive, campaign.id, { includeTranscripts:true });
  assert.equal(withTranscripts.sessions[0].transcript.length, 2, 'transcripts only when explicitly enabled');
  store.close();
});

test('encrypted bundles round-trip and reveal nothing without the passphrase', async () => {
  const { store, archive, campaign } = campaignFixture();
  const data = buildSiteData(archive, campaign.id);
  const envelope = await encryptSiteData(data, 'correct horse battery', { iterations:1000 });
  const raw = JSON.stringify(envelope);
  assert.doesNotMatch(raw, /Mara|Lantern|brass/);
  assert.deepEqual(await decryptSiteData(envelope, 'correct horse battery'), data);
  await assert.rejects(decryptSiteData(envelope, 'wrong passphrase'));
  await assert.rejects(encryptSiteData(data, 'short'), /at least 8/);
  store.close();
});

test('publishing writes the bundle and index, and refuses to publish openly by accident', async () => {
  const { store, archive, campaign } = campaignFixture();
  const siteDir = mkdtempSync(join(tmpdir(), 'chronicle-site-'));
  await assert.rejects(publishSite(archive, campaign.id, { siteDir, passphrase:'', allowPublic:false, push:false }), /SITE_PASSPHRASE/);
  const result = await publishSite(archive, campaign.id, { siteDir, passphrase:'lantern-road-2026', push:false, title:'' });
  assert.equal(result.slug, 'the-lantern-road'); assert.equal(result.encrypted, true); assert.equal(result.pushed, false);
  const index = JSON.parse(readFileSync(join(siteDir, 'data', 'index.json'), 'utf8'));
  assert.deepEqual(index.campaigns.map(c => [c.slug, c.file, c.encrypted]), [['the-lantern-road', 'data/the-lantern-road.json', true]]);
  const bundle = JSON.parse(readFileSync(join(siteDir, 'data', 'the-lantern-road.json'), 'utf8'));
  assert.equal((await decryptSiteData(bundle, 'lantern-road-2026')).sessions.length, 1);
  await publishSite(archive, campaign.id, { siteDir, passphrase:'lantern-road-2026', push:false, title:'' });
  assert.equal(JSON.parse(readFileSync(join(siteDir, 'data', 'index.json'), 'utf8')).campaigns.length, 1, 're-publishing replaces the entry');
  assert.equal(siteSlug('Ël Camino: Part II!'), 'el-camino-part-ii');
  rmSync(siteDir, { recursive:true, force:true }); store.close();
});

test('push mode commits only site data files and pushes to the remote', async () => {
  const { store, archive, campaign } = campaignFixture();
  const root = mkdtempSync(join(tmpdir(), 'chronicle-git-')), remote = join(root, 'remote.git'), repo = join(root, 'repo');
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding:'utf8' });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['clone', '-q', remote, repo]);
  git(repo, 'config', 'user.email', 'test@example.com'); git(repo, 'config', 'user.name', 'Test');
  mkdirSync(join(repo, 'site')); writeFileSync(join(repo, 'site', 'index.html'), '<!doctype html>');
  git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'init'); git(repo, 'push', '-q', '-u', 'origin', 'main');
  writeFileSync(join(repo, 'unrelated.txt'), 'work in progress');
  const result = await publishSite(archive, campaign.id, { siteDir:join(repo, 'site'), passphrase:'lantern-road-2026', push:true, title:'' });
  assert.equal(result.committed, true); assert.equal(result.pushed, true);
  const files = git(remote, 'show', '--name-only', '--format=%s', 'main').trim().split('\n');
  assert.match(files[0], /Publish campaign site: The Lantern Road \(1 approved session\)/);
  assert.deepEqual(files.slice(1).filter(Boolean).sort(), ['site/data/index.json', 'site/data/the-lantern-road.json']);
  assert.match(git(repo, 'status', '--porcelain'), /unrelated\.txt/, 'other work is left alone');
  rmSync(root, { recursive:true, force:true }); store.close();
});
