// Colours come from the host's --oc-* tokens, so light and dark themes follow
// the app. Surfaces are flat and set apart by tone; only controls stand up.
export const BASE_STYLE = `
  html, body { margin: 0; background: transparent; color: var(--oc-fg); font: 12px/1.4 var(--oc-font); }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: var(--oc-muted); }
  .mono { font-family: var(--oc-mono); }
  .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--oc-muted); opacity: .55; }
  .dot[data-tone="ok"] { background: var(--oc-success); opacity: 1; }
  .dot[data-tone="warn"] { background: var(--oc-warning); opacity: 1; }
  .dot[data-tone="bad"] { background: var(--oc-error); opacity: 1; }
  .dot.busy { animation: pulse 1s ease-in-out infinite; opacity: 1; background: var(--oc-primary); }
  @keyframes pulse { 50% { opacity: .3; } }
  .port { display: inline-flex; align-items: center; height: 17px; padding: 0 5px; border-radius: 4px; border: 0; cursor: pointer;
    font: 10.5px var(--oc-mono); white-space: nowrap; flex: none;
    background: color-mix(in srgb, var(--oc-primary) 14%, transparent); color: var(--oc-primary-text, var(--oc-primary)); }
  .port:hover { background: color-mix(in srgb, var(--oc-primary) 24%, transparent); }
  .port.plain { cursor: default; }
  /* Text buttons: no fill, they only change colour. */
  .tb { flex: none; padding: 0 2px; border: 0; background: none; font-size: 11px; color: var(--oc-muted); cursor: pointer; white-space: nowrap; }
  .tb:hover, .tb:focus-visible { color: var(--oc-fg); outline: none; }
  .tb.primary { color: var(--oc-primary-text, var(--oc-primary)); }
  .tb.danger:hover, .tb.danger:focus-visible { color: var(--oc-error-text, var(--oc-error)); }
  .tb.armed { color: var(--oc-error-text, var(--oc-error)); font-weight: 600; }
  .tb:disabled { cursor: default; opacity: .55; }
  [hidden] { display: none !important; }
`;

