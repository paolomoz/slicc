# SLICC Demo Video — Script

> **Length**: ~2 minutes | **Tone**: Casual, conversational | **Recording**: Real SLICC | **Format**: Screen recording, dialog between user and SLICC

The demo is a conversation. SLICC introduces itself, the user jumps in with real requests, and SLICC delivers. No narrator — just a user and their agent.

---

## Act 1 — Launch & Welcome (0:00–0:20)

**Visual**: Clean macOS desktop. Sliccstart is open. User clicks Chrome. SLICC workspace appears — chat, terminal, files, all visible. SLICC sends a welcome message in chat.

**SLICC** (chat bubble):
> Hey! I'm SLICC — I run right here in your browser. I've got a shell, a filesystem, browser automation, and I can spin up sub-agents when things get busy. What are we working on?

**User** (types):
> Can you run an SEO audit and an accessibility report on aem.live? Do them in parallel, I want both ready when I'm back.

---

## Act 2 — Parallel Scoops + Tray Setup (0:20–0:50)

**Visual**: SLICC spins up two scoops — visible in the scoop panel as two separate agents working simultaneously. One is labeled "SEO Audit", the other "Accessibility Report". Both are actively working (terminal output scrolling, browser tabs opening aem.live). The scoop panel shows both running at the same time.

**SLICC** (chat):
> Spinning up two scoops — one for SEO, one for accessibility. They'll run in parallel. What else while we wait?

**User** (types):
> I want to connect a couple of desktop apps too. Can you give me the tray join URL so I can onboard Slack and VS Code?

**SLICC** (chat):
> Sure, here's your tray URL: `https://tray.slicc.dev/join/xxxxx`. Any app that connects to this can be part of our session. The scoops are still working — I'll let you know when they're done.

**Visual**: SLICC shows the tray URL. The two scoops keep working in the background — visible activity in the scoop panel. User switches to Sliccstart.

---

## Act 3 — Connecting Electron Apps (0:50–1:15)

**Visual**: In Sliccstart, user clicks Slack — it launches with the SLICC overlay injected (ice cream logo visible in the sidebar). Then clicks VS Code — same thing. Quick shot: three windows on screen, all with SLICC.

**User** (types, back in SLICC Chrome window):
> OK, Slack and VS Code are connected. Both showing your panel.

**SLICC** (chat):
> I can see them both. Slack and VS Code are now part of this session. Oh, and the scoops just finished —

**Visual**: The two scoops complete. SLICC drops two inline sprinkles — side by side or stacked. The SEO report shows a score, issues found (missing meta descriptions, image alt tags, heading hierarchy). The accessibility report shows WCAG violations, contrast issues, missing ARIA labels, with severity badges.

**SLICC** (chat):
> SEO audit found 12 issues — biggest ones are missing meta descriptions on 3 pages and some images without alt text. Accessibility report flagged 8 WCAG violations, mostly contrast ratios and missing ARIA labels. Both reports are here if you want to dig in.
>
> Those ran while you were connecting apps. What's next?

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

**Visual**: Pull back to show the full desktop — Chrome with SLICC (SEO/a11y reports and Slack recap visible in chat), Slack with overlay (reply visible), VS Code with overlay. All connected through one session.

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
| 2 | Two scoops spinning up + tray URL in chat | Both scoops visible working in parallel, URL displayed |
| 3 | Sliccstart → Slack + VS Code attach, SEO/a11y reports land | Overlay injection, two sprinkle report cards rendering |
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
- **Parallel work is shown, not explained** — two scoops run SEO + a11y audits while user connects apps
- **The escalation is natural** — launch → parallel audits → connect apps → read Slack → take action
- **Real deliverables** — SEO and accessibility reports are genuinely useful output, not a toy demo
