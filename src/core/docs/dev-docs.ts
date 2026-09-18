/**
 * The /dev-docs page.
 *
 * Rendered from the route registry on every request, so it is always exactly
 * what the server is running. Styled with the RatnaGrid deep-forest palette and
 * the same two typefaces as the app, so a frontend developer moving between the
 * product and the docs does not feel like they have left.
 */
import { allRoutes, changeFeed, pathParams, routesByModule, toJsonSchema, type RouteSpec } from '../http/route-registry.js';
import { MODULE_CATALOG } from '../../modules/tenancy/module-catalog.js';
import { ERROR_CATALOG } from './error-catalog.js';

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const METHOD_TONE: Record<string, string> = {
  get: 'get', post: 'post', put: 'put', patch: 'patch', delete: 'del',
};

const MODULE_NAMES = new Map(MODULE_CATALOG.map((m) => [m.key, m.name]));

/** Turns a JSON Schema object into a readable field table. */
function fieldRows(schema: unknown, prefix = ''): string {
  const node = schema as { type?: string; properties?: Record<string, any>; required?: string[]; items?: any };
  if (!node || node.type !== 'object' || !node.properties) return '';

  const required = new Set(node.required ?? []);
  return Object.entries(node.properties)
    .map(([name, raw]) => {
      const field = raw as Record<string, any>;
      let type = field.type ?? (field.anyOf ? 'one of' : field.enum ? 'enum' : 'any');
      if (type === 'array') type = `${field.items?.type ?? 'any'}[]`;

      const bits: string[] = [];
      if (field.enum) bits.push(`one of: ${field.enum.map((v: unknown) => `<code>${esc(v)}</code>`).join(', ')}`);
      if (field.format) bits.push(esc(field.format));
      if (field.pattern) bits.push(`matches <code>${esc(field.pattern)}</code>`);
      if (field.minLength !== undefined) bits.push(`min length ${field.minLength}`);
      if (field.maxLength !== undefined) bits.push(`max length ${field.maxLength}`);
      if (field.default !== undefined) bits.push(`default <code>${esc(JSON.stringify(field.default))}</code>`);
      if (field.description) bits.push(esc(field.description));

      const nested = field.type === 'object' && field.properties
        ? fieldRows(field, `${prefix}${name}.`)
        : field.type === 'array' && field.items?.type === 'object'
          ? fieldRows(field.items, `${prefix}${name}[].`)
          : '';

      return `<tr>
          <td class="f-name"><code>${esc(prefix)}${esc(name)}</code></td>
          <td class="f-type">${esc(type)}</td>
          <td class="f-req">${required.has(name) ? '<span class="req">required</span>' : '<span class="opt">optional</span>'}</td>
          <td class="f-note">${bits.join(' · ') || '—'}</td>
        </tr>${nested}`;
    })
    .join('');
}

function schemaBlock(title: string, schema: unknown): string {
  if (!schema) return '';
  const rows = fieldRows(schema);
  const json = `<details class="raw"><summary>Raw JSON Schema</summary><pre>${esc(JSON.stringify(schema, null, 2))}</pre></details>`;
  if (!rows) return `<div class="block"><h4>${esc(title)}</h4>${json}</div>`;
  return `<div class="block">
      <h4>${esc(title)}</h4>
      <div class="tbl-wrap"><table class="fields">
        <thead><tr><th>Field</th><th>Type</th><th></th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${json}
    </div>`;
}

