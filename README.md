# training-hub

Your Strava and Garmin workouts, pulled into files you own, so Claude can read
your training, analyse it, write structured workouts, and build training plans
— then push those workouts back to your watch.

No server, no hosted service, no third party holding your data. A CLI and a
directory of JSON and markdown.

```
$ ./wk brief
TRAINING BRIEF — 2026-08-25
============================================================

Last 14 days: 14 sessions
  2026-08-21  running    5.82 mi    37:18  6:25/mi  167bpm
  2026-08-23  running   11.84 mi  1:38:24  8:19/mi  132bpm
  ...

Load: acute 578.1 / chronic 538.2 = 1.07 — sustainable
Intensity: 72.8% easy / 27.2% hard (target is roughly 80/20)
Efficiency: flat (+0.6% over 90 days)

Plan: Fall Half
  half marathon on 2026-11-15 — 82 days out
  Week 3 — Build
    Tue 09-01  Intervals  <- today
```

## Why it is shaped this way

Claude Code can already run shell commands and read files. So the simplest
thing that gives Claude full access to your training is a command that prints
text and a folder it can read — not an API, not a protocol, not a service in
the middle. That is the whole design.

## A note on this repository being public

`data/` is gitignored here, so your activity history stays on your machine and
out of GitHub. Credentials (`.env`, `.secrets/`) are gitignored too, and always
should be.

That costs you one real benefit. When activity JSON *is* committed, a brand-new
Claude session opens the repo already knowing your training history instead of
starting cold. To get that back, make this repository private and delete the
`data/` line from `.gitignore`. Until then, `./wk sync` rebuilds your local copy
from Strava and Garmin whenever you need it.

## Setup

Two accounts to connect. Budget about ten minutes, most of it Strava's app form.

```bash
git clone <your-repo-url> && cd training-hub
pip install -r requirements.txt
cp .env.example .env
```

### Strava

You register your own API application, which means the rate limit and the
token are yours and nobody is between you and your history.

1. Go to <https://www.strava.com/settings/api>.
2. Fill in anything for name and website, but set **Authorization Callback
   Domain** to exactly `localhost`.
3. Copy `Client ID` and `Client Secret` into `.env`.
4. Run `./wk auth strava`, open the URL it prints, click Authorize.
5. Your browser will land on a `localhost` page that fails to load — that is
   expected. Copy the `code=...` value out of the address bar and paste it back.

### Garmin

```bash
./wk auth garmin
```

Uses your normal Garmin Connect login, prompts for an MFA code if your account
asks for one, and stores tokens in `.secrets/` that last about a year.

**Worth knowing:** Garmin has no public consumer API. This talks to the same
private endpoints the Connect app uses, through `garth`. Garmin changed that
login flow in March 2026 and `garth` is no longer maintained, so Garmin login
is the part of this project most likely to break someday. Reading is
deliberately duplicated through Strava: if Garmin login stops working, you lose
workout push, not your training history.

### Pull your data

```bash
./wk sync                 # activities from both services
./wk sync --wellness      # also sleep, HRV and body battery from Garmin
./wk auth status          # what is connected, what is on disk
```

Activities recorded by both services are matched and collapsed automatically —
same sport, starting within a couple of minutes, similar distance. Garmin wins
ties, because the watch measured the run first-hand.

## The dashboard

```bash
./wk web --serve      # build it and open it in your browser
./wk web              # just build it, to site/index.html
```

`site/index.html` is a **single self-contained file** — data, styles and charts
all inlined. No build step, no server needed, no network: double-click it and it
works. Rebuild it after a sync to refresh.

### Publishing it

The dashboard is also live at
**<https://myofamilyhealth.github.io/AI-Training-Plan-/>**, deployed from
`site/` by `.github/workflows/pages.yml` whenever that folder changes on `main`.

Building needs your credentials, so it happens on your machine, never in CI.
To update the published page:

```bash
./wk sync && ./wk web
git add site/index.html && git commit -m "Update dashboard" && git push
```

**Read this before you publish real data.** This repository is public, so
anything in `site/index.html` is readable by anyone with the URL — every
session, its date, distance, pace and heart rate. The page carries a `noindex`
tag so search engines skip it, but that is politeness to crawlers, not access
control. Two ways to keep it private:

- Make the repository private. Pages on a private repo needs a paid GitHub
  plan, but the site then requires a login.
- Or do not publish at all: `./wk web --serve` gives you the same dashboard on
  localhost, and `site/` never has to be committed.

