# Validation record

Build: Chronicle 0.2.0, November 2, 2026.

Transcription configuration update: defaults now select full Whisper `large-v3` on CUDA/float16, with beam size 5; CTranslate2 is constrained to >=4.6.3,<5. The doctor checks CUDA device visibility and selected compute-type support without downloading or running a speech model. These changes have not been tested on an RTX 5080 or benchmarked on real speech. They do not establish human-level accuracy. See START_HERE.md for a retained-audio comparison using the actual group. Audio-chunk context handling, NPC voice attribution and long-session AI context truncation remain unresolved.

## Automated checks

The local Node test suite currently has 48 passing tests. It covers:

- Campaign separation, session access and cascading deletion.
- Speaker consent, Opus decoding and consent withdrawal.
- WAV headers, successful audio commits/deletion, failure retention, restart and shutdown queue recovery.
- Process arguments/stdin, queued job bounds, isolated Codex working directories, removal of bot credentials and context splitting.
- Private journal ACLs, player-character edit limits, revision/version conflicts and restoration.
- Member-key privilege checks, read-only share isolation and current permission filtering for semantic retrieval.
- Player-owned character facet review/approval, atomic bulk updates, and opt-in notification audience filtering.
- Citation checks, quote checks, staged review approval, atomic rollback and duplicate-approval rejection.
- HTTP authentication, cross-origin rejection, DNS-rebinding Host rejection, and player/share access restrictions.
- Full HTTP import → extraction → review → approval → player question workflow, with AI responses mocked.
- Real stdio MCP handshake/tool enumeration and scoped read/write calls to the local API.
- ZIP contents, permitted-data exports, campaign import reference remapping and rollback.
- Real PDF generation and HTML escaping.
- Mocked local-image workflow requests, explicit-delivery guards and Discord write/mention suppression.
- Participation radar formulas, transcript-duration aggregation and cached text-tone results, with model scores mocked.

`npm audit --omit=dev` reports zero known vulnerabilities at the checked dependency lockfile. This is not a comprehensive security audit.

## Browser checks

Headless Chromium was run against a temporary local server with explicitly fictional fixture data, not the user’s real campaign.

Verified desktop navigation: Overview, Sessions, Review queue, Compendium, Timeline, Quest log, Journals, Artifacts, Relationship map, Cast analysis, Ask Chronicle and Settings.

Verified interactions: saving/approving a review, creating a private journal, rendering a campaign answer, opening an entry, bulk table editing, graph layout/link controls, notification preference saving, wiki autocomplete, visual-editor/Markdown synchronization, and opening/closing navigation at a 390-pixel viewport. No browser JavaScript errors were observed in those checks; no horizontal overflow was detected. The fixture campaign is not included in the deliverable.

## Local rendering checks

The card renderer produced a real 1200×1680 PNG from a synthetic test portrait. The GIF assembler produced a 128×128 GIF from a synthetic sheet. These checks establish file output and dimensions, not image-model quality or believable animation. The PDF test establishes a parseable PDF signature and generated content; it does not validate every language/font or arbitrarily long layout.

## November 2, 2026 additions (GitHub repo, capture check, player site)

Built in a cloud workspace with Node 22.23 and **no npm dependencies installed** (package downloads were blocked there). The new tests ran with local stand-ins for `@discordjs/voice` and `prism-media` that were not committed. Run the full suite on a machine with internet access: `npm ci && npm test`.

Ran and passed:

- `test/capture.test.js` (8): one speaker's receive error doesn't stop the session and keeps audio decoded before it; automatic resubscribe while still speaking; decoder errors handled per speaker; silent speaking turns counted; error-storm cooldown with a single warning; connection errors tolerated until a burst; stats shared across pause/resume; capture summary text and SQLite storage/cascade.
- `test/merge.test.js` (4): history/progressLog appended across sessions with session tags, duplicates skipped, aliases unioned, logs capped.
- `test/publish.test.js` (4): only approved, party-visible, non-journal material is published; no transcripts by default, no Discord IDs or paths; citation timestamps kept; encryption round-trip and wrong-password rejection; refusal to publish without a passphrase; index updates; push mode commits only `site/data/*` to a local bare remote and leaves other work alone.
- `test/craig.test.js` (3): Craig file-name parsing, track selection, `--map` overrides.
- Headless Chromium against a locally served `site/` with an encrypted fictional bundle: wrong and right password, every route, search, an XSS probe (escaped, no script execution), remembered password and private note after reload, demo mode, mobile layout at 390 px with no horizontal overflow. Bundles encrypted by Node decrypted correctly in the browser.

Not run: the existing suites that import Discord/Opus/zod/pdfkit/fflate (`recording`, `core`, `archive`, `dashboard`, `exports`, `imports`, `integrations`, `mcp`, `analysis`, `local`); `scripts/import-craig.js` against a live dashboard; `/publish` and auto-publish inside the running bot; the GitHub Actions Pages deployment; a real Discord call under DAVE encryption. The engine change (extraction prompt + property merge) compiles and its merge helper is tested, but extraction quality needs real Codex runs.

## Not verified here

No real Discord login/call, speech recognition model, Codex account inference, long multi-track upload, companion-bot call, pyannote diarization, sentence-transformer model, ComfyUI generation, SMTP message, Foundry instance or Obsidian instance was exercised.

Those paths require the user’s local programs, credentials, models or destination applications. Code adapters and mocked paths are labelled separately from live verification in FEATURES.md. No real email or external Discord message was sent during validation.

## Reproduce

```powershell
npm ci
npm test
npm audit --omit=dev
```

Install the Python requirements, run `npm run doctor -- --discord`, then perform the two-person smoke test in START_HERE.md. Real setup should use a short disposable session before a game night. Keep an independent recording during initial testing.
