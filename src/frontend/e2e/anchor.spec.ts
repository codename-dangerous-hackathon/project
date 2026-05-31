import { test, expect } from "@playwright/test";
import fs from "fs";

const FACE_A = "e2e/fixtures/faceA.jpg";
const FACE_B = "e2e/fixtures/faceB.jpg";
const b64 = (p: string) => fs.readFileSync(p).toString("base64");

// End-to-end tests for Belong, exercising the real production build + FastAPI
// backend. Feature intent comes from docs/architecture_features.md and
// docs/claude-output.md (P0: "Who is this?", Daily Briefing, Memory Journal).

const SHOTS = "e2e/screenshots";

test.describe("Landing page", () => {
  test("renders title and navigates to both surfaces", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Belong" })).toBeVisible();
    await expect(
      page.getByText("100% On-Device AI Companion")
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });

    // Patient link
    await page.getByRole("link", { name: /Voice Companion/i }).click();
    await expect(page).toHaveURL(/\/patient$/);

    // Caregiver link
    await page.goto("/");
    await page.getByRole("link", { name: /Caregiver Dashboard/i }).click();
    await expect(page).toHaveURL(/\/caregiver$/);
  });
});

test.describe("Patient — Infinite Patience loop (Feature 1)", () => {
  const FALLBACK = "I hear you, my friend. Let's take a look at the garden together.";

  test("full voice loop: record → transcribe → real reply → speak", async ({
    page,
  }) => {
    await page.goto("/patient");
    const h1 = page.locator("h1");
    await expect(h1).toHaveText("I am here to help you.");

    // Tap to start listening (records the fake mic, which is fed our speech wav).
    await page.getByRole("button", { name: "TALK" }).click();
    await expect(page.getByRole("button", { name: "TAP TO STOP" })).toBeVisible();
    await expect(h1).toContainText("listening");

    // Let the spoken sentence ("Tell me about my daughter Sarah") play in.
    await page.waitForTimeout(3500);

    const sttResp = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/transcribe" &&
        r.request().method() === "POST",
      { timeout: 30_000 }
    );
    const askResp = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/ask" &&
        r.request().method() === "POST",
      { timeout: 30_000 }
    );

    // Tap to stop → triggers transcribe → ask → speak.
    await page.getByRole("button", { name: "TAP TO STOP" }).click();

    // Real STT actually heard the words.
    const stt = await sttResp;
    expect(stt.status()).toBe(200);
    expect((await stt.json()).text.toLowerCase()).toContain("sarah");

    // Real Nemotron reply (not the offline fallback line).
    const ask = await askResp;
    expect(ask.status()).toBe(200);
    const reply = (await ask.json()).reply as string;
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toBe(FALLBACK);

    // UI echoes what was heard and speaks the reply.
    await expect(page.getByText(/You said:/)).toBeVisible();
    await expect(h1).toHaveText(reply, { timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS}/02-patient-voice.png`, fullPage: true });
  });
});

test.describe('Patient — "Who is this?" face recognition (Feature 2)', () => {
  test("opens the camera and runs real recognition on the frame", async ({
    page,
  }) => {
    await page.goto("/patient");

    // First press opens the camera. The stream attaching to the <video> proves
    // getUserMedia succeeded and the mount-order bug is fixed.
    await page.getByRole("button", { name: "Who is this?" }).click();
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await page.waitForFunction(() => {
      const v = document.querySelector("video") as HTMLVideoElement | null;
      return !!v && v.srcObject != null;
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/03-patient-camera.png`, fullPage: true });

    const idResp = page.waitForResponse(
      (r) => r.url().includes("/api/identify") && r.request().method() === "POST",
      { timeout: 30_000 }
    );

    // Second press captures a frame and runs the real InsightFace recognizer.
    // Headless Chromium's fake camera has no real face, so the recognizer
    // correctly returns no match (the old code always faked "Sarah").
    await page.getByRole("button", { name: "Identify Face" }).click();
    const resp = await idResp;
    expect(resp.status()).toBe(200);
    expect((await resp.json()).match).toBe(false);

    // Fake camera has no real face, so we get a graceful no-match message.
    await expect(page.locator("h1")).toHaveText(
      /don't recognize this person yet|can't see a face clearly/,
      { timeout: 15_000 }
    );
    await page.screenshot({ path: `${SHOTS}/04-patient-identified.png`, fullPage: true });
  });
});

