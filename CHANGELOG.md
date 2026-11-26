# Changelog

What changed in each version of the Cogby plugin, newest first.

## 0.4.0 (2026-11-26)

Your own tools, after the owner's run of the onboarding: to-dos and meetings follow the tool you
already use.

- **To-dos in your own tool.** When your brain says where you keep your to-dos (Notion, Google Tasks,
  Asana or another tool) and the chat can reach it, Cogby adds, reads and ticks them there, and says
  where each one went. Its own list is used only when you have no tool, or the tool is not connected
  in that chat. Never the same to-do in both. "Connect my to-dos" sets it up at any time.
- **Catch up on your meetings.** "Catch me up on my meetings" goes through every meeting held since
  the last one in your brain, reads the ones that have a transcript or notes, and shows what was
  decided, promised and learned for one yes. A record keeps that and a link to the recording, never
  the transcript. The tool your meetings are recorded in is tried first. "Set up my routines" now
  offers a daily meeting catch-up; run on a schedule it writes nothing: it leaves one question.
- **Any chat knows where to look.** What is coming is read from your calendar, what was held from
  your brain's meeting records.
- **My view: a project opens on where it stands.** A click on a project now opens on what needs you
  there, Now and Next when they are written, where you stopped, the chats open on it and its open
  tasks, with its documents, what was promised and its notes beside them. Its status is a menu on
  that view: change it there and Cogby writes it on the project's card, keeping the old one in the
  card's timeline (`cogby project status`).
- **My view: an inbox you can act on.** The first tab is now Inbox: what Cogby left you, the chats
  that wait for you and your routines' latest results, in one list. A notification shows what Cogby
  suggests with one press to take it ("Yes, do that"), or its own answers. Later and Clear take it
  off the page at once, with a few seconds to undo. A click still shows its full text, the project it
  belongs to and what happens if nothing is done, and you can answer in your own words. Newest
  first; the ones older than 14 days are folded under "Older".
- **My view: Copy prompt.** The page cannot start Claude. One button at the top gathers everything
  you chose and asked on the page into a single request to paste into a new chat, which handles it
  end to end. What you press is still saved on the published page and applied the next time Claude
  refreshes it. This replaces "Do this", the "sent" mark on every row and the one line per
  notification.
- **My view: Tasks, Sessions and My Cogby.** Tasks is one list, with your quick notes under it. A
  task can be handed to Cogby, which proposes a plan and waits for your yes, or to a new chat with
  Claude. To-dos kept in a tool of your own show among your tasks with where each lives, and open
  there. Sessions lists your open chats with Claude, by project or by who acts next, when Claude
  could read them for the page. My Cogby, in the corner, holds your routines (each opens on what its
  last runs found, with a flag when it is late or not scheduled, Run it now and a line to describe a
  new one), the skills you can ask for and your sources. The page no longer shows a timeline of the
  last changes.
- **A notification asks something.** Whoever leaves one gives a question with its answers, or one
  thing to go ahead with; what needs nothing from you goes under "Done without you".
- **Decision pages are slides.** Whatever the number of rows: the situation is explained first, with
  a picture of the thing itself (the real screen, the before and after), then one decision per slide.
  Move with the arrow keys, the Previous and Next buttons, or a swipe on a phone.
- **Your answers build up in view.** A strip at the top shows every decision with what you chose and
  how many are answered, and a last slide lists every answer and what is still open, with what they
  add up to, before you copy or send them.
- **Wrap-up fills in where a project stands.** When a project you worked on has nothing written under
  Now or Next, the wrap-up proposes a line for each.

Onboarding after the second outside tester, who found the screens far too slow and whose email and
files were never looked at.

- **Plain chat, one screen.** Hello, Get to know you and You're set are said in the chat, each under
  one progress line ("Step 1 of 2 · Get to know you"). Only Check it is still a screen: the styling
  and script the other screens needed are gone, and it is copied once instead of four times.
- **After the owner's own run.** "Looks right, create it" never fails silently: the screen shows the
  reply as text every time, and Cogby says under it that you can answer in the chat. Hello is no longer
  counted as a step: two steps, Get to know you and Check it. The line saying what Cogby finds is saved
  on your computer sits right under the question that asks to look. While Cogby looks, it says to stay
  and that it will need you to check what it found.
- **After the owner's live run of the release copy.** The list of steps the chat shows is six lines
  written for you ("Introducing Cogby" to "Taking it for a first spin"), given from the first moment
  and never Cogby's own preparation. While it looks, Cogby says that a helper is reading through your
  work, that two things happen at once, and that you only need to answer in the chat.
- **Four questions, asked while Cogby looks.** Your name and what you do; what matters most; what you
  already use Claude for and what you wish it did every day; and a guess, from what you do, of what
  you want to understand yourself and what you would rather hand over, for you to correct. The first
  and the last are always asked; the two in between only while the look is still running. When the
  look finishes first, Cogby asks the last one and shows what it found. What was not asked waits for
  later chats, one per chat. A morning check-in is offered when your answer asks for one.
