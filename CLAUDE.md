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

## The page has two lives

`docs/index.html` is both the athlete's personal dashboard and a public tool.

- Built by `./wk web` with synced data, it renders that data directly.
- Served from GitHub Pages with no data baked in, it shows an import screen:
  any visitor drops in their own Garmin or Strava CSV and it is parsed,
  analysed and charted **entirely in their browser**. Nothing is uploaded.

`hub/static/analytics.js` deliberately mirrors `hub/analyze.py` — the CLI and
the browser must not disagree about someone's acute:chronic ratio. Change one
and change the other, then run the tests: `python3 tests/test_core.py` runs the
Python and the JavaScript suites together.

## The site is cycling-first

`hub/static/cycling.js`, `workouts.js` and `coach.js` are the bike side:

- **cycling.js** — FTP estimation, TSS, intensity factor, power zones, and the
  CTL/ATL/form model. An hour at FTP is 100 TSS by definition; the tests pin
  that, so treat it as a fixed point when changing anything here.
- **library.js** — 46 sessions. Each needs `key`, `name`, `focus`, `zone`,
  `defaultMinutes`, `keywords`, `terrain`, `blurb`, `why`, `course` and
  `build(minutes)`. The tests enforce all of it, plus: every session must be
  reachable by its own name, and `build` must fill the minutes it is handed.
  `why` states the adaptation and where the evidence comes from; `course` says
  where to ride it — the gradient, the length of clear road, whether it really
  needs a trainer. Never add a session missing either. Mark `fixed: true` for
  protocols that must not be stretched (tests, fixed ladders).
- **Pairing is not optional.** `Cycling.riderContext(activities, {profile, curve})`
  is the single place the profile meets the uploaded rides: FTP and where it came
  from, staleness against the measured curve, typical ride length, and a
  `bestFor(seconds)` lookup. Pass it as `opts.rider` to `Wk.fromText`,
  `Co.recommend` and `Co.buildPlan` — never hand them a bare FTP from the UI, or
  a session silently reverts to generic defaults and stops being checked against
  what the rider can actually do. The tests assert every session in a plan
  carries the context it was built from.
- **workouts.js** — the text parser and builder. Targets are fractions of FTP
  everywhere and only become watts at display or export. A session's own name
  outranks any other session's keyword; ties break toward the keyword appearing
  earliest in what the rider typed.
- **coach.js** — recommendation rules and plan layout. Every recommendation
  must carry a `why` naming the rule that fired. Never return advice without it.
  Plans draw from `PHASE_POOLS` crossed with `GOALS`, rotating by week index so
  consecutive weeks differ — a plan that prescribes the same Tuesday twelve
  times is a spreadsheet. Base phase deliberately ignores the goal overlay;
  base is base whatever you are training for.

Two input paths with different fidelity, and the difference matters:

- **CSV** (`importer.js`) — one row per ride. FTP is estimated from averages and
  reads low; each ride falls whole into one zone; no power curve is possible.
- **.FIT** (`fit.js`) — the full recording. FTP is measured from the best
  continuous 20 minutes, normalized power is computed from the stream, and a
  mean maximal power curve is real.

Never let a CSV-derived figure be presented with .FIT-level confidence. Where a
number could come from either, say which it was.

## A hard constraint on Strava

Strava's API policy forbids using Strava Data "in connection with the
development, training, evaluation, or operation of any AI Application", and
names "ingestion into a context window or working memory" among the prohibited
uses. Reading API-synced Strava activities into your context is exactly that.

So: analyse what `./wk sync` pulls from **Garmin** freely. For Strava, prefer
the athlete's own exported archive over API-synced data, and if they want
Claude connected to Strava properly, point them at Strava's own MCP connector
rather than working around the policy.

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
- FTP estimates, VO2 max and hrTSS are estimates from formulas. Say so where
  they appear; never present them as measurements.
- The numbers are indicators, not diagnoses. Acute:chronic ratio and the
  easy/hard split are coarse; say so rather than over-claiming precision.