It gives you, at a glance:

- **Four headline numbers** — last 7 days' distance with a week-over-week delta,
  acute:chronic ratio with a plain-language verdict, how much of your running is
  easy, and whether efficiency is trending.
- **Weekly volume** with training load beneath it, on a shared timeline. The
  current week is drawn faded and its load segment dashed, because a week that
  is only half run is not comparable to the finished weeks beside it.
- **A consistency heatmap** — daily load over six months, darker for harder.
- **Intensity balance**, **best efforts**, and **this week of your plan**.
- **A sortable session table**, filterable by sport and date range.

Every chart has a hover tooltip, the volume chart has a table view for the exact
numbers, and the whole page follows your system light/dark setting with a manual
toggle that overrides it.

## Using it from the terminal

```bash
./wk brief                              # everything at once
./wk list --days 30 --type running
./wk summary --weeks 12 --rest-hr 48 --max-hr 187
./wk show garmin-123456789
```

### Building a workout

```bash
./wk workout "warmup 10min @ easy
6x(800m @ 5k pace / 90s jog)
cooldown 10min @ easy" --name "Tuesday 800s"
```

```
Tuesday 800s  (running)
  warmup    10:00 @ 9:00–9:45/mi
  6x
      interval  0.50 mi @ 6:30/mi
      recovery  1:30
  cooldown  10:00 @ 9:00–9:45/mi

  ≈ 5.12 mi in 48:23
```

Add `--push` to send it to Garmin Connect, or `--schedule 2026-09-03` to also
put it on that day's calendar so the watch offers it when you head out.

Named efforts like `easy` and `5k pace` come from `training/paces.md`. Edit
that file and every future workout retunes.

### Training plans

Plans are markdown in `training/plans/`. Ask Claude to write one — it reads
your profile and your actual volume first — then:

```bash
./wk plan show
./wk plan push --week 3 --dry-run     # see what would go to the watch
./wk plan push --week 3
```

Days with a fenced ` ```workout ` block become structured sessions on the
watch. Easy and long days stay prose, because they do not need step-by-step
guidance.

## What is in the box

```
wk                     the CLI — every capability is a subcommand
hub/
  units.py             "800m", "7:30/mi", "90s" -> SI
  config.py            .env, secrets, named paces
  store.py             one activity shape for both services, plus dedupe
  strava.py            OAuth and fetch, standard library only
  garmin.py            activities, wellness, and workout push
  workout.py           the workout language -> Garmin's JSON
  analyze.py           load, acute:chronic, easy/hard split, trends, bests
  plan.py              markdown plans -> scheduled sessions
  web.py               shapes the dashboard's data
  _template.py         the dashboard's markup, styles and SVG charts
site/
  index.html           the built dashboard (regenerate with ./wk web)
training/
  ATHLETE.md           goals, PRs, injuries, constraints — fill this in
  paces.md             what "easy" and "threshold" mean for you
  plans/               training plans
  log/                 how sessions actually felt
data/                  gitignored while this repo is public
  activities/          one JSON file per session
  wellness/            sleep, HRV, body battery by day
  streams/             per-second samples, always re-fetchable
```

## The numbers, honestly

- **Training load** is Banister TRIMP when heart rate is available, and a
  duration-times-intensity estimate when it is not. Set `--rest-hr` and
  `--max-hr` from your own profile or it will be wrong.
- **Acute:chronic ratio** compares the last 7 days to the trailing 4-week
  average. Roughly 0.8–1.3 is the range usually called sustainable. It is a
  coarse indicator of a steep ramp, not a diagnosis.
- **Easy/hard split** draws the line at 76% of heart-rate reserve. Sessions
  without heart rate are reported separately rather than guessed at.
- **Efficiency trend** is speed per heartbeat on easy runs over 20 minutes,
  recent half of the window against the older half. Noisy under about a dozen
  runs.
- **Bests** are the fastest average pace over a whole activity in each distance
  band — not verified race results.

## Security

`.env` and `.secrets/` are gitignored and hold live credentials to your Strava
and Garmin accounts — never commit them, whatever this repository's visibility.
If you ever suspect a leak, revoke at <https://www.strava.com/settings/apps> and
change your Garmin password, which invalidates the stored tokens.

This repository is currently **public**, so `data/` and `site/` are gitignored
as well — both would otherwise publish your training history. Making the repo
private is the cleaner fix, and unlocks committing your history for Claude.
