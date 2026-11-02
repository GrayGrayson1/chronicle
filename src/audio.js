import { EndBehaviorType, joinVoiceChannel, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import prism from 'prism-media';
export { AudioProcessor, wav } from './processor.js';

export class Recorder {
  constructor({ channel, session, campaign, store, audio, maxHours, onFailure, onTimeout }) {
    Object.assign(this, { channel, session, campaign, store, audio, onFailure, onTimeout });
    this.consented = new Set(); this.streams = new Map(); this.stopped = false;
    this.maxHours = maxHours;
  }
  async start() {
    this.connection = joinVoiceChannel({ channelId:this.channel.id, guildId:this.channel.guild.id,
      adapterCreator:this.channel.guild.voiceAdapterCreator, group:this.channel.client.user.id, selfDeaf:false, selfMute:true });
    try { await entersState(this.connection, VoiceConnectionStatus.Ready, 20000); }
    catch (error) { this.connection.destroy(); throw error; }
    this.onSpeaking = id => this.capture(id);
    this.connection.receiver.speaking.on('start', this.onSpeaking);
    this.connection.on('error', () => this.onFailure(new Error('Discord voice connection failed.')));
    this.connection.on(VoiceConnectionStatus.Disconnected, () => {
      this.disconnectTimer = setTimeout(() => {
        if (!this.stopped && this.connection.state.status !== VoiceConnectionStatus.Ready) this.onFailure(new Error('Discord voice disconnected.'));
      }, 10000);
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (!this.stopped) this.onFailure(new Error('Discord removed the voice connection.'));
    });
    this.timer = setTimeout(() => this.onTimeout(), this.maxHours * 3600000);
  }
  consent(id) {
    this.consented.add(id);
    if (this.connection.receiver.speaking.users.has(id)) this.capture(id);
  }
  revoke(id) {
    this.consented.delete(id);
    this.streams.get(id)?.finish(false);
  }
  capture(id) {
    const member = this.channel.members.get(id);
    if (this.stopped || !this.consented.has(id) || !member || member.user.bot || this.streams.has(id)) return;
    const stream = this.connection.receiver.subscribe(id, { end:{ behavior:EndBehaviorType.AfterSilence, duration:1200 } });
    const decoder = new prism.opus.Decoder({ rate:48000, channels:2, frameSize:960 });
    const label = this.store.label(this.campaign.id, id, member.displayName);
    let pieces = [], bytes = 0, offset = (Date.now()-this.session.started)/1000, ended = false;
    const flush = save => {
      const pcm = Buffer.concat(pieces); pieces=[]; bytes=0;
      if (save && pcm.length) {
        try { this.audio.submit(this.session.id, label, offset, pcm); }
        catch (error) { queueMicrotask(() => this.onFailure(error)); }
      }
      offset = (Date.now()-this.session.started)/1000;
    };
    const finish = save => {
      if (ended) return;
      ended = true; flush(save); stream.unpipe(decoder); stream.destroy(); decoder.destroy(); this.streams.delete(id);
    };
    this.streams.set(id, { finish });
    decoder.on('data', pcm => {
      pieces.push(pcm); bytes += pcm.length;
      if (bytes >= 48000*2*2*30) flush(true);
    });
    decoder.on('end', () => finish(true));
    decoder.on('error', () => { finish(false); this.onFailure(new Error('An audio decoder failed; recording stopped.')); });
    stream.on('error', () => { finish(false); this.onFailure(new Error('Discord audio reception failed; recording stopped.')); });
    stream.pipe(decoder);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; clearTimeout(this.timer); clearTimeout(this.disconnectTimer);
    this.connection?.receiver.speaking.off('start', this.onSpeaking);
    for (const stream of [...this.streams.values()]) stream.finish(true);
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
  }
}
