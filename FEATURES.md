# Full-replacement feature checklist

Target: reproduce the user-facing campaign workflow of Archivist with an independent implementation, a Discord bot, a local dashboard and the user’s Codex login. Reviewed against the public product, documentation and integrations pages on November 2, 2026. This is a worklist and evidence record, not a claim of exact parity.

Status meanings:
- **Local checks pass**: application logic or transport is covered by automated/local browser tests. AI accuracy is not implied.
- **Implemented; needs live setup**: a real code path exists, but needs credentials, local model/service configuration, or the destination application before it can be validated.
- **Partial**: useful equivalent functionality exists, with a stated gap.
- **Outstanding**: not included in this package.

## Recording and ingestion

| Capability | Current implementation | Status / remaining check |
| --- | --- | --- |
| Discord recording and per-player labels | Opt-in subscriptions, Opus decode, local WAV segments | Local codec/consent tests pass; real voice call required |
| Start / stop | `/start`, `/end`, `/session start`, `/session stop` | Implemented; needs live Discord setup |
| Pause / resume | Disconnect and continue the same session with fresh consent | Implemented; needs live Discord setup |
| Concurrent tables | Pool of separately invited companion bot identities | Implemented; multi-bot call test outstanding |
| Multiple Discord servers | Explicit configured server list and separate campaign channels | Implemented; multi-server test outstanding |
| Transcript processing while recording | Incremental local worker and `/asklive` | Implemented; real latency/accuracy not measured |
| Downloadable audio | Optional retention and authenticated chunk downloads | API implemented; retention path locally checked |
| Audio upload | Streamed local uploads, 2 GB/track; smaller Discord attachments | Implemented; long-file stress test outstanding |
| Multiple aligned speaker tracks | Per-track speaker labels and API start offsets | Implemented; real aligned recording test outstanding |
| Mixed-file speaker discovery | Optional local pyannote clusters, human name mapping | Implemented adapter; model access and real-audio check required |
| Persistent cast roster | Player/character names, aliases, Discord subject IDs | Local checks pass |
| Automatic identity matching from voice profiles | Not implemented; labels are assigned explicitly | Outstanding; use Discord identities or manual speaker mapping |
| Notes / transcripts | Paste/upload text into a new session | Local import-to-review checks pass |
| Document journals | Local PDF/DOCX/TXT/Markdown extraction | Implemented; real document samples still needed |
| Play-by-post | User-selected message ID range in the campaign channel | Implemented; Message Content and live channel required |
| Language and output tone | Campaign language, output language, detail, glossary, tone settings | Implemented; multilingual recognition/output unbenchmarked |
| Failure recovery | Preserved pending audio, retries, restart states | Local checks pass |

## Review and campaign reference

| Capability | Current implementation | Status / remaining check |
| --- | --- | --- |
| Session review | Editable recap plus cited entity/event/objective suggestions | Local API and browser checks pass |
| Approve/reject individual changes | Include/reject toggles; transactional approval | Local checks pass |
| Entity merges and suggestion splits | Canonical merge with alias/wiki repair; duplicate suggestion for manual split | Local checks pass; advanced diff UX is partial |
| Unsupported-fact/quote guard | Invalid source IDs and unverified quotes discarded | Local checks pass; not a general factual guarantee |
| Recurring entities | Existing-ID/name matching and subsequent descriptions/properties | Implemented; extraction quality requires real sessions |
| Compendium | PCs, NPCs, items, locations, factions | Local CRUD/version/access checks pass |
| Entity images | Upload, optional local generation, authenticated viewing | Upload/API implemented; generation needs ComfyUI |
| Properties and aliases | Arbitrary structured fields, aliases, tags, linked IDs | Local logic passes; uses JSON for advanced editing |
| Timeline | Ordered events with chapter/scene/step properties | Implemented: step ordering and chapter/scene reassignment; advanced root-level editor differs |
| Quests | Objectives, derived status, related properties, reviewed updates | Local checks pass; advanced merge/split drawers are simpler |
| Wiki linking | Clickable `[[name]]` links and alias resolution | Browser-rendered links and textarea autocomplete; context tagging toolbar differs |
| Journals and folders | Markdown/plain text, nested folder paths, per-user ACLs | Local permissions and browser creation checks pass |
| Rich-text editing | Switchable visual editor and Markdown with sanitized rendering | Browser editor/Markdown synchronization checked |
| Character development | Seven-theme, player-owned facet proposals with editing and explicit approval | Local ownership/append tests pass; real-model quality untested |
| Find and replace | Literal preview/apply for entries/transcripts; rules logged | Local implementation; no advanced all-surface rule editor |
| Revision history | Entry versions, restoration, canonical merge history | Local checks pass |
| Bulk table editing | Table selection, selectable columns, atomic tag/property updates | Local atomic rollback checks pass; browser interaction checked |

