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
  `recentDays()` builds the two-week calendar: whole Monday-to-Sunday weeks,
  every day present whether or not it was ridden, days ahead of today flagged
  `future` rather than counted as rest. The window is anchored to the live date
  at render time, never to `DATA.today` — that is stamped in at import, so a
  history loaded a fortnight ago went on showing that fortnight. A day with no
  ride on it reads "Day off"; a day that has not happened yet reads "To come". Days are banded rest / easy / moderate
  / hard on the TSS boundaries a coach would use, and `BANDS` carries the words
  the legend prints — a shade with no label is what the old heatmap did, and
  nobody could read it.
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
  `options()` wraps `recommend()` in the three the dashboard shows: the
  recommendation, one that costs clearly less, one that costs clearly more. All
  three are built to the same length, so intensity is what separates them, and
  the neighbours are chosen by resulting TSS rather than off a fixed intensity
  ladder — the ladder put a long threshold session under "if you are feeling
  weaker" next to a shorter VO2 one, because a session with long recoveries is
  not the same thing as a cheap one. Below the easiest session the answer is a
  rest day, not a session; above the hardest it is the same session, longer.
  The tests pin the ordering across short, long and easy-only histories.

### The daily recommendation

`options()` wraps `recommend()` in the three the dashboard shows: the
recommendation, one that costs clearly less, one that costs clearly more. All
three are built to comparable lengths, so intensity is what separates them, and
the neighbours are chosen by resulting TSS rather than off a fixed ladder — the
ladder put a long threshold session under "if you are feeling weaker" next to a
shorter VO2 one, because a session with long recoveries is not the same thing as
a cheap one. The easier option is additionally capped at the recommendation's
zone: steep pitches cost less than a VO2 hour and are far worse to ride on flat
legs. Below the easiest session the answer is a rest day, not a session; above
the hardest it is the same session, longer.

`HILLS` sits in the same candidate pool, so a climb turns up among the day's
three for every rider, not only the ones who asked for climbing. There is no
block planner: it was removed, and what it knew lives here and in the workout
builder.

**The card asks about the next day that needs an answer, not always today.**
`Coach.nextUp()` is what the dashboard calls. A day with a ride recorded on it
has had its answer, so the question rolls forward to tomorrow — and tomorrow is
then read with today's ride in the history, which is what makes it adapt: ride
hard today and tomorrow comes back easy, or off, without anyone asking for it.
Never make the recommendation something computed at import and stored — it is worked
out from the rides held against the date at the moment it is drawn.

**A day off is a recommendation, not just the thing you drop to.** `recommend()`
returns `key: 'rest'` with no workout when the streak reaches six days, when
form is past -40, or when deep fatigue meets three days back to back and three
hard days in ten. `options()` then shows two tiles — the day off, and the easy
ride for a rider who is going to ride anyway — rather than pretending a rest
day has a harder version. `ridingStreak`, `lastDayOff`, `hardDays` and
`weekSoFar` are the week-shape helpers those rules read, and the card prints
the same figures underneath so the rule is visible rather than asserted.

**Doubles are a volume tool and are offered sparingly.** `doubleFor()` attaches
a second ride to the recommendation only above `DOUBLE_CTL` (60) and
`DOUBLE_HOURS` (8), with form above `DOUBLE_FORM` (-30) and fewer than five
days back to back — and never after a recovery or rest recommendation. The
second ride is always the easy one: a spin after a quality session, more
endurance after an endurance day. Two quality sessions in a day is a different
sport and is not offered. It is a full session with its own targets and its own
button, not a note telling somebody to ride longer, so a climbing second ride
still comes out in RPE like any other.

**An endurance ride is never under an hour.** `shortestFor()` holds the floor
per session and `ENDURANCE_MIN` is 60: under that there is not enough time at
low intensity for the adaptations the ride exists for.

**Nothing is ever prescribed fasted.** There is no `fasted` session; `fuelled`
replaced it — a long ride whose point is practising 60–90 g of carbohydrate an
hour. `fuelNote()` attaches the numbers to anything long or hard. Never add a
session that trains low; if a rider searches for one, `fuelled` answers them and
explains why.