- **Where your to-dos and your meetings live** is found, not asked: Cogby looks at what is connected,
  says what it found in one line ("Notion is connected, so your to-dos can stay there") and keeps it
  as one fact in your brain. Nothing found: it asks in a later chat, and keeps your answer the same
  way. A tool that is not connected yet stops nothing: "connect my to-dos" or "connect my meetings"
  picks it up later.
- **A new hello.** "Hi, I'm Cogby. Think of me as your second brain: I keep your projects, your
  people and your plans lined up, and nothing gets lost." Then what you get (say it once, and Cogby
  does better after a correction) and how it works (notes in a folder on your computer, with your
  OK). The four folders and the line on critical thinking are no longer in the hello. It has its
  French wording too, said as written when you write in French.
- **Check it appears sooner.** Cogby writes a short list of what it found, one line per item (its
  name, where it came from, and whether it is a project, ongoing, done or a person), and the screen
  draws the rows itself. An item is about 55 characters instead of about 520, so a map of 30 items is
  about 19,000 characters to write instead of about 30,000. The picker, the pencil, the bin, the Add
  boxes, the count and the reply the screen sends are unchanged.
- **Your language.** Onboarding follows the language you write in, and asks only when it is unclear:
  every step in the chat, and every label on Check it. For Arabic and other right-to-left languages
  the screen turns around. The language is saved in your profile, so later chats use it.
- **"What do you want to understand yourself?" is a guess you correct,** the last question of the
  interview, about subjects ("hiring decisions") and not project names, three at most. Check it no
  longer carries two lists for it, so the screen is lighter. Only what you say or confirm is saved,
  on both lists of your information border; "ask me as we go" saves nothing.
- **One real thing at the end.** Right after your brain is created, Cogby prepares your next meeting
  when a calendar is connected, or lists what is on your plate this week. When it found too little
  to go on, it skips this and keeps the three things to try.
- **Credit.** The last message says, once: "Your brain is organised with PARA, a method by Tiago
  Forte." PARA is named nowhere else.
- **Shorter starting files, for new brains only.** The file on who Cogby is keeps who it is and its
  voice, and no longer repeats the brain's rules. The file on who you are keeps who you are, what
  you do, what matters most, how to answer, the hard rules and standing work; it no longer asks for
  age, a 12-month aim, platform, disposition or how you work with AI. Brains that exist are not
  changed.
- **The bin stands out** on Check it: its own colour and a border, and an arrow in its place once a
  row is removed, to bring it back.
- **Cogby checks what is connected before it looks.** It searches the chat's tools for a calendar,
  mail and files before deciding one is missing. For what is missing it asks which one you use, shows
  where to connect it, and takes "skip"; You're set says what you can still connect.

Pictures that explain, and a quiz you can read. After the owner's own test of both on 25 Nov 2026.

