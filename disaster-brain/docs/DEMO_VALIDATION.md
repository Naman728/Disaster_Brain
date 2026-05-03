# Disaster Brain — Run & test everything (demo validation)

End-to-end checklist for **Ollama + Next.js + voice + photo triage** in **Google Chrome**.

---

## 1. Backend (Ollama) — Terminal 1

Run continuously (or use an existing daemon):

```bash
ollama serve
```

- If you see **“address already in use”**, Ollama is **already running** — do **not** restart; that is OK.

### Verify tags

```bash
curl -s http://127.0.0.1:11434/api/tags | head -c 2000
# equivalent: http://localhost:11434/api/tags
```

You should see JSON with a `models` array. The app expects:

- **Model:** `gemma3:4b`

If missing:

```bash
ollama pull gemma3:4b
```

> **Note:** API routes use `OLLAMA_HOST` (default `http://127.0.0.1:11434`) from `src/lib/ollama-config.ts` so Node hits the same host as the bundled chat client.

---

## 2. Frontend (Next.js) — Terminal 2

```bash
cd disaster-brain
npm install   # first time
npm run dev
```

### Verify app

- Open **http://localhost:3000** — page loads without a blank error screen.
- Open **http://localhost:3000/api/health** — JSON with `"ok": true` when Ollama is reachable **from the Next server** and the model is listed.

### Automated check (from project root)

```bash
npm run verify
```

This hits Ollama `/api/tags` and Next `/api/health`. Requires both servers up.

---

## 3. Common issues (before the room)

| Symptom | Checks |
|--------|--------|
| API errors / 500 | `ollama serve`, `ollama pull gemma3:4b`, no port conflict on **11434** |
| UI stuck “Analyzing…” | Client uses `finally` to clear loading; if stuck, hard-refresh and check DevTools **Network** for hung `/api/triage` or `/api/photo-triage` |
| No / odd response | **Chrome DevTools → Console**: look for `[DisasterBrain]` logs with parsed JSON and raw response snippets |

---

## 4. Browser requirement

- **Use Google Chrome** for the demo.
- **Web Speech API** (hold-to-speak) is unreliable in Safari; Chrome is required for voice.

---

## 5. Photo test flow (real images)

Suggested field-style inputs (injury photos):

| Scenario (example) | Typical expectation (START-style; model may vary) |
|--------------------|------------------------------------------------------|
| Arm bruise / minor soft tissue | Often **MINOR** |
| Burn injury (hand) | Often **DELAYED** (moderate) |
| Cut / wound | **DELAYED** or higher if severe bleeding |
| Head wound / major trauma cues | Often **IMMEDIATE** |

### Steps (each image)

1. Open **Photo vision** tab.
2. Upload image → **Analyze photo**.
3. Confirm: loading state → result from Gemma vision → patient appears in **global queue**.
4. Open **Queue board** (`/queue`) — row appears **immediately**, sorted by severity.

---

## 6. Voice test flow

1. **Voice / text** tab.
2. **Hold to speak** — dictate symptoms — release.
3. Edit textarea if needed.
4. **Run voice / text triage**.
5. Confirm: `/api/triage` returns JSON → patient in context → `/queue` updates.

---

## 7. Success criteria (system “green”)

- [ ] Voice triage → patient in **one** global queue  
- [ ] Photo triage → same queue  
- [ ] `/queue` sorts **IMMEDIATE → DELAYED → MINOR → EXPECTANT**  
- [ ] No infinite loading (spinners clear in `finally`)  
- [ ] No unhandled API crashes in UI (errors surfaced + Ollama alert where applicable)  
- [ ] Demo path: Chrome → `/` → `/queue` — feels like a **live AI emergency command center**

---

## 8. Demo readiness (2-minute script)

1. `npm run verify` → all green.  
2. Chrome: **http://localhost:3000** — show **Queue board** link and counts.  
3. Photo tab → analyze one real injury image → switch to **Queue board** — show sort + card.  
4. Voice tab → hold mic → short symptom → **Run triage** → refresh queue — new row on top by severity.  
5. State explicitly: **single PatientContext queue** for voice + photo.
