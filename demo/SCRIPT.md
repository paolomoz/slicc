# SLICC Demo Video — Script

> **Length**: ~2 minutes | **Tone**: Casual, developer-friendly | **Recording**: Real SLICC, no mocks | **Format**: Screen recording + AI voiceover

---

## Act 0 — Intro Slide (0:00–0:05)

**Visual**: Branded slide. Ice cream cone logo, "slicc" wordmark, tagline.

**Voiceover**:
> Meet SLICC — your AI agent that lives in the browser and gets things done.

---

## Act 1 — The Launch (0:05–0:15)

**Visual**: Clean macOS desktop. Sliccstart is open showing detected browsers and apps. User clicks Chrome. SLICC workspace opens — chat panel, terminal, files, all visible.

**Voiceover**:
> SLICC launches from Sliccstart, a native macOS app. One click and you've got a full workspace — chat, terminal, files, browser automation — all running inside Chrome.

---

## Act 2 — Connect Your World (0:15–0:35)

**Visual**: Back to Sliccstart. User clicks Slack — Slack opens with the SLICC overlay injected (ice cream logo visible). Then clicks VS Code — same thing, SLICC overlay appears inside VS Code. Quick montage: three windows side by side, all showing the SLICC panel.

**Voiceover**:
> But SLICC doesn't just live in a browser tab. Click any Electron app — Slack, VS Code, whatever — and SLICC injects itself right in. Same agent, same workspace, available wherever you're already working. It connects to your apps, not the other way around.

---

## Act 3 — The Morning Catch-Up (0:35–1:00)

**Visual**: Main SLICC Chrome window. User types: *"Hey Slicc, catch me up — what's important in Slack today and are there any open PRs that need my review?"* SLICC responds, spins up two scoops (visible in the scoop panel). One scoop reads Slack messages, the other checks GitHub. Both work simultaneously. Results come back — a sprinkle card appears in chat showing a structured summary: Slack highlights on one side, PR statuses on the other.

**Voiceover**:
> Start your day with a simple question. SLICC spins up parallel agents — one checks Slack, one checks GitHub — and comes back with an interactive summary. Not a wall of text — an actual interface, generated on the fly. Click into anything to dig deeper.

---

## Act 4 — Real Coding: AEM Edge Delivery News Block (1:00–1:35)

**Visual**: User types: *"Our Edge Delivery site needs a live news feed. Build me a news-headlines block that fetches from a public news API and displays articles with thumbnails, titles, and publish dates. Follow the EDS block conventions."*

SLICC works — visible in both terminal and file panel:
1. Creates `blocks/news-headlines/` folder
2. Writes `news-headlines.js` — fetches from a public news API (e.g. GNews, NewsData.io), parses the JSON, renders article cards with thumbnail, headline, source, and date
3. Writes `news-headlines.css` — responsive card grid layout, thumbnail styling, hover states
4. Shows the code briefly in the file panel (audience sees real EDS-pattern code: `export default async function decorate(block)`)
5. SLICC opens a browser preview tab — the block renders with live headlines and images pulled from the API

**Key on-screen moments**: The file tree expanding with the new folder. The JS `fetch()` call visible in code. The preview loading with real news thumbnails.

**Voiceover**:
> Now the real stuff. This Edge Delivery site has no news section — let's add one. SLICC builds a news-headlines block from scratch — fetches from a live API, renders a card grid with thumbnails, all following EDS conventions. And it previews the result right in the browser it's running in. Real articles, real data, real code — in about thirty seconds.

---

## Act 5 — Ship It (1:35–1:50)

**Visual**: User types: *"Looks good. Commit and push this, then let Sarah know on Slack that the news block is live and ready for content review."* SLICC runs git commands in the terminal (git add, commit, push visible). Then switches context — navigates Slack via browser automation, finds Sarah's thread, types a message with a link. All visible on screen.

**Voiceover**:
> Happy with it? Ship it. Git push, done. Then SLICC hops over to Slack and tells your teammate it's ready. One prompt, two apps, zero context switching.

---

## Act 6 — Outro (1:50–2:00)

**Visual**: Pull back to show the full desktop — Chrome with SLICC, Slack with overlay, VS Code with overlay. Fade to branded slide with logo, URL, and "npx sliccy" command.

**Voiceover**:
> SLICC. One agent across all your apps. Try it now — npx sliccy.

---

## Production Notes

### Screen Recordings Needed

| Act | What to record | Key moments |
|-----|---------------|-------------|
| 1 | Sliccstart → Chrome launch | Workspace appearing with all panels |
| 2 | Sliccstart → Slack attach, then VS Code attach | Overlay injection moment in each app |
| 3 | Chat interaction + scoops spinning up | Parallel scoops visible, sprinkle card rendering |
| 4 | Chat → terminal creates `blocks/news-headlines/` → JS/CSS written → preview tab with live news | File tree expanding, `fetch()` in code, real thumbnails loading in preview |
| 5 | Git commands in terminal + Slack browser automation | Commit output, Slack message being typed with link |
| 6 | Desktop pull-back shot | All three windows with SLICC visible |

### Timing Budget

| Act | Duration | Cumulative |
|-----|----------|------------|
| 0 — Intro | 5s | 0:05 |
| 1 — Launch | 10s | 0:15 |
| 2 — Connect | 20s | 0:35 |
| 3 — Catch-Up | 25s | 1:00 |
| 4 — Coding | 35s | 1:35 |
| 5 — Action | 15s | 1:50 |
| 6 — Outro | 10s | 2:00 |

### Voice

- Casual, upbeat, not corporate. Think "developer showing a friend something cool."
- ElevenLabs voice: **Eric** (smooth, trustworthy) or **Brian** (deep, resonant) — test both.
- Pacing: ~2.5 words/sec. Each act's voiceover is calibrated to fit within its time window.

### Music

- Lo-fi/chill instrumental on intro + outro slides only.
- No music during Acts 1–5 (voice + screen audio only).

### Word Counts per Act (at ~2.5 words/sec)

| Act | Duration for VO | Target words | Actual words |
|-----|----------------|--------------|--------------|
| 0 | 5s | ~12 | 14 |
| 1 | 10s | ~25 | 30 |
| 2 | 18s | ~45 | 48 |
| 3 | 22s | ~55 | 52 |
| 4 | 30s | ~75 | 68 |
| 5 | 13s | ~32 | 28 |
| 6 | 8s | ~20 | 14 |
