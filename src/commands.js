import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { archiveCommands } from './bot-archive.js';

const sessionId = option => option.setName('id').setDescription('Session ID from /session list').setRequired(true).setMaxLength(8);
const coreCommands = [
  new SlashCommandBuilder().setName('help').setDescription('How to use Chronicle'),
  new SlashCommandBuilder().setName('campaign').setDescription('Configure the campaign for this text channel')
    .addSubcommand(s => s.setName('create').setDescription('Bind a new campaign to this text channel (Manage Server)')
      .addStringOption(o => o.setName('name').setDescription('Campaign name').setRequired(true).setMaxLength(100)))
    .addSubcommand(s => s.setName('glossary').setDescription('Set names and terms to help transcription (Manage Server)')
      .addStringOption(o => o.setName('text').setDescription('Character names, places, unusual words').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName('info').setDescription('Show this channel’s campaign')),
  new SlashCommandBuilder().setName('character').setDescription('Set your speaker label for this campaign')
    .addStringOption(o => o.setName('name').setDescription('Example: Jon / Zafir').setRequired(true).setMaxLength(80)),
  new SlashCommandBuilder().setName('consent').setDescription('Choose whether your voice is recorded in the active session')
    .addBooleanOption(o => o.setName('allow').setDescription('True: record me. False: stop recording me.').setRequired(true)),
  new SlashCommandBuilder().setName('ask').setDescription('Ask about saved campaign sessions')
    .addStringOption(o => o.setName('question').setDescription('Example: What did the innkeeper promise us?').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('publish').setDescription('Update the campaign website with approved sessions (Manage Server)'),
  new SlashCommandBuilder().setName('session').setDescription('Record and manage campaign sessions')
    .addSubcommand(s => s.setName('start').setDescription('Announce a recording and join voice (Manage Server)')
      .addStringOption(o => o.setName('title').setDescription('Session title').setRequired(true).setMaxLength(150))
      .addChannelOption(o => o.setName('voice').setDescription('Voice channel you are in').addChannelTypes(ChannelType.GuildVoice).setRequired(true)))
    .addSubcommand(s => s.setName('stop').setDescription('Stop recording and generate a recap (starter or Manage Server)'))
    .addSubcommand(s => s.setName('status').setDescription('Recording and transcription status'))
    .addSubcommand(s => s.setName('list').setDescription('List recent sessions'))
    .addSubcommand(s => s.setName('recap').setDescription('Read a saved recap').addStringOption(sessionId))
    .addSubcommand(s => s.setName('transcript').setDescription('Download a Markdown transcript').addStringOption(sessionId))
    .addSubcommand(s => s.setName('retry').setDescription('Retry failed transcription and regenerate recap (Manage Server)').addStringOption(sessionId))
    .addSubcommand(s => s.setName('delete').setDescription('Permanently delete a session (Manage Server)').addStringOption(sessionId)
      .addStringOption(o => o.setName('confirm').setDescription('Type DELETE to confirm').setRequired(true)))
    .addSubcommand(s => s.setName('notes').setDescription('Import notes/transcript as a session (Manage Server)')
      .addStringOption(o => o.setName('title').setDescription('Session title').setRequired(true).setMaxLength(150))
      .addAttachmentOption(o => o.setName('file').setDescription('UTF-8 .txt or .md, up to 1 MB').setRequired(true)))
    .addSubcommand(s => s.setName('upload').setDescription('Transcribe a session recording (Manage Server)')
      .addStringOption(o => o.setName('title').setDescription('Session title').setRequired(true).setMaxLength(150))
      .addAttachmentOption(o => o.setName('file').setDescription('Audio file, up to 100 MB').setRequired(true))
      .addBooleanOption(o => o.setName('consent').setDescription('Everyone recorded agreed to transcription and AI summaries').setRequired(true))),
].map(command => command.setDMPermission(false).toJSON());

export const commands=[...coreCommands,...archiveCommands,...['pause','resume'].map(name=>new SlashCommandBuilder().setName(name).setDescription(name==='pause'?'Pause recording without ending the session':'Resume a paused session').setDMPermission(false).toJSON()),new SlashCommandBuilder().setName('start').setDescription('Start a session recording').setDMPermission(false).addStringOption(o=>o.setName('title').setDescription('Session title').setRequired(true).setMaxLength(150)).addChannelOption(o=>o.setName('voice').setDescription('Your voice channel').addChannelTypes(ChannelType.GuildVoice).setRequired(true)).toJSON(),new SlashCommandBuilder().setName('end').setDescription('End this session recording').setDMPermission(false).toJSON()];
