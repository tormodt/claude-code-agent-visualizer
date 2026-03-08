const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3334;
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');

const clients = new Set();
const filePositions = new Map();
const initialStates = new Map(); // sessionId -> last known event

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}

function parseEntry(line) {
  try { return JSON.parse(line.trim()); } catch { return null; }
}

function projectLabel(dir) {
  // C--Tormod-Git-play-android -> play-android
  // C--Tormod-Git -> Git
  const m = dir.match(/C--Tormod-Git-(.+)$/);
  if (m) return m[1];
  if (dir === 'C--Tormod-Git') return 'Git';
  const parts = dir.split('-');
  return parts[parts.length - 1] || dir;
}

function entryToEvent(entry, projectDir) {
  if (!entry?.sessionId || !entry.type) return null;

  let action = null;
  let detail = '';

  if (entry.type === 'user') {
    const content = entry.message?.content;
    const text = Array.isArray(content)
      ? content.find(b => b?.type === 'text')?.text
      : (typeof content === 'string' ? content : null);
    action = 'receiving';
    detail = (text || 'User input').substring(0, 50);
  } else if (entry.type === 'assistant') {
    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) return null;

    for (const block of blocks) {
      if (!block) continue;
      if (block.type === 'thinking') {
        action = 'thinking'; detail = 'Thinking...'; break;
      }
      if (block.type === 'tool_use') {
        const n = block.name || '';
        if (['Read', 'Glob', 'Grep'].includes(n)) {
          action = 'reading';
          detail = `${n}: ${block.input?.pattern || block.input?.file_path || block.input?.query || ''}`.substring(0, 50);
        } else if (['Write', 'Edit', 'NotebookEdit'].includes(n)) {
          action = 'typing';
          detail = `${n}: ${block.input?.file_path || block.input?.path || ''}`.substring(0, 50);
        } else if (n === 'Bash') {
          action = 'terminal';
          detail = (block.input?.description || block.input?.command || 'Running...').substring(0, 50);
        } else if (['WebSearch', 'WebFetch'].includes(n)) {
          action = 'browsing';
          detail = (block.input?.query || block.input?.url || '').substring(0, 50);
        } else if (n === 'Agent') {
          action = 'spawning';
          detail = (block.input?.description || 'Spawning agent...').substring(0, 50);
        } else if (n === 'ToolSearch') {
          action = 'searching';
          detail = `Loading tool: ${block.input?.query || ''}`.substring(0, 50);
        } else {
          action = 'tool';
          detail = n;
        }
        break;
      }
      if (block.type === 'text' && block.text) {
        action = 'responding';
        detail = block.text.substring(0, 50);
        break;
      }
    }
  }

  if (!action) return null;

  return {
    sessionId: entry.sessionId,
    projectDir: projectLabel(projectDir),
    action,
    detail,
    timestamp: entry.timestamp,
  };
}

function readNewLines(filePath, projectDir) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return; }

  const pos = filePositions.get(filePath) ?? stat.size;
  if (stat.size <= pos) return;

  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - pos);
    fs.readSync(fd, buf, 0, buf.length, pos);
    fs.closeSync(fd);
    filePositions.set(filePath, stat.size);

    buf.toString('utf8').split('\n').forEach(line => {
      if (!line.trim()) return;
      const entry = parseEntry(line);
      const event = entry && entryToEvent(entry, projectDir);
      if (event) {
        initialStates.set(event.sessionId, event);
        broadcast(event);
      }
    });
  } catch (e) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function watchFile(filePath, projectDir, fromStart = false) {
  if (filePositions.has(filePath)) return;
  try {
    const stat = fs.statSync(filePath);
    filePositions.set(filePath, fromStart ? 0 : stat.size); // fromStart: read all existing lines too
    fs.watchFile(filePath, { interval: 300 }, () => readNewLines(filePath, projectDir));
    console.log(`  watching ${path.basename(filePath).substring(0, 36)}... [${projectLabel(projectDir)}]`);
    if (fromStart && stat.size > 0) readNewLines(filePath, projectDir);
  } catch {}
}

