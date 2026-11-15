# Kitesurf fit note

Date: 2026-11-14. Status: research note; no code change and no default change.

[Kitesurf](https://github.com/cloudflare/kitesurf) is Cloudflare's stateless browser engine for agents, open-sourced
under Apache-2.0 on 2026-11-13 ([announcement](https://blog.cloudflare.com/kitesurf-open-source/),
[documentation](https://developers.cloudflare.com/browser-run/kitesurf/)). It runs on Workers, parses HTML, applies
CSS, runs page JavaScript and renders screenshots, and it speaks the Chrome DevTools Protocol (CDP), so Puppeteer,
Playwright and `chrome-devtools-mcp` can drive it. This note asks where it could stand in for Chromium in EndoForge
and what that would do to run time. EndoForge does not vendor or depend on Kitesurf; this page only links to it.

## What the sources say

- Fit: one-shot page loads, HTML extraction, screenshots and PDFs for compatible sites, and bursty ephemeral sessions.
- Not yet supported: video and WebGL, bot-challenge handshakes that need real TLS fingerprints, and long-running
  authenticated sessions with persistent state. Rendering is not pixel-perfect.
- Cost and speed, from the documentation's medians of five Browser Run runs over a 14-URL corpus against a warm
  Chromium pool: 3.1 to 3.8 times less CPU, 4.7 to 7.0 times less memory, and 1.7 to 1.8 times slower wall time
  (screenshot 1,148 ms against 637 ms; HTML extraction 820 ms against 472 ms).
- Running it: `pnpm run dev` builds the engine with Bazel and serves it with `wrangler dev` on `127.0.0.1:8787`.
  Deploying a self-hosted instance needs a Workers Paid plan (Dynamic Workers); the managed Browser Run endpoint needs
  a Cloudflare account and API token. Neither is used here.

## Where EndoForge uses a browser today

Nowhere in the engine. A search of `main` at `b4bf587` for `chromium`, `puppeteer`, `playwright`, `cdp`, `devtools`
and `headless` finds no browser use; the one hit for "browser" is the V8 isolate explanation in
[getting started](../tutorials/getting-started.md). Workcells, gates and the agent loop run WebAssembly and
JavaScript in V8 isolates, not in a browser.

The one place a browser can enter a run is [hill-climb](../../../tools/hillclimb/README.md):

- `render` runs each campaign's own `render` commands and writes stills (`tools/hillclimb/bin/hillclimb.mjs`,
  `renderJobs` and `cmdRender`), then records the stage's wall time in `render.json` as `seconds`. A page-layout
  campaign (the README's example goal is a landing page at phone width) would put its screenshot command here.
- `judge` fast-renders every competing variant before a judge atom picks one per owner, so render cost grows with
  the number of variants.
- `refs --fetch` downloads approved references with `curl`, not a browser.

EndoForge ships no campaign whose render command drives a browser, so there is no in-repository Chromium to replace.

## Where Kitesurf could replace Chromium

- Hill-climb `fast` renders of static or lightly scripted pages: one-shot screenshots per round and per variant,
  where the critic needs a readable still rather than pixel-exact output. Each render is a fresh, stateless session,
  which matches how the round already treats stills.
- Text or DOM extraction for critics, where a page's HTML and computed layout matter more than paint.
- Agent tools that need a CDP browser for a single page load inside a run, through `chrome-devtools-mcp` pointed at
  a local Kitesurf.

## Where it cannot

- Hill-climb `final` renders and any pixel comparison meant to stand for what a person sees in Chrome. Kitesurf is
  not pixel-perfect, so a `final` profile, or `pixel-diff.py` across engines, should stay on Chromium. Within one
  engine, round-to-round pixel diffs are still meaningful.
- Campaigns that render WebGL, canvas-heavy 3D or video, such as the 3D-asset and game-level goals the hill-climb
  README names.
- Anything that logs in and keeps a session, or a site behind a bot challenge.
- Sandboxed atoms as they stand. The factory runtime's egress proxy admits an exact provider allowlist on port 443
  only (`tools/factory_runtime/egress.py`), so a worker inside it cannot reach a local Kitesurf without a policy
  change. Render commands run on the host, not in atoms, so this does not block `render`.
- A hosted instance, under this project's limits: self-hosting needs Workers Paid, and the managed endpoint needs an
  account token. The local `wrangler dev` path is the only one this note uses.

## Expected effect on run time

Hill-climb's run time is model-bound. In [P-29](../../../experiments/P-29-hillclimb/RESULT.md) the generator round's
p50 total was 63.0 to 69.1 s per request with no browser in the loop, so a browser swap cannot change that number.
It can only change `render.json` `seconds` for campaigns that render pages.

- Per page, Kitesurf is slower, not faster. Cloudflare measured 1.7 to 1.8 times Chromium's wall time; the local
  probe below measured 1.8 times (median 261.5 ms against 144.8 ms per page load).
- Per session start, the local probe measured 13.4 to 15.0 ms to connect to a running Kitesurf against 199.3 to
  258.1 ms to spawn and connect a fresh headless Chromium. For one page per fresh browser, that more than offsets the
  per-page loss in this probe (about 276 ms against 345 ms); a long-running Chromium reused across pages keeps its lead.
- Memory is where it pays. The probe's `workerd` stayed at 87.6 to 87.9 MiB resident across 15 loads, against 373 to
  383 MiB idle and 490.6 to 496.7 MiB peak for the headless Chromium process tree. Cloudflare reports 4.7 to 7.0
  times less memory.
- Estimate (unmeasured in EndoForge): a render stage limited by memory rather than by a serial loop could run about
  four times as many concurrent page sessions in the same memory, from the probe's ratio of roughly 88 to 375 MiB.
  Hill-climb runs render jobs one after another today (`renderJobs` is a serial loop), so the swap alone would make
  `render` slower by about 1.8 times per page, and a gain needs parallel renders first.

Verdict for run time: neutral to slightly worse as wired today; a possible gain only for `judge` and other
multi-variant renders after they are parallelized. Measure with `render.json` before changing any default.

## Local proof

Run 2026-11-14, 7:55 to 8:10 PM ET, on a shared 32-thread Linux host with other jobs running (1-minute load 15 to 54).
Nothing was deployed and no Cloudflare account was used. The server listened on loopback only and was stopped by PID.

pnpm and Bazel came from `npx` (`pnpm@9.15.4`, `@bazel/bazelisk@1.25.0`) through two wrapper scripts on `PATH`,
with nothing installed globally. Versions: Kitesurf `4a29038` (2026-11-13), Node.js 26.13.1, pnpm 9.15.4, Bazel 9.3.0 (through Bazelisk 1.25.0),
wrangler 4.131.2, workerd 1.20260911.1, puppeteer-core 25.16.0, Chrome for Testing headless shell 149.0.7827.55.

```console
$ git clone -q https://github.com/cloudflare/kitesurf.git kitesurf && cd kitesurf
$ pnpm install --frozen-lockfile
Done in 7.8s
$ pnpm run dev -- --ip 127.0.0.1
[wrangler:info] Ready on http://localhost:8787
$ curl -s http://127.0.0.1:8787/health
kitesurf: OK
$ curl -s http://127.0.0.1:8787/json/version
{"Browser":"Kitesurf/0.0.1","Protocol-Version":"1.3","User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36","V8-Version":"12.0.0","WebKit-Version":"537.36","webSocketDebuggerUrl":"ws://127.0.0.1:8787/devtools/browser"}
$ ss -ltnp | grep -E ':(8787|9229)\b'    # process column trimmed
LISTEN 0      4096                                127.0.0.1:8787       0.0.0.0:*
LISTEN 0      4096                                127.0.0.1:9229       0.0.0.0:*
LISTEN 0      4096                                    [::1]:8787          [::]:*
```

The first build compiled the Rust core in 665 s with Bazel limited to 8 jobs. The probe is a Puppeteer script that
serves a one-line page on an ephemeral loopback port (title `EF fit probe`, plus a script that appends ` (js ran)`),
connects over CDP, and for each of five loads opens a page, navigates, reads `page.title()` and closes the page. It
ran three times against Kitesurf (`puppeteer.connect` to `ws://127.0.0.1:8787/devtools/browser`) and three times
against a headless Chromium it spawned on loopback. Every load returned `EF fit probe (js ran)`, so page JavaScript
ran in both. A further three loads of `https://example.com/` through Kitesurf returned `Example Domain` with a median
of 514.5 ms. Summary of the 15 local loads per engine:

```console
kitesurf 15 median 261.5 min 216 max 290.4 connect [14.6, 15, 13.4] rss [(87.6, 87.6), (87.7, 87.7), (87.8, 87.8)]
chromium 15 median 144.8 min 128.6 max 188.1 connect [199.3, 214.2, 258.1] rss [(376.8, 496.7), (383, 495.2), (373, 490.6)]
```

`rss` is (before, peak) MiB: the `workerd` process for Kitesurf and the whole browser process tree for Chromium. The
full `wrangler dev` tree (pnpm, wrangler, esbuild and workerd) held 1,641 MiB, so the local development server is
not a light way to run Kitesurf; the per-session figure is the one that would carry to a hosted instance.

What this does not show: local `wrangler dev` is not Cloudflare's production runtime; one host under shared load; one
trivial page, so neither CSS layout cost nor screenshots were measured; no hill-climb campaign was run.

## Next step

If a page-layout campaign appears, add Kitesurf as an optional `fast` render command next to the Chromium one and
compare `render.json` seconds and still quality over a few rounds, keeping `final` on Chromium.
