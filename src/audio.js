import { EndBehaviorType, joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import prism from 'prism-media';
export { AudioProcessor, wav } from './processor.js';

const BYTES_PER_SECOND = 48000*2*2;
// A speaker whose stream fails this often inside the window is paused briefly instead of retried in a tight loop.
const ERROR_WINDOW_MS = 60000, ERROR_LIMIT = 12, COOLDOWN_MS = 15000;
// Connection-level errors are tolerated unless they arrive this quickly; real disconnects are handled by state changes.
const CONNECTION_ERROR_LIMIT = 5;

/** Shared capture statistics for one session. Survives /pause and /resume because the bot keeps it on the live session. */
export function captureHealth() { return { stats:new Map(), connectionErrors:0, connectionErrorTimes:[], lastConnectionError:'' }; }

function speakerStats(label) {
  return { label, decodedSeconds:0, savedSeconds:0, clips:0, turns:0, silentTurns:0, receiveErrors:0, decoderErrors:0,
    lastError:'', recentErrors:[], pausedUntil:0, warned:false };
}

export class Recorder {
  constructor({ channel, session, campaign, store, audio, maxHours, onFailure, onTimeout, onWarning = () => {}, health = captureHealth(),
    createDecoder = () => new prism.opus.Decoder({ rate:48000, channels:2, frameSize:960 }), retryDelay = 250, log = console }) {
    Object.assign(this, { channel, session, campaign, store, audio, onFailure, onTimeout, onWarning, health, createDecoder, retryDelay, log });
    this.consented = new Set(); this.streams = new Map(); this.retryTimers = new Map(); this.stopped = false;
    this.maxHours = maxHours;
  }
  async start() {
    this.connection = joinVoiceChannel({ channelId:this.channel.id, guildId:this.channel.guild.id,
      adapterCreator:this.channel.guild.voiceAdapterCreator, group:this.channel.client.user.id, selfDeaf:false, selfMute:true });
    try { await entersState(this.connection, VoiceConnectionStatus.Ready, 20000); }
    catch (error) { this.connection.destroy(); throw error; }
    this.onSpeaking = id => this.capture(id);
    this.connection.receiver.speaking.on('start', this.onSpeaking);
    this.connection.on('error', error => this.connectionProblem(error));
    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = setTimeout(() => {
        if (!this.stopped && this.connection.state.status !== VoiceConnectionStatus.Ready) this.onFailure(new Error('Discord voice disconnected.'));
      }, 10000);
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (!this.stopped) this.onFailure(new Error('Discord removed the voice connection.'));
    });
    this.timer = setTimeout(() => this.onTimeout(), this.maxHours * 3600000);
  }
  speaker(id, label) {
    let stats = this.health.stats.get(id);
    if (!stats) { stats = speakerStats(label); this.health.stats.set(id, stats); }
    else if (label) stats.label = label;
    return stats;
  }
  consent(id) {
    this.consented.add(id);
    const member = this.channel.members.get(id);
    if (member && !member.user.bot) this.speaker(id, this.store.label(this.campaign.id, id, member.displayName));
    if (this.connection.receiver.speaking.users.has(id)) this.capture(id);
  }
  consentAll(excluded = new Set()) {
    for (const [id, member] of this.channel.members) if (!member.user.bot && !excluded.has(id)) this.consent(id);
  }
  suspend(id) {
    clearTimeout(this.retryTimers.get(id)); this.retryTimers.delete(id);
    this.streams.get(id)?.finish(false);
  }
  revoke(id) {
    this.consented.delete(id);
    this.suspend(id);
  }
  capture(id) {
    const member = this.channel.members.get(id);
    if (this.stopped || !this.consented.has(id) || !member || member.user.bot || this.streams.has(id)) return;
    const label = this.store.label(this.campaign.id, id, member.displayName);
    const stats = this.speaker(id, label);
    const now = Date.now();
    if (stats.pausedUntil > now) { this.scheduleRetry(id, stats.pausedUntil - now); return; }
    let stream, decoder;
    try {
      stream = this.connection.receiver.subscribe(id, { end:{ behavior:EndBehaviorType.AfterSilence, duration:1200 } });
      decoder = this.createDecoder();
    } catch (error) { stream?.destroy?.(); this.problem(id, stats, 'receive', error); return; }
    stats.turns++;
    let pieces = [], bytes = 0, turnBytes = 0, offset = (Date.now()-this.session.started)/1000, ended = false;
    const flush = save => {
      const pcm = Buffer.concat(pieces); pieces=[]; bytes=0;
      if (save && pcm.length) {
        try {
          this.audio.submit(this.session.id, label, offset, pcm);
          // AudioProcessor.submit ignores clips shorter than 0.25 s; count only what it keeps.
          if (pcm.length >= BYTES_PER_SECOND*0.25) { stats.clips++; stats.savedSeconds += pcm.length/BYTES_PER_SECOND; }
        }
        catch (error) { queueMicrotask(() => this.onFailure(error)); }
      }
      offset = (Date.now()-this.session.started)/1000;
    };
    const finish = (save, failed = false) => {
      if (ended) return;
      ended = true; flush(save); stream.unpipe?.(decoder); stream.destroy(); decoder.destroy(); this.streams.delete(id);
      // Discord reported this person speaking, but no decodable audio arrived. Repeated silent turns usually mean
      // packets were dropped before decoding (for example during an encryption key change).
      if (!failed && save && turnBytes === 0) stats.silentTurns++;
    };
    this.streams.set(id, { finish });
    decoder.on('data', pcm => {
      pieces.push(pcm); bytes += pcm.length; turnBytes += pcm.length; stats.decodedSeconds += pcm.length/BYTES_PER_SECOND;
      if (bytes >= BYTES_PER_SECOND*30) flush(true);
    });
    decoder.on('end', () => finish(true));
    // One person's bad packet or stream must not end everyone's recording: keep what was decoded, then resubscribe.
    decoder.on('error', error => { finish(true, true); this.problem(id, stats, 'decoder', error); });
    stream.on('error', error => { finish(true, true); this.problem(id, stats, 'receive', error); });
    stream.pipe(decoder);
  }
  problem(id, stats, type, error) {
    if (this.stopped) return;
    const now = Date.now();
    if (type === 'decoder') stats.decoderErrors++; else stats.receiveErrors++;
    stats.lastError = String(error?.message || error || 'unknown error').replace(/\s+/g,' ').slice(0,200);
    stats.recentErrors = stats.recentErrors.filter(time => now-time < ERROR_WINDOW_MS); stats.recentErrors.push(now);
    this.log.warn?.(`Audio ${type} error for ${stats.label}: ${stats.lastError}`);
    if (stats.recentErrors.length >= ERROR_LIMIT) {
      stats.pausedUntil = now + COOLDOWN_MS; stats.recentErrors = [];
      if (!stats.warned) {
        stats.warned = true;
        try { this.onWarning(`Chronicle is having trouble receiving audio from **${stats.label}**. Everyone else is still being recorded, and it keeps retrying. Check the capture report when the session ends.`); } catch {}
      }
    }
    this.scheduleRetry(id, Math.max(this.retryDelay, stats.pausedUntil - now));
  }
  scheduleRetry(id, delay) {
    if (this.stopped || this.retryTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      if (this.connection?.receiver.speaking.users.has(id)) this.capture(id);
    }, delay);
    timer.unref?.(); this.retryTimers.set(id, timer);
  }
  connectionProblem(error) {
    if (this.stopped) return;
    const now = Date.now(), health = this.health;
    health.connectionErrors++;
    health.lastConnectionError = String(error?.message || error || 'unknown error').replace(/\s+/g,' ').slice(0,200);
    health.connectionErrorTimes = health.connectionErrorTimes.filter(time => now-time < ERROR_WINDOW_MS); health.connectionErrorTimes.push(now);
    this.log.warn?.(`Discord voice connection error: ${health.lastConnectionError}`);
    if (health.connectionErrorTimes.length >= CONNECTION_ERROR_LIMIT) this.onFailure(new Error('Discord voice connection kept failing; recording stopped. Saved audio is kept.'));
  }
  report() { return captureReport(this.health); }
  stop() {
    if (this.stopped) return;
    this.stopped = true; clearTimeout(this.timer); clearTimeout(this.disconnectTimer);
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    if (this.onSpeaking) this.connection?.receiver.speaking.off('start', this.onSpeaking);
    for (const stream of [...this.streams.values()]) stream.finish(true);
    if (this.connection && this.connection.state?.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy?.();
  }
}

