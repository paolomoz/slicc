# SLICC Demo — Voice Dialog Script

> **For ElevenLabs TTS** | Low stability (~0.3) for natural, conversational feel
> **Two voices**: SLICC (AI voice — Eric or Brian) + User (second voice or typed on screen)
> **Pacing**: ~2.5 words/sec, with pauses marked as `[beat]` and `[pause]`

---

## Act 1 — Launch & Welcome (0:00–0:20)

*[Sliccstart visible. User clicks Chrome. Workspace opens.]*

**SLICC:**
Hey — so, I'm SLICC. I live right here in your browser. Shell, files, browser control, the whole deal. I can also spin up sub-agents if you need stuff done in parallel. So... what are we doing today?

**USER:**
Yeah, actually — can you run an SEO audit and an accessibility report on aem dot live? Both at the same time. I want them ready when I get back.

---

## Act 2 — Parallel Scoops + Tray (0:20–0:50)

*[Two scoops appear in the panel, both actively working.]*

**SLICC:**
Nice — spinning up two scoops right now. One's on SEO, the other's doing accessibility. They'll run side by side. [beat] Anything else while those are cooking?

**USER:**
Uh, yeah — I also want to hook up Slack and VS Code. Can you get me a tray join URL?

**SLICC:**
Sure thing. [beat] Here's your tray link. Any app that joins this is part of the session. Go connect your stuff — the scoops are still crunching, I'll ping you when they're done.

*[User switches to Sliccstart.]*

---

## Act 3 — Electron Apps + Reports Land (0:50–1:15)

*[User clicks Slack in Sliccstart — overlay appears. Clicks VS Code — same. Back to Chrome.]*

**USER:**
OK, Slack and VS Code are in. Both showing your panel.

**SLICC:**
Oh nice, I can see them both. [beat] And — oh, perfect timing — the scoops just wrapped up.

*[Two sprinkle report cards appear in chat.]*

**SLICC:**
So, SEO side — twelve issues. The big ones are missing meta descriptions on a few pages and some images without alt text. [beat] Accessibility flagged eight WCAG violations, mostly contrast ratios and some missing ARIA labels. Both full reports are right there if you want to poke around.

[beat]

That all ran while you were connecting apps, by the way. What's next?

---

## Act 4 — Slack Catch-Up (1:15–1:45)

**USER:**
Hmm, what's going on in my Slack channels? Anything I should actually care about today?

*[SLICC reads Slack via the tray connection. Activity visible.]*

**SLICC:**
OK let me take a look. [pause]

Right, so — you've got three mentions in dev. Sarah's asking about the deploy timeline, that seems kinda urgent. There's a thread in design about the new landing page, mostly back and forth still. And someone dropped a PR in code-review that touches your module.

Want me to jump on any of these?

**USER:**
Yeah — reply to Sarah. Tell her we're on track, shipping the fix this afternoon.

*[SLICC navigates Slack, finds Sarah's message, types the reply.]*

**SLICC:**
Done. Replied to Sarah in dev. [beat] She'll see it.

---

## Act 5 — Outro (1:45–2:00)

*[Pull back — full desktop visible. Chrome, Slack, VS Code, all with SLICC.]*

**SLICC:**
So yeah — three apps, one session, one agent. [beat] Need anything else, or are we good?

*[Fade to branded slide.]*

---

## TTS Production Notes

### ElevenLabs Settings (for natural/casual delivery)

| Parameter | Value | Why |
|-----------|-------|-----|
| Stability | 0.25–0.35 | Low = more expressive, less robotic. Fits casual tone. |
| Similarity Boost | 0.75 | Keep voice recognizable but not rigid. |
| Style | 0.2–0.3 | Slight style exaggeration for personality. |
| Speed | 0.95–1.0 | Just under default — don't rush, let it breathe. |

### Voice Direction

SLICC should sound like a capable coworker, not an assistant. Think:
- "Hey, just did that thing you asked" — not "I have completed your request"
- Contractions always (I'm, they'll, that's, what's)
- Filler words are OK in moderation (so, yeah, right, oh)
- Trailing off is fine — low stability will add natural variation
- Never stiff, never corporate

### Markers

- `[beat]` = ~0.5s natural pause. Don't insert silence — let ElevenLabs handle it via low stability. These are notes for pacing the script, not audio edits.
- `[pause]` = ~1.5s real pause. Insert silence in post or use a sentence break in the TTS call.

### Per-Line Generation

Generate each SLICC line as a separate TTS call. This gives control over timing in the final edit and avoids long-form TTS drift. User lines can be:
- A second ElevenLabs voice (different voice ID, slightly higher stability for contrast)
- Typed on screen with keystroke sounds (simpler, emphasizes the chat UI)
- Read by a real person (most natural contrast with AI voice)

### Word Counts

| Act | SLICC words | User words | Total | Target duration |
|-----|-------------|------------|-------|-----------------|
| 1 | 42 | 28 | 70 | 20s |
| 2 | 51 | 22 | 73 | 30s |
| 3 | 72 | 10 | 82 | 25s |
| 4 | 68 | 14 | 82 | 30s |
| 5 | 17 | 0 | 17 | 15s |
| **Total** | **250** | **74** | **324** | **2:00** |
