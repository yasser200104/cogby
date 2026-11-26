# Keeping routines: what Cogby brings up on its own, and moving to another tool

Part of the routines skill; read from there. The point of both halves is the same: the owner
knows which routines they have, why, and where each one runs, and can take them anywhere.

## One thing to bring up, when nothing is wrong

After the health check, when no routine is late and no schedule is broken, you may bring up ONE
thing: the first row below that applies. Never in the middle of a task, and never under `quiet`.

| What you see | Its gate, run before you say anything | What you then say, once |
|---|---|---|
| The brain holds no routine | `cogby routines offered "a first routine" --source "no routine in the brain"` | "Is there something you'd like to happen without asking?" |
| The scheduler here holds tasks the brain does not know | `cogby routines offered "record scheduled task: <name>" --source "<the scheduler's list>"`, for the first such task | "You have scheduled tasks I keep no record of: <names>. Shall I record them, so they stay yours wherever you work?" |
| A scheduled task's prompt says more than its routine's page | `cogby routines offered "keep the instructions: <name>" --source "<the task>"` | "Shall I keep the full instructions of <routine> in your brain, so it can be set up again anywhere?" |
| `gaps` of a routine holds `why` | `cogby routines offered "say why: <name>" --source "its page has no why"` | "What is <routine> for? One line is enough." |
| The brain shows a repeated need no routine covers | `cogby routines offered "<the routine in one line>" --source "<the dated lines that show the need>"` | The routine, in two lines: what it would run and when, and what in their brain shows the need |

- **The gate refuses** (the owner chose `quiet`, something was brought up in the last seven days,
  or this same thing was brought up before): say nothing, and do not mention the refusal.
- **The gate accepts:** say it once. A yes: do it with the skill's Step 1 and Step 2
  (`--instructions` for the full prompt, `--why` for the why). A no, or no answer: drop it. The
  gate never lets the same thing through again.
- **`gaps` holds `where`:** this needs no question. If the scheduler here shows the task, record
  where it runs in plain words (`cogby routines edit <name> --where "…" --source "<the scheduler>"`)
  and tell the owner that line.
- **A repeated need** means the owner asked for the same thing on a rhythm, three times or more,
  or a notification, a note or a to-do says something came too late or was missed again ("prep
  came too late"). Never from one occurrence, never from a hunch. Quote their own words as the
  evidence. The look-back skill does this reading every day when the owner has turned it on;
  without it, the weekly check-in does. Either way, one routine proposal a week at most.

## "I moved to another tool", "set my routines up here"

The routines are pages in the brain, so they came along. The schedules did not: they stayed in
the tool the owner left. Setting up here is offering each routine again, from its page.

1. `cogby routines --json`. Say each active routine in one line: what it does, its rhythm, why it
   exists, and where it ran until now (`where`, or the old pointer when there is none).
2. Check what this tool can schedule (the skill's Step 2, point 1). Nothing: say so plainly. The
   routines stay recorded and a session start names the ones that are due. Stop.
3. Ask which to set up here: all, some or none. Schedule only those (Step 2). Build each prompt
   from the page: its `instructions` when it has them, else what it `runs`. A routine that runs a
   Cogby skill this tool does not have: say so, and offer to run it from the `cogby` commands that
   skill uses, or to leave it.
4. After this scheduler confirms each one:
   `cogby routines edit <name> --scheduled "<this scheduler>: <task name or id>" --where "<the tool, this computer or the cloud, what must be open>" --source "<the scheduler's confirmation>"`.
   The earlier pointer and place stay in the page's timeline: nothing is lost.
5. Say once that the tasks in the old tool may still be running. You cannot see or stop them from
   here; two schedulers running one routine do it twice. Switching the old ones off is theirs.

A routine whose page has no `instructions` and whose scheduled prompt you cannot see may be missing
part of what it did. Say which ones, and ask the owner for the missing words; never invent them.
