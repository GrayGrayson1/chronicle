# Chronicle 0.2 — Discord bot and campaign archive

Developer handoff: [CLAUDE.md](CLAUDE.md) links to [the project vision, current decisions, reliability gaps and acceptance criteria](docs/VISION_AND_HANDOFF.md).

Chronicle is an independent, self-hosted campaign-management application inspired by the workflow you requested from Archivist. It combines a Discord recorder, local Whisper transcription, a local dashboard, and a bridge to your installed Codex CLI. The build is broader than the original recording prototype, but full Archivist parity has not been established. `FEATURES.md` tracks that gap explicitly.

Start with **START_HERE.md**. The code lives at https://github.com/GrayGrayson1/chronicle; [docs/GITHUB_SETUP.md](docs/GITHUB_SETUP.md) covers cloning it and the player site. No existing Archivist account or proprietary source files are needed. This application does not connect to or impersonate the official Archivist service.

## What is here

- Discord recording with per-user opt-in, individual speaker labels, pause/resume, multiple configured servers, and optional companion bots for overlapping tables.
- Audio/notes imports, aligned per-speaker tracks, optional local discovery of anonymous speakers in mixed audio, transcript corrections and retained-audio playback.
- A browser dashboard for reviewing suggested facts before updating the campaign record.
- An editable compendium for PCs, NPCs, places, items and factions, plus aliases, tags, structured properties, linked entries, revision history and merging.
- Timeline events with chapter/scene properties; quests with objectives, statuses, progress details, and reviewable changes.
- Private/shared journals, per-user view/edit/manage access, folder paths, and PDF/DOCX/TXT/Markdown import.
- Session highlights, confirmed quotes, awards, handouts, card artwork, optional image/GIF generation, collections and character-arc drafts.
- Campaign questions using permitted entries, approved transcripts/recaps, and optional local semantic retrieval; separate creative-suggestion mode.
- Relationship maps, participation metrics, radar/trend plots, optional local text-tone scoring, and AI-written insight reports.
- A password-locked **player site** on GitHub Pages with recaps, people, inventory, quests, timeline and search, refreshed after each approved session. See [docs/PLAYER_SITE.md](docs/PLAYER_SITE.md).
- A per-speaker **capture check** after every recording, and a **Craig import** as a backup recorder.
- Scoped member keys, read-only campaign links, Markdown/HTML/Obsidian ZIP exports, JSON restore, PDF downloads, explicit Discord/email delivery, and adapters for MCP, Foundry and Obsidian.

A feature’s source code existing does not establish its accuracy, visual quality, or third-party compatibility. See the coverage table and validation report.

## Architecture and running modes

Node.js 24 runs the bot, HTTP API/dashboard and SQLite database. Python runs local models and document/image conversion. Codex runs non-interactively with `codex exec`, an ephemeral temporary workspace, read-only sandbox, disabled shell/hooks/memories/web search, and the Discord token removed from its environment. Campaign text is still sent to OpenAI for AI processing. Account usage limits apply; no separate API key is required when Codex is logged in with your ChatGPT account.

- `npm start`: Discord bot plus dashboard.
- `npm run dashboard`: dashboard/API only; useful for uploads and editing without a Discord connection.
- `npm run register`: update slash commands in every configured server.
- `npm run doctor -- --discord`: bot/CLI/Python dependency checks; does not record or call AI.
- `npm test`: automated local tests, with AI responses mocked.
- `npm run publish-site -- "<campaign>"`: write (and optionally push) the player site data while the bot is stopped. `/publish` does the same from Discord.
- `npm run import-craig -- <craig.zip> --title "…" --consent`: import a Craig multi-track recording into a running Chronicle.
- `npm run preview`: the real dashboard with the fictional demo campaign and a stand-in for Codex, to look at the UI without Discord.
- `npm run mcp`: stdio MCP bridge to an already-running dashboard, using `CHRONICLE_URL` and `CHRONICLE_ACCESS_TOKEN`.

One host process owns a data directory. The bot and dashboard-only modes must not run simultaneously against it. The MCP process forwards requests through the HTTP API and does not open SQLite itself.

## Access and privacy

Campaigns created in Discord are bound to their chosen text channel. Ordinary slash-command users are enrolled as players; the creator is an owner and server managers can be enrolled as admins. Dashboard requests from Discord IDs are checked against the member’s current access to that channel when the bot is connected. The standalone dashboard uses its explicitly assigned campaign memberships; it cannot check Discord channel changes while disconnected.