test.describe("Caregiver — portal", () => {
  test("tabs switch between Dashboard, Family and Notes", async ({ page }) => {
    await page.goto("/caregiver");

    await expect(page.getByRole("heading", { name: "Daily Dashboard" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/05-caregiver-dashboard.png`, fullPage: true });

    await page.getByRole("button", { name: "Family Members" }).click();
    await expect(page.getByRole("heading", { name: "Add a Family Member" })).toBeVisible();

    await page.getByRole("button", { name: "Patient Notes" }).click();
    await expect(
      page.getByRole("heading", { name: "General facts about the patient" })
    ).toBeVisible();
  });

  test("adding a general patient note persists and is listed", async ({ page, request }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Patient Notes" }).click();

    const note = `Helen grew up in Scarborough ${Date.now()}`;
    await page.getByPlaceholder(/grew up in Scarborough/).fill(note);
    await page.getByRole("button", { name: "Save Note" }).click();

    await expect(page.getByText("Saved to the offline vault.")).toBeVisible();
    await expect(page.getByText(note)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/06-caregiver-notes.png`, fullPage: true });

    // cleanup
    const list = await (await request.get("/api/journal")).json();
    const mem = (list.general as { id: string; text: string }[]).find((x) => x.text === note);
    if (mem) await request.delete(`/api/memories/${mem.id}`);
  });

  test("add a family member WITH a photo enrolls their face (optional photo)", async ({
    page,
    request,
  }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Family Members" }).click();

    const name = `Mina${Date.now()}`;
    await page.getByPlaceholder(/^Name/).fill(name);
    await page.getByPlaceholder(/^Relationship/).fill("aunt");
    await page.locator('input[type="file"]').setInputFiles(FACE_A);

    const resp = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/people" && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await page.getByRole("button", { name: "Add Family Member" }).click();

    const r = await resp;
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe("success");
    expect(body.has_photo).toBe(true);
    await expect(page.getByText(new RegExp(`${name} added`))).toBeVisible();
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/07-caregiver-family.png`, fullPage: true });

    await request.delete(`/api/people/${body.person_id}`);
  });

  test("family member can be added WITHOUT a photo, then given facts", async ({
    page,
    request,
  }) => {
    // Seed a person via API, then drive the profile UI.
    const name = `Zoe${Date.now()}`;
    const created = await request.post("/api/people", {
      data: { name, relationship: "friend" },
    });
    const personId = (await created.json()).person_id;

    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Family Members" }).click();
    await page.getByText(name, { exact: false }).first().click();

    const fact = `enjoys watercolour painting ${Date.now()}`;
    await page.getByPlaceholder(/Add a fact about/).fill(fact);
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(fact)).toBeVisible();

    await request.delete(`/api/people/${personId}`);
  });

  test("add family member gives feedback when name/relationship missing", async ({ page }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Family Members" }).click();
    await page.getByRole("button", { name: "Add Family Member" }).click();
    await expect(page.getByText("Please enter a name and a relationship.")).toBeVisible();
  });
});

test.describe("Backend API contract (via /api proxy)", () => {
  test("POST /api/ask returns a REAL companion reply (not the fallback)", async ({
    request,
  }) => {
    const r = await request.post("/api/ask", {
      data: { user_input: "When is my daughter coming to visit?" },
      timeout: 60_000,
    });
    expect(r.status()).toBe(200);
    const reply = (await r.json()).reply as string;
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).not.toBe(
      "I hear you, my friend. Let's take a look at the garden together."
    );
  });

  test("POST /api/transcribe accurately transcribes spoken audio", async ({
    request,
  }) => {
    const wav = fs.readFileSync("e2e/fixtures/voice_sarah.wav");
    const r = await request.post("/api/transcribe", {
      timeout: 30_000,
      multipart: {
        file: { name: "voice.wav", mimeType: "audio/wav", buffer: wav },
      },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).text.toLowerCase()).toContain("sarah");
  });

  test("STT auto-detects language — transcribes French speech as French", async ({
    request,
  }) => {
    const wav = fs.readFileSync("e2e/fixtures/voice_fr.wav");
    const r = await request.post("/api/transcribe", {
      timeout: 30_000,
      multipart: { file: { name: "fr.wav", mimeType: "audio/wav", buffer: wav } },
    });
    expect(r.status()).toBe(200);
    const text = (await r.json()).text.toLowerCase();
    // Real French words must appear (proves it's not forcing English).
    expect(text).toMatch(/bonjour|famille|où/);
  });

  test("TTS speaks back in the text's language (French → French voice, no crash)", async ({
    request,
  }) => {
    const r = await request.post("/api/synthesize", {
      data: { user_input: "Bonjour, je suis très heureux de vous voir aujourd'hui." },
      timeout: 30_000,
    });
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("audio/wav");
    expect((await r.body()).length).toBeGreaterThan(2000);
  });

  test("person with photo is recognized by name AND a remembered fact", async ({
    request,
  }) => {
    // Create a unique person on FACE_B (kept clean of other test data) + a fact.
    const name = `Liang${Date.now()}`;
    const create = await request.post("/api/people", {
      data: { name, relationship: "nephew", image_base64: b64(FACE_B) },
      timeout: 30_000,
    });
    expect(create.status()).toBe(200);
    const body = await create.json();
    expect(body.status).toBe("success");
    expect(body.has_photo).toBe(true);
    const personId = body.person_id;
    await request.post(`/api/people/${personId}/memories`, {
      data: { text: "loves chess and jazz records" },
    });

    // Identifying that face returns the name AND the remembered fact.
    const m = await request.post("/api/identify", {
      data: { image_base64: b64(FACE_B) },
      timeout: 30_000,
    });
    const mb = await m.json();
    expect(mb.match).toBe(true);
    expect(mb.name).toBe(name);
    expect(mb.fact).toContain("chess");

    // A different face is NOT this person (proves it's real recognition).
    const n = await request.post("/api/identify", {
      data: { image_base64: b64(FACE_A) },
      timeout: 30_000,
    });
    const nb = await n.json();
    if (nb.match) expect(nb.name).not.toBe(name);

    await request.delete(`/api/people/${personId}`);
  });

  test("POST /api/enroll_memory writes to the vault", async ({ request }) => {
    const r = await request.post("/api/enroll_memory", {
      data: { text: `smoke-test ${Date.now()}`, tags: "life-story" },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.status).toBe("success");
    await request.delete(`/api/memories/${body.memory_id}`); // don't leave junk in the vault
  });

  test("POST /api/synthesize returns real WAV audio (not the 44-byte mock)", async ({
    request,
  }) => {
    const r = await request.post("/api/synthesize", {
      data: { user_input: "Good morning Helen, it is lovely to see you." },
      timeout: 30_000,
    });
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("audio/wav");
    expect((await r.body()).length).toBeGreaterThan(2000);
  });

  test("GET /api/briefing returns a daily briefing", async ({ request }) => {
    const r = await request.get("/api/briefing");
    expect(r.status()).toBe(200);
    expect((await r.json()).briefing).toBeTruthy();
  });

  test("GET /api/journal groups people + general notes", async ({ request }) => {
    const r = await request.get("/api/journal");
    expect(r.status()).toBe(200);
    const data = await r.json();
    expect(Array.isArray(data.people)).toBe(true);
    expect(Array.isArray(data.general)).toBe(true);
  });

  test("family member photo is stored and served for the About Me cards", async ({
    request,
  }) => {
    const A = fs.readFileSync("e2e/fixtures/faceA.jpg").toString("base64");
    const c = await request.post("/api/people", {
      data: { name: "PhotoZed", relationship: "cousin", image_base64: A },
      timeout: 30_000,
    });
    const id = (await c.json()).person_id;
    try {
      const photo = await request.get(`/api/people/${id}/photo`, { timeout: 15_000 });
      expect(photo.status()).toBe(200);
      expect(photo.headers()["content-type"]).toContain("image/jpeg");
      expect((await photo.body()).length).toBeGreaterThan(1000);
    } finally {
      await request.delete(`/api/people/${id}`);
    }
    // photo is gone after delete
    const after = await request.get(`/api/people/${id}/photo`);
    expect(after.status()).toBe(404);
  });

  test("person lifecycle: create → add fact → list → delete", async ({ request }) => {
    const name = `Probe${Date.now()}`;
    const c = await request.post("/api/people", { data: { name, relationship: "cousin" } });
    const id = (await c.json()).person_id;

    await request.post(`/api/people/${id}/memories`, { data: { text: "plays the violin" } });
    const detail = await (await request.get(`/api/people/${id}`)).json();
    expect(detail.name).toBe(name);
    expect(detail.memories.some((m: { text: string }) => m.text === "plays the violin")).toBe(true);

    await request.delete(`/api/people/${id}`);
    const after = await request.get(`/api/people/${id}`);
    expect(after.status()).toBe(404);
  });

  test("calendar event lifecycle + push endpoints", async ({ request }) => {
    // Create a daily medication
    const c = await request.post("/api/events", {
      data: {
        type: "medication",
        title: `TestPill${Date.now()}`,
        notes: "1 tablet",
        time: "16:00",
        recurrence: "daily",
      },
    });
    expect(c.status()).toBe(200);
    const ev = await c.json();
    expect(ev.id).toBeTruthy();
    expect(ev.recurrence).toBe("daily");

    const list = await (await request.get("/api/events")).json();
    expect(list.events.some((e: { id: string }) => e.id === ev.id)).toBe(true);

    // Push plumbing
    const key = await (await request.get("/api/push/public_key")).json();
    expect(key.public_key.length).toBeGreaterThan(80);
    const test = await request.post("/api/push/test");
    expect(test.status()).toBe(200);
    expect(typeof (await test.json()).sent).toBe("number"); // 0 with no subscribers

    await request.delete(`/api/events/${ev.id}`);
    const after = await (await request.get("/api/events")).json();
    expect(after.events.some((e: { id: string }) => e.id === ev.id)).toBe(false);
  });

  test("patient profile round-trips and the companion knows the patient's name", async ({
    request,
  }) => {
    const orig = await (await request.get("/api/profile")).json();
    const name = "TestPatientZed";
    try {
      const s = await request.post("/api/profile", { data: { name, tagline: "loves the sea" } });
      expect(s.status()).toBe(200);
      expect((await s.json()).name).toBe(name);
      expect((await (await request.get("/api/profile")).json()).name).toBe(name);

      const r = await request.post("/api/ask", {
        data: { user_input: "What is my name?" },
        timeout: 60_000,
      });
      expect((await r.json()).reply).toContain(name);
    } finally {
      await request.post("/api/profile", {
        data: { name: orig.name, tagline: orig.tagline, photo: orig.photo },
      });
    }
  });

  test("emergency contact saves and the companion knows it", async ({ request }) => {
    const orig = await (await request.get("/api/profile")).json();
    try {
      const s = await request.post("/api/profile", {
        data: { emergency_name: "Bartholomew", emergency_phone: "+1 555 0199" },
      });
      expect(s.status()).toBe(200);
      const saved = await s.json();
      expect(saved.emergency_name).toBe("Bartholomew");
      expect(saved.emergency_phone).toBe("+1 555 0199");

      const r = await request.post("/api/ask", {
        data: { user_input: "Who do I call in an emergency?" },
        timeout: 60_000,
      });
      expect((await r.json()).reply).toContain("Bartholomew");
    } finally {
      await request.post("/api/profile", {
        data: {
          name: orig.name, tagline: orig.tagline, photo: orig.photo,
          emergency_name: orig.emergency_name, emergency_phone: orig.emergency_phone, medical: orig.medical,
        },
      });
    }
  });

  test("companion is aware of the calendar (medications/schedule)", async ({ request }) => {
    // Add a distinctively-named medication...
    const c = await request.post("/api/events", {
      data: { type: "medication", title: "Zorbex", notes: "1 tablet", time: "08:00", recurrence: "daily" },
    });
    const id = (await c.json()).id;
    try {
      const r = await request.post("/api/ask", {
        data: { user_input: "What medications do I take?" },
        timeout: 60_000,
      });
      expect(r.status()).toBe(200);
      expect((await r.json()).reply.toLowerCase()).toContain("zorbex");
    } finally {
      await request.delete(`/api/events/${id}`);
    }
  });

  test("nearest-place tool + companion answers 'where is the nearest washroom?'", async ({
    request,
  }) => {
    const loc = { lat: 43.6532, lng: -79.3832 }; // downtown Toronto
    const t = await request.get(
      `/api/places/nearest?category=washroom&lat=${loc.lat}&lng=${loc.lng}&n=1`,
      { timeout: 30_000 }
    );
    expect(t.status()).toBe(200);
    const nearest = (await t.json()).results[0];
    expect(typeof nearest.distance_m).toBe("number");
    expect(nearest.name).toBeTruthy();

    // The companion uses the location to name the nearest place.
    const r = await request.post("/api/ask", {
      data: { user_input: "Where is the nearest washroom?", location: loc },
      timeout: 60_000,
    });
    const reply = (await r.json()).reply as string;
    const token = nearest.name.split(/\s+/).sort((a: string, b: string) => b.length - a.length)[0];
    expect(reply.toLowerCase()).toContain(token.toLowerCase());
  });

  test("map community-centres dataset + nearest community endpoint", async ({ request }) => {
    const m = await request.get("/map/data/reccentres", { timeout: 30_000 });
    expect(m.status()).toBe(200);
    const data = await m.json();
    expect(data.count).toBeGreaterThan(50);
    expect(data.points[0].fields.name).toBeTruthy();

    const n = await request.get(
      "/api/places/nearest?category=community&lat=43.6532&lng=-79.3832&n=1",
      { timeout: 30_000 }
    );
    expect((await n.json()).results.length).toBe(1);
  });

  test("GET /api/discover/events returns Eventbrite dementia events", async ({ request }) => {
    const r = await request.get("/api/discover/events?limit=5", { timeout: 30_000 });
    expect(r.status()).toBe(200);
    const data = await r.json();
    expect(Array.isArray(data.events)).toBe(true);
    expect(data.events.length).toBeGreaterThan(0);
    expect(data.events[0]).toHaveProperty("title");
    expect(data.events[0]).toHaveProperty("url");
    expect(data.events[0].url).toContain("eventbrite");
  });
});

test.describe("Stored data views (verify what's saved)", () => {
  test("Patient Memories overlay groups memories by family member", async ({
    page,
    request,
  }) => {
    // Seed a person with a fact so the overlay has a person section.
    const name = `Overlay${Date.now()}`;
    const c = await request.post("/api/people", { data: { name, relationship: "brother" } });
    const id = (await c.json()).person_id;
    await request.post(`/api/people/${id}/memories`, { data: { text: "was a sailor for 30 years" } });

    await page.goto("/patient");
    await page.getByRole("button", { name: "Memories" }).click();
    await expect(page.getByRole("heading", { name: "Your Memories" })).toBeVisible();
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    await expect(page.getByText("was a sailor for 30 years")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/08-patient-memories.png`, fullPage: true });
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: "Your Memories" })).not.toBeVisible();

    await request.delete(`/api/people/${id}`);
  });

  test("Caregiver Calendar: add a medication event and see it scheduled", async ({
    page,
    request,
  }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByRole("heading", { name: /Calendar/ })).toBeVisible();

    const title = `Heart Pill ${Date.now()}`;
    // medication is the default type
    await page.getByPlaceholder(/Medicine name/).fill(title);
    await page.getByPlaceholder(/Take 1 tablet|Note/).first().fill("Take 1 tablet with water");
    await page.getByRole("button", { name: "Add to Calendar" }).click();

    await expect(page.getByText(/Reminds every day at/)).toBeVisible();
    // The event now appears both in the month calendar and the scheduled list.
    await expect(page.getByText(title).first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/09-caregiver-calendar.png`, fullPage: true });

    // cleanup
    const list = await (await request.get("/api/events")).json();
    const ev = (list.events as { id: string; title: string }[]).find((e) => e.title === title);
    if (ev) await request.delete(`/api/events/${ev.id}`);
  });

  test("Caregiver Calendar: add a WEEKLY event and delete it via the list", async ({
    page,
  }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Calendar" }).click();

    await page.getByRole("button", { name: "📅 Appointment" }).click();
    await page.locator("select").selectOption("weekly");
    const title = `Weekly Visit ${Date.now()}`;
    await page.getByPlaceholder(/Title/).fill(title);
    await page.locator('input[type="date"]').fill("2026-06-01");
    await page.getByRole("button", { name: "Add to Calendar" }).click();

    await expect(page.getByText(/Reminds every week/)).toBeVisible();
    await expect(page.getByText(title).first()).toBeVisible();

    // Delete via the ✕ in the Scheduled list — must actually remove it.
    await page.locator("li", { hasText: title }).getByRole("button", { name: "✕" }).first().click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("Caregiver Discover: browse Eventbrite dementia events and add one to the calendar", async ({
    page,
    request,
  }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(
      page.getByRole("heading", { name: /Discover dementia events/ })
    ).toBeVisible();

    const addBtn = page.getByRole("button", { name: "➕ Add" }).first();
    await expect(addBtn).toBeVisible({ timeout: 30_000 });
    await addBtn.click();

    await expect(page.getByText(/Added .* to the calendar/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/11-caregiver-discover.png`, fullPage: true });

    // The added activity event is now scheduled.
    const list = await (await request.get("/api/events")).json();
    const activities = (list.events as { id: string; type: string }[]).filter(
      (e) => e.type === "activity"
    );
    expect(activities.length).toBeGreaterThan(0);
    for (const a of activities) await request.delete(`/api/events/${a.id}`); // cleanup
  });

  test("Patient About Me shows the patient's identity (name + story)", async ({
    page,
    request,
  }) => {
    const orig = await (await request.get("/api/profile")).json();
    try {
      await request.post("/api/profile", {
        data: { name: "Helen", tagline: "You love gardening and Earl Grey tea." },
      });
      await page.goto("/patient");
      await page.getByRole("button", { name: "About Me" }).click();

      await expect(page.getByRole("heading", { name: "About You", exact: true })).toBeVisible();
      await expect(page.getByText("This is you")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Helen" })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/12-patient-about.png`, fullPage: true });

      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("heading", { name: "About You", exact: true })).not.toBeVisible();
    } finally {
      await request.post("/api/profile", {
        data: { name: orig.name, tagline: orig.tagline, photo: orig.photo },
      });
    }
  });

  test("Patient reminder card shows from a notification payload + can be dismissed", async ({
    page,
  }) => {
    const payload = encodeURIComponent(
      JSON.stringify({ title: "💊 Time for your Heart Pill", body: "Take 1 tablet with water", type: "medication" })
    );
    await page.goto(`/patient?reminder=${payload}`);

    await expect(page.getByRole("heading", { name: "💊 Time for your Heart Pill" })).toBeVisible();
    await expect(page.getByText("Take 1 tablet with water")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/10-patient-reminder.png`, fullPage: true });

    await page.getByRole("button", { name: "✓ I took it" }).click();
    await expect(
      page.getByRole("heading", { name: "💊 Time for your Heart Pill" })
    ).not.toBeVisible();
  });

  test("Patient Daily Briefing overlay shows a warm morning briefing", async ({ page }) => {
    await page.goto("/patient");
    await page.getByRole("button", { name: /Good Morning/i }).click();
    await expect(page.getByRole("heading", { name: /Daily Briefing/i })).toBeVisible();
    // The briefing body always states today's date ("Today is …") — unique to the
    // overlay (avoids colliding with the "🌅 Good Morning" button text).
    await expect(page.getByText(/Today is/i)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/14-patient-briefing.png`, fullPage: true });
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("heading", { name: /Daily Briefing/i })).not.toBeVisible();
  });

  test("Patient Mood check-in logs a feeling the caregiver can see", async ({ page, request }) => {
    // Patient taps how they feel.
    await page.goto("/patient");
    await page.getByRole("button", { name: /How I Feel/i }).click();
    await expect(page.getByRole("heading", { name: /How are you feeling/i })).toBeVisible();
    await page.getByRole("button", { name: /Great/i }).click();
    await expect(page.getByRole("heading", { name: /Thank you for sharing/i })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/15-patient-mood.png`, fullPage: true });
    await page.getByRole("button", { name: /Done/i }).click();

    // Caregiver sees it under Wellbeing.
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Wellbeing" }).click();
    await expect(page.getByRole("heading", { name: "Mood Check-ins" })).toBeVisible();
    await expect(page.getByText("great", { exact: false }).first()).toBeVisible();

    // Cleanup: this is a real backend; remove the entries this test created.
    const moods = (await (await request.get("/api/mood")).json()).moods || [];
    for (const m of moods) await request.delete(`/api/mood/${m.id}`);
  });

  test("Photo Memory Journal: caregiver adds a photo memory, patient sees it", async ({ page, request }) => {
    const caption = `Lake trip ${Date.now()}`;
    // Caregiver adds a photo memory (caption + image) in Patient Notes.
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Patient Notes" }).click();
    await page.getByPlaceholder(/A caption/).fill(caption);
    await page.locator('input[type="file"]').last().setInputFiles(FACE_A);
    await page.waitForTimeout(500); // let the FileReader produce the base64
    const posted = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/memories/photo" && r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await page.getByRole("button", { name: "Add Photo Memory" }).click();
    expect((await posted).status()).toBe(200);

    // Patient browses the Photo Journal and sees the captioned photo.
    await page.goto("/patient");
    await page.getByRole("button", { name: /Photo Journal/i }).click();
    await expect(page.getByRole("heading", { name: "Photo Journal" })).toBeVisible();
    await expect(page.getByText(caption)).toBeVisible();
    await expect(page.locator(`img[alt="${caption}"]`)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/16-patient-photo-journal.png`, fullPage: true });

    // Cleanup (real backend).
    const photos = (await (await request.get("/api/photo-journal")).json()).photos || [];
    for (const p of photos) await request.delete(`/api/memories/${p.id}`);
  });
});

test.describe("Map — nearby places", () => {
  test.use({
    permissions: ["geolocation"],
    geolocation: { latitude: 43.6532, longitude: -79.3832 }, // downtown Toronto
  });

  test("shows community-centre layer and finds nearest to me", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByText("Community & Rec Centres")).toBeVisible();
    const btn = page.getByRole("button", { name: /Nearest to me/ });
    await expect(btn).toBeVisible();

    await page.waitForTimeout(3000); // let Leaflet initialize
    await btn.click();
    await expect(page.getByText("Nearest to you")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: `${SHOTS}/13-map-nearest.png`, fullPage: true });
  });
});

// ---------------------------------------------------------------------------
// Spec P0 features that are specified but NOT yet wired into the UI.
// Marked fixme so they surface in the report as "not implemented" without
// failing the suite. These are the real coverage gaps vs. the docs.
// ---------------------------------------------------------------------------
// The former "Spec gaps" P0 features — Daily Briefing, Mood check-in, and Photo
// Memory Journal — are all implemented now, each with a real test in the
// "Stored data views" group above (no remaining test.fixme placeholders).
