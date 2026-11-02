# Start here — Chronicle 0.2

**Continuing development with Claude or another assistant?** Start with [CLAUDE.md](CLAUDE.md) and [the vision and handoff](docs/VISION_AND_HANDOFF.md). They explain the goal, decisions, known gaps and suggested next work.

Chronicle now includes a Discord bot and a local campaign dashboard. The dashboard contains sessions, a review queue, compendium, timeline, quests, journals, artifacts, a relationship map, participation reports, and campaign chat.

**This is a substantial development build, not a verified feature-for-feature Archivist clone.** See `FEATURES.md` for the precise coverage and remaining differences. Do not use it as your only recording until a short real call has passed on your computer.

## 1. Install the tools

Install **Node.js 24+**, **Python 3.12 (64-bit)** and **Git**. Get the code with `git clone https://github.com/GrayGrayson1/chronicle.git` (or extract the ZIP) and open PowerShell in its folder:

```powershell
npm ci
npm install -g @openai/codex
codex login
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-full.txt
Copy-Item .env.example .env
```

`requirements-full.txt` installs local speech transcription, semantic-search dependencies, document import, and image/card rendering. First model use downloads model files. The optional mixed-audio diarization model is installed separately (see README).

Speech recognition now defaults to full **Whisper large-v3 on an NVIDIA GPU**, using float16 and beam size 5. For your RTX 5080, install a current NVIDIA driver and the CUDA 12.x runtime required by CTranslate2 (CUDA 12.8 or newer in the 12.x series). The requirements enforce CTranslate2 4.6.3 or newer for CUDA 12.8 support. See the current [CTranslate2 installation instructions](https://opennmt.net/CTranslate2/installation.html) and [Faster-Whisper GPU requirements](https://github.com/SYSTRAN/faster-whisper#gpu). Follow their instructions for any required runtime libraries. `doctor` checks GPU visibility and the selected precision; this does not establish successful model inference or accuracy.

If you already have `.env`, update `WHISPER_MODEL=large-v3`, `WHISPER_DEVICE=cuda`, and `WHISPER_COMPUTE_TYPE=float16` there too; copying a new ZIP does not change your existing settings. CPU operation remains possible with `WHISPER_DEVICE=cpu` and `WHISPER_COMPUTE_TYPE=int8`, but will be slower. The program does not silently fall back to a smaller model.

Open `.env` in Notepad and set:

```dotenv
PYTHON_BIN=.venv/Scripts/python.exe
```

Your Codex login is used by `codex exec`. Codex still sends transcript text to OpenAI and uses your account limits. **No separate AI API key is required.** Whisper handles speech-to-text on your computer. The bot and dashboard must remain running during sessions.

## 2. Create the Discord application

1. Open https://discord.com/developers/applications and create an application, for example **Chronicle**.
2. Copy its Application ID into `DISCORD_CLIENT_ID` in `.env`.
3. Open **Bot**, create/reset the token, and put it in `DISCORD_TOKEN` in `.env`. Keep it private.
4. In Discord, enable **User Settings → Advanced → Developer Mode**, right-click your server, and copy its server ID into `DISCORD_GUILD_ID`.
5. In the portal OAuth2 URL Generator, select `bot` and `applications.commands`. Select **View Channels**, **Connect**, **Send Messages**, **Read Message History**, **Embed Links**, and **Attach Files**. Invite it using the generated link. Administrator permission is not needed.
6. Allow these permissions in your campaign text channel and voice-channel chat. Speaker capture does not require privileged intents. Selected-message imports and Discord MCP message text require enabling **Message Content** in the portal and `ENABLE_PLAY_BY_POST=1` in `.env`.

## 3. Start Chronicle

```powershell
npm run doctor -- --discord
npm run register
npm start
```

Or double-click `START_CHRONICLE.cmd` after setup.

The terminal prints a **private host dashboard link**. Open that link in your browser. Do not send the host link to players; use their own campaign keys from Settings or `/dashboard` in Discord.

For imports and campaign management without connecting Discord, use `npm run dashboard` or `START_DASHBOARD.cmd`. Only one mode can use the data directory at a time. The legacy microphone/playback CLI is also included as an optional backup.

## 4. Record your first session

1. In a dedicated Discord text channel, run `/campaign create` and enter a name. Refresh the dashboard and choose that campaign.
2. Players can set a speaker label with `/character`, such as **Jon / my character**.
3. Join voice and run `/start` with a title and voice channel. `/session start` is an equivalent command.
4. **Every speaker runs `/consent allow:true` in the campaign text channel.** Recording starts with nobody opted in. The person starting the session must opt in too.
5. Use `/pause` and `/resume` if needed. Resuming and rejoining voice require opting in again.
6. Use `/end` or `/session stop` to finish.
7. Open **Review queue**. Correct names, descriptions and objectives, reject unsupported suggestions, then **Save review** and **Approve saved review**.
8. Approved entries appear in the compendium, timeline and quest log. Ask about them with `/ask` or **Ask Chronicle**.

The dashboard import form also accepts notes or audio. Separate, aligned audio files should be named for their speakers. One mixed recording can be transcribed with unknown speakers, or processed through the optional local speaker-discovery workflow and manually mapped before transcription.

## 5. Test before game night

When you stop a recording, the bot posts a **capture check** for each opted-in speaker: seconds captured, clips saved, speaking turns that came through with no audio, and errors. A ⚠️ next to someone means their audio may be incomplete. For the first test, also run [Craig](https://craig.chat) in the same call; if the capture check looks wrong, import Craig's multi-track ZIP with `npm run import-craig -- craig.zip --title "Test" --consent` while Chronicle is running.


Before recording, enable **Retain raw audio** in campaign settings. Record 10–15 minutes with your actual group, including character/place names, two people speaking together, DM character switches, numbers, and phrases such as “do not open the door.” Add names to the campaign glossary first. Compare the transcript against the audio: note omitted speech, incorrect names/numbers, and errors that reverse the meaning. Check that processing keeps up, then approve a review and ask questions about the conversation. A plausible-looking recap is not evidence of an accurate transcript. The model/settings have not been benchmarked on your group or run on an RTX 5080 in this build environment.

The bot records Discord users; it does not automatically recognize which NPC the DM is acting as. Audio-boundary context handling and long-session AI context budgeting also remain limitations; upgrading the speech model does not fix them. Audio reception, recognition accuracy, real Codex responses and external integrations still need testing on your setup.

Raw audio is deleted after successful transcription unless you enable **Retain raw audio** in campaign settings first. Failed audio is kept for retry. Back up the whole `data` folder while Chronicle is stopped.

To share recaps with the party, set up the player site: [docs/PLAYER_SITE.md](docs/PLAYER_SITE.md).

See `README.md` for optional integrations and privacy/access details. See `FEATURES.md` for the comparison and `docs/VALIDATION.md` for exactly what was tested.