- **A picture is drawn, not filled in.** The fixed picture card is gone: it could only set words in
  boxes under Cogby's mark. Claude now draws the idea itself with the chat's own visual tool, in
  that tool's own design, so a picture looks like part of the chat. The kind of visual is chosen
  for the subject, from everything the tool can make, not from a fixed list. The `picture` skill
  says only what the drawing has to show: the real things by name, what moves or changes between
  them, and one place to look. Cogby adds nothing to how a picture looks: no mark, no frame, no
  colour of its own. A picture is signed by one line under it, the way a session wrap ends:
  "Cogby · from" and the page it came from, or that your brain has nothing on this yet. It is checked before it is shown ("cover the words: does it still say
  something?"), and followed by how to read it.
- **The full explanation, as a page.** When one picture is not enough, on your ask or on a yes to a
  one-line offer: a private page with the whole in one drawing, each part in turn, a worked example
  from your own work, what people get wrong, the sources, and three questions to check it landed.
- **The quiz: what you press stays readable.** A pressed answer keeps its text as it was and gains
  an outline, a light wash and a mark that fills with a check. Before, its text changed colour, and
  in the chat it could no longer be read. A line at the top shows how far along you are; a revealed
  answer says in words which was yours and which was right; the last screen lists every question
  with how it went. "That has changed" is now "This is out of date".
- **Cards look like the chat.** The chat's own font, thinner lines, and Cogby's mark without the
  dark square behind it.
- `cogby card picture` is refused, and the refusal says the skill draws it now.
- The plugin can be uploaded to Cowork: three skill descriptions held a placeholder in angle
  brackets, which Cowork's upload refuses. They use square brackets now.

The save lock: saves are no longer refused after a chat closes. On 24 and 25 Nov 2026 the brain's
save lock was left behind five times, each within seconds of the app closing a chat, and every save
after it was refused until the lock was removed by hand.

- **Why it happened.** When a chat closes, Cogby saves the day's log into the brain's history.
  Claude Code gives that closing step 1.5 seconds and then stops it wherever it is; on this
  computer the step needed 2 to 3. Stopped while git held its lock, the lock stayed.
- **The save no longer runs in the closing step.** The step now only hands the work to a small
  helper that belongs to nobody and returns at once (about a quarter of a second). The helper does
  what the step did, in the same order: it saves the day's log, works out what the session
  changed, and starts the automatic wrap-up when that is on. Nothing stops it half-way.
- **Looking no longer locks.** Each time Cogby asks git what changed (when a chat opens, when it
  closes, before it tidies `.gitignore`), it now asks in git's no-lock mode. Before, each look
  held the lock for as long as it took to scan the brain.
- **A safety net, on the owner's yes of 25 Nov.** Before a save, Cogby removes a leftover lock by
  itself, only when the lock has not been touched for 10 minutes and no git program is running on
  the computer. A fresh lock, a lock with a git running, or a computer whose running programs
  cannot be listed: never touched, and the save says git refused, as before. Each removal, and each
  old lock left alone, leaves a line in `.cogby/self/.gateway/save-lock.log`, which stays on this
  computer.
- The plugin also asks Claude Code for more time for the closing step (30 seconds), as an extra:
  the step no longer needs it.
- For whoever tests it: `COGBY_SESSION_END_INLINE=1` keeps the work in the closing step itself, so
  a dry run (`BRAIN_WRAPUP_DRYRUN=1`) prints what it would do; and
  `node tests/manual/lock-sweep.cjs` stops the closing step at many moments on a throwaway brain
  and counts the locks left behind.

Which Cogby is this. After the owner ran an onboarding on a computer with three copies of Cogby
installed, and nothing said which one the chat was running.

- **The version is shown.** The hello ends on a small plain line, "Cogby version 0.4.0", in English
  and in French, and My view says "Cogby 0.4.0" in one quiet line at its foot. Both are read from the
  plugin's own `plugin.json`, never written in by hand, and a test version such as "0.4.0-rc1" is
  shown as it is. Each chat's session start names the version and the folder it runs from, also
  before any brain exists, and `cogby --version` reads the same file.

The Notion mirror, an extra for people who want to see their brain in Notion. Off until turned on.

- `cogby mirror on --parent <notion page link>` keeps a copy of the brain under one Notion page:
  every project and area card, every page under people, organizations and threads, the open to-dos
  and the decisions. Each mirrored page opens by saying it is a copy; the brain stays the one home.
  Not mirrored: `resources/`, the archive, the day log, meeting records, notes, notifications,
  routines and `.cogby/self/`. A card with `mirror: false` stays out, and what looks like a secret
  is blanked before it leaves.
- `cogby mirror push` updates Notion through Notion's own command-line tool (`ntn`), with no model
  in the loop: only pages that are new or changed are written, a run that stops halfway is picked up
  where it stopped, and nothing is ever deleted in Notion. Without `ntn`, a session writes the pages
  through its own Notion connection (`cogby mirror plan`, `page`, `done`).
- To-dos come back: a to-do ticked on the mirrored To-dos page is done in the brain, and a line
  added there is a new to-do (`cogby mirror pull`, run first by every push). Nothing else comes
  back: any other edit made in Notion is overwritten.
- A new skill, `notion-mirror`, sets it up after saying what leaves the computer, and updates it on
  request. You start it by typing `/cogby:notion-mirror`: it is left out of the list of skills Claude
  reads, so someone who does not use Notion never hears of it. While the mirror is on, each wrap-up
  updates it too (`cogby mirror push --if-on`, silent on a brain where it is off).
- Which Notion page is which is remembered on the machine that made the mirror, so a mirror is
  kept from one machine. Pages only, no Notion databases yet.

A private brain, for a second brain on the same computer (for example a personal one beside a work
one).

- **`cogby init --brain <folder> --private`** makes a brain private, or marks one you already have.
  A private brain is used only from a chat or a command started in its own folder.
- **Never the default.** It cannot be made the default brain, and a default brain that is marked
  private stops being the default. From any other folder, Cogby never falls back to it.
- **Closed from outside.** Naming it from another folder is refused, so a chat about work cannot
  search it or write to it through Cogby.
- **Closed from inside.** A chat opened in it uses no other brain: it cannot write to your main one.
  Its turns are logged and saved in it and nowhere else: if the chat's folder moves into another
  brain, they are not logged at all. A chat opened anywhere else never logs or saves into it.
- **Not read by another brain.** It cannot be added as a place to search, it is passed over when a
  folder that holds it is searched, and it cannot be imported into another brain.
- **What this does not do.** It guards Cogby's own commands, tools and hooks. It does not stop a
  person or an agent from opening its files directly, and a personal topic raised in a chat opened
  in another folder is still saved to that folder's brain. Onboarding does not offer it yet.

Cogby is the memory and the coach of your routines; whatever tool you use does the running. Cogby
runs nothing itself, schedules, changes or puts back nothing without your yes, and tracks no habits.

- **One page per routine, complete enough to move.** What it does (its full instructions, in plain
  words), why you have it, how often, where it runs (which tool, your computer or the cloud, what
  has to be open) and what each run found. Any tool can read the page and set the routine up
  again: say "I moved to another tool, set my routines up here" and Cogby offers each one from its
  page. What is scheduled right now is still read in the scheduler, never copied.
- **It asks once if you have none.** "Is there something you'd like to happen without asking?" It
  also offers, once, to record things already scheduled that it does not know, and asks once for
  the reason of a routine that has none. One such ask a week at most, the same one never twice,
  none under `cogby proactive quiet`.
- **It teaches as it sets up.** One plain line each time: where this will run, what has to be
  open, and what happens if the computer is off.
- **It tells you when a routine is not really running, by exception only.** Each scheduled run,
  check-in and question about routines starts with a quiet check. A scheduled task that is gone or
  switched off gets one question, "Put it back" or "Leave it". A run that did not happen is said.
  Cogby does not run a missed routine itself: the tool that schedules it decides (the Claude app
  runs a missed task when it next opens).
- **Once a week it reviews them.** In the weekly check-in: which ran, which days were missed,
  which results you used and which nothing followed, and at most one suggestion (move its time,
  change what it runs, or pause it).
- **My view shows each routine with its last result and flags only a problem.** The page itself
  comes with the My view rework, which already shows every routine, its last results and a late
  or not-scheduled flag. This work adds what that page needs underneath: for each routine, what is
  wrong with it and where it runs.
- **A routine proposed from your own words.** When the same ask keeps coming back, the look-back
  (or, without it, the weekly check-in) proposes a routine with your words as the evidence: one
  routine proposal a week at most, built only on your yes.
- "Prepare my team meeting on Monday morning" is an ordinary routine whose job is to prepare.
  There is no separate kind of routine for things you do yourself, and Cogby does not ask
  whether the event happened.
- **A daily look-back you can turn on.** A built-in routine, off until you ask for it. Each
  morning it reads what you asked the day before and proposes what keeps coming back: a routine
  for a need on a rhythm, a skill for a task you explain again and again, a rule for something you
  corrected, a topic worth understanding, or something you said that was never saved. Three
  proposals at most, each with your own words as the evidence, and nothing is made, scheduled or
  written before your yes. It is one of the built-in routines "set up my routines" offers.
- For other tools: `cogby dream` also returns `days`: what the owner asked the day before, cut
  from the day's log with no model (`--since YYYY-MM-DD` for every day from that one, seven at
  most). `look-back` is on the list of what may run unasked: it reads and leaves proposals.
