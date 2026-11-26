'use strict';

// `cogby card`: small pieces of interface a session shows inside the chat. One kit, one look.
//
// A card is a short question or a state, with answers to click. It is filled here, by code, from
// data: a model passes the data and shows the HTML it gets back, exactly as returned. It never
// writes a card's HTML, so every person sees the same card and nothing a page or a note said can
// restyle one.
//
// What a card may do is fixed: show what it was given, and send ONE chat message when the person
// presses a button (`sendPrompt`, which the host provides). It reads nothing and writes nothing.
// The message is plain words; the session then does the work with the brain's tools, as it would
// had the person typed the same sentence. Data reaches the HTML only through `esc`, and a card's
// script reads the page it is in, never the data.

const { BrainError } = require('./db.cjs');

// A card loads nothing: no font, no stylesheet, no image. Its type is the host's own (the chat's
// interface font), so a card reads as part of the conversation and not as a page set into it.
const SANS = "var(--font-sans,-apple-system,'Segoe UI',sans-serif)";

// The colours come from the host's own theme variables, so a card is light or dark exactly when the
// chat around it is, however the host says so; the values after each comma are Cogby's own, for a
// host that has none. Cogby's purple is mixed from one hue and the host's text colour: deep on a
// light page, light on a dark one.
//
// Text is never set on that purple, and never changes colour when something is pressed. A host
// styles its own buttons (their hover, their pressed state), and a card cannot know how: on
// 25 Nov 2026 the owner pressed an answer in the quiz and could no longer read it. So a selected
// answer keeps its text as it was and gains three things around it: a purple outline, a light
// purple wash, and a mark that fills with a check. It reads in both themes, and not by colour alone.
const BASE = `.cg{--cg-ink:var(--text-primary,#191634);--cg-body:var(--text-secondary,#3d3663);--cg-muted:var(--text-secondary,#5c5486);--cg-card:var(--surface-2,#ffffff);--cg-quiet:var(--surface-1,#f6f5f4);--cg-line:var(--border,rgba(25,22,52,.14));--cg-line2:var(--border-strong,rgba(25,22,52,.28));--cg-warn:var(--text-warning,#8A4A14);--cg-primary:color-mix(in srgb,#6e48ec 72%,var(--cg-ink));--cg-on:color-mix(in srgb,var(--cg-primary) 14%,transparent);font-family:${SANS};color:var(--cg-body);padding:.5rem 0}`;

