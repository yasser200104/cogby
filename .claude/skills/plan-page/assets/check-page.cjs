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
  }

  const preset = [
    ...body.matchAll(/<input\b[^>]*\bchecked\b/gi),
    ...body.matchAll(/<option\b[^>]*\bselected\b/gi),
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
    const heads = [...body.matchAll(/how (?:this was reached|we got here|this was decided)/gi)];
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
      const tail = body.slice(last).replace(/<[^>]+>/g, " ");
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

  const marker = body.match(/REPLACE ME|REPLACE:|PASTE HERE|Lorem ipsum|TODO:/);
  if (marker) fault(`Template marker left in the page: "${marker[0]}".`);

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
    console.log("This checks nothing about whether the terms are defined in the right place, whether");
    console.log("the split is MECE, or whether the titles assert anything. That gets re-read.");
  }
  process.exit(faults.length || (strict && warns.length) ? 1 : 0);
}

if (require.main === module) main();
module.exports = { check };
