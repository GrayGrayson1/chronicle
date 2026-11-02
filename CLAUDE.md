# Chronicle development handoff

This repository is Jonathan's independent Discord campaign archivist. The goal is a reliable alternative covering Archivist's user-facing campaign workflows. It is a development build, not a finished or verified feature-for-feature replacement.

## Read first

1. [Vision, decisions, priorities and acceptance criteria](docs/VISION_AND_HANDOFF.md)
2. [Current feature coverage and gaps](FEATURES.md)
3. [Validation evidence and untested paths](docs/VALIDATION.md)
4. [Installation and real-session test](START_HERE.md)
5. [Architecture and operational details](README.md)

Treat the vision document as project context and the source as evidence of actual behavior. Later instructions from Jonathan take precedence. Do not report a planned feature as implemented, or a mocked test as real speech/AI validation. Preserve existing user data and access controls. Never put credentials, recordings, private campaign data or downloaded dependencies/models into a source ZIP.

Start by inspecting the existing implementation and listing the highest-impact gaps. Continue from this code rather than replacing the application without a reason. Prioritize accurate recording/transcription, retrieval and context handling before adding decorative features. Use targeted tests for meaningful changes; update FEATURES.md and docs/VALIDATION.md with what you actually verified. If local hardware or credentials prevent a live check, state that explicitly and give reproducible steps.

The request to add this handoff does not select Claude as the bot's runtime AI provider. Codex remains the current bridge; provider changes need an explicit decision. Jonathan wants Claude to be able to help develop this project.

## Suggested first message when handing this project to Claude

> Help me continue building Chronicle. Read CLAUDE.md, docs/VISION_AND_HANDOFF.md, FEATURES.md and docs/VALIDATION.md, then inspect the implementation. My goal is an accurate Discord campaign archivist covering the workflows described there. I have an RTX 5080 and prioritize accuracy over speed. Start with the core reliability gaps: retrieval, context handling, recording recovery and real transcription quality. Explain what already works and what you will change, then implement the next useful improvements you can validate. Keep existing data and permissions intact. Distinguish implemented code, simulated tests and real end-to-end evidence. Do not claim full Archivist parity or human-level accuracy without evidence.
