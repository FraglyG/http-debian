const http = require('http');
const { exec, execFile } = require('child_process');

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const val = Number(raw);
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

const API_HOST = process.env.API_HOST || '0.0.0.0';
const API_PORT = envNumber('API_PORT', 8080);
const API_TOKEN = process.env.API_TOKEN || '';
const DEFAULT_TIMEOUT = envNumber('DEFAULT_TIMEOUT', 30);
const API_MAX_BODY_BYTES = envNumber('API_MAX_BODY_BYTES', 2 * 1024 * 1024);
const API_MAX_BUFFER = envNumber('API_MAX_BUFFER', 1024 * 1024);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getAuthToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return auth.trim();
}

function isAuthorized(req) {
  if (!API_TOKEN) {
    return true;
  }
  return getAuthToken(req) === API_TOKEN;
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > API_MAX_BODY_BYTES) {
        reject(new Error('request too large'));
      }
    });

    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('invalid JSON object'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error('invalid JSON'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function executeCommand(opts) {
  const { cmd, shell, cwd, env, timeout } = opts;

  return new Promise((resolve) => {
    const msTimeout = Math.floor(timeout * 1000);
    const mergedEnv = { ...process.env, ...env };

    const callback = (error, stdout, stderr) => {
      if (error) {
        const timedOut = error.killed && error.signal === 'SIGTERM';
        if (timedOut) {
          resolve({
            statusCode: 408,
            body: {
              ok: false,
              error: 'command timed out',
              timeout,
              stdout: stdout || '',
              stderr: stderr || '',
            },
          });
          return;
        }

        resolve({
          statusCode: 200,
          body: {
            ok: false,
            exit_code: typeof error.code === 'number' ? error.code : 1,
            stdout: stdout || '',
            stderr: stderr || String(error.message || ''),
          },
        });
        return;
      }

      resolve({
        statusCode: 200,
        body: {
          ok: true,
          exit_code: 0,
          stdout: stdout || '',
          stderr: stderr || '',
        },
      });
    };

    if (shell) {
      exec(cmd, { cwd, env: mergedEnv, timeout: msTimeout, maxBuffer: API_MAX_BUFFER }, callback);
      return;
    }

    const split = cmd.trim().split(/\s+/);
    const command = split[0];
    const args = split.slice(1);

    execFile(command, args, { cwd, env: mergedEnv, timeout: msTimeout, maxBuffer: API_MAX_BUFFER }, callback);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true, status: 'healthy' });
    return;
  }

  if (req.method === 'GET' && req.url === '/env') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    sendJson(res, 200, { ok: true, env: process.env });
    return;
  }

  if (req.method === 'POST' && req.url === '/exec') {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      sendJson(res, 400, { ok: false, error: 'request body must be JSON' });
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const cmd = body.cmd;
      const shell = body.shell !== false;
      const cwd = body.cwd;
      const env = body.env || {};
      const timeout = body.timeout !== undefined ? Number(body.timeout) : DEFAULT_TIMEOUT;

      if (typeof cmd !== 'string' || !cmd.trim()) {
        sendJson(res, 400, { ok: false, error: "field 'cmd' is required and must be a non-empty string" });
        return;
      }
      if (cwd !== undefined && typeof cwd !== 'string') {
        sendJson(res, 400, { ok: false, error: "field 'cwd' must be a string" });
        return;
      }
      if (!env || typeof env !== 'object' || Array.isArray(env)) {
        sendJson(res, 400, { ok: false, error: "field 'env' must be an object" });
        return;
      }
      for (const [k, v] of Object.entries(env)) {
        if (typeof k !== 'string' || typeof v !== 'string') {
          sendJson(res, 400, { ok: false, error: 'all env keys and values must be strings' });
          return;
        }
      }
      if (!Number.isFinite(timeout) || timeout <= 0) {
        sendJson(res, 400, { ok: false, error: "field 'timeout' must be a positive number" });
        return;
      }

      const result = await executeCommand({ cmd, shell, cwd, env, timeout });
      sendJson(res, result.statusCode, result.body);
      return;
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      const statusCode = msg === 'request too large' ? 413 : 400;
      sendJson(res, statusCode, { ok: false, error: msg });
      return;
    }
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(API_PORT, () => {
  console.log(`control API listening on ${API_HOST}:${API_PORT}`);
});