Only administrators see review drafts. Player questions use approved sessions and entries they can read. Private journals are visible to their author, campaign owners/admins, and explicitly granted members. Journal ACL values are `view`, `edit`, or `manage`; party visibility grants viewing to all campaign members. Players assigned to a PC through `properties.playerSubject` can edit its name/description and upload its image; changing structured ownership fields requires an administrator.

Read-only share links omit journals, private entries, drafts and chat; source-audio downloads require membership. These are access links to your own running host, not automatic public website deployments. Default hosting binds to `127.0.0.1`. For trusted LAN access, explicitly set `DASHBOARD_HOST=0.0.0.0` and use the host PC’s LAN address in the player link. Remote use needs your own authenticated HTTPS tunnel or reverse proxy; no network publishing is performed by this package.

The host key is stored in `data/dashboard-key`. Keep it and `.env` private. Scoped keys are hashed in the database, shown once, expire, and can be revoked. Keys do not grant more authority than their member’s current campaign role. The local archive is not encrypted by this application.

## Voice recording

The bot joins muted and undeafened, announces recording, and subscribes only to opted-in speakers. `/consent allow:false` discards a person’s current unsaved buffer and stops future capture. Previously submitted speech remains. Leaving the channel revokes consent; resuming requires new consent.

`/pause` disconnects without finalizing; `/resume` continues the same session. Each Discord bot can hold one voice connection per server. To record simultaneous tables, create/invite extra bot applications and set `DISCORD_COMPANION_TOKENS` to a JSON array of their tokens. Never post those tokens into Discord. The main bot handles slash commands and assigns an available recorder. Simultaneous recordings and pause/resume still need live Discord validation.

Add extra server IDs in `DISCORD_EXTRA_GUILD_IDS`, comma-separated, then re-register. Each campaign remains separate. Voice receive uses `@discordjs/voice` with DAVE support; Discord does not guarantee receive behavior as a stable documented API. Test your call before relying on it.

One speaker's receive or decoder error no longer stops the session: Chronicle keeps that person's audio decoded so far, logs the error and resubscribes them while everyone else keeps recording. A speaker who fails 12 times in a minute is paused for 15 seconds and the channel gets one warning. Five voice-connection errors within a minute still stop the recording. When recording stops, the bot posts a **capture check**: seconds captured, clips saved, speaking turns that delivered no audio, and errors for each opted-in speaker. It is saved per session and summarized in `/session status`. Repeated silent turns usually mean packets were dropped before decoding, for example during Discord's encryption key changes.