## Questions, analysis and outputs

| Capability | Current implementation | Status / remaining check |
| --- | --- | --- |
| Campaign questions | Approved sources, permitted journals, citations requested | Local isolation/transport/browser checks pass; real AI test needed |
| Creative suggestions | Explicitly labelled suggestion mode | Implemented; real-model behavior needs checking |
| Session questions during recording | `/asklive` over completed transcript segments | Implemented; live call required |
| Semantic retrieval | Optional local sentence-transformer vectors, permission filtering | Retrieval/filter logic tested with mocked vectors; real model needed |
| Relationship map | Draggable graph, type filter, focused entity, wiki/property edges | Browser navigation and rendering checked |
| Advanced Data Studio views | Circular/grid/network maps, type/link/session filters, focused nodes | Implemented; exact commercial layout/preset controls differ |
| Participation reports | Words, lines, turns, questions, longest segments, trends | Local metrics/rendering pass; no precision benchmark |
| Emotional-tone/radar analysis | Radar measures plus optional local text-tone scoring and AI-written insights | Metrics/cache tested with mocked scores; model validity for real sessions unverified |
| Session moments/awards/quotes | Extracted, cited, editable highlight records | Local review path passes; quality depends on real AI |
| Automatic highlight notifications | Opt-in per-member email topics and optional campaign Discord posts with expiry | Permission/opt-in logic mocked; actual SMTP/Discord delivery requires setup |
| Handouts and quest logs | AI-written artifacts, Markdown and PDF | PDF format checked; real AI writing not checked |
| Artifact collections | Collection entries with member references | Storage/view implemented; polished bundle builder is partial |
| High-resolution trading cards | Local portrait/text/stat renderer, five themes, crop controls | Renderer produced real 1200×1680 PNG in local check |
| Image generation | Standard local ComfyUI workflow | Adapter mocked locally; real checkpoint quality untested |
| Looping sprites | Portrait-based AI sheet plus 128×128 GIF assembly | Assembly checked; actual animation alignment/quality untested |
| Email delivery | Explicit per-send SMTP recipients/content confirmation | Guardrails tested; real SMTP not configured or used |
| Discord artifact delivery | Explicit posting to the campaign’s channel | Mocked authorization/mention tests; real posting untested |

## Access, sharing, data and integrations

| Capability | Current implementation | Status / remaining check |
| --- | --- | --- |
| Owners/admins/players | Role checks, scoped keys, individual character edits | Local tests pass |
| Private journal isolation | Shared filtering for UI, search, export and AI context | Local tests pass |
| Personal member access | Expiring/revocable personal keys; current role checked on each request | Local tests pass; not hosted OAuth accounts |
| Public/read-only sharing | Scoped local-host links for party entries/approved sessions | Local checks pass; host must be reachable |
| Hosted public campaign/GM profiles | No hosted directory, gallery, social profile or discovery network | Outstanding |
| Markdown/HTML/Obsidian export | ZIP with permitted text, data snapshot and available images | ZIP contents/privacy locally checked |
| Restore/copy export | JSON import with remapped references; artwork copied separately | Local rollback/remapping tests pass |
| MCP campaign tools | stdio reader/search/chat/journal/editor tools | Real local MCP transport checks pass |
| Discord MCP actions | Campaign-channel reads, pins, threads; confirmed writes/reactions/polls | Write guards mocked; live Discord API paths need testing |
| Foundry module | Import approved/party data, private Q&A, journal push | Source included; actual Foundry installation test outstanding |
| Obsidian plugin | Import with backups, private note push | Source included; actual Obsidian installation test outstanding |
| Hosted ChatGPT/Claude app listings | Local MCP configuration only | Outstanding marketplace/OAuth distribution |
| Account security/billing/gifts | Uses local keys and the user’s own services | No commercial subscription/billing/gifting service is included |

## What must happen before “does everything” is an accurate description

1. Run a real two-person Discord session through recording, transcription, review, approval and Codex Q&A. Fix defects that this reveals.
2. Configure and validate any optional models/services you want: embeddings, mixed-file diarization, ComfyUI, SMTP, Foundry and Obsidian.
3. Complete the outstanding/partial UI and workflow items above, including remaining editor/layout refinements, analysis methods and hosted publishing if those are required.
4. Compare the actual installed Archivist interfaces and outputs to this implementation. Public documentation cannot establish every private behavior, output-quality detail or undocumented feature.

The current ZIP is an expanded implementation milestone. It is **not yet a finished, verified replacement for every Archivist capability**. This checklist is deliberately retained so missing features are visible rather than hidden behind a large feature list.
