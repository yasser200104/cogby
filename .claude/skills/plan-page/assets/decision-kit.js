function DecisionKit(opts) {
  const slug = opts.slug || "decisions";
  const onChange = opts.onChange || function () {};
  const onStatus = opts.onStatus || function () {};
  const LS_KEY = "decision-kit:" + slug;
  const DOC = "review/decisions";

  // What the page recommended, by row id: { T3: "keep" }. Fixed by the page, never by a click. It
  // travels back with the answers, so the session that reads them can tell a recommendation taken
  // from one chosen against. A row with no entry had no recommendation.
  const recommended = Object.assign({}, opts.recommended || {});
  const state = { marks: {}, notes: {} };
  let db = null;

  function readLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const o = JSON.parse(raw) || {};
      Object.assign(state.marks, o.marks || {});
      Object.assign(state.notes, o.notes || {});
    } catch (e) {
    }
  }

  function writeLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  let chain = Promise.resolve();
  let dirty = false;

  function persist() {
    writeLocal();
    if (!db) {
      onStatus("local", "Saved in this browser: press Copy answers when done");
      return;
    }
    dirty = true;
    onStatus("pending", "Saving…");
    chain = chain
      .then(async () => {
        if (!dirty) return;
        dirty = false;
        await db.doc(DOC).set({
          marks: state.marks,
          notes: state.notes,
          recommended: recommended,
          slug: slug,
          updated: new Date().toISOString(),
        });
        if (!dirty) onStatus("ok", "Saved");
      })
      .catch(() => {
        dirty = false;
        onStatus("local", "Saved in this browser: press Copy answers when done");
      });
  }

  function mark(id, value) {
    if (state.marks[id] === value) delete state.marks[id];
    else state.marks[id] = value;
    persist();
    onChange();
  }

  function note(id, text) {
    const v = (text || "").trim();
    if (state.notes[id] === v) return;
    if (v) state.notes[id] = v;
    else delete state.notes[id];
    persist();
    onChange();
  }

  function block(allIds) {
    const ids = allIds || Object.keys(state.marks);
    const date = new Date().toISOString().slice(0, 10);
    const lines = ["=== COGBY ANSWERS · " + slug + " · " + date + " ==="];
    const unanswered = [];
    ids.forEach((id) => {
      const m = state.marks[id];
      const n = state.notes[id];
      if (!m && !n) {
        unanswered.push(id);
        return;
      }
      if (m && n) lines.push(id + ": " + m + " · " + n);
      else if (m) lines.push(id + ": " + m);
      else lines.push(id + ": ? · " + n);
    });
    // Always written, "none" included: a block with no such line came from a page built before
    // recommendations were carried, and says nothing either way.
    const rec = Object.keys(recommended).map((id) => id + "=" + recommended[id]);
    lines.push("recommended: " + (rec.length ? rec.join(", ") : "none"));
    if (unanswered.length) lines.push("unanswered: " + unanswered.join(", "));
    lines.push("=== END ===");
    return lines.join("\n");
  }

  async function copy(allIds) {
    const text = block(allIds);
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText =
        "position:fixed;inset:10% 10% auto;width:80%;height:50vh;z-index:9999;padding:12px;font:13px/1.5 ui-monospace,monospace";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e2) {}
      if (ok) ta.remove();
      else ta.addEventListener("blur", () => ta.remove(), { once: true });
      return ok;
    }
  }

  readLocal();
  onStatus("local", "Saved in this browser");

  const ready = (typeof window !== "undefined" && window.claude && window.claude.use
    ? window.claude.use("db")
    : Promise.resolve(null)
  )
    .then(async (store) => {
      if (!store) {
        onStatus("local", "Saved in this browser: press Copy answers when done");
        return "local";
      }
      db = store;
      try {
        const snap = await db.doc(DOC).get();
        if (snap.exists) {
          const d = snap.data() || {};
          state.marks = Object.assign({}, state.marks, d.marks || {});
          state.notes = Object.assign({}, state.notes, d.notes || {});
          writeLocal();
          onChange();
        }
        onStatus("ok", "Saved");
        if (Object.keys(state.marks).length || Object.keys(state.notes).length) persist();
      } catch (e) {
        onStatus("local", "Saved in this browser: press Copy answers when done");
        return "local";
      }
      return "store";
    })
    .catch(() => {
      onStatus("local", "Saved in this browser: press Copy answers when done");
      return "local";
    });

  return {
    ready,
    mark,
    note,
    block,
    copy,
    answers: () => ({
      marks: Object.assign({}, state.marks),
      notes: Object.assign({}, state.notes),
      recommended: Object.assign({}, recommended),
    }),
    markOf: (id) => state.marks[id],
    recommendedOf: (id) => recommended[id],
    noteOf: (id) => state.notes[id] || "",
  };
}
