// Render the pipeline document as the seedance-shotlist-director HTML artifact
// (docs/skills/seedance-shotlist-director.md): self-contained, checkboxes persisted in
// localStorage, copy-ready prompt blocks (Style Prefix + cut text + presets, verbatim).
// PURE: doc in, HTML string out.

import { compilePromptText, type PipelineDoc } from './doc';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderShotlistHtml(doc: PipelineDoc, title: string): string {
  const scenesHtml = doc.scenes
    .map((scene, si) => {
      const prompts = scene.prompts
        .map((p) => {
          const full = compilePromptText(doc, p.name) + (p.dialogue ? `\n\nSpoken line: "${p.dialogue}"` : '');
          const assets = p.assetSlugs.length ? ` · refs: ${p.assetSlugs.join(', ')}` : '';
          return `
  <div class="prompt-block">
    <div class="prompt-label"><span>Prompt ${esc(p.name)}${esc(assets)}</span><button class="copy-btn">Copy</button></div>
    <pre class="prompt">${esc(full)}</pre>
  </div>`;
        })
        .join('\n');
      const desc = scene.prompts[0]?.text.slice(0, 110) ?? '';
      return `
<div class="scene">
  <div class="scene-header">
    <input type="checkbox" data-scene="${si + 1}">
    <div class="scene-num">${si + 1}.</div>
    <div class="scene-desc">${esc(desc)}${scene.styleOverride ? ` <em style="color:var(--accent)">· scoped override</em>` : ''}</div>
  </div>
  ${prompts}
</div>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)} — Director's Shotlist</title>
<style>
  :root { --bg:#0e0e10; --panel:#17171a; --panel-2:#1d1d21; --border:#2a2a30; --text:#e8e8ea; --text-dim:#9a9aa2; --accent:#d4a259; --done:#4ade80; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; line-height:1.5; padding:32px 24px 80px; }
  .container { max-width: 980px; margin: 0 auto; }
  h1 { font-size:28px; font-weight:600; margin:0 0 4px; letter-spacing:-0.02em; }
  .subtitle { color:var(--text-dim); font-size:14px; margin-bottom:32px; }
  .howto { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:14px 18px; font-size:13px; color:var(--text-dim); margin-bottom:24px; }
  details.style-prefix { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:14px 18px; margin-bottom:32px; }
  details.style-prefix summary { cursor:pointer; font-weight:600; color:var(--accent); user-select:none; }
  details.style-prefix pre { margin:14px 0 0; padding:14px; background:var(--panel-2); border-radius:6px; font-family:"SF Mono",Menlo,Consolas,monospace; font-size:12.5px; white-space:pre-wrap; color:var(--text); }
  .scene { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:20px 22px; margin-bottom:18px; }
  .scene-header { display:flex; align-items:flex-start; gap:12px; margin-bottom:14px; }
  .scene-header input[type="checkbox"] { width:20px; height:20px; margin-top:2px; accent-color:var(--done); cursor:pointer; flex-shrink:0; }
  .scene-num { font-size:18px; font-weight:700; color:var(--accent); min-width:36px; }
  .scene-desc { font-size:15px; color:var(--text); flex:1; }
  .scene.done .scene-desc { text-decoration:line-through; color:var(--text-dim); }
  .prompt-block { background:var(--panel-2); border:1px solid var(--border); border-radius:6px; margin-top:12px; overflow:hidden; }
  .prompt-label { display:flex; justify-content:space-between; align-items:center; padding:8px 14px; background:rgba(255,255,255,0.02); border-bottom:1px solid var(--border); font-size:12px; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.05em; }
  .copy-btn { background:transparent; color:var(--accent); border:1px solid var(--border); border-radius:4px; padding:4px 10px; font-size:11px; cursor:pointer; text-transform:uppercase; letter-spacing:0.05em; font-family:inherit; }
  .copy-btn:hover { border-color:var(--accent); }
  .copy-btn.copied { color:var(--done); border-color:var(--done); }
  pre.prompt { margin:0; padding:14px 16px; font-family:"SF Mono",Menlo,Consolas,monospace; font-size:12.5px; white-space:pre-wrap; color:var(--text); }
</style>
</head>
<body>
<div class="container">
  <h1>${esc(title)}</h1>
  <div class="subtitle">Director's Shotlist · Recut</div>
  <div class="howto">Tick scenes as you shoot them — progress saves in your browser. Copy any prompt to use it standalone (Style Prefix included). Revise in Recut and re-download; scene numbers stay stable.</div>
  <details class="style-prefix"><summary>Global Style Prefix (applied to every prompt)</summary><pre>${esc(doc.stylePrefix || '(none set)')}</pre></details>
  ${scenesHtml}
</div>
<script>
  document.querySelectorAll('.scene input[type="checkbox"]').forEach(cb => {
    const key = 'shotlist-scene-' + cb.dataset.scene + '-done';
    if (localStorage.getItem(key) === '1') { cb.checked = true; cb.closest('.scene').classList.add('done'); }
    cb.addEventListener('change', () => { localStorage.setItem(key, cb.checked ? '1' : '0'); cb.closest('.scene').classList.toggle('done', cb.checked); });
  });
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pre = btn.closest('.prompt-block').querySelector('pre.prompt');
      navigator.clipboard.writeText(pre.textContent).then(() => {
        btn.classList.add('copied'); const o = btn.textContent; btn.textContent = 'Copied';
        setTimeout(() => { btn.classList.remove('copied'); btn.textContent = o; }, 1500);
      });
    });
  });
</script>
</body>
</html>`;
}
