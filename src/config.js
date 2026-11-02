import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
if (existsSync('.env')) process.loadEnvFile('.env');

function number(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
export const config = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  guildIds: [...new Set([process.env.DISCORD_GUILD_ID,...(process.env.DISCORD_EXTRA_GUILD_IDS||'').split(',').map(value=>value.trim())].filter(Boolean))],
  dataDir: resolve(process.env.DATA_DIR || './data'),
  codexBin: process.env.CODEX_BIN || 'codex',
  codexModel: process.env.CODEX_MODEL || '',
  codexTimeout: number('CODEX_TIMEOUT_SECONDS', 240, 10, 1800) * 1000,
  pythonBin: process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
  maxHours: number('MAX_SESSION_HOURS', 6, 0.05, 12),
  maxPendingAudio: number('MAX_PENDING_AUDIO', 300, 1, 2000),
};
export function required(...names) {
  for (const name of names) if (!process.env[name] || process.env[name].startsWith('replace_')) throw new Error(`Set ${name} in .env first.`);
}