function endpointCard(route: RouteSpec): string {
  const id = `${route.method}-${route.path}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const params = pathParams(route.path);

  const paramTable = params.length
    ? `<div class="block"><h4>Path parameters</h4>
       <div class="tbl-wrap"><table class="fields"><thead><tr><th>Field</th><th>Type</th><th></th><th>Notes</th></tr></thead>
       <tbody>${params.map((p) => `<tr><td class="f-name"><code>:${esc(p)}</code></td><td class="f-type">string</td><td class="f-req"><span class="req">required</span></td><td class="f-note">In the URL path</td></tr>`).join('')}</tbody>
       </table></div></div>`
    : '';

  const responses = route.responses
    .map((r) => {
      const tone = r.status < 300 ? 'ok' : r.status < 500 ? 'warn' : 'bad';
      const schema = toJsonSchema(r.schema, 'output');
      const rows = schema ? fieldRows(schema) : '';
      return `<div class="resp">
          <div class="resp-head"><span class="status ${tone}">${r.status}</span><span>${esc(r.description)}</span></div>
          ${rows ? `<div class="tbl-wrap"><table class="fields"><tbody>${rows}</tbody></table></div>` : '<p class="muted">No body.</p>'}
        </div>`;
    })
    .join('');

  return `<article class="endpoint" id="${esc(id)}" data-search="${esc((route.method + ' ' + route.path + ' ' + route.summary).toLowerCase())}">
    <header class="ep-head" role="button" tabindex="0" aria-expanded="false">
      <span class="method ${METHOD_TONE[route.method]}">${route.method.toUpperCase()}</span>
      <code class="ep-path">${esc(route.path)}</code>
      <span class="ep-summary">${esc(route.summary)}</span>
      ${route.deprecated ? '<span class="pill dep">deprecated</span>' : ''}
      ${route.auth === false ? '<span class="pill open">public</span>' : ''}
      <span class="chev" aria-hidden="true">▾</span>
    </header>
    <div class="ep-body">
      ${route.description ? `<p class="ep-desc">${esc(route.description)}</p>` : ''}
      ${route.deprecated ? `<div class="callout warn"><strong>Deprecated since ${esc(route.deprecated.since)}.</strong> ${route.deprecated.useInstead ? `Use <code>${esc(route.deprecated.useInstead)}</code> instead.` : ''} ${esc(route.deprecated.note ?? '')}</div>` : ''}
      <dl class="meta">
        <div><dt>Auth</dt><dd>${route.auth === false ? 'None' : 'Bearer token'}</dd></div>
        <div><dt>Permission</dt><dd>${route.permission ? `<code>${esc(route.permission)}</code>` : '—'}</dd></div>
        <div><dt>Module</dt><dd>${esc(MODULE_NAMES.get(route.module) ?? route.module)}</dd></div>
      </dl>
      ${paramTable}
      ${schemaBlock('Query parameters', toJsonSchema(route.query))}
      ${schemaBlock('Request body', toJsonSchema(route.body))}
      <div class="block"><h4>Responses</h4>${responses}</div>
      ${route.changelog?.length ? `<div class="block"><h4>History</h4><ul class="hist">${route.changelog.map((c) => `<li><span class="kind ${esc(c.kind)}">${esc(c.kind)}</span><time>${esc(c.date)}</time> ${esc(c.note)}</li>`).join('')}</ul></div>` : ''}
    </div>
  </article>`;
}

export function renderDevDocs(options: { version: string; baseUrl: string }): string {
  const grouped = routesByModule();
  const feed = changeFeed(25);
  const total = allRoutes().length;

  const ordered = [...grouped.entries()].sort((a, b) => {
    const ai = MODULE_CATALOG.findIndex((m) => m.key === a[0]);
    const bi = MODULE_CATALOG.findIndex((m) => m.key === b[0]);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  const nav = ordered
    .map(([key, list]) => `<a href="#mod-${esc(key)}"><span>${esc(MODULE_NAMES.get(key) ?? key)}</span><em>${list.length}</em></a>`)
    .join('');

  const sections = ordered
    .map(([key, list]) => `<section class="module" id="mod-${esc(key)}">
        <h2>${esc(MODULE_NAMES.get(key) ?? key)}</h2>
        <p class="mod-desc">${esc(MODULE_CATALOG.find((m) => m.key === key)?.description ?? '')}</p>
        ${list.map(endpointCard).join('')}
      </section>`)
    .join('');

  const changes = feed.length
    ? feed.map((c) => `<li>
          <time>${esc(c.date)}</time>
          <span class="kind ${esc(c.kind)}">${esc(c.kind)}</span>
          <code class="mono-sm">${esc(c.method.toUpperCase())} ${esc(c.path)}</code>
          <span>${esc(c.note)}</span>
        </li>`).join('')
    : '<li class="muted">No changes recorded yet.</li>';

  const errors = ERROR_CATALOG.map((e) => `<tr>
      <td><code>${esc(e.code)}</code></td>
      <td class="num">${e.status}</td>
      <td>${esc(e.meaning)}</td>
      <td>${e.frontendAction.replace(/`([^`]+)`/g, (_, m) => `<code>${esc(m)}</code>`)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en" data-theme="deep-forest">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RatnaGrid API — Developer Docs</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23C79B3B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polygon points='6 3 18 3 22 9 12 22 2 9 6 3'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --gold:#c79b3b; --gold-dark:#865800; --gold-ink:#714a00; --gold-surface:#fdf9ef; --gold-border:#c79b3b40;
  --forest:#0d3b2f; --forest-dark:#061c16; --forest-light:#165646; --forest-surface:#eaf2ee;
  --canvas:#f7f8f4; --card:#fff; --card-elevated:#fff;
  --ink:#142019; --ink-secondary:#3b4b42; --ink-muted:#596a60; --ink-faint:#99aba1;
  --border:#e3e8e4; --border-subtle:#edf1ee; --border-strong:#c8d2cb;
  --success:#1a7f4b; --success-bg:#e8f5ee;
  --danger:#b4232f; --danger-bg:#fdf0f1;
  --info:#1b5e8a; --info-bg:#eef6fc;
  --warn:#8a6512; --warn-bg:#fdf6e6;
  --f-head:'Outfit',system-ui,sans-serif;
  --f-body:'Plus Jakarta Sans',system-ui,sans-serif;
  --f-mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  --radius:10px;
}
@media (prefers-color-scheme:dark){
  :root:not([data-force-light]){
    --canvas:#0d0f12; --card:#15181e; --card-elevated:#1d212a;
    --ink:#f0f4f8; --ink-secondary:#c5d0dc; --ink-muted:#8899a8; --ink-faint:#68788a;
    --border:#2b323d; --border-subtle:#202630; --border-strong:#566170;
    --forest-surface:#22262e; --gold-surface:#292418; --gold-ink:#ffe5a6; --gold-dark:#f5d588;
    --success-bg:#12251a; --danger-bg:#2a1518; --info-bg:#101f2b; --warn-bg:#251e10;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--f-body);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
code{font-family:var(--f-mono);font-size:.86em}
.mono-sm{font-size:.78rem}
.muted{color:var(--ink-muted)}
.num{font-variant-numeric:tabular-nums}

/* header */
header.top{background:linear-gradient(135deg,var(--forest-dark),var(--forest));color:#fff;padding:34px 28px 26px;border-bottom:3px solid var(--gold)}
.top-in{max-width:1180px;margin:0 auto}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.brand svg{width:26px;height:26px}
.brand b{font-family:var(--f-head);font-weight:700;font-size:1.18rem;letter-spacing:-.01em}
.brand span{color:var(--gold);font-weight:600}
h1{font-family:var(--f-head);font-weight:700;font-size:clamp(1.6rem,3.6vw,2.3rem);margin:0 0 8px;letter-spacing:-.02em}
.top p{margin:0;color:#c9dbd2;max-width:62ch}
.stats{display:flex;flex-wrap:wrap;gap:22px;margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,.14)}
.stat b{display:block;font-family:var(--f-head);font-size:1.3rem;color:var(--gold);font-variant-numeric:tabular-nums}
.stat span{font-size:.74rem;text-transform:uppercase;letter-spacing:.1em;color:#a9c2b7}

/* layout */
.wrap{max-width:1180px;margin:0 auto;padding:26px 28px 90px;display:grid;grid-template-columns:225px 1fr;gap:34px;align-items:start}
@media(max-width:940px){.wrap{grid-template-columns:1fr}nav.side{position:static!important;max-height:none!important}}
nav.side{position:sticky;top:18px;max-height:calc(100vh - 36px);overflow:auto}
nav.side a{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 11px;border-radius:7px;color:var(--ink-secondary);text-decoration:none;font-size:13.4px;font-weight:500}
nav.side a:hover{background:var(--forest-surface);color:var(--forest)}
nav.side a em{font-style:normal;font-size:11px;color:var(--ink-faint);font-variant-numeric:tabular-nums}
.side-title{font-family:var(--f-head);font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-faint);padding:0 11px;margin:0 0 8px}

#search{width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--ink);font-family:var(--f-body);font-size:13.5px;margin-bottom:16px}
#search:focus{outline:2px solid var(--gold);outline-offset:1px;border-color:var(--gold)}

/* panels */
.panel{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px 22px;margin-bottom:26px}
.panel>h2{font-family:var(--f-head);font-size:1.03rem;margin:0 0 4px;font-weight:650}
.panel>p.sub{margin:0 0 14px;color:var(--ink-muted);font-size:13.4px}

ul.feed{list-style:none;margin:0;padding:0}
ul.feed li{display:flex;flex-wrap:wrap;gap:9px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-subtle);font-size:13.4px}
ul.feed li:last-child{border-bottom:0}
ul.feed time{font-family:var(--f-mono);font-size:11.6px;color:var(--ink-faint);min-width:76px}
.kind{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;border-radius:4px}
.kind.added{background:var(--success-bg);color:var(--success)}
.kind.changed{background:var(--info-bg);color:var(--info)}
.kind.fixed{background:var(--gold-surface);color:var(--gold-ink)}
.kind.removed,.kind.deprecated{background:var(--danger-bg);color:var(--danger)}

/* module + endpoints */
section.module{margin-bottom:34px}
section.module>h2{font-family:var(--f-head);font-size:1.25rem;font-weight:700;margin:0 0 3px;letter-spacing:-.012em}
.mod-desc{margin:0 0 14px;color:var(--ink-muted);font-size:13.6px;max-width:72ch}

.endpoint{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:10px;overflow:hidden}
.endpoint.hidden{display:none}
.ep-head{display:flex;align-items:center;gap:11px;padding:12px 15px;cursor:pointer;user-select:none}
.ep-head:hover{background:var(--forest-surface)}
.ep-head:focus-visible{outline:2px solid var(--gold);outline-offset:-2px}
.method{font-family:var(--f-mono);font-size:10.5px;font-weight:700;letter-spacing:.06em;padding:4px 8px;border-radius:5px;min-width:60px;text-align:center;flex:none}
.method.get{background:var(--info-bg);color:var(--info)}
.method.post{background:var(--success-bg);color:var(--success)}
.method.patch,.method.put{background:var(--gold-surface);color:var(--gold-ink)}
.method.del{background:var(--danger-bg);color:var(--danger)}
.ep-path{font-weight:600;font-size:13.4px;color:var(--ink)}
.ep-summary{color:var(--ink-muted);font-size:13.2px;flex:1;min-width:120px}
.chev{margin-left:auto;color:var(--ink-faint);transition:transform .15s}
.endpoint.open .chev{transform:rotate(180deg)}
.ep-body{display:none;padding:2px 15px 18px;border-top:1px solid var(--border-subtle)}
.endpoint.open .ep-body{display:block}
.ep-desc{margin:14px 0;color:var(--ink-secondary);max-width:74ch;font-size:13.8px}

.pill{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:4px}
.pill.dep{background:var(--danger-bg);color:var(--danger)}
.pill.open{background:var(--gold-surface);color:var(--gold-ink)}

dl.meta{display:flex;flex-wrap:wrap;gap:26px;margin:14px 0 4px;padding:11px 0;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle)}
dl.meta dt{font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:3px}
dl.meta dd{margin:0;font-size:13.2px;font-weight:500}

.block{margin-top:20px}
.block h4{font-family:var(--f-head);font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-muted);margin:0 0 9px;font-weight:600}
.tbl-wrap{overflow-x:auto;border:1px solid var(--border-subtle);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:13px}
table.fields th{text-align:left;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint);font-weight:600;padding:8px 12px;background:var(--forest-surface);border-bottom:1px solid var(--border)}
table.fields td{padding:8px 12px;border-bottom:1px solid var(--border-subtle);vertical-align:top}
table.fields tr:last-child td{border-bottom:0}
.f-name{white-space:nowrap}
.f-type{color:var(--ink-muted);white-space:nowrap;font-family:var(--f-mono);font-size:11.8px}
.f-req{white-space:nowrap}
.req{color:var(--danger);font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.opt{color:var(--ink-faint);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase}
.f-note{color:var(--ink-secondary);font-size:12.6px}

.resp{margin-bottom:12px}
.resp-head{display:flex;align-items:center;gap:9px;margin-bottom:7px;font-size:13.2px;color:var(--ink-secondary)}
.status{font-family:var(--f-mono);font-size:11.5px;font-weight:700;padding:3px 8px;border-radius:5px}
.status.ok{background:var(--success-bg);color:var(--success)}
.status.warn{background:var(--gold-surface);color:var(--gold-ink)}
.status.bad{background:var(--danger-bg);color:var(--danger)}

details.raw{margin-top:8px}
details.raw summary{cursor:pointer;font-size:11.6px;color:var(--ink-faint);letter-spacing:.04em}
details.raw pre{background:var(--forest-surface);border:1px solid var(--border-subtle);border-radius:8px;padding:12px 14px;overflow-x:auto;font-family:var(--f-mono);font-size:11.6px;line-height:1.55;margin:8px 0 0;color:var(--ink-secondary)}

ul.hist{list-style:none;margin:0;padding:0;font-size:13.2px}
ul.hist li{display:flex;gap:9px;align-items:center;padding:5px 0}
ul.hist time{font-family:var(--f-mono);font-size:11.6px;color:var(--ink-faint)}

.callout{padding:11px 14px;border-radius:8px;font-size:13.2px;margin:12px 0}
.callout.warn{background:var(--warn-bg);color:var(--warn);border:1px solid #e8d9a8}
.callout.info{background:var(--info-bg);color:var(--info);border:1px solid #cfe3f0}

pre.curl{background:var(--forest-dark);color:#dfeee7;border-radius:8px;padding:14px 16px;overflow-x:auto;font-family:var(--f-mono);font-size:12.2px;line-height:1.6;margin:10px 0 0}
pre.curl .c{color:var(--gold)}
footer{max-width:1180px;margin:0 auto;padding:22px 28px 60px;color:var(--ink-faint);font-size:12.4px;border-top:1px solid var(--border);display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
</style>
</head>
<body>
<header class="top"><div class="top-in">
  <div class="brand">
    <svg viewBox="0 0 32 32" fill="none" stroke="#C79B3B" stroke-width="2" stroke-linejoin="round">
      <path d="M16 3.8L27.2 9.7L16 16L4.8 9.7L16 3.8Z"/><path d="M4.8 9.7L16 16V28.2L5.5 22.4L4.8 9.7Z"/>
      <path d="M27.2 9.7L16 16V28.2L26.5 22.4L27.2 9.7Z"/>
    </svg>
    <b>Ratna<span>Grid</span></b>
  </div>
  <h1>API Developer Docs</h1>
  <p>Generated from the running server on every request. If an endpoint validates it, this page shows it — the two cannot drift apart.</p>
  <div class="stats">
    <div class="stat"><b>${total}</b><span>Endpoints</span></div>
    <div class="stat"><b>${ordered.length}</b><span>Modules</span></div>
    <div class="stat"><b>${esc(options.version)}</b><span>Version</span></div>
    <div class="stat"><b>${esc(new Date().toISOString().slice(0, 10))}</b><span>Generated</span></div>
  </div>
</div></header>

<div class="wrap">
  <nav class="side">
    <input id="search" type="search" placeholder="Filter endpoints…" aria-label="Filter endpoints">
    <p class="side-title">Modules</p>
    ${nav}
    <p class="side-title" style="margin-top:16px">Reference</p>
    <a href="#getting-started"><span>Getting started</span></a>
    <a href="#errors"><span>Error codes</span></a>
  </nav>

  <main>
    <div class="panel" id="recent">
      <h2>Recently updated</h2>
      <p class="sub">Newest first. Every endpoint change is recorded here automatically.</p>
      <ul class="feed">${changes}</ul>
    </div>

    <div class="panel" id="getting-started">
      <h2>Getting started</h2>
      <p class="sub">Base URL <code>${esc(options.baseUrl)}</code></p>
      <p style="font-size:13.6px;margin:0 0 4px">Sign in, then send the access token on every call. Add <code>X-Branch-Id</code> to act at a specific branch.</p>
      <pre class="curl"><span class="c"># 1. sign in</span>
curl -X POST ${esc(options.baseUrl)}/api/auth/login \\
  -H 'content-type: application/json' \\
  -d '{"tenantCode":"aarohi","email":"owner@aarohi.test","password":"demo12345"}'

<span class="c"># 2. use the token</span>
curl ${esc(options.baseUrl)}/api/tenancy/modules \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "X-Branch-Id: $BRANCH_ID"</pre>
      <div class="callout info" style="margin-top:14px"><strong>Every error uses the same shape.</strong>
      <code>{ "error": { "code", "message", "details?", "requestId" } }</code> — switch on <code>code</code>, never on <code>message</code>.</div>
    </div>

    ${sections}

    <div class="panel" id="errors">
      <h2>Error codes</h2>
      <p class="sub">The complete list. <code>code</code> is a contract; <code>message</code> is written for people and may be reworded.</p>
      <div class="tbl-wrap"><table class="fields">
        <thead><tr><th>Code</th><th>HTTP</th><th>Meaning</th><th>What the frontend should do</th></tr></thead>
        <tbody>${errors}</tbody>
      </table></div>
    </div>
  </main>
</div>

<footer>
  <span>RatnaGrid API — generated ${esc(new Date().toISOString())}</span>
  <span>${total} endpoints across ${ordered.length} modules</span>
</footer>

<script>
(function(){
  document.querySelectorAll('.ep-head').forEach(function(h){
    function toggle(){ h.parentElement.classList.toggle('open');
      h.setAttribute('aria-expanded', h.parentElement.classList.contains('open')); }
    h.addEventListener('click', toggle);
    h.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); } });
  });
  var box = document.getElementById('search');
  box.addEventListener('input', function(){
    var q = box.value.trim().toLowerCase();
    document.querySelectorAll('.endpoint').forEach(function(el){
      el.classList.toggle('hidden', q && el.dataset.search.indexOf(q) === -1);
    });
    document.querySelectorAll('section.module').forEach(function(sec){
      var any = sec.querySelectorAll('.endpoint:not(.hidden)').length;
      sec.style.display = any ? '' : 'none';
    });
  });
  if (location.hash) { var t = document.querySelector(location.hash); if (t && t.classList.contains('endpoint')) t.classList.add('open'); }
})();
</script>
</body>
</html>`;
}
