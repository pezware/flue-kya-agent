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

  function render(messages, error) {
    const log = $('log');
    log.innerHTML = '';
    if (!messages.length && !error) { log.innerHTML = '<p class="empty">No messages yet.</p>'; return; }
    for (const m of messages) {
      const text = (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join('');
      if (!text) continue;
      const div = document.createElement('div');
      div.className = 'msg ' + m.role;
      div.innerHTML = '<div class="who"></div><div class="body"></div>';
      div.querySelector('.who').textContent = m.role;
      div.querySelector('.body').textContent = text;
      log.appendChild(div);
    }
    if (error) {
      const div = document.createElement('div');
      div.className = 'msg error';
      div.textContent = error;
      log.appendChild(div);
    }
  }

  async function poll(deadlineMs) {
    const started = Date.now();
    while (Date.now() - started < deadlineMs) {
      await new Promise(r => setTimeout(r, 1200));
      const r = await call('/agents/kya/' + conversation);
      if (!r.ok) continue;
      const d = await r.json();
      const failed = (d.settlements || []).find(s => s.outcome === 'failed');
      render(d.messages || [], failed && failed.error ? failed.error.message : '');
      const settled = (d.settlements || []).some(s => s.outcome === 'completed' || s.outcome === 'failed');
      if (settled) return;
    }
    render([], 'Timed out waiting for the agent.');
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
        render([], r.status === 401
          ? 'Submit refused (401). Check the API token above.'
          : 'Submit failed (' + r.status + ')');
        return;
      }
      $('message').value = '';
      await poll(90000);
    } finally { $('send').disabled = false; }
  };

  refreshWallet();
})();
</script>
</body>
</html>`;