- For other tools: `cogby routines add|edit … --where "…" --instructions "…"`, and `where`,
  `instructions` and `gaps` on each routine. `cogby routines offered` now also refuses the same
  offer twice.
- For other tools: `cogby routines --json` carries, for each routine, the days missed in the last
  seven (`week`) and what is wrong with it (`problem`). The `routines` part of `cogby view --json`
  gains `all`: every active routine with `scheduled`, `scheduled_as`, its last five runs
  (`history`), `week`, `problem`, `where` and `gaps`. New command `cogby routines offered "<the routine>" --source "<evidence>"`, the
  gate an agent passes before it offers a routine.

## 0.3.11 (2026-11-22)

Onboarding, very simple: hello, let me get to know you, here's your brain. After the owner's review
and the first outside tester.

- Three steps, then You're set. **Hello:** Cogby says hello in the chat ("Hi, I'm Cogby. Let's work
  together: …", then how it files your work in four folders), and the screen stays minimal: "Meet
  Cogby", the four folders as small cards, the three steps. **Get to know you:** "Can I get to know
  your work?", calendar, email, files and your computer as cards with icons to untick (no to-dos:
  most people keep none in a connected tool), and Light (the default) or Deep (also email messages and what's inside files; it
  says plainly that this uses much more of your Claude allowance). **Check it:** your name and what
  you do, and what Cogby found, each row with a picker (Project, Ongoing, Done) and a bin; Done is
  filed in the Archive. **You're set:** My view first, "where you and I keep track of everything",
  then what to try, then "start a new chat, from anywhere".
- While Cogby looks through your work in the background, it asks a few questions in the chat: who
  you are, what matters most right now, what you want to understand yourself, and whether you want
  a morning check-in. The brain is created only after you check what it found.
- No more Quick choices and no Folders screen. Safe defaults, said in one line: Cogby asks before
  it sends, deletes or spends (pushing code too, when it finds code folders), answers first in plain
  words, keeps your brain in Cogby Brain in your home folder, saves it when you say "wrap up", keeps
  My view on, and runs no routine until you pick one. A folder is offered when a chat opens in it.
- The questions not reached wait in a new file, `.cogby/self/getting-to-know.md`, and a new chat is
  told the next one: at most one a chat, at a natural pause, each asked once and skippable.
- The screens take My view's light look in every theme: white cards on a white panel, a light grey
  band, Cogby's violet, and small corners.
- Cogby's default design, used for the other pages it makes, takes the same light look: white
  pages and cards, a light grey band, Cogby's violet, and small corners (4 to 8 px).

