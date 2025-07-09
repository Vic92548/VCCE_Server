// TCP File System Server for VCCE
// Author: Victor Chanet
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 7071; // default port, can be overridden with env PORT

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

