# Chronicle: vision, goals and development handoff

Written November 2, 2026, for another developer or AI assistant to continue the existing project. This document records Jonathan's stated goals and the build's actual limitations. Roadmap items below are proposed work, not shipped features.

## 1. The intended product

Jonathan wants a Discord bot that does the campaign-archiving work he associates with Archivist: capture game sessions, produce useful transcripts and recaps, maintain a growing campaign reference, and answer questions accurately across sessions. The aim is broad functional coverage through an independent implementation. No proprietary Archivist source code or private internals were obtained. Public descriptions and the included feature checklist are not enough to prove complete equivalence.

The desired experience is simple: launch Chronicle on the host PC, join the group's Discord channel, start a session, and let the bot capture opted-in participants while the group plays. Afterward, review the transcript and proposed changes, correct mistakes, and approve campaign facts. Later, ask natural questions about events, people, places, possessions, promises and unresolved quests, with evidence pointing back to the session.

The system should reduce manual note-taking substantially. Plausible prose is not success if important facts are missing, speakers are confused, or the AI invents events.

## 2. User preferences and decisions already made

| Topic | Stated preference / decision |
| --- | --- |
| Host | Jonathan's own PC; GPU is an NVIDIA RTX 5080. Do not assume CPU, RAM, available VRAM, driver versions or free disk space without checking. |
| Audio source | Discord bot preferred over simply joining voice with the desktop app. Separate Discord user streams are valuable. |
| Quality | Accuracy takes priority over speed or choosing a model merely because it is easy to integrate. No invented accuracy percentages or promises that AI beats a careful human. |
| AI access | Existing ChatGPT/Codex login preferred; no separate OpenAI API key required for the current bridge. Jonathan wants a launch flow that guides sign-in when needed. That flow is not implemented. |
| Local versus cloud | Recording, transcription and storage are local. Current Codex inference sends supplied transcript/context text to OpenAI. A local CLI does not mean its model runs on the RTX 5080. |
| Memory | Durable campaign records that survive questions and restarts. Do not depend on a chat session, prompt cache, model memory or a single endless conversation. |
| Development help | Claude should be able to inspect this ZIP and help implement the remaining work. This is not a request to switch the runtime AI to Claude. |
| Model choice | Whisper and Codex are current implementation choices, not proven winners. Evaluate alternatives against actual campaign audio and questions. |
| Completion claims | Be explicit about missing features and untested behavior. Prior descriptions overstated readiness; do not repeat that mistake. |

## 3. Scope to preserve

The broader vision includes recording and imports; transcripts with speaker labels; session review and approval; recaps; a compendium for PCs, NPCs, locations, items and factions; quests and timeline events; aliases and wiki links; private/shared journals; revision history; campaign Q&A; character development; relationship maps; participation reports; highlights, handouts and artwork; exports and backups; and optional integrations.

FEATURES.md is the detailed coverage checklist. Some commercial-style features, such as hosted public profiles, a discovery directory, marketplace listings and billing, are absent. Keep those gaps visible, but resolve the accuracy and memory problems before expanding peripheral product surfaces. Do not silently redefine “everything” as only the recording prototype.

## 4. What exists now

The project has real code for the Discord recorder, local transcription worker, SQLite archive, dashboard, review/approval flow, campaign entities, journals and permissions, basic Q&A retrieval, exports, MCP transport and optional integration adapters. Existing local checks cover portions of those paths. The last automated Node run passed 48 tests. Several AI/model/integration responses in those tests are mocked.

No actual Discord call, speech-model inference, Codex account inference or RTX 5080 run has been completed in the build environment. Optional embeddings, mixed-file diarization, ComfyUI, SMTP, Foundry and Obsidian require configuration and live validation. See docs/VALIDATION.md for the exact evidence. A module's presence does not establish its output quality or compatibility.

## 5. Architecture and source map