// One rule a line. A card carries the base and only the rules whose classes it uses (`styleFor`).
const RULES = `.cg .card{background:var(--cg-card);border:.5px solid var(--cg-line);border-radius:12px;padding:16px 20px 18px}
.cg .top{display:flex;align-items:center;gap:7px;margin-bottom:14px}
.cg .brand{font-weight:500;font-size:14px;color:var(--cg-ink);line-height:1}
.cg .where{margin-left:auto;font-size:12.5px;color:var(--cg-muted)}
.cg .bar{display:flex;gap:4px;margin:0 0 16px}
.cg .seg{flex:1;height:3px;border-radius:2px;background:var(--cg-line2)}
.cg .seg.done{background:var(--cg-primary)}
.cg .seg.now{background:var(--cg-ink)}
.cg .q{font-size:16px;font-weight:500;color:var(--cg-ink);margin:0 0 4px;line-height:1.4}
.cg .why{font-size:13px;margin:0 0 14px;line-height:1.5}
.cg .grp{font-size:13px;color:var(--cg-muted);margin:16px 0 8px}
.cg .set{display:flex;flex-wrap:wrap;gap:8px}
.cg .chip{font-family:inherit;font-size:13px;color:var(--cg-ink);background:transparent;border:1px solid var(--cg-line2);border-radius:9999px;padding:6px 14px;cursor:pointer}
.cg .opt{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font-family:inherit;color:var(--cg-ink);background:transparent;border:1px solid var(--cg-line2);border-radius:var(--radius,8px);padding:11px 14px;margin:0 0 8px;cursor:pointer}
.cg .opt:hover,.cg .chip:hover,.cg .mini:hover{background:var(--cg-quiet);border-color:var(--cg-primary)}
.cg .opt b{font-weight:400;font-size:14.5px;color:var(--cg-ink);line-height:1.4}
.cg .dot{flex:none;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--cg-line2);box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:11px;line-height:1;color:var(--cg-card)}
.cg .go{font-family:inherit;font-size:14px;font-weight:500;color:var(--cg-ink);background:var(--cg-on);border:1px solid var(--cg-primary);border-radius:var(--radius,8px);padding:8px 18px;cursor:pointer}
.cg .quiet{font-family:inherit;font-size:14px;color:var(--cg-ink);background:transparent;border:1px solid var(--cg-line2);border-radius:var(--radius,8px);padding:8px 16px;cursor:pointer}
.cg .mini{font-family:inherit;font-size:12.5px;color:var(--cg-ink);background:transparent;border:1px solid var(--cg-line2);border-radius:9999px;padding:4px 12px;cursor:pointer;flex:none}
.cg .chip[aria-pressed="true"],.cg .opt[aria-pressed="true"],.cg .mini[aria-pressed="true"]{background:var(--cg-on);border-color:var(--cg-primary);box-shadow:inset 0 0 0 1px var(--cg-primary)}
.cg .chip[aria-pressed="true"],.cg .mini[aria-pressed="true"],.cg .opt[aria-pressed="true"] b{font-weight:500}
.cg .chip[aria-pressed="true"]::before,.cg .mini[aria-pressed="true"]::before{content:"\\2713";margin-right:6px;color:var(--cg-primary)}
.cg .opt[aria-pressed="true"] .dot,.cg .opt.right .dot{background:var(--cg-primary);border-color:var(--cg-primary)}
.cg .opt[aria-pressed="true"] .dot::before,.cg .opt.right .dot::before{content:"\\2713"}
.cg .foot{display:flex;align-items:center;gap:10px;margin-top:18px;flex-wrap:wrap}
.cg .hint{font-size:13px;color:var(--cg-muted)}
.cg .err{font-size:13px;color:var(--text-danger,#a32d2d);margin:12px 0 0;display:none}
.cg .row{display:flex;align-items:baseline;gap:10px;padding:9px 0;border-top:.5px solid var(--cg-line)}
.cg label.row{cursor:pointer}
.cg .row input{margin:0;position:relative;top:2px;flex:none}
.cg .tag{flex:none;font-size:12px;color:var(--cg-muted);border:.5px solid var(--cg-line2);border-radius:9999px;padding:1px 9px}
.cg .name{font-size:14px;color:var(--cg-ink);line-height:1.45}
.cg .name b{font-weight:500}
.cg .note{font-size:12.5px;color:var(--cg-muted);margin-left:auto;text-align:right;flex:none;max-width:45%}
.cg[data-js] .pg{display:none}
.cg .pg.on{display:block}
.cg .end:not(.on){display:none}
.cg .none{font-size:13px;color:var(--cg-muted);padding:9px 0;border-top:.5px solid var(--cg-line);margin:0}
.cg .verdict{display:inline-block;font-size:13px;font-weight:500;color:var(--cg-ink);background:var(--cg-on);border:1px solid var(--cg-primary);border-radius:9999px;padding:3px 12px;margin:0 0 12px}
.cg .verdict.off{background:transparent;border-color:var(--cg-warn);color:var(--cg-warn)}
.cg .pg .opt:disabled{cursor:default;pointer-events:none;opacity:1}
.cg .opt.right{background:var(--cg-on);border-color:var(--cg-primary);box-shadow:inset 0 0 0 1px var(--cg-primary)}
.cg .opt.wrong{background:transparent;border-color:var(--cg-warn);box-shadow:inset 0 0 0 1px var(--cg-warn)}
.cg .opt.wrong .dot{background:transparent;border-color:var(--cg-warn);color:var(--cg-warn)}
.cg .opt.wrong .dot::before{content:"\\2717"}
.cg .opt.right::after,.cg .opt.wrong::after{margin-left:auto;padding-left:10px;font-size:12px;color:var(--cg-muted);flex:none}
.cg .opt.right::after{content:"The answer"}
.cg .opt.wrong::after{content:"Your answer"}
.cg .opt.right[aria-pressed="true"]::after{content:"Your answer, and right"}
.cg .rev{display:none;margin-top:16px;padding-top:14px;border-top:.5px solid var(--cg-line)}
.cg .pg[data-shown] .rev{display:block}
.cg .pg[data-shown] .ask{display:none}
.cg .rev .verdict{display:none}
.cg .pg[data-shown="right"] .v-right,.cg .pg[data-shown="wrong"] .v-wrong,.cg .pg[data-shown="idk"] .v-idk{display:inline-block}
.cg .lbl{font-size:12.5px;color:var(--cg-muted);margin:0 0 3px}
.cg .ans{font-size:15px;font-weight:500;color:var(--cg-ink);margin:0 0 6px;line-height:1.45}
.cg .because{font-size:13.5px;line-height:1.55;margin:0 0 6px}
.cg .src{font-size:12px;color:var(--cg-muted);margin:0}`.split('\n');