## 0.3.10 (2026-11-19)

My view, the way the owner worked in the old Console.

- Notion's white: page and cards white, bands and pressed states a light neutral grey, in place
  of the beige. Text and buttons stay Cogby's violet.
- Squarer: smaller corner rounding on cards, buttons, tags and meeting blocks (4 / 6 / 8 / 6 px).
  Dots and ticks stay round.
- Today: what waits on you first, then the Console Home's "Today's tasks": overdue and today,
  done today, and Add a task for today. The day's calendar stays on the right.
- Tasks & notes: the left side is the Console's tasks view: All / Mine / Cogby's, a New task
  window for a to-do or a note, To do / Planned by project / Done today, and a click on a date
  changes it. Notes stay on the right, and a new note can carry details.
- Projects: the Console's list, with search and status filters ("Anything not done" first), one
  row per project with its status, open to-dos and when it last moved, and sub-projects under
  their parent. A project's page has the Console's header and Tasks, Sub-projects, Documents
  (the files in its folder) and Project context tabs.

## 0.3.9 (2026-11-18)

Onboarding, rebuilt after the owner ran it live and found it too technical: fun, plain, not scary.

- Skills a person sees or types have plain names: setup is now **onboarding**
  (`/cogby:onboarding`), command-center is **my-view**, quiz is **quiz-me**, meeting-debrief is
  **meeting-notes** and html-plan is **plan-page**. The old words still start them: "set me up",
  "command center", "debrief the meeting", "quiz me", "html plan".
- The brain page is called **My view**, your brain on one page, in the onboarding and the skill.
- A welcome first: "Meet Cogby. It remembers, you decide.", four cards on what it does, the five
  steps, and the four places with "Cogby does the filing". Then five steps: Quick choices, What you
  have, About you, Check it, You're set.
- Every screen is fixed: one file beside the skill holds each screen in Cogby's colours (the design
  system's own, light and dark) with its mark and a five-step bar, readable deep violet text at 14
  to 16 px. Claude copies a screen into its own inline visual and fills in only the person's names;
  a plain-text twin stands in where a chat cannot show visuals. A click sends an ordinary reply.
- Quick choices asks only what applies to everyone. Where the brain lives and what a due routine
  does are defaults, said in one line. "Push or deploy code" is offered only when Cogby finds code
  folders.
- No more "do you keep notes somewhere?". Cogby offers to map your work itself, from what you tick:
  calendar titles and dates, email recipients and subjects, file names, the folders of past Claude
  Code chats, your to-dos where they live. You fix the map by clicking (drop, rename, move, add)
  and pick your top three priorities, in place of "What are you trying to accomplish?".
- Check it: one profile card, the question of what you want to understand yourself with examples
  from your own map (the answers go on the list of what you care about understanding yourself),
  and one line of counts.
- You're set: folders are connected on one screen after a yes, never one question per project; the
  routines you picked are scheduled for real and called "on" only once the scheduler confirms; the
  ending says what's ready, what to try first, links your brain page, and asks you to start a new
  chat, from anywhere. No paths, no terminal command. You never type a command anywhere.
- One screen per reply, never the whole run as one long page. Each command Claude runs carries a
  plain description of what it does for you.
- To-dos found in your own task tool are read there and never copied: until the two lists sync on
  their own, your tool is the list to trust, and the screens say so.
- Right after onboarding, building the brain page and the first thing you try (a meeting prep,
  "what needs me today?") stay just as plain: one line on what's happening, then the result.

My view, simpler, after the owner's review of the page: less to read, and a way to fix a line.

- Projects is a plain list of names, A to Z, in columns. A small count shows only when something
  in a project waits for you. Folder-style names read as words ("Hiring autumn 2026").
- No confirmed or unconfirmed marks anywhere on the page. Point at a timeline line and a Fix button
  appears: what you type is sent to the next session, which records it as your correction and
  offers to retract the line when you say it is wrong.
- Today shows your day hour by hour: each meeting a block at its time, meetings at the same time
  side by side, finished ones faded, all-day events on top. A meeting opens a card with the time,
  who is in it, Join, Prepare me and a box for your notes. Meetings carry their start and end.
- A to-do opens a panel: change its words, due date, project and details, mark it done or open it
  again, or remove it. To-dos keep details (`cogby todo add/edit --body "…"`, `none` clears them),
  and the page sends a seventh kind of change, a to-do edit.
- Less text: no intro sentences or section subtitles, long items cut to two lines (tap to see the
  rest), the suggested answer a small mark on its button, and "Not applied yet" now reads "sent".

## 0.3.8 (2026-11-18)

The command center, after the owner's review of the page: less on it, and one list of what waits.

- No Send bar. On the published page, a choice you press (Later, Clear, an answer, Prepare me) is
  sent at once, and a comment is sent when you press its Save. Cogby's suggested answer is shown,
  never sent for you. On a page opened from disk, a small "Copy my answers" button sits at the top
  while something is unsent.
