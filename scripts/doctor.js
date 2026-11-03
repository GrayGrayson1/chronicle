import { config } from '../src/config.js';
import { runProcess, childEnvironment, codexCommand } from '../src/process.js';

let failed=false;
async function check(name,fn) {
  try { console.log(`OK  ${name}: ${await fn()}`); }
  catch (error) { failed=true; console.log(`FAIL ${name}: ${error.message}`); }
}
await check('Node',async()=>{ if (Number(process.versions.node.split('.')[0])<24) throw new Error('Install Node.js 24 or newer.'); return process.version; });
await check('SQLite',async()=>{ const { DatabaseSync }=await import('node:sqlite'); const db=new DatabaseSync(':memory:'); db.close(); return 'available'; });
const codex=codexCommand(config);
await check('Codex executable',()=>runProcess(codex.bin,[...codex.prefix,'--version'],{ env:childEnvironment(),timeout:15000 }));
await check('Codex login',()=>runProcess(codex.bin,[...codex.prefix,'login','status'],{ env:childEnvironment(),timeout:20000 }));
await check('Local Whisper',()=>runProcess(config.pythonBin,['-c','import faster_whisper; print("installed (model loads on first transcription)")'],{ env:childEnvironment(),timeout:30000 }));
if ((process.env.WHISPER_DEVICE || 'cuda') === 'cuda') await check('Whisper GPU',()=>runProcess(config.pythonBin,['-c',
  'import os, ctranslate2; count=ctranslate2.get_cuda_device_count(); assert count > 0, "No CUDA GPU detected. Check NVIDIA driver and CUDA setup."; types=ctranslate2.get_supported_compute_types("cuda"); precision=os.getenv("WHISPER_COMPUTE_TYPE", "float16"); assert precision in types, f"GPU does not support requested compute type {precision}; supported: {sorted(types)}"; print(f"{count} CUDA device(s), {precision} supported; actual model inference still needs a recording test")'
],{env:childEnvironment(),timeout:30000}));
if (!process.argv.includes('--discord')) await check('Local audio devices',()=>runProcess(config.pythonBin,['-c','import soundcard as s; print("Microphone:", s.default_microphone()); print("Playback:", s.default_speaker())'],{ env:childEnvironment(),timeout:15000 }));
if (process.argv.includes('--discord')) {
  await check('Discord dependencies',async()=>{ await import('discord.js'); const voice=await import('@discordjs/voice'); return voice.generateDependencyReport(); });
  await check('Discord settings',async()=>{ for (const key of ['DISCORD_TOKEN','DISCORD_CLIENT_ID']) if (!process.env[key] || process.env[key].startsWith('replace_')) throw new Error(`Set ${key} in .env.`); return 'set (not printed)'; });
}
console.log('Checks do not record audio or call the AI. Test mic and playback before a real session.');
process.exitCode=failed ? 1:0;
