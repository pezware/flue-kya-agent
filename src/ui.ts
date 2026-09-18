// The operator console: one page, served by the Worker itself.
//
// It is deliberately dependency-free and inlined. A Worker cannot serve a
// bundled asset without an assets binding, and this page is small enough that
// adding one would cost more than it saves.
//
// The page itself is NOT gated — it carries no secret. The token the operator
// types goes to sessionStorage and rides on every API call, and each of those
// calls is gated. So an unauthorised visitor gets an empty shell and nothing
// else.

export const CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>KYA agent console</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa; --fg: #1a1a18; --muted: #6b6b66;
    --line: #e2e2dd; --card: #ffffff; --accent: #3b5bdb; --bad: #b02a2a; --good: #1f7a4d;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17171a; --fg: #e8e8e4; --muted: #9a9a94;
      --line: #2e2e33; --card: #1f1f23; --accent: #8aa2ff; --bad: #ff8a8a; --good: #6ee7a8;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, sans-serif;
    padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom));
  }
  main { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 12px; margin: 0 0 18px; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; margin-bottom: 14px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin: 0 0 10px; font-weight: 600; }
  label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
  input, textarea, button {
    font: inherit; border-radius: 7px; border: 1px solid var(--line);
    background: var(--bg); color: var(--fg); padding: 8px 10px; width: 100%;
  }
  textarea { resize: vertical; min-height: 64px; }
  button { background: var(--accent); color: #fff; border-color: transparent; cursor: pointer; font-weight: 500; width: auto; padding: 8px 16px; }
  button:disabled { opacity: 0.5; cursor: default; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
  .row > * { flex: 1 1 200px; }
  .row > button { flex: 0 0 auto; }
  .pill { display: inline-block; font-size: 12px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
  .pill.good { color: var(--good); border-color: currentColor; }
  .pill.bad { color: var(--bad); border-color: currentColor; }
  #log { display: flex; flex-direction: column; gap: 10px; }
  .msg { padding: 9px 12px; border-radius: 9px; border: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere; }
  .msg.user { background: var(--bg); }
  .msg .who { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin-bottom: 3px; }
  .msg.error { border-color: var(--bad); color: var(--bad); }
  .msg.thinking { color: var(--muted); font-style: italic; border-style: dashed; }
  .empty { color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>KYA agent console</h1>
  <p class="sub">A Flue agent on Cloudflare Workers, with a Durable Object wallet.</p>

  <section>
    <h2>Access</h2>
    <div class="row">
      <div>
        <label for="token">API token</label>
        <input id="token" type="password" placeholder="Bearer token" autocomplete="off">
      </div>
      <button id="save">Save</button>
    </div>
  </section>

  <section>
    <h2>Wallet</h2>
    <div class="row">
      <div><span id="wallet-state" class="pill">unknown</span></div>
      <button id="refresh">Refresh</button>
      <button id="clear">Clear credential</button>
    </div>
    <div style="margin-top:10px">
      <label for="sdjwt">Install a delegation credential (SD-JWT)</label>
      <textarea id="sdjwt" placeholder="document~disclosure~" autocomplete="off"></textarea>
      <div class="row" style="margin-top:8px"><button id="install">Install</button></div>
    </div>
  </section>

  <section>
    <h2>Conversation</h2>
    <div id="log"><p class="empty">No messages yet.</p></div>
    <div style="margin-top:12px">
      <label for="message">Message</label>
      <textarea id="message" placeholder="Ask the agent something"></textarea>
      <div class="row" style="margin-top:8px">
        <button id="send">Send</button>
        <span class="pill" id="conv"></span>
      </div>
    </div>
  </section>
</main>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'kya-token';
  let conversation = 'ui-' + Math.random().toString(36).slice(2, 10);
  $('conv').textContent = conversation;

  const remembered = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };

  // The field wins over what was remembered. Reading sessionStorage alone made
  // a typed-but-unsaved token silently do nothing, which looks identical to a
  // wrong token: the field appears filled and every call still 401s.
  const token = () => ($('token').value || '').trim() || remembered();

  const remember = () => { try { sessionStorage.setItem(KEY, token()); } catch {} };

  try { $('token').value = remembered(); } catch {}
  $('token').addEventListener('change', remember);

  const call = (path, init = {}) => fetch(path, {
    ...init,
    headers: { ...(init.headers || {}), authorization: 'Bearer ' + token() },
  });

  function setWallet(text, kind) {
    const el = $('wallet-state');
    el.textContent = text;
    el.className = 'pill' + (kind ? ' ' + kind : '');
  }

  async function refreshWallet() {
    // Distinguish "you gave me no token" from "the token was refused". Both
    // produced 401 before, and the first one reads as a server problem when it
    // is really an empty field.
    if (!token()) return setWallet('no token', 'bad');
    try {
      const r = await call('/wallet');
      if (r.status === 401) return setWallet('token refused', 'bad');
      const d = await r.json();
      setWallet(d.canPresent ? 'can present' : d.reason, d.canPresent ? 'good' : 'bad');
    } catch (e) { setWallet('unreachable', 'bad'); }
  }

  // Conversation state, accumulated from the stream. Polling re-fetched the
  // whole snapshot on a fixed 1.2s cadence, so a 2.7s turn was not shown until
  // 3.6s. The stream delivers each delta as it is produced instead.
  const convo = { order: [], byId: {}, error: '', thinking: false };

  function resetConvo() {
    convo.order = []; convo.byId = {}; convo.error = ''; convo.thinking = false;
  }

  function upsert(id, role) {
    if (!convo.byId[id]) { convo.byId[id] = { role: role, text: '' }; convo.order.push(id); }
    return convo.byId[id];
  }

  function textOf(message) {
    return ((message || {}).parts || [])
      .filter(p => p.type === 'text').map(p => p.text).join('');
  }

  function line(cls, who, text) {
    const div = document.createElement('div');
    div.className = cls;
    div.innerHTML = '<div class="who"></div><div class="body"></div>';
    div.querySelector('.who').textContent = who;
    // textContent, never innerHTML: model output is untrusted text.
    div.querySelector('.body').textContent = text;
    return div;
  }

  function render() {
    const log = $('log');
    log.innerHTML = '';
    const visible = convo.order.map(id => convo.byId[id]).filter(m => m.text);
    if (!visible.length && !convo.error && !convo.thinking) {
      log.innerHTML = '<p class="empty">No messages yet.</p>';
      return;
    }
    for (const m of visible) log.appendChild(line('msg ' + m.role, m.role, m.text));
    if (convo.thinking) log.appendChild(line('msg thinking', 'assistant', 'thinking…'));
    if (convo.error) {
      const div = document.createElement('div');
      div.className = 'msg error';
      div.textContent = convo.error;
      log.appendChild(div);
    }
  }

  // Returns true when this chunk ends the turn we are waiting for.
  function applyChunk(c, submissionId) {
    if (c.type === 'conversation-reset') {
      resetConvo();
      for (const m of ((c.snapshot || {}).messages || [])) upsert(m.id, m.role).text = textOf(m);
    } else if (c.type === 'message-appended') {
      upsert(c.message.id, c.message.role).text = textOf(c.message);
    } else if (c.type === 'message-started') {
      upsert(c.messageId, 'assistant');
    } else if (c.type === 'message-delta') {
      // A reasoning model emits reasoning deltas before any answer text. Show
      // that it is working rather than leaving the pane empty, but never print
      // the reasoning itself.
      if (c.kind === 'reasoning') { convo.thinking = true; }
      else { upsert(c.messageId, 'assistant').text += (c.delta || ''); convo.thinking = false; }
    } else if (c.type === 'message-completed') {
      convo.thinking = false;
    } else if (c.type === 'submission-settled' && c.submissionId === submissionId) {
      convo.thinking = false;
      if (c.outcome !== 'completed') {
        convo.error = 'Turn ' + c.outcome
          + ((c.error && c.error.message) ? ': ' + c.error.message : '');
      }
      return true;
    }
    return false;
  }

  // One SSE frame: lines until a blank line. A line starting with ':' is the
  // server's 15s heartbeat comment and carries nothing.
  function handleFrame(frame, submissionId) {
    let name = 'message', data = '';
    // Every backslash in this file is written twice, comments included. The
    // page is one template literal, so a single backslash is consumed at build
    // time and emits a real newline into the served script, which leaves an
    // unterminated string and kills the whole script.
    for (const l of frame.split('\\n')) {
      if (!l || l.charAt(0) === ':') continue;
      if (l.indexOf('event:') === 0) name = l.slice(6).trim();
      else if (l.indexOf('data:') === 0) data += l.slice(5).replace(/^ /, '');
    }
    if (name !== 'data' || !data) return false;
    let chunks;
    try { chunks = JSON.parse(data); } catch (e) { return false; }
    let finished = false;
    for (const c of (Array.isArray(chunks) ? chunks : [chunks])) {
      if (applyChunk(c, submissionId)) finished = true;
    }
    return finished;
  }

  // EventSource cannot set an Authorization header and every route here is
  // gated, so the stream is read from fetch's body instead.
  // A stream that never produces a frame boundary must not grow without limit.
  const MAX_BUFFER = 1048576;

  async function streamTurn(offset, submissionId, timeoutMs) {
    const url = '/agents/kya/' + conversation
      + '?view=updates&offset=' + encodeURIComponent(offset) + '&live=sse';
    const ctrl = new AbortController();
    // Three different reasons to stop, and they need different messages.
    // Aborting is how a SUCCESSFUL turn ends too, so the abort flag alone
    // cannot say whether anything went wrong.
    let finished = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    try {
      const r = await call(url, { headers: { accept: 'text/event-stream' }, signal: ctrl.signal });
      if (!r.ok || !r.body) {
        convo.error = 'Stream failed (' + r.status + ')';
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        // SSE allows CRLF, CR or LF line endings. Cloudflare sends LF, but an
        // intermediary may not, and framing on LF alone against a CRLF stream
        // finds no boundary at all — the turn would simply never render.
        buffer += decoder.decode(step.value, { stream: true })
          .replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n');
        if (buffer.length > MAX_BUFFER) {
          convo.error = 'Stream sent ' + buffer.length + ' bytes with no frame boundary.';
          ctrl.abort();
          return;
        }
        let cut;
        while ((cut = buffer.indexOf('\\n\\n')) !== -1) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (handleFrame(frame, submissionId)) { finished = true; ctrl.abort(); return; }
        }
        render();
      }
      if (!finished && !convo.error) convo.error = 'The stream ended before the turn settled.';
    } catch (e) {
      if (convo.error) {
        // already explained
      } else if (timedOut) {
        convo.error = 'The agent did not answer within ' + Math.round(timeoutMs / 1000) + 's.';
      } else if (!finished) {
        convo.error = 'Stream interrupted: ' + e.message;
      }
    } finally {
      clearTimeout(timer);
      convo.thinking = false;
      render();
    }
  }

  // Save only persists the token across a reload. Calls already use whatever
  // is in the field, so forgetting to press it costs nothing.
  $('save').onclick = () => { remember(); refreshWallet(); };
  $('refresh').onclick = refreshWallet;
  $('clear').onclick = async () => {
    await call('/wallet/credential', { method: 'DELETE' });
    refreshWallet();
  };
  $('install').onclick = async () => {
    const r = await call('/wallet/credential', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sdJwt: $('sdjwt').value.trim() }),
    });
    if (r.ok) $('sdjwt').value = '';
    else setWallet('install failed (' + r.status + ')', 'bad');
    refreshWallet();
  };
  $('send').onclick = async () => {
    const body = $('message').value.trim();
    if (!body) return;
    $('send').disabled = true;
    try {
      const r = await call('/agents/kya/' + conversation, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'user', body }),
      });
      if (!r.ok) {
        convo.error = r.status === 401
          ? 'Submit refused (401). Check the API token above.'
          : 'Submit failed (' + r.status + ')';
        render();
        return;
      }
      // The admission carries the offset recorded just before this submission,
      // so the stream replays this turn from its own start with no gap.
      const admission = await r.json();
      $('message').value = '';
      convo.error = '';
      render();
      await streamTurn(admission.offset, admission.submissionId, 120000);
    } finally { $('send').disabled = false; }
  };

  refreshWallet();
})();
</script>
</body>
</html>`;
