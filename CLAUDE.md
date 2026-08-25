# Working in this repo

This is a personal training hub. It pulls Strava and Garmin data into local
files and lets you read, analyse, and write training back to the watch. There
is no server and no API layer — everything is the `./wk` CLI plus files on disk.

## Start every training conversation here

```bash
./wk brief
```

One call gives you recent sessions, training load, intensity balance, fitness
trend, and where the athlete is in their plan. Read `training/ATHLETE.md` and
`training/paces.md` too — they hold goals, constraints, injury history and the
paces that named efforts resolve to.

## The commands

| Command | What it gives you |
|---|---|
| `./wk brief` | Everything at once. Start here. |
| `./wk sync` | Pull fresh data from both services. |
| `./wk list --days 30 --type running` | Recent activities as a table. |
| `./wk show <id>` | One activity, full JSON. |
| `./wk summary --weeks 12` | Weekly volume, load, easy/hard split, bests. |
| `./wk workout "<text>"` | Build a workout and show what it comes to. |
| `./wk workout "<text>" --push --schedule 2026-09-03` | Put it on the watch. |
| `./wk plan show` | The current plan, week by week. |
| `./wk plan push --week 3` | Send that week's sessions to the Garmin calendar. |
| `./wk web` | Rebuild the visual dashboard at `docs/index.html`. |
| `./wk web --serve` | Build it and open it in a browser. |

Rebuild the dashboard after any sync that changes the data — it is a static
snapshot, so it shows whatever was on disk when it was built. If you have just
synced and the athlete is likely to look at the page, run `./wk web` too.

Pass `--rest-hr` and `--max-hr` from `ATHLETE.md` to `summary` and `brief` —
the defaults (50/190) are placeholders and will skew load and intensity numbers.

## Writing workouts

The workout format is three kinds of line:

```
warmup 10min @ easy
6x(800m @ 5k pace / 90s jog)
cooldown 10min @ easy
```

- Goals are a distance (`800m`, `1mi`, `5k`), a duration (`10min`, `90s`,
  `1:30`), or `lap` for a lap-button step.
- Targets after `@` are a pace (`6:30/mi`), a range (`7:00-7:30/mi`), an HR
  zone (`zone 4`), or a name from `training/paces.md` (`easy`, `threshold`,
  `5k pace`).
- Repeats are `Nx(work / recovery)`. Steps inside are separated by ` / ` with
  spaces, because a bare slash belongs to a pace.
- Leave recoveries unpaced unless there is a reason — jogging by feel is
  usually the point.

Always preview without `--push` first and show the athlete the summary. Pushing
writes to their real Garmin account.

## Writing training plans

Plans are markdown in `training/plans/`, named `YYYY-goal.md`. You design them;
the CLI just executes them. Structure:

```markdown
---
name: Fall Half
goal: half marathon
race_date: 2026-11-15
target_time: 1:35:00
---

## Week 1 — Base

Focus: settle into volume

### Tue — Intervals
```workout
warmup 10min @ easy
6x(800m @ 5k pace / 90s jog)
cooldown 10min @ easy
```

### Sun — Long run
12 mi @ long
```

Week dates are derived from `race_date` counting backwards, or from an explicit
`start_date`. Days with a fenced ` ```workout ` block get pushed to the watch;
prose days (easy runs, long runs) stay prose, because they do not need
step-by-step guidance.

Before writing a plan: read the profile, run `./wk summary`, and build from the
volume they are actually doing. Check the acute:chronic ratio in `./wk brief` —
if it is already above 1.3, the plan should not add more.

## Keeping a log

Append session notes to `training/log/YYYY-MM.md`. Data says what happened;
the log says how it felt and what you concluded. Write down the reasoning
behind plan changes so the next conversation inherits it.

## House rules

- Never commit `.env` or `.secrets/`. Both are gitignored; keep it that way.
- Never print tokens, passwords, or the contents of `.secrets/`.
- Preview before pushing. `--push` and `plan push` touch a live Garmin account.
- This repository is PUBLIC. `data/` is gitignored — never commit raw activity
  or wellness data, and never work around the ignore rules to do it. If the
  athlete makes the repo private and drops the `data/` line, committing
  `data/activities/` becomes the right call again: it is what gives a fresh
  session real history.
- `docs/` IS committed, because GitHub Pages serves it. That means the built
  dashboard is world-readable. Before committing a rebuilt page that now
  contains real sessions, say so plainly and let the athlete decide — do not
  publish their training history on your own initiative.
- A fresh session therefore starts with no data on disk. Run `./wk sync` before
  reading anything, rather than telling the athlete they have no training.
- `docs/index.html` is generated. Edit `hub/_template.py`, never the built file.
- If you change a chart, rebuild and actually look at it before saying it works:
  `./wk web` then open the file. Charts fail visually, not loudly.
- The numbers are indicators, not diagnoses. Acute:chronic ratio and the
  easy/hard split are coarse; say so rather than over-claiming precision.