**Climbs are ridden by effort, not watts.** `workout.effortBased` is set for any
session whose focus is climbing (or whose terrain is mountainous), and
`stepTarget()` then renders RPE and a breathing cue instead of a watt range. The
gradient decides the power on a climb; the rider only decides how hard to push
against it. File exports (.zwo, .mrc, .erg) still carry numbers, because a file
format cannot hold "RPE 7".

### Rides only

Nothing but cycling gets in. A Garmin or Strava export is a whole athletic
life, and every number here is a bike number — FTP, TSS, the power curve,
weekly miles, the zones — so a 10 km run does not read as a run in that
arithmetic, it reads as a very slow ride. The runs and swims are turned away at
the door rather than filtered again at each use:

- **CSV** — `Importer.isCyclingType()` reads the sport column. Three answers:
  a ride, not a ride, or `null` when the file did not say. A file that says
  nothing is taken as a ride, because it was dropped on a cycling site; only an
  activity that names itself as something else is dropped. `parse()` returns
  `nonCycling` alongside `skipped`, and the detected bar says how many were
  left out.
- **.FIT** — the sport enum in `fit.js`. Sport 0 is "generic" and is read as a
  ride, as is any id the table has never heard of; everything the table names
  as another sport is refused by `handleFiles`.
- **`addToHistory`** filters both what is arriving and what is already held, so
  a history saved before this rule cannot keep a run in the totals, and
  `ridesOnly()` rebuilds and re-saves such a payload on load.

That is why the Sessions table has no sport column and no sport filter.

### It is always today's answer

Nothing about the recommendation, the calendar or the last-seven-days figure is
stored. All three are worked out from the rides held against the date at the
moment they are drawn, so yesterday's session is what today's advice answers.
`Cycling.pmc()` ends its series on the rider's local day — read as UTC it ran a
day too far all evening west of Greenwich, and form read fresher after dinner
than it had at lunch. `watchTheDate()` redraws the dashboard when the date
turns over, so a page left open overnight is not still showing yesterday.

Two input paths with different fidelity, and the difference matters:

- **CSV** (`importer.js`) — one row per ride. FTP is estimated from averages and
  reads low; each ride falls whole into one zone; no power curve is possible.
- **.zip** (`zip.js`) — Garmin and Strava both export archives. Expanded before
  anything else sees the files, so a zipped ride behaves exactly like a dropped
  one. Uses `DecompressionStream`; no library.
- **.FIT** (`fit.js`) — the full recording. FTP is measured from the best
  continuous 20 minutes, normalized power is computed from the stream, and a
  mean maximal power curve is real.

Rides can also be typed in: `Cycling.manualRide()` takes a date, a duration and
a distance and fills in the rest — speed exactly, average power from a rolling
resistance and air drag model (`estimatePower`), stress from that power. Those
rides carry `manual: true`, which keeps them out of `estimateFTP` and
`powerProfile` and makes `rideTSS` report a basis of "estimated from speed".
Never let a manual ride into anything presented as measured, and never let
`fillGaps` copy the flag onto a measured ride that replaced one.

Rides can be deleted, one row at a time, from the Sessions table. `deleteRide`
rebuilds the payload from the rides that remain, so nothing derived survives the
ride it came from. That is why every .FIT ride carries its own `curve`: the
page-wide curve is merged from the rides currently held (`curveFor`), so a
delete drops that ride's bests instead of leaving a personal best nothing can
account for. Adding rides may pass the stored curve as a fallback — adding can
only raise a best — but a delete never does.

Uploads accumulate. `handleFiles(files, unitPref, prior)` merges what was
dropped into the rides already loaded and `Importer.dedupe` decides what is
genuinely new, matching on start time (within 2.5 min) and distance (within
500 m) rather than on an exact key — so the same ride from a CSV and a .FIT
collapses to one, the .FIT copy wins, and fields only the CSV had are folded
into it. New power curves are merged with the stored one, so a personal best
survives every later easy ride. A .FIT's samples are dropped after its curve is
taken: a season of second-by-second recordings would not fit in localStorage.
Never make an import path that replaces the stored payload wholesale.

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
