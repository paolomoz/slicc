# SLICC Demo Video — Script

> **Length**: ~2 minutes | **Tone**: Casual, conversational | **Recording**: Real SLICC | **Format**: Screen recording, dialog between user and SLICC

The demo is a conversation. SLICC introduces itself, the user jumps in with real requests, and SLICC delivers. No narrator — just a user and their agent.

---

## Act 1 — Launch & Welcome (0:00–0:20)

**Visual**: Clean macOS desktop. Sliccstart is open. User clicks Chrome. SLICC workspace appears — chat, terminal, files, all visible. SLICC sends a welcome message in chat.

**SLICC** (chat bubble):
> Hey! I'm SLICC — I run right here in your browser. I've got a shell, a filesystem, browser automation, and I can spin up sub-agents when things get busy. What are we working on?

**User** (types):
> First, can you open a tab and check what's trending on Hacker News? I want to see what's going on while we set things up.

---

## Act 2 — Background Work + Tray Setup (0:20–0:50)

**Visual**: SLICC opens a new browser tab, navigates to Hacker News, starts summarizing. Meanwhile the user keeps chatting — SLICC is doing work in the background (visible in terminal/scoop panel).

**SLICC** (chat):
> On it — I'll grab the front page and pull together a summary. What else?

**User** (types):
> I want to connect a couple of desktop apps too. Can you give me the tray join URL so I can onboard Slack and VS Code?

**SLICC** (chat):
> Sure, here's your tray URL: `https://tray.slicc.dev/join/xxxxx`. Any app that connects to this can be part of our session. I'll keep working on the HN summary while you set that up.

**Visual**: SLICC shows the tray URL. Meanwhile in the background, the HN summary is being built — visible as a scoop working. User switches to Sliccstart.

---

## Act 3 — Connecting Electron Apps (0:50–1:15)

**Visual**: In Sliccstart, user clicks Slack — it launches with the SLICC overlay injected (ice cream logo visible in the sidebar). Then clicks VS Code — same thing. Quick shot: three windows on screen, all with SLICC.

**User** (types, back in SLICC Chrome window):
> OK, Slack and VS Code are connected. Both showing your panel.

**SLICC** (chat):
> I can see them both. Slack and VS Code are now part of this session. And here's your Hacker News roundup —

**Visual**: SLICC drops an inline sprinkle — a compact card with the top HN stories, titles, points, comment counts. It was built while the user was connecting apps.

**SLICC** (chat):
> Built that while you were setting things up. Anything else?

---

## Act 4 — The Real Ask (1:15–1:45)

**User** (types):
> Actually yeah — what's new in my Slack channels? Anything I should pay attention to today?

**Visual**: SLICC reads Slack via the connected tray session. Browses channels, reads recent messages. Comes back with a summary — either as text or a sprinkle card with channel highlights, mentions, and threads that need attention.

**SLICC** (chat):
> Here's what's going on. You've got 3 mentions in #dev — Sarah's asking about the deploy timeline. There's a thread in #design about the new landing page. And someone shared a PR in #code-review that touches your module.
>
> Want me to do anything about these?

**User** (types):
> Reply to Sarah — tell her we're on track, shipping the fix this afternoon.

**Visual**: SLICC navigates Slack via browser automation, finds Sarah's message, types the reply. Visible on screen.

**SLICC** (chat):
> Done. Replied to Sarah in #dev.

---

## Act 5 — Outro (1:45–2:00)

**Visual**: Pull back to show the full desktop — Chrome with SLICC (HN summary and Slack recap visible in chat), Slack with overlay (reply visible), VS Code with overlay. All connected through one session.

**SLICC** (chat):
> Three apps, one agent. Need anything else?

**Visual**: Fade to branded slide — ice cream cone logo, "slicc" wordmark, `npx sliccy`, website URL.

---

## Production Notes

### Dialog Delivery

This is NOT a traditional voiceover. Two options:

1. **Text only** — The chat bubbles ARE the dialog. No spoken audio. Lo-fi background music throughout. Clean, modern. Captions/subtitles for key moments.
2. **Two voices** — SLICC gets an AI voice (ElevenLabs), user lines are either typed on screen or read by a second voice. More engaging but more production work.

Recommend starting with option 1 (text only) — it's simpler to produce and the dialog reads well on screen.

### Screen Recordings Needed

| Act | What to record | Key moments |
|-----|---------------|-------------|
| 1 | Sliccstart → Chrome launch, welcome message | Workspace appearing, SLICC greeting |
| 2 | SLICC opens HN tab + tray URL in chat | Background scoop working, URL displayed |
| 3 | Sliccstart → Slack + VS Code attach, HN sprinkle appears | Overlay injection, sprinkle card rendering |
| 4 | Slack channel reading + reply via browser automation | Slack summary, reply being typed live |
| 5 | Desktop pull-back, all three windows | Connected session visible |

### Timing Budget

| Act | Duration | Cumulative |
|-----|----------|------------|
| 1 — Launch & Welcome | 20s | 0:20 |
| 2 — Background + Tray | 30s | 0:50 |
| 3 — Electron Apps | 25s | 1:15 |
| 4 — Slack Ask | 30s | 1:45 |
| 5 — Outro | 15s | 2:00 |

### What Makes This Work

- **Dialog-driven** — feels like watching someone use the product, not a marketing pitch
- **SLICC has personality** — it talks casually, offers to help, works in the background without being asked to wait
- **Parallel work is shown, not explained** — HN summary builds while user does something else
- **The escalation is natural** — open a tab → connect apps → read Slack → take action
- **No coding in this version** — keeps it accessible. Coding demo can be a separate video
