# Kitesurf measurement note

Date: 2026-11-14, revised the same day. Status: research note; no code change and no default change.

[Kitesurf](https://github.com/cloudflare/kitesurf) is Cloudflare's stateless browser engine for agents, open-sourced
under Apache-2.0 on 2026-11-13 ([announcement](https://blog.cloudflare.com/kitesurf-open-source/),
[documentation](https://developers.cloudflare.com/browser-run/kitesurf/)). It parses HTML, applies CSS, runs page
JavaScript and renders screenshots. Its engine is Rust compiled to WebAssembly (Blitz, Stylo, Taffy, Parley,
`vello_cpu`, and Boa for page JavaScript) behind a TypeScript layer that runs on Workers and speaks the Chrome DevTools
Protocol (CDP).

This note records what the sources say and what one local run measured. The run used Kitesurf's own packaging:
`wrangler dev`, `workerd` and a CDP client. EndoForge's direction is different: run Kitesurf's WebAssembly core inside
a workcell, with no browser process or CDP server, as designed in
[#152](https://github.com/Akilleez-QA/endoforge/pull/152). The numbers below describe the `wrangler dev` and CDP path,
not the in-workcell path. EndoForge does not vendor or depend on Kitesurf; this page only links to it.

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

## Where a browser enters a run today

On `main` at `b4bf587` no browser engine is wired into the engine. Workcells, gates and the agent loop run WebAssembly
and JavaScript in V8 isolates; the workcell browser design (#152) would add a browser engine there. Until then, the
one place a browser can enter a run is [hill-climb](../../../tools/hillclimb/README.md):

- `render` runs each campaign's own `render` commands on the host and writes stills
  (`tools/hillclimb/bin/hillclimb.mjs`, `renderJobs` and `cmdRender`), then records the stage's wall time in
  `render.json` as `seconds`. A page-layout campaign (the README's example goal is a landing page at phone width)
  would put its screenshot command here.
- `judge` fast-renders every competing variant before a judge atom picks one per owner, so render cost grows with
  the number of variants.
- `refs --fetch` downloads approved references with `curl`, not a browser.

EndoForge ships no campaign whose render command drives a browser.

## What Kitesurf suits, on any path

These limits belong to the engine, so they apply to the in-workcell design as much as to the CDP path.

- Suits: `fast` stills of static or lightly scripted pages, where a critic needs a readable image rather than
  pixel-exact output, and text or DOM extraction, where HTML and computed layout matter more than paint.
- Does not suit: `final` renders and pixel comparisons meant to stand for what a person sees in Chrome, since
  Kitesurf is not pixel-perfect (within one engine and one pinned build, round-to-round diffs stay meaningful);
  WebGL, canvas-heavy 3D or video, such as the 3D-asset and game-level goals the hill-climb README names; anything
  that logs in and keeps a session, or a site behind a bot challenge.
- A local Kitesurf server is out of reach of factory-runtime atoms: the egress proxy admits an exact provider
  allowlist on port 443 only (`tools/factory_runtime/egress.py`). The in-workcell design needs no server.
- A hosted instance is outside this project's limits: self-hosting needs Workers Paid, and the managed endpoint needs
  an account token.

## Run time on the measured path

Hill-climb's run time is model-bound. In [P-29](../../../experiments/P-29-hillclimb/RESULT.md) the generator round's
p50 total was 63.0 to 69.1 s per request with no browser in the loop, so a browser cannot change that number. It can
only change `render.json` `seconds` for campaigns that render pages. On the `wrangler dev` and CDP path:

- Per page, Kitesurf was slower. Cloudflare measured 1.7 to 1.8 times Chromium's wall time; the local probe below
  measured 1.8 times (median 261.5 ms against 144.8 ms per page load).
- Per session start, connecting to a running Kitesurf took 13.4 to 15.0 ms against 199.3 to 258.1 ms to spawn and
  connect a fresh headless Chromium. For one page per fresh browser that more than offset the per-page loss in this
  probe (about 276 ms against 345 ms); a long-running Chromium reused across pages keeps its lead.
- Memory: `workerd` stayed at 87.6 to 87.9 MiB resident across 15 loads, against 373 to 383 MiB idle and 490.6 to
  496.7 MiB peak for the headless Chromium process tree. Cloudflare reports 4.7 to 7.0 times less memory.
- Hill-climb runs render jobs one after another (`renderJobs` is a serial loop), so any gain from cheaper sessions
  needs parallel renders first. That gain is unmeasured.

The in-workcell path has different costs: no CDP round trips or `workerd`, but one engine module per process cell.
#152 records first numbers for the core alone in plain Node and labels what is still unmeasured; they are not
comparable with the numbers here.

## Local proof (`wrangler dev` and CDP path)

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

Review the workcell browser design (#152). Its first spike renders one local HTML file to pixels inside a workcell.
Measure any render change with `render.json` before changing a default, and keep `final` renders on Chromium.