/** Plain-data snapshot of a session's capture health, safe to store and post. */
export function captureReport(health) {
  const round = value => Math.round(value*10)/10;
  return {
    speakers:[...health.stats.entries()].map(([id, s]) => ({ id, label:s.label, decodedSeconds:round(s.decodedSeconds), savedSeconds:round(s.savedSeconds),
      clips:s.clips, turns:s.turns, silentTurns:s.silentTurns, receiveErrors:s.receiveErrors, decoderErrors:s.decoderErrors, lastError:s.lastError })),
    connectionErrors:health.connectionErrors, lastConnectionError:health.lastConnectionError, created:Date.now(),
  };
}

function duration(seconds) {
  const value = Math.round(seconds);
  if (value < 60) return `${value}s`;
  const hours = Math.floor(value/3600), minutes = Math.floor(value/60)%60, rest = value%60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${rest}s`;
}

/** True when a speaker's numbers suggest audio was lost, not just that they were quiet. */
export function speakerNeedsCheck(speaker) {
  const errors = speaker.receiveErrors + speaker.decoderErrors;
  return errors > 0 || (speaker.turns > 0 && speaker.decodedSeconds === 0) ||
    (speaker.silentTurns >= 3 && speaker.silentTurns/Math.max(1, speaker.turns) > 0.2);
}

/** Discord-ready summary. Mentions are suppressed by the client, so labels are safe to include. */
export function captureSummary(report, session) {
  const lines = [`**Capture check · ${session.title}** (\`${session.id}\`)`];
  if (!report.speakers.length) lines.push('Nobody opted in, so no voice audio was saved.');
  for (const speaker of [...report.speakers].sort((a, b) => a.label.localeCompare(b.label))) {
    if (!speaker.turns) { lines.push(`• ${speaker.label}: opted in but was never heard (muted, or didn't talk?)`); continue; }
    const details = [`${duration(speaker.decodedSeconds)} captured in ${speaker.clips} clip${speaker.clips === 1 ? '' : 's'}`];
    if (speaker.silentTurns) details.push(`${speaker.silentTurns} of ${speaker.turns} speaking turns came through with no audio`);
    const errors = speaker.receiveErrors + speaker.decoderErrors;
    if (errors) details.push(`${errors} receive error${errors === 1 ? '' : 's'}${speaker.lastError ? ` (last: ${speaker.lastError.slice(0,80)})` : ''}`);
    lines.push(`${speakerNeedsCheck(speaker) ? '⚠️' : '✅'} ${speaker.label}: ${details.join(' · ')}`);
  }
  if (report.connectionErrors) lines.push(`Discord voice connection errors: ${report.connectionErrors}${report.lastConnectionError ? ` (last: ${report.lastConnectionError.slice(0,80)})` : ''}`);
  if (report.speakers.some(speakerNeedsCheck)) lines.push('Something looks off. Compare against a backup recording (for example Craig) before trusting this session.');
  return lines.join('\n');
}
