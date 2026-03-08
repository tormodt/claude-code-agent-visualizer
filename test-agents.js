// Spawns 3 fake agents by writing JSONL to watched Claude project dirs
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const ts = Date.now();

const AGENTS = [
  {
    dir: 'C--Tormod-Git-play-ctv',
    id: `test-ctv-${ts}`,
    name: 'play-ctv',
    sequence: [
      { delay: 800,  type: 'user',      content: 'Fix the video playback bug in the CTV app' },
      { delay: 1800, type: 'assistant', tool: 'Read',      input: { file_path: 'src/components/Player.tsx' } },
      { delay: 3000, type: 'assistant', think: true },
      { delay: 5000, type: 'assistant', tool: 'Grep',      input: { query: 'videoElement', pattern: '**/*.tsx' } },
      { delay: 6500, type: 'assistant', tool: 'Edit',      input: { file_path: 'src/components/Player.tsx' } },
      { delay: 8000, type: 'assistant', tool: 'Bash',      input: { description: 'Run tests', command: 'npm test' } },
      { delay: 10000, type: 'assistant', text: 'Fixed the autoplay policy issue. The video now starts correctly.' },
    ]
  },
  {
    dir: 'C--Tormod-Git-sumo-web-app',
    id: `test-web-${ts}`,
    name: 'sumo-web-app',
    sequence: [
      { delay: 1200,  type: 'user',      content: 'Update the hero banner component' },
      { delay: 2200,  type: 'assistant', tool: 'WebSearch', input: { query: 'CSS aspect-ratio hero banner' } },
      { delay: 3800,  type: 'assistant', tool: 'Read',      input: { file_path: 'src/components/HeroBanner.tsx' } },
      { delay: 5200,  type: 'assistant', think: true },
      { delay: 7000,  type: 'assistant', tool: 'Edit',      input: { file_path: 'src/components/HeroBanner.tsx' } },
      { delay: 9500,  type: 'assistant', tool: 'Write',     input: { file_path: 'src/components/HeroBanner.module.css' } },
      { delay: 11500, type: 'assistant', text: 'Updated the hero banner with responsive aspect-ratio and improved spacing.' },
    ]
  },
  // Agent 3 spawns a sub-agent to test the group table
  {
    dir: 'C--Tormod-Git',
    id: `test-git-${ts}`,
    name: 'Git',
    sequence: [
      { delay: 500,  type: 'user',      content: 'Refactor the auth module across all apps' },
      { delay: 1500, type: 'assistant', think: true },
      { delay: 3200, type: 'assistant', tool: 'Agent', input: { description: 'Search all repos for auth-related files', subagent_type: 'general' } },
      { delay: 5000, type: 'assistant', tool: 'Bash',  input: { description: 'Run git status', command: 'git status' } },
      { delay: 7500, type: 'assistant', tool: 'Read',  input: { file_path: 'play-android/src/auth/AuthManager.kt' } },
      { delay: 9000, type: 'assistant', text: 'Delegated search to sub-agent. Reviewing Android auth implementation.' },
    ]
  },
  // Sub-agent spawned by agent 3 — same dir, appears shortly after → goes to group table
  {
    dir: 'C--Tormod-Git',
    id: `test-git-sub-${ts}`,
    name: 'Git',
    sequence: [
      { delay: 3800, type: 'user',      content: 'Search all repos for auth-related files' },
      { delay: 5000, type: 'assistant', tool: 'Glob',  input: { pattern: '**/auth/**/*.{kt,swift,ts}' } },
      { delay: 6500, type: 'assistant', tool: 'Grep',  input: { query: 'AuthManager', pattern: '**/*.kt' } },
      { delay: 8000, type: 'assistant', tool: 'Grep',  input: { query: 'AuthService',  pattern: '**/*.ts' } },
      { delay: 9500, type: 'assistant', think: true },
      { delay: 11000, type: 'assistant', text: 'Found 12 auth-related files across 4 repos. Reporting back.' },
    ]
  },
];

function makeEntry(sessionId, event) {
  const base = {
    type: event.type,
    sessionId,
    cwd: 'C:\\Tormod\\Git',
    uuid: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString(),
  };

  if (event.type === 'user') {
    base.message = { role: 'user', content: [{ type: 'text', text: event.content }] };
  } else if (event.type === 'assistant') {
    let content = [];
    if (event.think) {
      content = [{ type: 'thinking', thinking: 'Let me think about this carefully...' }];
    } else if (event.tool) {
      content = [{ type: 'tool_use', id: 'tool_' + Math.random().toString(36).slice(2), name: event.tool, input: event.input || {} }];
    } else if (event.text) {
      content = [{ type: 'text', text: event.text }];
    }
    base.message = { role: 'assistant', content };
  }

  return JSON.stringify(base) + '\n';
}

function ensureDir(dirName) {
  const p = path.join(CLAUDE_DIR, dirName);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

// Write each agent's events on a schedule
for (const agent of AGENTS) {
  const dir = ensureDir(agent.dir);
  const file = path.join(dir, `${agent.id}.jsonl`);

  // Create file immediately so server starts watching it
  fs.writeFileSync(file, '');
  console.log(`Created ${agent.id}.jsonl in ${agent.dir}`);

  for (const step of agent.sequence) {
    setTimeout(() => {
      const line = makeEntry(agent.id, step);
      fs.appendFileSync(file, line);
    }, step.delay);
  }
}

console.log('\nAgents spawned. Watch http://localhost:3334\n');
// Keep process alive until all events have fired
const maxDelay = Math.max(...AGENTS.flatMap(a => a.sequence.map(s => s.delay)));
setTimeout(() => { console.log('All events sent.'); process.exit(0); }, maxDelay + 2000);
