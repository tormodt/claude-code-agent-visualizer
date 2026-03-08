# Age of Agents — Claude Code Visualizer

A real-time visualizer that renders active [Claude Code](https://claude.ai/code) sessions as medieval workers building structures on a canvas (Age of Empires style).

Each Claude Code agent appears as a worker that walks to a building site, raises tools matching its current action (reading, writing, terminal, browsing, etc.), and builds up a structure as it works.

## How to start

Requires Node.js. No dependencies — runs on the standard library.

```bash
node server.js
```

Open **http://localhost:3334** in your browser.

The server watches `~/.claude/projects/` for active Claude Code session logs and streams events to the browser via SSE.

## Configuration

Two places in the source are hardcoded to the original author's system and should be updated for your setup:

**`server.js` line 28–32** — `projectLabel()` parses Claude's project directory names back into human-readable labels. The pattern `C--Tormod-Git-(.+)` reflects a Windows path `C:\Tormod\Git\...`. Update this regex to match your own base directory.

**`server.js` line 239** — The `/prompt` endpoint (used by the Deploy button in the UI) resolves project paths relative to `C:/Tormod/Git`. Update this to your own projects root.

**`index.html` line 641–647** — `PROJECT_MAP` lists projects available in the Deploy dropdown. Replace with your own project names.

## Branches / visual styles

Different branches of this repo contain alternative visual themes for the canvas:

| Branch | Style |
|--------|-------|
| `age-of-agents` | Medieval Age of Empires 4 style |

Switch branches and reload to change the look.

## Features

- Agents walk from a town center to individual building slots as they become active
- Building construction animates from foundation → scaffolding → full structure as the session progresses
- Worker tools and glow colors change based on current action (reading, writing, terminal, browsing, thinking, spawning sub-agents, etc.)
- Speech bubbles show the current task detail
- Deploy panel lets you send a prompt to Claude Code in a specific project directory (requires `ANTHROPIC_API_KEY` or enter it in the UI)
- Idle agents return to the town center after ~50 seconds of inactivity