- No footer, and no "days old" banner: the "As of" time at the top is the page's age.
- The Cogby mark sits on the page without its dark tile.
- Today: "Needs you" also lists the routines that are due and, when there are any, how many lines
  Cogby wrote that wait for your confirmation. "Moving this week" is gone, and so is the meetings
  box when no calendar was read. One "Tasks & notes" block takes the place of "Due" and "Capture".
- To-dos and notes are one tab, "Tasks & notes": to-dos on the left with an add field at the top of
  the list, notes on the right grouped by day. "Promised to others" shows only when there is one.
- A project's name and card open a basic view of the project inside the page. A project's own
  dashboard, when it has one, is a second link. A card shows Next beside Now.
- Brain: "Your folders" and "Gone quiet" are gone. Sources lists your own folders first, a missing
  one marked, and the brain and its day log last as built in. "Last lines written" is grouped by
  day, says where each line came from, and marks what Cogby wrote that you have not confirmed. A
  project's timeline marks it too.
- "Copy resume line" is gone.

## 0.3.7 (2026-11-18)

Cogby is your context manager first, and it now keeps a file of what you want to understand
yourself.

- A new brain holds `.cogby/self/information-border.md`, with two lists: "What I care about
  understanding myself" and "Hand over". Cogby reads it before it makes something that will be
  used, sent or shipped. On a listed topic it asks your view before it recommends. On a
  handed-over topic it decides and says what it chose in one line. It adds a line only on your
  answer. A brain made before this version has no such file yet, and the session start says so.
- The session start names that file and says the rule, also in a linked project folder. Under
  `cogby proactive quiet` it names the file only.
- A decision has a fourth value for who made the call: `agent`, a call an agent made alone that
  you did not see. `cogby log … --decision --who agent` writes one, `cogby decisions --who agent`
  lists them, and the count line of `cogby decisions` now reads "… N by an agent alone, N not
  recorded".
- An agent's line says which agent wrote it, when Cogby knows:
  `[yasser · agent claude-code · unconfirmed]`. The name comes from the tool server's connection,
  from Claude Code's shell, or from `COGBY_AGENT=<name>` set in another agent's shell. It is never
  something the agent passes. Older lines read as before. The index is rebuilt once to hold the
  name.
- The rules ask for an expected outcome and a review date on every decision, and for a decision
  whose review is due to be raised once in the conversation.
- The weekly check-in no longer goes through unconfirmed lines one by one. You say when a line is
  wrong, and Cogby asks for a yes only on a decision and on a change to that file.
- `USER.md` has a "Working with AI" line, and its size note is 2 KB.
- New words in setup's opening, the README and the starter `SOUL.md`: Cogby keeps what you know
  and what you are working on, and you make the calls.

## 0.3.6 (2026-11-16)

One fix, found in real use: a dismissed notification could come back.

- `cogby notify later` refuses a notification that was dismissed. A "later" sent from the command
  center before you cleared the notification, and applied after, used to put it back on your list.
- The command center marks each send, and each change to your to-dos and notes, read before it
  applies it, not after. A send that was applied but never marked read used to be applied again by
  the next session. If two sessions reach the same send, the second one skips it.

## 0.3.5 (2026-11-16)

Fewer cards, and a setup that works in the chat where you have just installed Cogby.

- Setup needs none of Cogby's tools. In the chat where the plugin was just installed, its tool
  server is not running, and setup used to open by calling two of its tools. Now every step is a
  command run by the plugin's full path, Claude's own question tool, or plain words. The questions
  and the opening words are written in the setup skill itself.
- Setup's review is a numbered list in the chat. You reply "create", or the numbers to drop.
- Five cards are gone: `setup`, `setup-review`, `check-in`, `meeting-brief` and
  `wrap-up-summary`. The check-in and the meeting brief are text in the chat. A session wrap ends
  with a short text report and one signed line, such as "Cogby · 3 lines saved to acme". Asking
  for a removed card is refused with a line that says what took its place.
- Five cards stay, and look as they did: `wrap-up-review`, `debrief-review`, `digest-review`,
  `quiz` and `picture`. Each skill that shows one now gives the card's data in full, as an example,
  so Claude does not have to look it up.
