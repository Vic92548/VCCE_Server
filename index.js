// TCP File System Server for VCCE
// Author: Victor Chanet
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chat as openaiChat, hasApiKey, setApiKey as setOpenAiKey } from './openai.js';

import crypto from 'node:crypto';
// Optional dependency: ignore (npm install ignore). Falls back to simple matcher if missing.
let ig = null;
try { ig = (await import('ignore')).default(); } catch { /* ignore */ }

const PORT = 7071; // default port, can be overridden with env PORT
// File extensions considered binary; we'll avoid reading their contents.
const BINARY_EXTS = new Set([
  '.png','.jpg','.jpeg','.gif','.bmp','.webp','.svg',
  '.mp3','.wav','.ogg','.flac','.m4a','.aac',
  '.mp4','.mkv','.mov','.avi','.webm','.wmv',
  '.zip','.rar','.7z','.gz','.tar'
]);

// === AI integration state ===
const sessions = new Map(); // key: projectPath, value: { filesText, lastUsed }
const pendingPatches = new Map(); // key: patchId, value: { projectPath, diff }

/**
 * Encode a JS object as a length-prefixed JSON buffer.
 * Format: 4-byte unsigned LE length followed by UTF-8 JSON string.
 * @param {object} obj
 * @returns {Buffer}
 */
function encode(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const buf = Buffer.allocUnsafe(4 + json.length);
  buf.writeUInt32LE(json.length, 0);
  json.copy(buf, 4);
  return buf;
}

// Recursively read all files under a root directory, returning concatenated text (UTF-8).
// Limits total bytes read to avoid huge payloads.
async function readProjectFiles(root, limitBytes = 1_000_000) {
  // build ignore matcher once per call
  console.log('[AI] reading project files', root);
  let matcher = null;
  const gitignorePath = path.join(root, '.gitignore');
  try {
    const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
    if (ig) {
      matcher = ig.clone().add(gitignoreContent.split(/\r?\n/));
      console.log('[AI] .gitignore loaded with', matcher._rules.length, 'rules');
    } else {
      // very simple fallback: just store patterns literals (no globs)
      const lines = gitignoreContent.split(/\r?\n/).filter(l=>l && !l.startsWith('#'));
      matcher = { ignores:p=>lines.some(r=>p.startsWith(r)) };
      console.log('[AI] .gitignore loaded (simple) with', lines.length, 'patterns');
    }
  } catch {}

  let total = 0;
  const parts = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      console.log('[AI] processing', p);
      const rel = path.relative(root, p).replace(/\\/g,'/');
      console.log('[AI] relative', rel);
      // always ignore .git folder contents
      if (rel.startsWith('.git/')) {
        if (process.env.DEBUG_AI_FILES) console.log('[AI] skip .git', rel);
        continue;
      }
      if (matcher && matcher.ignores && matcher.ignores(rel)) {
        if (process.env.DEBUG_AI_FILES) console.log('[AI] skip', rel);
        continue;
      }
      if (ent.isDirectory()) {
        await walk(p);
      } else {
        try {
          const ext = path.extname(p).toLowerCase();
          if (BINARY_EXTS.has(ext)) {
            parts.push(`BINARY_FILE: ${rel}`);
            if (process.env.DEBUG_AI_FILES) console.log('[AI] add binary placeholder', rel);
            continue;
          }
          const content = await fs.readFile(p, 'utf8');
          total += Buffer.byteLength(content, 'utf8');
          if (total > limitBytes) return; // stop if over budget
          parts.push(`FILE: ${rel}\n\n${content}`);
          console.log('[AI] add', rel);
          if (process.env.DEBUG_AI_FILES) console.log('[AI] add', rel);
        } catch {}
      }
      if (total > limitBytes) return;
    }
  }
  await walk(root);
  return parts.join('\n\n');
}

/**
 * Process one command and return a Promise with the response data.
 * The response must follow the generic { ok, data, meta } shape.
 * @param {object} req
 */
