#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const faults = [];
const warns = [];
const passes = [];

const fault = (m) => faults.push(m);
const warn = (m) => warns.push(m);
const pass = (m) => passes.push(m);

function lineAt(src, index) {
  return src.slice(0, index).split("\n").length;
}

function stripBlocks(html, tag) {
  return html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "gi"), (m) =>
    " ".repeat(m.length),
  );
}

function blocksOf(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let m;
  while ((m = re.exec(html))) out.push({ body: m[1], start: m.index + m[0].indexOf(m[1]) });
  return out;
}

function stringLiterals(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
    } else if (c === '"' || c === "'" || c === "`") {
      const start = i;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      out.push({ text: src.slice(start, i + 1), index: start });
    }
  }
  return out;
}

function attrOf(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
  return m ? m[2] : null;
}

function countOf(text, re) {
  return (text.match(re) || []).length;
}

// Every decision page is slides: an opening explanation, one decision per slide, the answers, then
// how it was reached, with a strip that stays in view. `body` has scripts and styles blanked out,
// character for character, so an index in it is an index in the page.
function checkSlides(html, body, scriptText) {
  const page = body.replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
  const slides = [];
  const open = /<[a-z][a-z0-9]*\b[^>]*\bdata-slide\s*=\s*["']([a-z]+)["'][^>]*>/gi;
  let m;
  while ((m = open.exec(page))) {
    slides.push({ kind: m[1].toLowerCase(), tag: m[0], start: m.index, from: m.index + m[0].length });
  }
  if (!/<[a-z][a-z0-9]*\b[^>]*\bdata-slides\b[^>]*>/i.test(page) || !slides.length) {
    fault(
      "Not built as slides: no slides container (data-slides) holding one data-slide per step. Copy assets/slides.html and fill it.",
    );
    return;
  }
  const lastEnd = page.indexOf("</main>", slides[slides.length - 1].from);
  slides.forEach((s, i) => {
    s.to = i + 1 < slides.length ? slides[i + 1].start : lastEnd < 0 ? page.length : lastEnd;
    s.inner = page.slice(s.from, s.to);
    s.id = attrOf(s.tag, "data-id");
    s.name = s.id || `line ${lineAt(html, s.start)}`;
  });
  const decisions = slides.filter((s) => s.kind === "decision");
  if (!decisions.length) {
    fault('No decision slide: every decision is its own <section data-slide="decision" data-id="...">.');
    return;
  }
  const before = faults.length;

  const firstDecision = slides.indexOf(decisions[0]);
  const intros = slides.slice(0, firstDecision).filter((s) => s.kind === "intro");
  if (!intros.length) {
    fault(
      'No opening explanation: the situation goes on its own slide (data-slide="intro") before the first decision.',
    );
  } else if (!intros.some((s) => /<(figure|svg)\b/i.test(s.inner))) {
    fault(
      "The opening explanation has no visual. Draw the thing itself (the screen, the before and after, the real steps, real numbers) in its figure.",
    );
  }

  const seen = new Set();
  for (const s of decisions) {
    if (!s.id) {
      fault(`A decision slide has no data-id (${s.name}). It carries the source's real id.`);
    } else if (seen.has(s.id)) {
      fault(`Two decision slides carry the id ${s.id}.`);
    } else if (!s.inner.replace(/<[^>]+>/g, " ").includes(s.id)) {
      fault(`Slide ${s.id} never shows its id to the reader.`);
    }
    seen.add(s.id);
    const groups = countOf(s.inner, /\bdata-options\b/gi);
    if (groups > 1 || /\bdata-id\s*=/i.test(s.inner) || countOf(s.inner, /\bdata-note\b/gi) > 1) {
      fault(`More than one decision on a slide (${s.name}). One decision per slide.`);
    } else if (groups === 0 || countOf(s.inner, /\bdata-value\s*=/gi) < 2) {
      fault(`A decision with no control (${s.name}): it needs a data-options group with two or more options.`);
    }
    const marked = [...s.inner.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bdata-recommended\b[^>]*>([\s\S]*?)<\/\1>/gi)];
    if (marked.length > 1) {
      fault(`${marked.length} options are marked recommended on one slide (${s.name}). One at most.`);
    } else if (marked.length && !/recommend/i.test(marked[0][2])) {
      fault(`The recommended option on ${s.name} is not labelled as recommended for the reader.`);
    }
  }
  const stray = slides.find((s) => s.kind !== "decision" && /\bdata-options\b|\bdata-value\s*=/i.test(s.inner));
  if (stray) {
    fault(`A control sits on a slide that is not a decision slide (line ${lineAt(html, stray.start)}).`);
  }

  const strip = page.search(/\bdata-strip\b/i);
  if (strip < 0 || !/\bdata-count\b/i.test(page)) {
    fault(
      "No progress strip (data-strip, with its data-count): every decision as a small item and the count, always in view.",
    );
  } else if (strip > slides[0].start && strip < slides[slides.length - 1].to) {
    fault("The progress strip is inside a slide, so it leaves the view with it. It goes above the slides.");
  }

  const lastDecision = slides.lastIndexOf(decisions[decisions.length - 1]);
  const answers = slides.findIndex((s) => s.kind === "answers");
  if (answers < 0 || !/\bdata-answers\b/i.test(slides[answers].inner)) {
    fault(
      'No answers slide (data-slide="answers", holding data-answers): every answer listed, and what is still open, before they are sent or copied.',
    );
  } else if (answers < lastDecision) {
    fault("The answers slide comes before the last decision. It goes after every decision.");
  }

  const moves = [
    [/\bdata-prev\b/i.test(page) && /\bdata-next\b/i.test(page), "Previous and Next buttons"],
    [/ArrowLeft/.test(scriptText) && /ArrowRight/.test(scriptText), "the left and right arrow keys"],
    [/touchstart|pointerdown/.test(scriptText), "a swipe"],
  ].filter(([ok]) => !ok);
  if (moves.length) {
    fault(`No way to move between slides by ${moves.map(([, what]) => what).join(", or by ")}. Keep the template's script and bar.`);
  }

  if (faults.length === before) {
    pass(
      `Built as slides: an opening explanation with a visual, ${decisions.length} decision${
        decisions.length > 1 ? "s" : ""
      } one per slide, a progress strip, an answers slide.`,
    );
  }
}

