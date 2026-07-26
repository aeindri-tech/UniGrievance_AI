require("dotenv").config();
const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");

const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || "gemini-2.5-flash";
const DB_PATH = path.join(__dirname, "data", "complaints.json");

if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "\n[warn] GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.\n" +
      "       Get one free (no card required) at https://aistudio.google.com/apikey\n"
  );
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const DEPARTMENTS = ["electricity", "roads", "water", "municipal", "cyber", "other"];

// Mock official-portal endpoints. In a real deployment these would be the
// actual department API/webhook endpoints (or a routing agent's target URL).
const TARGET_PORTALS = {
  electricity: "https://api.electricityboard.gov.in/grievance",
  roads: "https://api.pwd.gov.in/roads/complaints",
  water: "https://api.jalboard.gov.in/report",
  municipal: "https://api.municipalcorp.gov.in/tickets",
  cyber: "https://cybercrime.gov.in/api/report",
  other: "https://api.pgportal.gov.in/grievance",
};

// --- tiny file-backed "database", with a write queue to avoid clobbering
//     concurrent writes on a single instance. Fine for a hackathon demo;
//     swap for Postgres/SQLite/Mongo for real production use. ---
let writeQueue = Promise.resolve();

async function readComplaints() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeComplaints(data) {
  writeQueue = writeQueue.then(() =>
    fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), "utf-8")
  );
  return writeQueue;
}

function stripFence(text) {
  return text.replace(/```json|```/g, "").trim();
}

function newTicketId() {
  return `UG-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

async function triage(text, existingGroups) {
  const summary = existingGroups.slice(-60).map((g) => ({
    id: g.id,
    department: g.department,
    location: g.location,
    title: g.title,
  }));

  const system = `You are the AI triage engine for UniGrievance AI, a unified public-grievance portal for India. You receive a citizen's complaint (any Indian language, English, or a mix) plus a short list of currently open issues. Respond with ONLY a raw JSON object - no markdown fences, no preamble, no trailing text - matching exactly this shape:
{
"detectedLanguage": string,
"translatedText": string,
"title": string (5-8 word issue title, English),
"department": one of ${JSON.stringify(DEPARTMENTS)},
"location": string (best-guess locality/area mentioned, else "Not specified"),
"severity": one of ["Low","Medium","High"],
"duplicateOfId": string or null (id of an existing issue ONLY if it is clearly the same underlying problem in the same area, else null),
"citizenReply": string (a short warm confirmation, written in the citizen's ORIGINAL language/script, telling them the complaint was registered or merged with others already reporting it, and that it is being sent to the right department)
}`;

  const user = `Existing open issues (JSON): ${JSON.stringify(summary)}

New complaint from citizen: """${text}"""`;

  const result = await ai.models.generateContent({
    model: MODEL,
    contents: `${system}\n\n${user}`,
    config: { responseMimeType: "application/json" },
  });

  const raw = result.text;
  return JSON.parse(stripFence(raw));
}

// --- routes ---

app.get("/api/health", (req, res) => {
  res.json({ ok: true, model: MODEL, keyConfigured: Boolean(process.env.GEMINI_API_KEY) });
});

app.get("/api/complaints", async (req, res) => {
  const groups = await readComplaints();
  res.json(groups);
});

app.post("/api/complaints", async (req, res) => {
  const text = (req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Complaint text is required." });

  try {
    const groups = await readComplaints();
    const ai = await triage(text, groups);
    const now = Date.now();
    const match = ai.duplicateOfId && groups.find((g) => g.id === ai.duplicateOfId);

    let group;
    let next;
    const report = {
      id: `${now}`,
      rawText: text,
      language: ai.detectedLanguage,
      translatedText: ai.translatedText,
      timestamp: now,
    };

    if (match) {
      group = {
        ...match,
        severity: ai.severity === "High" || match.severity === "High" ? "High" : match.severity,
        targetPortal: match.targetPortal || TARGET_PORTALS[match.department],
        reports: [...match.reports, report],
      };
      next = groups.map((g) => (g.id === match.id ? group : g));
    } else {
      const dept = DEPARTMENTS.includes(ai.department) ? ai.department : "other";
      group = {
        id: newTicketId(),
        title: ai.title,
        department: dept,
        location: ai.location || "Not specified",
        severity: ["Low", "Medium", "High"].includes(ai.severity) ? ai.severity : "Medium",
        status: "Routed to Portal",
        targetPortal: TARGET_PORTALS[dept],
        createdAt: now,
        reports: [report],
      };
      next = [group, ...groups];
    }

    await writeComplaints(next);
    res.json({
      group,
      isNew: !match,
      reply: ai.citizenReply,
      telemetry: {
        category: group.department,
        urgency: group.severity,
        stackCount: group.reports.length,
        targetPortal: group.targetPortal || TARGET_PORTALS[group.department],
      },
    });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "The AI counter is busy right now. Please try again." });
  }
});

app.patch("/api/complaints/:id/resolve", async (req, res) => {
  const groups = await readComplaints();
  const next = groups.map((g) => (g.id === req.params.id ? { ...g, status: "Resolved" } : g));
  await writeComplaints(next);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`UniGrievance AI server running on http://localhost:${PORT}`);
});