async function handleCommand(req, socket) {
  const { cmd, args = {} } = req;
  try {
    switch (cmd) {
      case 'readFile': {
        const data = await fs.readFile(args.path, 'utf8');
        return { ok: true, data };
      }
      case 'writeFile': {
        await fs.writeFile(args.path, args.data, 'utf8');
        return { ok: true };
      }
      case 'listDir': {
        const entries = await fs.readdir(args.path ?? '.', { withFileTypes: false });
        return { ok: true, data: entries };
      }
      case 'listDirs': {
        const all = await fs.readdir(args.path ?? '.', { withFileTypes: true });
        const dirs = all.filter(d => d.isDirectory()).map(d => d.name);
        return { ok: true, data: dirs };
      }
      case 'createDir': {
        await fs.mkdir(args.path, { recursive: true });
        return { ok: true };
      }
      case 'deleteFile': {
        await fs.unlink(args.path);
        return { ok: true };
      }
      case 'deleteDir': {
        await fs.rm(args.path, { recursive: !!args.recursive, force: true });
        return { ok: true };
      }
      case 'isDir': {
        const st = await fs.stat(args.path);
        return { ok: true, data: st.isDirectory() };
      }
      case 'rename': {
        await fs.rename(args.oldPath, args.newPath);
        return { ok: true };
      }
      case 'exec': {
        // spawn command and start streaming events; respond async
        const { cwd = process.cwd(), command } = args;
        if (!command) return { ok: false, data: 'No command provided' };
        const child = spawn(command, {
          cwd,
          shell: true,
        });
        const execId = req.id; // use request id to tag events
        child.stdout.on('data', chunk => {
          socket.write(encode({ id: execId, event: 'stdout', data: chunk.toString() }));
        });
        child.stderr.on('data', chunk => {
          socket.write(encode({ id: execId, event: 'stderr', data: chunk.toString() }));
        });
        child.on('close', code => {
          socket.write(encode({ id: execId, event: 'exit', code }));
        });
        // immediate ack
        return { ok: true, started: true };
      }
      case 'aiChat': {
        const { projectPath, messages = [], newSession } = args;
        if (!projectPath) return { ok: false, data: 'projectPath is required' };
        let contextText;
        if (newSession || !sessions.has(projectPath)) {
          contextText = await readProjectFiles(projectPath);
          sessions.set(projectPath, { filesText: contextText, lastUsed: Date.now() });
        } else {
          contextText = sessions.get(projectPath).filesText;
        }
        const fullMessages = [
          { role: 'system', content: 'You are an AI assistant helping with the following project. The full codebase is provided below. Always ask for approval before applying code changes.\n\n' + contextText },
          ...messages,
        ];
        const reply = await openaiChat(fullMessages);

        // detect patch block
        let pendingPatch = null;
        const patchRegex = /```patch[\s\S]*?\n([\s\S]*?)```/;
        const m = reply.match(patchRegex);
        if (m) {
          const diffText = m[1];
          const patchId = crypto.randomUUID();
          pendingPatches.set(patchId, { projectPath, diff: diffText });
          pendingPatch = { id: patchId, diff: diffText };
        }
        return { ok: true, data: { reply, pendingPatch } };
      }
      case 'setApiKey': {
        const { key } = args;
        if (!key) return { ok: false, data: 'key is required' };
        setOpenAiKey(key);
        return { ok: true, data: { hasKey: true } };
      }
      case 'aiStatus': {
        return { ok: true, data: { hasKey: hasApiKey() } };
      }
      case 'aiApprove': {
        const { patchId, apply } = args;
        const entry = pendingPatches.get(patchId);
        if (!entry) return { ok: false, data: 'Unknown patchId' };
        if (apply) {
          // TODO: implement safe diff apply
          return { ok: false, data: 'Auto-apply not implemented yet' };
        } else {
          pendingPatches.delete(patchId);
          return { ok: true, data: 'Patch discarded' };
        }
      }
      default:
        return { ok: false, data: `Unknown command ${cmd}` };
    }
  } catch (e) {
    return { ok: false, data: e.message ?? String(e) };
  }
}

/**
 * Handle a single client socket
 * @param {net.Socket} socket
 */
function onClient(socket) {
  console.log('Client connected', socket.remoteAddress, socket.remotePort);

  let buffer = Buffer.alloc(0);

  socket.on('data', async chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    // Process as many complete frames as possible
    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) break; // wait for full frame
      const jsonBuf = buffer.slice(4, 4 + len);
      buffer = buffer.slice(4 + len);

      let req;
      try {
        req = JSON.parse(jsonBuf.toString('utf8'));
      } catch (e) {
        // Malformed JSON, close connection
        socket.end(encode({ id: null, ok: false, data: 'Invalid JSON' }));
        return;
      }

      const resp = await handleCommand(req, socket);
      resp.id = req.id;
      socket.write(encode(resp));
    }
  });

  socket.on('close', () => console.log('Client disconnected'));
  socket.on('error', err => console.error('Socket error', err));
}

const server = net.createServer(onClient);
server.listen(process.env.PORT ?? PORT, () => {
  console.log(`VCCE Server listening on port ${server.address().port}`);
});