| Area | Main files | Current role |
| --- | --- | --- |
| Discord | src/bot.js, src/bot-archive.js, src/commands.js | Commands, campaign access, recording control and campaign workflows |
| Voice capture | src/audio.js | Opt-in per-user Discord streams, decoding, buffered WAV submission |
| Audio queue | src/processor.js | Persisted audio jobs, transcription, retry/failure handling and optional retention |
| Speech worker | src/whisper.js, scripts/whisper_worker.py | Persistent Python Faster-Whisper worker over newline-delimited JSON |
| Durable storage | src/store.js, src/archive.js | SQLite sessions, transcript chunks, campaign records, permissions, chat and revisions |
| Campaign processing | src/engine.js | Extraction, review, approval, Q&A and generated artifacts |
| AI bridge | src/codex.js, src/process.js | Noninteractive codex exec, isolated temporary working directory, bounded requests |
| Optional search | src/search.js, scripts/embed.py | Local embeddings, stored vectors and permission-filtered retrieval |
| Dashboard | src/dashboard.js, src/host.js, web/ | Local HTTP interface and browser UI |
| Other paths | src/local.js, src/mcp.js, integrations/ | Legacy local recorder/CLI, MCP and application adapters |

Node.js 24+ and Python 3.12 are documented setup targets. Local data is under DATA_DIR, normally ./data; the database is chronicle.sqlite. Back up the complete data directory while the application is stopped. Dependencies, models and user data are not bundled in this source ZIP.

## 6. Recording and speaker behavior

The recorder subscribes to each opted-in Discord user separately. It buffers decoded audio and writes chunks on silence or about 30 seconds of continuous decoded audio. The silence threshold is approximately 1.2 seconds. A persistent worker transcribes queued files while recording continues; stopping a session waits for queued transcription before extraction.

Raw audio is deleted after successful transcription unless retainAudio is enabled in campaign settings. Failed chunks are kept for retry. Enable retention before quality evaluation so the transcript can be checked against its source. The build retains chunks, not one guaranteed continuous merged master recording. Review short-chunk discard rules, timing and reconnect behavior before claiming lossless capture.

Discord identity answers “which account spoke?” It does not answer “which NPC was the DM portraying?” A changed accent is not a reliable identity label. /character can set the next speaking-turn label, and transcripts can be corrected manually; automatic NPC attribution and reusable voice-profile matching are absent. Keep actual speaker identity separate from inferred fictional identity in any future design. Mark uncertain attributions and make them editable.

Separate user streams allow overlapping participants to be processed independently. Multiple humans on one microphone, echo and mixed-file uploads remain different problems. Optional diarization clusters voices and requires human mapping; it is not evidence that overlapping speech is successfully separated or that an NPC has been identified.

## 7. Speech-to-text: current choice and evaluation goal

The latest defaults are full Whisper large-v3, CUDA, float16, English language selection and beam size 5. The Python requirements constrain CTranslate2 to >=4.6.3,<5 for CUDA 12.8 support. The diagnostic checks CUDA visibility and precision support, not successful model inference. Existing .env files require explicit updates; a new ZIP does not overwrite them.

Whisper was originally selected for local operation, no per-minute API bill, and straightforward integration. The initial base.en/CPU default was replaced after Jonathan clarified his hardware and accuracy requirement. Neither default was chosen from a head-to-head evaluation on his group.

Candidate evaluations discussed include NVIDIA Parakeet, NVIDIA Canary and Microsoft VibeVoice-ASR. These are research candidates, not implemented backends or guaranteed improvements. Verify current official installation, licensing, hardware requirements and model behavior before integrating them. Do not assume a larger model or higher beam size is always more accurate on this task.

Proposed acceptance: use the same consented 10–15 minute group recording for every candidate, with a manually corrected reference. Include invented names, numbers, negation, accents, jokes, quiet speech, interruptions and simultaneous dialogue. Report word errors alongside missed events, name/number errors and meaning-changing errors. Record processing time, backlog and resource use on the actual PC. Choose a default from the results. A polished recap is not a transcription benchmark.

## 8. Memory: what it means and the unfinished work

The database is the source of durable memory. The model sees a selected context for each request. Asking more questions does not evict old campaign records from disk. Persistence, retrieval quality and the model's context limit are separate concerns.

Current main Q&A is in Engine.ask. It ranks accessible entries with keyword matching, obtains transcript matches from Store.search, optionally adds embedding results, and includes selected approved recaps. The main Discord /ask and dashboard use this path. The legacy local CLI has a separate Codex.ask path; inspect both when changing behavior.

Important current limits:

- Main Q&A selects at most 20 entries, 24 transcript excerpts and 10 recaps, with individual text caps. Store.search uses substring scoring, not a comprehensive linguistic search, and can return zero-score filler.
- Transcript search is capped before some approved-session filtering; investigate whether irrelevant or ineligible matches can crowd out useful older evidence.
- Optional semantic search is disabled by default. It needs real model setup and indexing; current tests do not establish its retrieval accuracy.
- The last three question/answer pairs for the same member and campaign are supplied as conversational history. Older exchanges are stored but not automatically read. Chat history can be explicitly cleared.
- There is no iterative AI-guided search loop that asks for more evidence when the initial retrieval is insufficient.
- A correction in chat does not automatically update approved campaign facts. Answers are not campaign canon just because they were saved in chat.
- Some prompts use raw string slicing of serialized context. This can omit important material and can cut through a serialized structure.
- Extraction processes roughly 18,000-character transcript groups independently. Later groups do not receive a running ledger of earlier decisions or resolved references.
- Speech chunks receive a glossary, not a robust neighboring-chunk context mechanism.

Proposed work: unify retrieval behavior; resolve aliases and follow-up references; combine lexical and semantic evidence; fetch neighboring passages; support bounded additional searches; make context selection explicit and structured; preserve provenance through compression; keep transcript originals; surface incomplete evidence. Recheck access permissions for every retrieval and reused conversational context. Avoid carrying inaccessible evidence forward after membership or visibility changes. Treat these as requirements to implement and validate, not capabilities already present.

Use tests spanning many sessions: an old promise outside the recent recap window; sword/blade synonyms; renamed NPC aliases; a fact contradicted later; a correction to a transcription; a follow-up such as “and who did he give it to?”; an absent fact; and private evidence the questioner cannot access. Define expected evidence and answers. A sensible answer must distinguish missing retrieval from proof an event never happened.

## 9. Recommended development order

1. Establish a reproducible local launch and a real two-person Discord recording. Verify all opted-in streams, overlap, timestamps, transcription and recovery. Retain source audio during evaluation.
2. Improve campaign retrieval and follow-up handling; remove blind prompt truncation. Add meaningful long-campaign and permission regression cases.
3. Preserve cross-chunk context during transcription/extraction, while avoiding duplicate events and misleading carryover. Store source links and a reviewable record of unresolved references.
4. Benchmark speech engines on the actual group and RTX 5080. Make backend selection explicit if multiple engines are supported.
5. Add a startup status/sign-in flow that checks Codex availability and authentication and explains what remains local versus sent to a service. Do not assume an API key or silently change the user's billing/authentication choice.
6. Improve DM/NPC attribution with explicit identities and review before trusting automatic guesses. Then complete the remaining feature/workflow gaps in FEATURES.md and validate requested integrations.

This order is a recommendation from the handoff, not a claim that all stages are already authorized for unattended external actions. Follow Jonathan's next instructions. Routine local development should proceed without repeated confirmation; ask only for genuinely missing decisions or required account actions.

## 10. Definition of a usable milestone

- A real session passes recording, local transcription, review, approval and evidence-backed Q&A on Jonathan's machine.
- Speech quality has a measured report on representative audio; no unsupported percentage or human-level claim.
- Important old facts remain retrievable across a long campaign, including aliases and follow-up questions.
- Requests fit context budgets through deliberate selection/compression; omitted evidence is visible rather than silently sliced away.
- Transcription errors and mistaken character attribution can be corrected without losing source provenance.
- A process restart preserves saved work; backups and retained-audio behavior are verified.
- Player questions, history, search, exports and integrations respect current campaign and journal access.
- Missing evidence produces an honest uncertainty response. Factual mode does not invent quotes, loot or events or import published-adventure spoilers. Creative suggestions remain clearly labelled.
- Installation and sign-in instructions match actual behavior. Live checks and simulated tests are reported separately.

Full Archivist parity is a separate milestone requiring a verified feature inventory and real comparisons. Never label this ZIP “complete” solely because the checklist is long or the automated suite passes.

## 11. How to continue and report work

Read the source and existing tests before redesigning. Preserve working functionality and database compatibility; back up user data before migrations. Keep credentials in local configuration. Maintain opt-in recording, review before canon changes, and clear separation of campaign access. Avoid sending private audio/text to a new provider without making the change explicit.

For every meaningful change, explain the resulting behavior, run appropriate tests, and update the feature/validation documents. Record what remains blocked by credentials, missing audio samples or unavailable hardware. Do not substitute mock responses for an end-to-end claim. Keep the next handoff accurate enough that another developer can continue without this conversation.