**Backup recorder:** if the capture check looks wrong, record with [Craig](https://craig.chat) alongside Chronicle and import its multi-track ZIP with `npm run import-craig -- craig.zip --title "Session 4" --consent` (add `--map "craigname=Label"` to rename speakers, `--dry-run` to preview). Craig's tracks are aligned, so each is imported at offset 0 with its own speaker label.

Audio is chunked to bound recording memory. `MAX_PENDING_AUDIO` stops recording when local transcription falls behind. Successfully transcribed raw audio is deleted unless retention was enabled first; failed and pending audio are saved. Shutdown preserves the queue. Review generation can be retried without re-recording. Already approved sessions should be corrected through their reference entries so existing review history is preserved.

## Audio and language options

Transcription defaults to full `large-v3`, `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16`, and beam size 5 for an accuracy-focused NVIDIA GPU setup. `requirements.txt` requires CTranslate2 4.6.3+ for CUDA 12.8 support on RTX 50-series hardware. Install the matching GPU runtime libraries as described in START_HERE.md. Existing `.env` files must be updated explicitly. There is no automatic smaller-model or CPU fallback. To run on a CPU, set `WHISPER_DEVICE=cpu` and `WHISPER_COMPUTE_TYPE=int8`; expect slower processing.

`large-v3` is multilingual. Set campaign language to `auto` or `mixed` for automatic detection; `.en` alternative models are English-only. Set `outputLanguage` to control generated writing. Model choice and audio quality affect recognition; hardware primarily affects processing speed. These defaults are a starting point, not proof of human-level accuracy or a benchmark against Archivist. Follow the real-audio comparison in START_HERE.md and enable retained audio before that test. Chunk-boundary context, automatic DM-to-NPC attribution, and long-session prompt truncation remain unresolved limitations.

The campaign glossary is set by `/campaign glossary`. Speaker labels are set by `/character`. Cast profiles store player/character names, aliases and Discord subject IDs. Mixed-audio discovery creates anonymous clusters that you map to names yourself; this is not automatic identity recognition or persistent voice-profile matching.

For speaker discovery, install `requirements-diarization.txt`, accept the access terms for `pyannote/speaker-diarization-community-1`, and put your read-only Hugging Face token in `HF_TOKEN`. CPU is supported; GPU can be selected in `.env`. First use downloads models. Large audio files and models need substantial local RAM and storage. This path has not been run against real speech in the build environment.

The web uploader accepts up to 2 GB per track, streamed to disk. Discord attachment imports are limited to 100 MB and Discord’s own upload limit. Use the dashboard for larger or multiple files. Tracks must already be aligned to the same recording start; optional offsets can be passed through the API. Mixed uploads do not gain reliable real-world speaker identities automatically.

## Review and campaign records

Extraction proposes records, citations and potential merges. Invalid source IDs and non-verbatim generated quotes are discarded; raw-note imports do not produce verified quotes. Every suggestion can be edited or rejected before approval. Approval applies accepted changes in one transaction; an invalid suggestion rolls the whole approval back. Earlier pending sessions must be approved first.

Use `[[Entry name]]` to link entries; aliases also resolve. Properties can contain linked entry IDs (for example allies, owner, home base) and feed the relationship graph. Quests use `objectives: [{text, status}]`, with statuses `planned`, `in_progress`, `blocked`, `failed`, `done`. Objective states determine the overall status. Completed/failed quests are not automatically updated by later extraction.

The dashboard includes a switchable Quill visual/Markdown editor with sanitized rendering, wiki autocomplete, a selectable-column compendium table and atomic bulk edits, draggable timeline steps, seven-theme character-facet proposals with owner review, and circular/grid/network map layouts. Advanced properties remain editable as JSON. Exact editor/layout differences are listed in `FEATURES.md`.

## Campaign questions

`/ask`, the dashboard's Ask Chronicle and the MCP ask tool share `src/ask.js`. For each question it searches only what the asking member can read right now: approved sessions (also for admins), entries that pass the journal/visibility rules, and recaps. Ranking is BM25 with light stemming, a small TTRPG synonym list, entity aliases and optional semantic hits. Matching transcript lines come with their neighbours, named entities with their linked entries. The model gets a numbered evidence list (E# entries, T# transcript passages, R# recaps) packed under a budget, with a count of what didn't fit, and may ask for up to two extra searches before answering. The **Sources** list under each answer is generated from the IDs it cited, with session and timestamp. Unknown IDs are removed. If nothing at all matches a specific question, Chronicle says so without calling Codex. Earlier questions in the conversation help resolve follow-ups; earlier answers are not resent.

## Semantic search

Install `requirements-full.txt`, set `SEMANTIC_SEARCH=1`, then choose **Rebuild semantic index** in Settings. The default local embedding model is `sentence-transformers/all-MiniLM-L6-v2`; change `EMBED_MODEL` for another compatible model. First use downloads it.

The index stores local vectors. Permissions are checked again at retrieval time, including for journals indexed while private. Without this optional model, search uses literal matches, keyword-ranked transcript excerpts and recent recaps. Neither mode guarantees perfect recall or correct citations. Rebuild after significant edits or new sessions.

## Participation and text tone

Cast analysis includes word shares, speaker changes, questions, timestamp gaps, five-minute consistency/variability and a radar chart with explicit formulas in the report. The optional Analyze approved text locally action downloads `SENTIMENT_MODEL` on first use. The default is an English social-media text model; its scores describe wording and do not measure players’ emotions or mental states. It has not been validated on your roleplaying sessions.

## Artifacts, artwork and email

Text artifacts use Codex. Cards use Pillow to render 1200×1680 PNGs with an existing portrait, editable text/stats, crop position/zoom and five themes. PDFs support five color themes. Set `PDF_FONT`/`PDF_FONT_BOLD` to appropriate local fonts for scripts outside the default font coverage.

Image generation is optional and local: install ComfyUI, load a compatible standard checkpoint, and set `COMFYUI_CHECKPOINT` and `COMFYUI_URL`. The included workflow uses standard text-to-image/img2img nodes. Sprite generation asks that model for an aligned 4×2 sequence and assembles a 128×128 looping GIF. Alignment, animation semantics and character consistency depend on the image model and need review; output equivalence to Archivist’s sprite pipeline is not established. No image model is bundled or called during installation.

Email delivery requires SMTP settings in `.env`. Delivery is explicit: select the content and recipients and confirm **Send now**. Members can separately opt into approved-session email or owner/admin review-ready alerts through My notifications. Campaign admins can enable approved recap/highlight posts, which expire after 24 hours while the bot is running. No marketing/security/account email service is included. Discord delivery stays within the campaign channel and suppresses mentions. No real email or Discord message was sent during tests.

## Player site (GitHub Pages)

`site/` is a static, read-only player companion. Chronicle publishes approved sessions and party-visible, non-journal entries to `site/data/` as an AES-256-GCM bundle locked with `SITE_PASSPHRASE`; the browser unlocks it with the party password. Transcripts, private entries, journals, drafts, chat and Discord user IDs are not published. Publish with `/publish`, automatically after approval (`SITE_AUTO_PUBLISH=1`), or `npm run publish-site`. With `SITE_GIT_PUSH=1` it commits only `site/data/*` and pushes; `.github/workflows/pages.yml` deploys the site. Open the site with `?demo` to see a fictional campaign. Details and the security model are in [docs/PLAYER_SITE.md](docs/PLAYER_SITE.md).

Item and NPC records now carry inventory and history fields (quantity, holder, location, status, history; likes/dislikes/role/home). Approval appends `history` and `progressLog` entries across sessions instead of replacing them, and unions aliases.

## Exports, restore and backups

Settings exports Markdown, HTML or an Obsidian vault ZIP with `campaign.json` and accessible artwork. Approved sessions are included; private journals appear only when the exporting member can read them. Read-only shares omit journals entirely. Export ZIPs are bounded to 64 MB; select fewer sessions through the API for larger archives.

Restore imports `campaign.json` into the current campaign with new IDs and remapped references. It does not import access keys or memberships. Copy the export’s `assets` folder into the host’s `data/assets` separately to restore images. For a complete backup including raw audio and exact permissions, stop the host and copy the whole `data` directory.

## Integrations

- **MCP:** run `src/mcp.js` through a local MCP client. Set `CHRONICLE_URL=http://127.0.0.1:8787` and a scoped `CHRONICLE_ACCESS_TOKEN`. Tools read campaign data, search, ask, create private journals and update entries with version checks. Discord tools are restricted to the campaign channel. Writes require explicit confirmation fields and appropriate role/key scope. The stdio transport and scoped calls are locally tested.
- **Foundry:** copy `integrations/foundry` to `Data/modules/chronicle-local`; enable it, configure URL/key/campaign in module settings, and add the Foundry origin to `DASHBOARD_ALLOWED_ORIGINS`. `/chronicle-sync` imports party content after confirmation; `/chronicle QUESTION` whispers the answer to the requester. `game.chronicle.pushJournal(ID)` creates a private Chronicle journal after confirmation. Target API is Foundry 13+; an actual Foundry instance was not available for validation.
- **Obsidian:** copy the two files from `integrations/obsidian` into `.obsidian/plugins/chronicle-local`, enable it, and configure URL/key/campaign. Import commands copy party entries and approved recaps, backing up differing local files. Push sends the active note as a new private journal. Plugin keys live in local plugin data; exclude it from shared vaults. Not live-tested in Obsidian.

No official Archivist connector, hosted ChatGPT app listing, vendor OAuth integration, or third-party subscription is created by this package.

## Legacy local recording

Install `requirements-local.txt`, set `LOCAL_CAMPAIGN` and `LOCAL_SPEAKER`, then use `npm run local -- record "Session title"`. It captures mic plus playback and uses the original personal transcript/recap flow, without the dashboard’s approval workflow. It records the microphone even when Discord is muted and includes all playback on the selected device. Use headphones and verify `MIC_DEVICE`/`PLAYBACK_DEVICE`. Native Windows WASAPI loopback is the intended target; macOS needs a separate loopback device.

## Validation and sources

See `docs/VALIDATION.md` for the local tests, browser checks and untested external paths. See `FEATURES.md` for the full-replacement worklist. Source ZIPs include no credentials, recordings or seeded example campaign data.

Primary references used for interfaces:
- https://www.myarchivist.ai/documentation
- https://www.myarchivist.ai/features
- https://www.myarchivist.ai/tools/integrations
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://ts.sdk.modelcontextprotocol.io/server
- https://discordjs.guide/voice
- https://github.com/SYSTRAN/faster-whisper
- https://github.com/pyannote/pyannote-audio
- https://sbert.net/docs/package_reference/sentence_transformer/model.html
- https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/websockets_api_example.py
- https://foundryvtt.com/api/v13/