export const PANEL_STYLE = `
  html, body { height: 100%; overflow: hidden; }
  #root { height: 100%; display: flex; flex-direction: column; }
  .view { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 14px; padding: 12px 12px 20px; }
  .view.fill { overflow: hidden; padding-bottom: 12px; }
  .head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
  .head .titles { min-width: 0; flex: 1; }
  .title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title .muted { font-weight: 400; }
  .subtitle { color: var(--oc-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .live { display: inline-flex; align-items: center; gap: 6px; color: var(--oc-muted); font-size: 11px; white-space: nowrap; padding-top: 2px; }
  .live::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--oc-success); }
  .live.stale::before { background: var(--oc-muted); }
  .back { padding: 0 4px 0 0; font-size: 15px; line-height: 18px; }
  .label { font-size: 11px; font-weight: 600; letter-spacing: .02em; color: var(--oc-muted); text-transform: uppercase; }
  .section { display: flex; flex-direction: column; gap: 2px; }
  .section-head { display: flex; align-items: baseline; gap: 8px; padding: 0 2px 4px; min-width: 0; }
  .section-head .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card { min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 10px 10px 8px;
    border-radius: var(--oc-radius); background: color-mix(in srgb, var(--oc-fg) 4%, transparent); }
  .cols, .row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto 48px 58px 22px; align-items: center; column-gap: 8px; }
  .cols { color: var(--oc-muted); font-size: 10.5px; padding: 0 2px 3px; border-bottom: 1px solid var(--oc-border); }
  .cell { text-align: right; white-space: nowrap; }
  .row { padding: 6px 2px; border-radius: 6px; cursor: pointer; min-height: 38px; }
  .row:hover, .row:focus-visible { background: var(--oc-hover); outline: none; }
  .who { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .line1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .detail { color: var(--oc-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail.bad { color: var(--oc-error-text, var(--oc-error)); }
  .detail.busy { color: var(--oc-primary-text, var(--oc-primary)); }
  .ports { display: flex; gap: 4px; min-width: 0; overflow: hidden; }
  .cell.quiet, .quiet { color: var(--oc-muted); }
  .action { display: flex; justify-content: flex-end; }
  .menu-cell { display: flex; justify-content: center; }
  .menu-cell .oc-sdk-btn { min-height: 20px; height: 20px; padding: 0 5px; }
  .badge { font-size: 10px; padding: 0 5px; border-radius: 4px; line-height: 16px; flex: none; white-space: nowrap;
    background: color-mix(in srgb, var(--oc-fg) 7%, transparent); color: var(--oc-muted); }
  .badge.ok { background: color-mix(in srgb, var(--oc-success) 14%, transparent); color: var(--oc-success-text, var(--oc-success)); }
  .badge.warn { background: color-mix(in srgb, var(--oc-warning) 14%, transparent); color: var(--oc-warning-text, var(--oc-warning)); }
  .badge.bad { background: color-mix(in srgb, var(--oc-error) 14%, transparent); color: var(--oc-error-text, var(--oc-error)); }
  .diag { margin: 0 2px 4px 20px; padding: 6px 8px; border-radius: 6px; font-size: 11.5px; line-height: 1.45;
    background: color-mix(in srgb, var(--oc-error) 8%, transparent); white-space: pre-wrap; user-select: text; }
  .diag .muted { font-size: 10.5px; display: block; margin-top: 2px; }
  .diag code { font: 10.5px var(--oc-mono); padding: 0 3px; border-radius: 3px; background: color-mix(in srgb, var(--oc-fg) 8%, transparent); }
  .diag.pending { background: color-mix(in srgb, var(--oc-fg) 4%, transparent); color: var(--oc-muted); }
  .group { display: flex; flex-direction: column; }
  .group-head { display: grid; grid-template-columns: minmax(0, 1fr) auto 48px 58px 22px; column-gap: 8px; align-items: center;
    padding: 8px 2px; border-bottom: 1px solid var(--oc-border); cursor: pointer; }
  .group-head:focus-visible { outline: none; background: var(--oc-hover); border-radius: 4px; }
  .gname { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .gname b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gname::before { content: ''; flex: none; border-left: 4px solid var(--oc-muted); border-top: 3.5px solid transparent;
    border-bottom: 3.5px solid transparent; transition: transform .15s ease; }
  .group.open .gname::before { transform: rotate(90deg); }
  /* The open group's rows sit under its name, set in by the fold arrow's width; no rail. */
  .group-body { display: flex; flex-direction: column; padding: 2px 0 6px 10px; }
  .group:not(.open) .group-body { display: none; }
  .stack-actions { display: flex; gap: 8px; align-items: baseline; flex: none; }
  .empty-note { color: var(--oc-muted); padding: 6px 2px; }
  .storage-link { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: var(--oc-radius); border: 0; width: 100%;
    background: color-mix(in srgb, var(--oc-fg) 4%, transparent); cursor: pointer; text-align: left; }
  .storage-link:hover { background: color-mix(in srgb, var(--oc-fg) 7%, transparent); }
  .storage-link .grow { flex: 1; }
  .banner { padding: 8px 12px; border-radius: var(--oc-radius); user-select: text;
    background: color-mix(in srgb, var(--oc-warning) 10%, transparent); color: var(--oc-warning-text, var(--oc-fg)); }
  .banner.error { background: color-mix(in srgb, var(--oc-error) 10%, transparent); color: var(--oc-error-text, var(--oc-fg)); }

  /* Engine down */
  .engine-card { display: flex; flex-direction: column; gap: 10px; padding: 16px; border-radius: var(--oc-radius);
    background: color-mix(in srgb, var(--oc-fg) 4%, transparent); }
  .engine-card .big { font-size: 14px; font-weight: 600; }
  .command { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; font: 11.5px var(--oc-mono);
    background: color-mix(in srgb, var(--oc-fg) 6%, transparent); }
  .command span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
  .buttons { display: flex; gap: 8px; flex-wrap: wrap; }
  .problem { font: 10.5px/1.4 var(--oc-mono); color: var(--oc-muted); overflow-wrap: anywhere; user-select: text; }
  .output { font: 10.5px/1.45 var(--oc-mono); color: var(--oc-muted); white-space: pre-wrap; max-height: 120px; overflow: auto; user-select: text; }

  /* Container detail */
  .segmented { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: color-mix(in srgb, var(--oc-fg) 6%, transparent); flex: none; }
  .segmented button { flex: 1; border: 0; background: none; font-size: 11.5px; padding: 4px 0; border-radius: 6px; color: var(--oc-muted); cursor: pointer; }
  .segmented button:hover { color: var(--oc-fg); }
  .segmented button[aria-pressed="true"] { background: var(--oc-bg); color: var(--oc-fg);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--oc-fg) 10%, transparent), 0 1px 2px rgb(0 0 0 / .08); }
  .segmented button:focus-visible { outline: none; color: var(--oc-fg); }
  .tab-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
  .toolbar { display: flex; align-items: center; gap: 10px; flex: none; min-width: 0; }
  .toolbar .grow { flex: 1; min-width: 0; }
  .field { width: 100%; min-width: 0; height: 26px; padding: 0 8px; border-radius: 6px; font: 11.5px var(--oc-font); color: var(--oc-fg);
    border: 1px solid color-mix(in srgb, var(--oc-fg) 10%, transparent); background: color-mix(in srgb, var(--oc-fg) 3%, transparent); outline: none; }
  .field:focus { border-color: color-mix(in srgb, var(--oc-primary) 60%, transparent); }
  .field.mono { font-family: var(--oc-mono); }
  .toggle { border: 0; background: none; padding: 0; font-size: 11px; color: var(--oc-muted); cursor: pointer; white-space: nowrap; }
  .toggle[aria-pressed="true"] { color: var(--oc-fg); font-weight: 600; }
  .toggle:focus-visible { outline: none; color: var(--oc-fg); }
  .code { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 8px 10px; border-radius: 6px;
    font: 11px/1.55 var(--oc-mono); user-select: text; white-space: pre; tab-size: 4;
    background: color-mix(in srgb, var(--oc-fg) 4%, transparent); }
  .code.wrap { white-space: pre-wrap; overflow-wrap: anywhere; }
  .log-line { min-height: 1.55em; }
  .log-line .ts { display: inline-block; width: 6.2em; text-indent: 0; color: var(--oc-muted); opacity: .7; user-select: none; }
  /* Wrapped lines hang under the message, not under the time. */
  .code.wrap .log-line { padding-left: 6.2em; text-indent: -6.2em; }
  .lvl-error { color: var(--oc-error-text, var(--oc-error)); font-weight: 600; }
  .lvl-warn { color: var(--oc-warning-text, var(--oc-warning)); }
  .lvl-info { color: var(--oc-info-text, var(--oc-info, var(--oc-primary))); }
  .lvl-debug { color: var(--oc-muted); }
  mark { background: color-mix(in srgb, var(--oc-warning) 35%, transparent); color: inherit; border-radius: 2px; }
  .foot { color: var(--oc-muted); font-size: 11px; flex: none; display: flex; gap: 8px; align-items: baseline; }
  .foot .grow { flex: 1; }
  .linkish { border: 0; background: none; padding: 0; font-size: 11px; color: var(--oc-muted); text-decoration: underline; cursor: pointer; }
  .linkish:hover { color: var(--oc-fg); }
  .crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font: 11px var(--oc-mono); min-width: 0; }
  .crumbs button { border: 0; background: none; padding: 1px 3px; border-radius: 4px; color: var(--oc-muted); cursor: pointer; font: inherit; }
  .crumbs button:hover { color: var(--oc-fg); background: var(--oc-hover); }
  .crumbs button:last-child { color: var(--oc-fg); }
  .files { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .file { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 5px; cursor: pointer; border: 0; background: none; text-align: left; width: 100%; }
  .file:hover, .file:focus-visible { background: var(--oc-hover); outline: none; }
  .file .icon { width: 14px; flex: none; color: var(--oc-muted); text-align: center; }
  .file.dir .fname { font-weight: 600; }
  .file .fname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file.hidden-file .fname { color: var(--oc-muted); }
  .shell { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 8px 10px; border-radius: 6px;
    background: color-mix(in srgb, var(--oc-fg) 4%, transparent); font: 11px/1.5 var(--oc-mono); user-select: text; }
  .shell .cmd { color: var(--oc-fg); font-weight: 600; }
  .shell .cmd .cwd { color: var(--oc-primary-text, var(--oc-primary)); font-weight: 400; }
  .shell .out { white-space: pre-wrap; overflow-wrap: anywhere; color: color-mix(in srgb, var(--oc-fg) 85%, transparent); }
  .shell .exit { color: var(--oc-error-text, var(--oc-error)); font-size: 10.5px; }
  .presets { display: flex; gap: 6px; flex-wrap: wrap; flex: none; }
  .preset { border: 0; border-radius: 5px; padding: 2px 7px; font: 10.5px var(--oc-mono); cursor: pointer; color: var(--oc-muted);
    background: color-mix(in srgb, var(--oc-fg) 6%, transparent); }
  .preset:hover { color: var(--oc-fg); }
  .prompt { display: flex; align-items: center; gap: 8px; flex: none; }
  .prompt .cwd { font: 11px var(--oc-mono); color: var(--oc-primary-text, var(--oc-primary)); white-space: nowrap; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
  .kv { display: grid; grid-template-columns: minmax(80px, 30%) minmax(0, 1fr); gap: 4px 12px; font-size: 11.5px; }
  .kv .k { color: var(--oc-muted); }
  .kv .v { overflow-wrap: anywhere; user-select: text; }
  .kv .v.mono { font: 11px var(--oc-mono); }
  .inspect { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 2px; }
  .secret { cursor: pointer; color: var(--oc-muted); }
  .message { color: var(--oc-muted); padding: 16px 4px; text-align: center; display: flex; flex-direction: column; gap: 10px; align-items: center; }

  /* Storage */
  .disk { display: flex; gap: 1px; height: 8px; border-radius: 4px; overflow: hidden; background: color-mix(in srgb, var(--oc-fg) 8%, transparent); }
  .disk span { height: 100%; transition: width .4s ease; }
  .disk-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; align-items: center; column-gap: 8px; min-height: 22px; }
  .swatch { width: 8px; height: 8px; border-radius: 2px; }
  .big { font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
  .item { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; column-gap: 10px; align-items: center; padding: 5px 2px; }
  .item .name { font-weight: 500; }
  .pull { display: flex; gap: 8px; align-items: center; padding: 6px 2px; }
`;

export const STATUS_STYLE = `
  html, body { overflow: hidden; }
  #root { display: flex; flex-direction: column; gap: 3px; padding: 2px 0 4px; }
  .sline { display: grid; grid-template-columns: 8px minmax(0, 88px) minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 19px; }
  .sline .sname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sline .sdetail { color: var(--oc-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; gap: 4px; min-width: 0; }
  .sline .sdetail.bad { color: var(--oc-error-text, var(--oc-error)); }
  .sline .value { text-align: right; white-space: nowrap; color: var(--oc-muted); }
  .note { color: var(--oc-muted); }
  .note.error { color: var(--oc-error-text, var(--oc-fg)); }
  .more { color: var(--oc-muted); font-size: 11px; }
`;