function loadInitialState(filePath, projectDir) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    // Walk backwards to find the last meaningful event per session
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = parseEntry(lines[i]);
      const event = entry && entryToEvent(entry, projectDir);
      if (event && !initialStates.has(event.sessionId)) {
        initialStates.set(event.sessionId, event);
        break;
      }
    }
  } catch {}
}

function watchProjects() {
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.log(`Claude dir not found: ${CLAUDE_DIR}`);
    return;
  }

  let dirs;
  try {
    dirs = fs.readdirSync(CLAUDE_DIR).filter(d => {
      try { return fs.statSync(path.join(CLAUDE_DIR, d)).isDirectory(); } catch { return false; }
    });
  } catch { return; }

  console.log(`Watching ${dirs.length} project directories...`);

  for (const dir of dirs) {
    const dirPath = path.join(CLAUDE_DIR, dir);

    // Watch for newly created JSONL files — read from start so fast -p sessions aren't missed
    try {
      fs.watch(dirPath, (event, filename) => {
        if (!filename?.endsWith('.jsonl')) return;
        const fp = path.join(dirPath, filename);
        if (fs.existsSync(fp)) watchFile(fp, dir, true);
      });
    } catch {}

    // Watch and load initial state from 3 most recent files
    try {
      const recent = fs.readdirSync(dirPath)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ f, m: fs.statSync(path.join(dirPath, f)).mtimeMs }))
        .sort((a, b) => b.m - a.m)
        .slice(0, 3);

      for (const { f } of recent) {
        const fp = path.join(dirPath, f);
        loadInitialState(fp, dir);
        watchFile(fp, dir);
      }
    } catch {}
  }

  // Watch for new project dirs
  try {
    fs.watch(CLAUDE_DIR, (event, dirname) => {
      if (!dirname) return;
      const dp = path.join(CLAUDE_DIR, dirname);
      try {
        if (fs.statSync(dp).isDirectory()) {
          fs.watch(dp, (ev, fn) => {
            if (!fn?.endsWith('.jsonl')) return;
            const fp = path.join(dp, fn);
            if (fs.existsSync(fp)) watchFile(fp, dirname, true);
          });
        }
      } catch {}
    });
  } catch {}
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // POST /prompt — spawn claude in the given project dir
  if (req.method === 'POST' && req.url === '/prompt') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { prompt, projectDir, apiKey } = JSON.parse(body);
        const cwd = (!projectDir || projectDir === 'Git')
          ? 'C:/Tormod/Git'
          : path.join('C:/Tormod/Git', projectDir);
        // Strip Claude Code env vars so nested sessions are allowed
        const env = { ...process.env };
        delete env.CLAUDE_CODE_ENTRYPOINT;
        delete env.CLAUDECODE;
        delete env.CLAUDE_CODE_SESSION_ID;
        if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
        const proc = spawn('claude', ['--dangerously-skip-permissions', '-p', prompt], {
          cwd, shell: true, windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env,
        });
        let errOut = '';
        proc.stderr.on('data', d => errOut += d.toString());
        proc.on('exit', (code) => {
          if (code !== 0) console.error(`[prompt] exit ${code}: ${errOut.slice(0,300)}`);
          else console.log(`[prompt] completed ok in ${projectDir||'Git'}`);
        });
        proc.on('error', (e) => console.error(`[prompt] spawn error: ${e.message}`));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, cwd }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // GET /projects — list known project labels
  if (req.method === 'GET' && req.url === '/projects') {
    try {
      const projects = fs.readdirSync(CLAUDE_DIR)
        .filter(d => { try { return fs.statSync(path.join(CLAUDE_DIR, d)).isDirectory(); } catch { return false; } })
        .map(projectLabel)
        .filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(projects));
    } catch(e) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('[]');
    }
    return;
  }

  if (req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');

    // Send current known states to new client
    for (const event of initialStates.values()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'));
});

watchProjects();

server.listen(PORT, () => {
  console.log(`\nPixel Agents running at http://localhost:${PORT}\n`);
});