// The whole sheet, every rule: what the tests read, and what any card could use.
const STYLE = `<style>\n${BASE}\n${RULES.join('\n')}\n</style>`;

// The classes a card uses: those in its markup, and those its script adds or takes away.
function classesIn(html) {
  const names = new Set();
  for (const [, value] of html.matchAll(/class="([^"]*)"/g)) for (const name of value.split(/\s+/)) if (name) names.add(name);
  for (const [, args] of html.matchAll(/classList\.(?:add|toggle|remove)\(([^)]*)\)/g)) for (const [, name] of args.matchAll(/'([\w-]+)'/g)) names.add(name);
  return names;
}
// Only the rules a card can use: one whose selector names a class the card never has is left out.
// Every byte of a card is one the session has to send again before the person sees anything.
function styleFor(html) {
  const names = classesIn(html);
  const fits = (selector) => [...selector.matchAll(/\.([\w-]+)/g)].every(([, name]) => name === 'cg' || names.has(name));
  const kept = RULES.map((rule) => {
    const at = rule.indexOf('{');
    const selectors = rule.slice(0, at).split(',').filter(fits);
    return selectors.length ? selectors.join(',') + rule.slice(at) : '';
  }).filter(Boolean).join('\n');
  // The base keeps only the colours those rules use, and the colours those are made from.
  const [, open, decls, rest] = /^(\.cg\{)(--.*?;)(font-family.*)$/.exec(BASE);
  const tokens = decls.split(/;(?=--)/).map((decl) => decl.replace(/;$/, ''));
  const name = (decl) => decl.slice(0, decl.indexOf(':'));
  const needed = new Set();
  const want = (text) => { for (const [, token] of text.matchAll(/var\((--cg-[\w-]+)/g)) needed.add(token); };
  want(kept); want(rest);
  for (let size = -1; size !== needed.size;) { size = needed.size; tokens.filter((decl) => needed.has(name(decl))).forEach(want); }
  return `<style>\n${open}${tokens.filter((decl) => needed.has(name(decl))).map((decl) => `${decl};`).join('')}${rest}\n${kept}\n</style>`;
}

// Cogby's mark on its own, with no tile behind it: the flower sits straight on the card, in a purple
// that holds on a light card and on a dark one.
const MARK = '<svg width="20" height="20" viewBox="0 0 32 32" role="img" aria-label="Cogby"><g transform="translate(16 16) scale(0.25)"><g fill="#9670E0"><g id="cg-petals"><rect x="-11" y="-59" width="22" height="26" rx="9"/><rect x="-11" y="33" width="22" height="26" rx="9"/></g><use href="#cg-petals" transform="rotate(45)"/><use href="#cg-petals" transform="rotate(90)"/><use href="#cg-petals" transform="rotate(135)"/><circle r="41"/></g><rect x="-24" y="-12" width="14" height="22" rx="7" fill="#1D1430"/><rect x="10" y="-12" width="14" height="22" rx="7" fill="#1D1430"/><circle cx="-19.6" cy="-6.4" r="2.9" fill="#fff"/><circle cx="14.4" cy="-6.4" r="2.9" fill="#fff"/><path d="M-9 20q9 9 18 0" fill="none" stroke="#1D1430" stroke-width="4" stroke-linecap="round"/></g></svg>';

const MAX_ROWS = 8;
const MAX_TEXT = 240;

// Everything a card shows that came from outside this file goes through here: one line, a bounded
// length, and no character that could open a tag or close an attribute.
function esc(value, max = MAX_TEXT) {
  const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  return cut.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const list = (value, max = MAX_ROWS) => (Array.isArray(value) ? value : []).filter((item) => item != null && item !== '').slice(0, max);

// The frame every card shares: the mark, where the person is, the body, and at most one script.
// The style is the short part that comes first, the content next, the script last: a card streams,
// and the person sees its first question as soon as the content starts.
function frame(label, where, body, script) {
  const card = `<h2 class="sr-only">${esc(label)}</h2>\n<div class="cg"><div class="card">\n`
    + `<div class="top">${MARK}<span class="brand">cogby</span><span class="where">${where}</span></div>\n${body}\n</div></div>`
    + (script ? `\n<script>\n(function(){\n${script}\n})();\n</script>` : '');
  return `${styleFor(card)}\n${card}\n`;
}

// A button that carries data-say sends that sentence to the chat, as if the person had typed it.
const SAY = "document.querySelectorAll('.cg [data-say]').forEach(function(b){b.addEventListener('click',function(){sendPrompt(b.getAttribute('data-say'));});});";
// Chips: several may be on, except inside a set marked data-one, where pressing one releases the others.
const CHIPS = "document.querySelectorAll('.cg .set').forEach(function(set){set.querySelectorAll('.chip').forEach(function(b){b.addEventListener('click',function(){"
  + "if(set.hasAttribute('data-one')){set.querySelectorAll('.chip').forEach(function(o){o.setAttribute('aria-pressed',o===b?'true':'false');});}"
  + "else{b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')==='true'?'false':'true');}"
  + "var e=document.getElementById('err');if(e)e.style.display='none';});});});"
  + "function picked(id){return Array.prototype.slice.call(document.querySelectorAll('#'+id+' .chip[aria-pressed=\"true\"]')).map(function(b){return b.textContent.trim();});}";
// A checklist: the button names the rows kept and the rows left out, by the number each row shows.
const CHECKLIST = (keep, none) => "document.getElementById('go').addEventListener('click',function(){var keep=[],drop=[];"
  + "document.querySelectorAll('#rows label.row').forEach(function(r){(r.querySelector('input').checked?keep:drop).push(r.getAttribute('data-line'));});"
  + `var say=keep.length?'${keep} '+keep.join('; ')+'.':'${none}';`
  + "if(drop.length)say+=' Leave out: '+drop.join('; ')+'.';sendPrompt(say);});";

const chip = (text, on) => `<button class="chip" aria-pressed="${on ? 'true' : 'false'}">${esc(text)}</button>`;

// The quiz: pages in an order, a first round over all of them and a second over what was missed.
const QUIZ = `document.querySelector('.cg').setAttribute('data-js','');
var pages=Array.prototype.slice.call(document.querySelectorAll('.cg .pg[data-q]')),end=document.getElementById('end'),go=document.getElementById('go'),idk=document.getElementById('idk'),err=document.getElementById('err'),where=document.getElementById('where'),segs=document.querySelectorAll('.cg .seg'),recap=document.getElementById('recap');
var order=pages.map(function(p,i){return i;}),pos=0,round=1,res=pages.map(function(){return {first:'',sure:'',second:''};});
function cur(){return pages[order[pos]];}
function text(el){return el?el.textContent.trim():'';}
function show(){pages.forEach(function(p,i){p.classList.toggle('on',i===order[pos]);});
var shown=cur().hasAttribute('data-shown');go.style.display=shown?'':'none';idk.style.display=shown?'none':'';err.style.display='none';
segs.forEach(function(g,i){g.classList.toggle('done',res[i].first!=='');g.classList.toggle('now',i===order[pos]);});
where.textContent=(round===1?'Question ':'Second try · ')+(pos+1)+' of '+order.length;}
function reset(p){p.removeAttribute('data-shown');p.querySelectorAll('.opt').forEach(function(o){o.disabled=false;o.setAttribute('aria-pressed','false');o.classList.remove('right','wrong');});
p.querySelectorAll('.sure .chip,.self .chip').forEach(function(c){c.setAttribute('aria-pressed','false');});}
function reveal(sure,unknown){var p=cur(),r=res[order[pos]],opts=p.querySelectorAll('.opt'),pick=p.querySelector('.opt[aria-pressed="true"]'),out;
if(opts.length&&!pick&&!unknown){p.querySelectorAll('.sure .chip').forEach(function(c){c.setAttribute('aria-pressed','false');});err.style.display='block';return;}
opts.forEach(function(o){o.disabled=true;if(o.hasAttribute('data-right'))o.classList.add('right');});
if(unknown)out='idk';else if(!opts.length)out='self';else if(pick.hasAttribute('data-right'))out='right';else{out='wrong';pick.classList.add('wrong');}
p.setAttribute('data-shown',out);if(round===1){r.first=out;r.sure=sure;}else{r.second=out;}show();}
function finish(){pages.forEach(function(p){p.classList.remove('on');});end.classList.add('on');
var right=res.filter(function(r){return r.first==='right';}).length;
document.getElementById('score').textContent=right+' of '+pages.length+' right the first time';
pages.forEach(function(p,i){var r=res[i],row=document.createElement('div'),tag=document.createElement('span'),name=document.createElement('span');
row.classList.add('row');tag.classList.add('tag');name.classList.add('name');
tag.textContent=r.first==='right'?'\u2713 Right':r.second==='right'?'Second try':'\u2717 Missed';name.textContent=text(p.querySelector('.q'));
row.appendChild(tag);row.appendChild(name);recap.appendChild(row);});
segs.forEach(function(g){g.classList.add('done');g.classList.remove('now');});
go.textContent='Finish';go.style.display='';idk.style.display='none';err.style.display='none';where.textContent='Done';}
function send(){var right=0,missed=[],lucky=[],changed=[];
pages.forEach(function(p,i){var r=res[i],q='"'+text(p.querySelector('.q'))+'"';
if(r.first==='right'){right++;if(r.sure==='Guessing')lucky.push(q);}
else{missed.push(q+' ('+(r.first==='idk'?'did not know':r.sure==='Sure'?'was sure':'wrong')+(r.second==='right'?', right on the second try':'')+')');}
if(p.querySelector('.chg[aria-pressed="true"]'))changed.push(q);});
var say='My quiz on '+end.getAttribute('data-topic')+': '+right+' of '+pages.length+' right the first time.';
if(missed.length)say+=' Missed: '+missed.join('; ')+'.';
if(lucky.length)say+=' Right by guessing: '+lucky.join('; ')+'.';
if(changed.length)say+=' My brain is out of date on: '+changed.join('; ')+'.';
sendPrompt(say);}
document.querySelectorAll('.cg .pg .opt').forEach(function(b){b.addEventListener('click',function(){
b.parentNode.querySelectorAll('.opt').forEach(function(o){o.setAttribute('aria-pressed',o===b?'true':'false');});err.style.display='none';});});
document.querySelectorAll('.cg .sure .chip').forEach(function(c){c.addEventListener('click',function(){reveal(text(c),false);});});
document.querySelectorAll('.cg .chg').forEach(function(c){c.addEventListener('click',function(){c.setAttribute('aria-pressed',c.getAttribute('aria-pressed')==='true'?'false':'true');});});
idk.addEventListener('click',function(){reveal('',true);});
go.addEventListener('click',function(){if(end.classList.contains('on')){send();return;}
var p=cur(),r=res[order[pos]];
if(p.getAttribute('data-shown')==='self'){var s=p.querySelector('.self .chip[aria-pressed="true"]');if(!s){err.style.display='block';return;}
if(round===1){r.first=s.hasAttribute('data-had')?'right':'wrong';}else{r.second=s.hasAttribute('data-had')?'right':'wrong';}}
if(pos<order.length-1){pos++;show();return;}
var missed=[];res.forEach(function(x,i){if(x.first!=='right')missed.push(i);});
if(round===1&&missed.length){round=2;order=missed;pos=0;missed.forEach(function(i){reset(pages[i]);});show();return;}
finish();});
show();`;

const CARDS = {
  // With a summary, the meeting record is shown too: the summary, the transcript it points at, and a
  // last row, ticked, for the record itself (core/brain/meetings.cjs). One yes covers all of it.
  'debrief-review': {
    about: 'What a meeting debrief would save. data: { title, date, pages: [the pages it touched], items: [{ kind: Decision|Fact|They will|You will|Open, text, where, ticked: false for one shown unticked }], summary: [the record\'s 5 to 15 lines], transcript: its link or path, or "none" }',
    render(data) {
      const items = list(data.items, 30);
      const summary = (Array.isArray(data.summary) ? data.summary : String(data.summary || '').split(/\r?\n/)).map((line) => String(line == null ? '' : line).trim()).filter(Boolean).slice(0, 15);
      if (!items.length && !summary.length) throw new BrainError('USAGE', 'The debrief review needs items: [{ kind, text, where }], or a summary for the meeting record.', '');
      const row = (n, kind, text, where, on) => `<label class="row" data-line="${n}"><input type="checkbox"${on ? ' checked' : ''}><span class="tag">${n} · ${esc(kind || 'Item', 14)}</span><span class="name">${esc(text, 200)}</span><span class="note">${esc(where, 50)}</span></label>`;
      const rows = items.map((item, index) => row(index + 1, item.kind, item.text, item.where, item.ticked !== false));
      const pages = list(data.pages, 6).length ? list(data.pages, 6).join(', ') : data.page || '';
      const transcript = String(data.transcript || '').trim();
      const none = !transcript || /^(none|no|n\/a|-)$/i.test(transcript);
      let record = '';
      if (summary.length) {
        rows.push(row(items.length + 1, 'Record', 'The meeting record: this summary and the link to the transcript, linked from every page it touched', 'resources/meetings', true));
        record = `<p class="grp">For the meeting record</p>\n${summary.map((line) => `<div class="row"><span class="name">${esc(line, 300)}</span></div>`).join('\n')}
<p class="none">${none ? 'No transcript: the record says so, and each line cites the meeting by name and date.' : `Transcript: ${esc(transcript, 120)}`}</p>\n`;
      }
      return frame(`What would be saved from the meeting ${data.title || ''}.`, 'Meeting debrief', `<p class="q">${esc(data.title || 'This meeting', 100)}</p>
<p class="why">${[data.date, pages ? `goes on ${pages}` : ''].filter(Boolean).map((text) => esc(text, 160)).join(' · ') || 'What I took from it.'} Untick anything that is wrong. Nothing is saved until you press the button.</p>
${record}<div id="rows">
${rows.join('\n')}
</div>
<div class="foot"><button class="go" id="go">Save these</button><span class="hint">Or tell me what to fix in the chat</span></div>`, CHECKLIST('Save items', 'Save none of these.'));
    },
  },
  // The same checklist for a source that is not a meeting. The summary is the one row that starts
  // unticked: evidence is saved on a yes, the top of a page changes only when the owner picks it.
  'digest-review': {
    about: 'What a digest of one source would save. data: { title: the source, source: how it is cited, page: where most of it goes, items: [{ kind: Fact|Timeline|To-do|Open question, text, where }], summary: a proposed new summary for `page`, shown last and unticked }',
    render(data) {
      const items = list(data.items, 30);
      if (!items.length) throw new BrainError('USAGE', 'The digest review needs items: [{ kind, text, where }].', '');
      const line = (n, kind, text, where, on) => `<label class="row" data-line="${n}"><input type="checkbox"${on ? ' checked' : ''}><span class="tag">${n} · ${esc(kind || 'Item', 14)}</span><span class="name">${esc(text, 200)}</span><span class="note">${esc(where, 50)}</span></label>`;
      const rows = items.map((item, index) => line(index + 1, item.kind, item.text, item.where, true));
      if (data.summary) rows.push(line(items.length + 1, 'Summary', data.summary, data.page, false));
      return frame(`What would be saved from the source ${data.title || ''}.`, 'Digest', `<p class="q">${esc(data.title || 'This source', 100)}</p>
<p class="why">${[data.source ? `cited as ${data.source}` : '', data.page ? `goes on ${data.page}` : ''].filter(Boolean).map((text) => esc(text, 80)).join(' · ') || 'What I took from it.'} Untick anything that is wrong.${data.summary ? ' Tick the summary only if it should replace the one on the page.' : ''} Nothing is saved until you press the button.</p>
<div id="rows">
${rows.join('\n')}
</div>
<div class="foot"><button class="go" id="go">Save these</button><span class="hint">Or tell me what to fix in the chat</span></div>`, CHECKLIST('Save items', 'Save none of these.'));
    },
  },
  'wrap-up-review': {
    about: 'Before a wrap-up asked for by hand saves anything. data: { items: [{ kind: Progress|Decision|Fact|To-do|For you|Lesson|Files|Confirm, text, where, ticked: false for one shown unticked }] }',
    render(data) {
      const items = list(data.items, 30);
      if (!items.length) throw new BrainError('USAGE', 'The wrap-up review needs items: [{ kind, text, where }].', '');
      const rows = items.map((item, index) => `<label class="row" data-line="${index + 1}"><input type="checkbox"${item.ticked === false ? '' : ' checked'}><span class="tag">${index + 1} · ${esc(item.kind || 'Item', 14)}</span><span class="name">${esc(item.text, 200)}</span><span class="note">${esc(item.where, 50)}</span></label>`).join('\n');
      return frame('What this session would save to your brain, for you to check before it is written.', 'Session wrap', `<p class="q">Before I save this session</p>
<p class="why">This is what I would keep. Untick anything you do not want. Nothing is written until you press the button.</p>
<div id="rows">
${rows}
</div>
<div class="foot"><button class="go" id="go">Save these</button><span class="hint">Or tell me what to change in the chat</span></div>`, CHECKLIST('Wrap up with items', 'Save nothing from this session.'));
    },
  },

  // A whole quiz in one card: one question to a page, the answer shown the moment the person
  // commits, Continue to the next, and ONE message at the end with how it went. The answers are in
  // the card, hidden until asked for: a quiz is practice for its owner, not an exam to guard.
  // Three things here come from what is known about remembering: saying how sure you are before
  // you see the answer (a confident mistake, once corrected, sticks best), questions with no
  // options among those with some, and a second try at whatever was missed before the card ends.
  'quiz': {
    about: 'A quiz from the brain, in one card. It sends one message at the end: the score, what was missed and how sure they were, and what they say has changed. data: { topic, questions: [{ question, options: [text] (leave out for an answer they recall unaided), answer: the right option, or the answer in a line, why: one line, source: the page }] }, one to seven questions',
    render(data) {
      const questions = list(data.questions, 7).filter((item) => item && typeof item === 'object');
      if (!questions.length) throw new BrainError('USAGE', 'The quiz needs questions: [{ question, options, answer, why, source }].', '');
      const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
      const topic = data.topic ? esc(data.topic, 60) : 'your brain';
            const pages = questions.map((item, index) => {
        if (!item.question || item.answer == null || item.answer === '') throw new BrainError('USAGE', `Quiz question ${index + 1} needs a question and its answer.`, '');
        const options = list(item.options, 4);
        if (options.length && options.filter((text) => same(text, item.answer)).length !== 1) {
          throw new BrainError('USAGE', `Quiz question ${index + 1}: exactly one of its options must be its answer.`, 'Pass `answer` as the text of the right option.');
        }
        const choices = options.map((text) => `<button class="opt" aria-pressed="false"${same(text, item.answer) ? ' data-right' : ''}><i class="dot" aria-hidden="true"></i><b>${esc(text, 160)}</b></button>`).join('\n');
        const self = options.length ? '' : '<p class="grp">Did you have it?</p>\n<div class="set self" data-one><button class="chip" aria-pressed="false" data-had>I had it</button><button class="chip" aria-pressed="false">I missed it</button></div>';
        return `<section class="pg${index === 0 ? ' on' : ''}" data-q="${index + 1}">
<p class="q">${esc(item.question)}</p>
<p class="why">From ${topic}. ${options.length ? 'Pick your answer from memory.' : 'No options here: say your answer to yourself, or write it down.'}</p>
${choices}
<div class="ask"><p class="grp">${options.length ? 'Then say how sure you are. That shows the answer.' : 'Then say how sure you are. That shows what your brain holds.'}</p>
<div class="set sure" data-one>${chip('Sure')}${chip('Think so')}${chip('Guessing')}</div></div>
<div class="rev"><span class="verdict v-right">&#10003; Right</span><span class="verdict off v-wrong">&#10007; Not quite</span><span class="verdict off v-idk">Now you know</span>
<p class="lbl">Your brain says</p>
<p class="ans">${esc(item.answer)}</p>
${item.why ? `<p class="because">${esc(item.why)}</p>` : ''}
${item.source ? `<p class="src">From ${esc(item.source, 120)}</p>` : ''}
${self}
<p style="margin:14px 0 0"><button class="mini chg" aria-pressed="false">This is out of date</button></p></div>
</section>`;
      }).join('\n');
      return frame(`A quiz of ${questions.length} question${questions.length === 1 ? '' : 's'} from what your brain holds, one at a time.`,
        `<span id="where">Question 1 of ${questions.length}</span>`,
        `<div class="bar" aria-hidden="true">${questions.map(() => '<i class="seg"></i>').join('')}</div>
${pages}
<section class="pg end" id="end" data-topic="${topic}">
<p class="q" id="score">&nbsp;</p>
<p class="why">Finish sends how it went, so I can say what is worth rereading and fix what is out of date.</p>
<div id="recap"></div>
</section>
<p class="err" id="err">Pick an answer first.</p>
<div class="foot"><button class="go" id="go" style="display:none">Continue</button><button class="quiet" id="idk">I don&#39;t know</button><button class="quiet" data-say="Stop the quiz.">Stop</button></div>`,
        `${SAY}
${CHIPS}
${QUIZ}`);
    },
  },
};

function names() { return Object.keys(CARDS); }

// Cards that existed once. A session that still asks for one is told what took its place, so it
// does not go looking for a card under another name.
const REMOVED = {
  'setup': 'The onboarding skill shows its own fixed screens, or says them in plain words.',
  'setup-review': 'The onboarding skill shows its own check screen, or a numbered list in the chat.',
  'check-in': 'The check-in skill reports in the chat; the command center is the page.',
  'meeting-brief': 'The meeting-prep skill writes the brief as text in the chat.',
  'wrap-up-summary': 'The wrap-up skill ends with a short text report in the chat.',
  'picture': 'The picture skill draws the idea with the chat\'s own visual tool, following that tool\'s design, or answers in text.',
};

function render(name, data) {
  const card = CARDS[name];
  if (!card && Object.hasOwn(REMOVED, name)) throw new BrainError('NO_CARD', `The card "${name}" was removed: show no card for it.`, `${REMOVED[name]} Cards: ${names().join(', ')}.`);
  if (!card || !Object.hasOwn(CARDS, name)) throw new BrainError('NO_CARD', `No card named "${name}".`, `Cards: ${names().join(', ')}.`);
  const input = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return { card: name, html: card.render(input), show: 'Show `html` as an inline visual, exactly as returned. A click sends an ordinary chat message.' };
}

module.exports = { render, names, esc, CARDS, REMOVED, STYLE, styleFor };
