# UniGrievance AI
### One Citizen, One Window — a unified, AI-triaged public grievance portal for India

**Team:** Git Push, Pray
**Track:** Track 4 — AI for Bharat: Governance & Social Impact
**Event:** Summer School '26 AI First Hackathon (IIT Jammu × Techible × I3C)

---

## The problem

Citizens today juggle separate portals for electricity, roads, water, municipal, and
cyber complaints — most of them English-only, form-heavy, and inaccessible to rural or
non-English-speaking users. Meanwhile, if fifty people report the same broken
streetlight, authorities get fifty duplicate tickets instead of one high-priority one.

## The solution

One conversational front door. A citizen types or **speaks in their own language** —
Hindi, Odia, Bengali, Tamil, and more. The AI:

1. **Transcribes & translates** the complaint to English
2. **Categorizes** it to the right department (Electricity / Roads / Water / Municipal / Cyber / Other)
3. **Extracts** location and severity
4. **Checks for duplicates** — if someone already reported the same issue in the same area, it's merged into that ticket instead of creating a new one, and the ticket's priority rises with every additional report
5. **Replies to the citizen in their own language**, confirming the complaint was filed or merged

A public **Control Room dashboard** shows every open ticket, sorted by how many
citizens reported it — turning scattered individual complaints into a ranked, actionable
queue for authorities.

## Architecture

```
┌─────────────┐      HTTP       ┌──────────────┐      Gemini API       ┌────────────┐
│  Browser     │ ─────────────▶ │  Express      │ ──────────────────▶  │  Gemini    │
│  (vanilla JS,│ ◀───────────── │  server.js    │ ◀──────────────────  │  (triage)  │
│  Web Speech) │                │  + JSON store │                       └────────────┘
└─────────────┘                 └──────────────┘
```

- **Frontend** (`/public`) — plain HTML/CSS/JS, no build step. Handles the ticket-stub
  UI, voice capture (browser `SpeechRecognition` API), and polling the dashboard.
- **Backend** (`/server`) — Express API. This is where the Gemini API key lives —
  it is **never** exposed to the browser. Handles triage, duplicate-matching, and
  persistence.
- **Storage** — a JSON file (`server/data/complaints.json`) acting as a lightweight
  database. Swap `readComplaints`/`writeComplaints` in `server.js` for a real database
  (Postgres, SQLite, MongoDB) to move beyond a single-instance demo.

## Tech stack

| Layer | Choice |
|---|---|
| AI / triage | Google Gemini API (`gemini-2.5-flash` by default, swappable) — free tier, no credit card required |
| Speech-to-text | Browser Web Speech API (free, no key required) — swap for Bhashini/Whisper for production-grade Indian-language accuracy |
| Backend | Node.js + Express |
| Storage | JSON file (demo) → Postgres/SQLite (production path) |
| Frontend | Vanilla HTML/CSS/JS |


## Deploying it

Any Node host works (Render, Railway, Fly.io, a plain VPS). General steps:

1. Push this repo to GitHub.
2. Create a new Web Service on your host of choice, point it at the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Add an environment variable `GEMINI_API_KEY` (and optionally `MODEL`) in the
   host's dashboard — **do not** commit `.env`.
5. Note: the JSON-file storage resets if the host's filesystem is ephemeral (common on
   free tiers). For a persistent demo, attach a small volume, or swap in a hosted
   database (e.g. a free Postgres instance on Railway/Supabase).

## What's simulated vs. real in this prototype

| Feature | Status |
|---|---|
| Language detection, translation, categorization, severity, duplicate detection | **Real** — live calls to Gemini |
| Citizen reply in their own language | **Real** |
| Voice input | **Real** (browser-native, Chrome/Edge) |
| Routing to actual government portals | **Simulated** — ticket is marked "Routed to Portal"; real integration would need per-portal scraping/API agents (see risks below) |
| Multi-citizen duplicate stacking | **Real**, shared across everyone hitting the same server |

## Known risks & mitigations (for judges)

- **Official portals may block automated submission** (CAPTCHAs, session logins).
  Mitigation: a human-in-the-loop dashboard where a moderator clicks to confirm/forward
  a pre-filled ticket, rather than fully blind automation.
- **Regional accents/dialects** may reduce speech-to-text accuracy on rarer languages.
  Mitigation: fall back to text input; fine-tune with a dedicated Indian-language ASR
  model (e.g. Bhashini) instead of the browser default for production use.
- **Gemini's free tier has daily/per-minute request caps.** Fine for a hackathon demo
  (hundreds of requests/day); a real deployment would move to a paid tier or a
  provider-agnostic queue so traffic spikes don't get rate-limited.

## Roadmap

- Pilot with 1–2 city municipal/electricity boards
- Swap browser speech recognition for Bhashini (better Indian-language coverage)
- Real routing agents per department portal
- Admin auth for the Control Room dashboard
- SMS/WhatsApp intake for citizens without smartphone data plans

---
*Built for Track 4: AI for Bharat — Governance & Social Impact.*