- The tool server names itself "Cogby", and each tool has a short title ("Show a card", "Search the
  brain") for apps that show one. The `card` tool lists only the five cards there are.

## 0.3.4 (2026-11-16)

Meeting debriefs that find the transcript themselves, and fixes from the first setups and the
first days of use. One change touches your pages: fact tables gain a column, described first.

- **The page format changes: fact tables gain a `recorded` column.** It sits between `valid_until`
  and `source`, and holds the day `remember` wrote the fact; Cogby sets it, never the caller. A
  page counts as having new evidence from that day, so a fact remembered today about something
  true since last year no longer leaves its page flagged as stale. Nothing is migrated: an old
  table reads as before and gains the column the next time a fact is written to it, its old rows
  left with no recorded day, and for those rows `valid_from` counts as before. The search index
  (schema 5 to 6) is rebuilt once from your pages the next time Cogby opens the brain, with nothing
  for you to do. An older version still reads a page written by 0.3.4, but drops the `recorded`
  column when it writes a fact to that page: if more than one machine shares the brain, update
  them all.
- **A meeting debrief finds the transcript and keeps a record of the meeting.** `meeting-debrief`
  looks for the transcript itself through the connectors the session has: the calendar event's
  Meet attachments read with Drive, Granola or another meeting-notes tool, a Drive search by title
  and date, and only then asks you for a link, a file or a paste. The transcript stays where it
  lives. Each debriefed meeting gets one record, `resources/meetings/<date>-<name>.md`: the link to
  the transcript, a summary of at most 15 lines, and what the debrief wrote where. Every page the
  meeting touched gets one timeline line linking to the record, and every line written from it
  cites the meeting's name, date and transcript link. A record is written once (the same meeting
  again writes nothing) and is never flagged stale; the session start and the view show the lines
  on the pages it touched, not the record's own. A link to a project or area that has since moved
  to `archive/` still finds it. `cogby meetings` lists the records, newest first;
  `cogby meetings --page <slug>` lists the ones linked to or from that page, and `meeting-prep`
  reads the newest of those before a meeting. The work templates no longer name a Meetings view
  that does not exist.
- **`cogby wrapup review` no longer pushes in a plugin brain.** It commits locally and leaves one
  notification naming the commit, the branch and the files, as the README says. This was
  the known issue of 0.3.2 and 0.3.3. `cogby wrapup auto`, and every brain that is not a plugin
  brain, are unchanged.
- **Setup is easier to follow.** It asks its closed questions with Claude's own question dialog
  where the host has one, and sends a card only where it does not. It says "Step N of 5" at each
  step and tells you to type your answers if a card does not appear.
- **Cards are smaller and follow your theme.** Each carries only the styles it uses (setup's card
  went from 18 KB to 8 KB, the others from about 10 KB to 3 or 4 KB), takes its colours from the
  host's light or dark theme, and shows a selected answer as a solid fill with a check.
- **An old `cogby` on your PATH is named.** When a `cogby` command installed before the plugin
  (such as the old `@cogby/cli` npm package) would run instead of the plugin's, the session start
  says so and gives the exact `npm uninstall -g` command that removes it. `cogby --version` prints
  the version.
- **`digest` reads PDFs by page and reads scans.** Each item from a PDF cites its page; a long PDF
  is read in ranges of at most 20 pages, and the summary says which pages were read and which were
  not. A scan or an image is read, and each item from it is marked "read from a scan" so you check
  it. A text version is asked for only when a source cannot be read at all.
- A new brain's `.gitignore` no longer names a `cogby setup` command that does not exist. An
  existing brain's `.gitignore` is never rewritten, so it keeps the old wording.


## 0.3.3 (2026-11-15)

Changes the owner asked for after reading how 0.3.2 works: linking, the day's log and the map.

- Linking a folder names both sides. `cogby link <folder> <card>` takes the folder first, then the
  card, and prints `Linking folder <folder> to card <card> as <role>` before it writes anything.
  `cogby link <card>` still means the folder you are in, and `--repo PATH` still works. `--none`
  and `--undo` take a folder the same way.
- Setup links your folders. For each project you keep in the review, it asks once whether the
  project has a folder or a repository on this machine, and links it on your yes.
- The day's log can be read by card. Each entry says which card it is about, on a line like
  `Card: projects/acme/card`: the place's page in a linked folder, and in the brain the project
  or area the turn wrote to. When no card can be known the line is left out. An entry keeps the
  ask up to 1,000 characters and the answer up to 4,000, where it kept 200 and 1,200.
  `cogby search acme --source log` lists everything said about that card, newest first. A plain
  search still never shows the log.
- `cogby map` prints the map of the brain: every project, area, resource and archive entry with
  its one line, read from the index. `.cogby/context-index.md` is no longer generated, and a new
  brain has none. A brain that already has the file keeps it: nothing updates it, and the first
  session start puts a note at its top saying so. `AGENTS.md`, `capture` and `html-plan` point at
  the command. `core/ops/reindex.cjs` is gone.

Known issue, unchanged from 0.3.2 and fixed in 0.3.4: in a plugin brain `cogby wrapup review`
pushed like `auto` when the brain had a remote.

## 0.3.2 (2026-11-15)

No new feature. The gaps the 0.3.1 verification found between the plugin and a dependable first
week of real use are closed.

- A brain's rules follow the plugin. When a session starts and the brain's `AGENTS.md` came from an
  older version, it is replaced with the current one, committed on its own, and the session says
  so in one line. A copy you edited by hand is left alone and you are told once. Your own rules go
  in the brain's `.claude/CLAUDE.md`, which is never touched.
- Bookkeeping no longer counts as unconfirmed. Linking a folder, and adding, pausing, resuming or
  recording the run of a routine, write a line that ends in `record`. It is not listed by
  `cogby unconfirmed`, not counted, and not shown as where you stopped. Lines of this kind written
  by earlier versions are read the same way, with nothing to migrate. What Claude claims with
  `log` and `remember` is unconfirmed exactly as before.
