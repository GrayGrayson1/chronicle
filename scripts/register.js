import { REST, Routes } from 'discord.js';
import { config, required } from '../src/config.js';
import { commands } from '../src/commands.js';
required('DISCORD_TOKEN','DISCORD_CLIENT_ID','DISCORD_GUILD_ID');
for(const guild of config.guildIds)await new REST({ version:'10' }).setToken(config.token).put(Routes.applicationGuildCommands(config.clientId, guild), { body:commands });
console.log('Chronicle slash commands registered in your server.');