function check(html) {
  const body = stripBlocks(stripBlocks(html, "script"), "style");
  const styles = blocksOf(html, "style")
    .map((b) => b.body)
    .join("\n");
  const scripts = blocksOf(html, "script");
  const isDecisionPage = /DecisionKit\s*\(/.test(html);

  const dashHits = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "—" || body[i] === "–") dashHits.push(lineAt(html, i));
  }
  for (const s of scripts) {
    for (const lit of stringLiterals(s.body)) {
      if (/[—–]/.test(lit.text)) dashHits.push(lineAt(html, s.start + lit.index));
    }
  }
  if (dashHits.length) {
    fault(
      `${dashHits.length} em dash or en dash in reader-visible text (line${
        dashHits.length > 1 ? "s" : ""
      } ${[...new Set(dashHits)].slice(0, 8).join(", ")}). Use colons and commas.`,
    );
  } else {
    pass("No em dash or en dash in reader-visible text.");
  }

  const linked = new Set(
    [...html.matchAll(/<a\b[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]),
  );
  const remote = [];
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    if (!linked.has(m[1]) && !/^https?:\/\/[^/]*w3\.org/.test(m[1])) remote.push(m[1]);
  }
  for (const m of styles.matchAll(/url\(\s*['"]?(https?:\/\/[^)'"]+)/gi)) remote.push(m[1]);
  if (remote.length) {
    fault(
      `${remote.length} remote resource loaded by the page (${remote[0]}). It must open with no network.`,
    );
  } else {
    pass("No remote resource: the page opens offline.");
  }

  if (/<script[^>]*\bsrc\s*=\s*["'][^"']*decision-kit\.js/i.test(html)) {
    fault("decision-kit.js is referenced by src. Inline it: the file lane has no server.");
  } else if (isDecisionPage && !/function\s+DecisionKit\b/.test(html)) {
    fault("DecisionKit() is called but never defined in the page. Paste assets/decision-kit.js in.");
  } else if (isDecisionPage) {
    pass("decision-kit is inlined in the page.");
  }

  if (isDecisionPage) {
    if (!/\.copy\s*\(/.test(html) && !/\.block\s*\(/.test(html)) {
      fault("No Copy answers path: kit.copy() or kit.block() is never called, so answers are stuck.");
    } else {
      pass("Copy answers path present.");
    }
    if (!/onStatus/.test(html)) {
      warn("No onStatus handler: the page never tells him whether an answer was saved.");
    }
    checkSlides(html, body, scripts.map((s) => s.body).join("\n"));
  } else {
    warn("No DecisionKit() call: this is not a decision page, so the slide checks did not run.");
  }

  const preset = [
    ...body.matchAll(/<input\b[^>]*\bchecked\b/gi),
    ...body.matchAll(/<option\b[^>]*\bselected\b/gi),
    ...body.matchAll(/<[a-z][a-z0-9]*\b[^>]*\baria-pressed\s*=\s*["']true["']/gi),
  ];
  const presetLines = preset.map((m) => lineAt(html, m.index));
  if (presetLines.length) {
    fault(
      `${presetLines.length} control starts pre-selected (line${
        presetLines.length > 1 ? "s" : ""
      } ${presetLines.slice(0, 8).join(", ")}). A set control reads as your opinion, not his question.`,
    );
  } else {
    pass("Every control starts unset.");
  }

  const svgTags = [...body.matchAll(/<svg\b[^>]*>/gi)];
  if (svgTags.length) {
    const noViewBox = svgTags.filter((m) => !/viewBox/i.test(m[0]));
    if (noViewBox.length) {
      fault(
        `${noViewBox.length} of ${svgTags.length} <svg> has no viewBox: it breaks on resize (line ${lineAt(
          html,
          noViewBox[0].index,
        )}).`,
      );
    } else {
      pass(`All ${svgTags.length} SVG have a viewBox.`);
    }
    const noLabel = svgTags.filter((m) => !/aria-label|aria-labelledby/i.test(m[0]));
    if (noLabel.length) warn(`${noLabel.length} <svg> with no aria-label.`);
    const noRole = svgTags.filter((m) => !/role\s*=\s*["']img["']/i.test(m[0]));
    if (noRole.length) warn(`${noRole.length} <svg> with no role="img".`);
  } else if (body.replace(/<[^>]+>/g, " ").trim().length > 6000) {
    warn(
      'A long page with no diagram is almost always a paragraph that should have become one. See "the diagram carries the argument".',
    );
  }

  const tables = [...body.matchAll(/<table\b/gi)];
  if (tables.length) {
    if (!/overflow-x\s*:\s*(auto|scroll)/i.test(styles)) {
      fault(
        `${tables.length} table(s) and no overflow-x:auto rule anywhere in the page: the body will scroll sideways.`,
      );
    } else {
      pass(`${tables.length} table(s), and a scrolling container rule exists.`);
    }
  }

  if (isDecisionPage) {
    // What the reader sees: a label kept in an attribute or a comment is not the section.
    const blank = (m) => " ".repeat(m.length);
    const seenText = body.replace(/<!--[\s\S]*?-->/g, blank).replace(/<[^>]*>/g, blank);
    const heads = [...seenText.matchAll(/how (?:this was reached|we got here|this was decided)/gi)];
    if (!heads.length) {
      fault(
        'No "How this was reached" section. Mandatory on any page that recommends something: ruled out, nearly went the other way, not sure of.',
      );
    } else {
      const last = heads[heads.length - 1].index;
      const after = [...body.matchAll(/<h[12]\b/gi)].filter((m) => m.index > last);
      if (after.length) {
        warn(
          `"How this was reached" is followed by ${after.length} more section(s) (line ${lineAt(
            html,
            after[0].index,
          )}). It goes last.`,
        );
      } else {
        pass('"How this was reached" present, at the end.');
      }
      const tail = seenText.slice(last);
      const partsFound = [
        /ruled out|discarded|rejected|left out/i,
        /nearly|almost|close call|tipped|went the other way/i,
        /not sure|unsure|uncertain|did not verify|didn't verify|unverified/i,
      ].filter((re) => re.test(tail)).length;
      if (partsFound < 3) {
        warn(
          `The closing section has ${partsFound} of its 3 parts (ruled out / nearly went the other way / not sure of).`,
        );
      }
    }
  }

  const marker = body.match(/REPLACE ME|REPLACE:|PASTE HERE|Lorem ipsum|TODO:|TEMPLATE:/);
  if (marker) {
    fault(`Template marker left in the page: "${marker[0]}" (line ${lineAt(html, marker.index)}).`);
  }
  if (/PLACEHOLDER LOOK/.test(styles)) {
    fault("The template's placeholder look is still in the page. Replace that style block with the design skill's.");
  }

  if (!/<title>\s*\S/.test(html)) warn("No <title>: the browser tab will show the file name.");
  if (!/charset/i.test(html)) warn("No charset meta.");
  if (!/name\s*=\s*["']viewport["']/i.test(html)) warn("No viewport meta: unreadable on his phone.");
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--strict" && a !== "--json");
  const strict = process.argv.includes("--strict");
  const asJson = process.argv.includes("--json");
  if (!args.length) {
    console.error("usage: node check-page.cjs <page.html> [--strict] [--json]");
    process.exit(2);
  }
  const file = args[0];
  if (!fs.existsSync(file)) {
    console.error("Page not found: " + file);
    process.exit(2);
  }
  check(fs.readFileSync(file, "utf8"));

  if (asJson) {
    console.log(JSON.stringify({ file, faults, warns, passes }, null, 2));
  } else {
    const line = "=".repeat(76);
    console.log(line);
    console.log("PAGE CHECK: " + path.basename(file));
    console.log(line);
    passes.forEach((m) => console.log("  OK      " + m));
    warns.forEach((m) => console.log("  WARN    " + m));
    faults.forEach((m) => console.log("  FAULT   " + m));
    console.log("-".repeat(76));
    console.log(`${passes.length} checks passed, ${faults.length} faults, ${warns.length} warnings.`);
    if (faults.length) console.log("VERDICT: not ready. Fix every FAULT before handing the page over.");
    else if (warns.length) console.log("VERDICT: ready, with points to look at.");
    else console.log("VERDICT: ready.");
    console.log("This checks nothing about whether the opening visual shows the thing itself, whether the");
    console.log("terms are defined in the right place, whether the split is MECE, or whether the titles");
    console.log("assert anything. That gets re-read.");
  }
  process.exit(faults.length || (strict && warns.length) ? 1 : 0);
}

if (require.main === module) main();
module.exports = { check };