- Work done outside the brain reaches git without a wrap-up. Every to-do, note and notification is
  committed as it is written, from any folder. The day's log is committed when a session ends, in
  the brain and in a linked code, workspace or environment folder. Nothing is pushed for you.
- The day's log keeps fewer secrets. Besides known token shapes, a value named as a password,
  secret, token, API key or authorization is replaced and its name kept, and so is the password
  in a connection string. `max_tokens: 4096` and ordinary sentences about passwords are left alone.
  A secret said in plain words with no name beside it is still not caught.
- No page Cogby builds loads anything from the network: the cards and the command center no longer
  ask Google for their fonts.
- The weekly check-in asks once who made each decision logged that week without it, and records
  your answer as a line of its own on the decision's page. The decision is never edited.
- `cogby decisions --who none` counts the decisions it lists, not the whole scope.
- The session-end hook no longer names a `cogby setup` command that does not exist.

## 0.3.1 (2026-11-14)

A release that adds nothing. Everything in 0.3.0 was run by hand in a throwaway brain and as an
installed plugin, and what was small and wrong was fixed.

- When the to-do or note store cannot be read, the hint now gives a git command that runs as
  written: `git log -- .cogby/todos/store.json`. The space after the dashes was missing.
- A brain with one page says "1 page", and one project "1 project", where a session starts and in
  `cogby view`.
- `cogby help` lines up the `dream` line with the others.
- The README says that Cogby is local-first and for Claude Code only today, that a Notion-backed
  option is being evaluated and is not in this release, and what a new brain's own
  `.claude/settings.json` sets. It lists all fourteen skills.
- `STRONG-POINTS.md` no longer calls the decision log's cross of who made a call with how it turned
  out "in progress": it shipped in 0.3.0.

## 0.3.0 (2026-11-13)

Everything since 0.2.0.

**Evidence you can trust**

- Five write-path bugs fixed. A similar fact is named and left alone, and replaces an older one
  only with `--replaces`. A dash in a source no longer hides the decision behind it. A to-do, note
  or notification store that cannot be read refuses writes and is left untouched. A routine's run
  is recorded by what the routine runs, never by a name that starts the same. A write that cannot
  be indexed is put back.
- Every line and fact says who wrote it and whether you confirmed it. `cogby unconfirmed` lists
  what an agent wrote, `cogby confirm` says a line is right, `cogby retract` says it is wrong and
  keeps it on the page. From Claude both are refused unless you said yes to those lines.
- Inside a Claude session a write is always an agent's and unconfirmed, whatever `--human` says.

**The decision log**

- A decision is a dated line on the page it is about, with its reason and who made the call: you
  alone, you taking Claude's suggestion, or you overriding it. `cogby decisions` lists them across
  the brain, and `cogby decisions review` records how one turned out as a new line.
- Once decisions have been reviewed, the list says how each kind of call turned out.
- A verdict you give on an `html-plan` page is offered as a decision, never saved on a guess.

**One brain across your folders**

- Places: `cogby link` makes the folder you work in a place of one project or area page, with a
  role (code, workspace, environment, reference, scratch). `cogby link --none` records that a
  folder is not a brain project. `cogby places` lists them.
- A session opens by what the folder is: on its page in a code, workspace or environment place,
  with two lines elsewhere. In a folder the brain does not know, Claude asks once whether to save
  it, twice at most, and never under `cogby proactive quiet`.
- The day's log is also written from a code, workspace or environment place, naming the place and
  its page, and from nowhere else.
- To-dos, notes and notifications are committed with the brain, so they travel to your other
  machines.

**Routines**

- What you do on a rhythm with Claude is one page each under `areas/routines/`, with a dated line
  for every run. `cogby routines` adds, edits, pauses and lists them and says what is due.
- `cogby proactive quiet | suggest | act` sets how far Claude goes on its own. Which routines may
  run unasked is a list in the code, not something a page can claim.

**Pages, skills and cards**

- A project is one `card.md`: what it is, what is in flight now and what is next on top, what was
  done and decided below. A brain made before this keeps working as it is.
- New skills: `digest` reads one document or folder into sourced evidence, `routines` keeps and
  schedules your routines, `quiz` asks you about your own brain, and `picture` draws one idea.
- Cards in the chat: setup, the check-in, the meeting brief, the debrief, digest and wrap-up
  reviews, the quiz and the picture, all from one kit that fills fixed markup from data.
- The command center shows your own folders, has a tab for notes, lets you add and remove to-dos
  and notes, and publishes no local path. A project can have a dashboard page of its own.
- A search answers from the index as it is. A short background sync keeps the index up to date.
- `STRONG-POINTS.md`: the nine things that make Cogby special, each checked against the code.

## 0.2.0 (2026-11-11)

The first version of the plugin as its own repository: one session-start hook, nine brain tools,
and skills in three layers.
