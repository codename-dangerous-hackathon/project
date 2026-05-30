import { test, expect } from "@playwright/test";
import fs from "fs";

const FACE_A = "e2e/fixtures/faceA.jpg";
const FACE_B = "e2e/fixtures/faceB.jpg";
const b64 = (p: string) => fs.readFileSync(p).toString("base64");

// End-to-end tests for Anchor, exercising the real production build + FastAPI
// backend. Feature intent comes from docs/architecture_features.md and
// docs/claude-output.md (P0: "Who is this?", Daily Briefing, Memory Journal).

const SHOTS = "e2e/screenshots";

test.describe("Landing page", () => {
  test("renders title and navigates to both surfaces", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Anchor" })).toBeVisible();
    await expect(
      page.getByText("100% On-Device AI Companion")
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/01-home.png`, fullPage: true });

    // Patient link
    await page.getByRole("link", { name: "Open Companion (Patient)" }).click();
    await expect(page).toHaveURL(/\/patient$/);

    // Caregiver link
    await page.goto("/");
    await page.getByRole("link", { name: "Caregiver Dashboard" }).click();
    await expect(page).toHaveURL(/\/caregiver$/);
  });
});

test.describe("Patient — Infinite Patience loop (Feature 1)", () => {
  test("TALK button asks the Companion and renders a warm reply", async ({
    page,
  }) => {
    await page.goto("/patient");
    const h1 = page.locator("h1");
    await expect(h1).toHaveText("I am here to help you.");

    const askResp = page.waitForResponse(
      (r) => r.url().includes("/api/ask") && r.request().method() === "POST"
    );

    await page.getByRole("button", { name: "TALK" }).click();
    // Immediate feedback proves the client hydrated (the original prod bug).
    await expect(h1).toHaveText("Listening...");
    await expect(page.getByRole("button", { name: "LISTENING" })).toBeVisible();

    const resp = await askResp;
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(typeof body.reply).toBe("string");
    expect(body.reply.length).toBeGreaterThan(0);

    // The companion reply is rendered as the subtitle.
    await expect(h1).toHaveText(body.reply);
    await page.screenshot({ path: `${SHOTS}/02-patient-reply.png`, fullPage: true });
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

    await expect(page.locator("h1")).toHaveText(
      "I don't recognize this person yet.",
      { timeout: 15_000 }
    );
    await page.screenshot({ path: `${SHOTS}/04-patient-identified.png`, fullPage: true });
  });
});

test.describe("Caregiver — portal", () => {
  test("tabs switch between Dashboard, Faces and Life Story", async ({ page }) => {
    await page.goto("/caregiver");

    // Default: dashboard
    await expect(
      page.getByRole("heading", { name: "Today's Summary" })
    ).toBeVisible();
    await expect(page.getByText("AI Generated Rollup")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/05-caregiver-dashboard.png`, fullPage: true });

    // Faces tab
    await page.getByRole("button", { name: "Identity & Faces" }).click();
    await expect(
      page.getByRole("heading", { name: "Enroll a New Family Member" })
    ).toBeVisible();

    // Life Story tab
    await page.getByRole("button", { name: "Life Story Vault" }).click();
    await expect(
      page.getByRole("heading", { name: "Add a Memory or Fact" })
    ).toBeVisible();
  });

  test("enrolling a life-story memory persists to the vector DB (Feature 4 enroll)", async ({
    page,
  }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Life Story Vault" }).click();

    const memory =
      "Helen grew up in Scarborough and loves gardening and Earl Grey tea.";
    await page.locator("textarea").fill(memory);

    const enrollResp = page.waitForResponse(
      (r) =>
        r.url().includes("/api/enroll_memory") &&
        r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "Save to Local VectorDB" }).click();

    const resp = await enrollResp;
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("success");
    expect(body.memory_id).toBeTruthy();

    await expect(
      page.getByText("Memory successfully saved to the local offline Vault!")
    ).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/06-caregiver-enrolled.png`, fullPage: true });
  });

  test("enrolling a face via photo upload extracts and stores an embedding (Feature 2 enroll)", async ({
    page,
  }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Identity & Faces" }).click();

    await page.locator('input[placeholder="e.g. Sarah"]').fill("Grace");
    await page.locator('input[placeholder="e.g. Daughter"]').fill("Wife");
    await page.locator('input[type="file"]').setInputFiles(FACE_A);

    const enrollResp = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/enroll" &&
        r.request().method() === "POST",
      { timeout: 30_000 }
    );
    await page.getByRole("button", { name: "Extract Face Embedding" }).click();

    const resp = await enrollResp;
    expect(resp.status()).toBe(200);
    expect((await resp.json()).status).toBe("success");

    await expect(page.getByText(/enrolled\. Photo discarded/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/07-caregiver-face-enrolled.png`, fullPage: true });
  });

  test("face enroll gives visible feedback when fields are missing (no silent dead button)", async ({
    page,
  }) => {
    await page.goto("/caregiver");
    await page.getByRole("button", { name: "Identity & Faces" }).click();

    // Photo only, no name/relationship — must NOT silently do nothing.
    await page.locator('input[type="file"]').setInputFiles(FACE_A);
    await page.getByRole("button", { name: "Extract Face Embedding" }).click();
    await expect(
      page.getByText("Please enter both a name and a relationship.")
    ).toBeVisible();
  });
});

test.describe("Backend API contract (via /api proxy)", () => {
  test("POST /api/ask returns a companion reply", async ({ request }) => {
    const r = await request.post("/api/ask", {
      data: { user_input: "When is my daughter coming to visit?" },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).reply).toBeTruthy();
  });

  test("real face enroll + identify round-trip (recognizes A, rejects B)", async ({
    request,
  }) => {
    // Enroll person A...
    const e = await request.post("/api/enroll", {
      data: { name: "Grace", relationship: "wife", image_base64: b64(FACE_A) },
      timeout: 30_000,
    });
    expect(e.status()).toBe(200);
    expect((await e.json()).status).toBe("success");

    // ...the same face is recognized as Grace...
    const m = await request.post("/api/identify", {
      data: { image_base64: b64(FACE_A) },
      timeout: 30_000,
    });
    const mb = await m.json();
    expect(mb.match).toBe(true);
    expect(mb.name).toBe("Grace");
    expect(mb.relationship).toBe("wife");

    // ...and a different person is NOT matched (proves it's real, not a mock).
    const n = await request.post("/api/identify", {
      data: { image_base64: b64(FACE_B) },
      timeout: 30_000,
    });
    expect((await n.json()).match).toBe(false);
  });

  test("POST /api/enroll_memory writes to the vault", async ({ request }) => {
    const r = await request.post("/api/enroll_memory", {
      data: { text: "API smoke-test memory", tags: "life-story" },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).status).toBe("success");
  });

  test("POST /api/synthesize returns WAV audio", async ({ request }) => {
    const r = await request.post("/api/synthesize", {
      data: { user_input: "Good morning Helen" },
    });
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("audio/wav");
  });

  test("GET /api/briefing returns a daily briefing", async ({ request }) => {
    const r = await request.get("/api/briefing");
    expect(r.status()).toBe(200);
    expect((await r.json()).briefing).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Spec P0 features that are specified but NOT yet wired into the UI.
// Marked fixme so they surface in the report as "not implemented" without
// failing the suite. These are the real coverage gaps vs. the docs.
// ---------------------------------------------------------------------------
test.describe("Spec gaps (P0 features missing in UI)", () => {
  test.fixme(
    "Daily Briefing has a Patient-facing UI (backend /briefing exists, no UI calls it)",
    async () => {}
  );
  test.fixme(
    'Photo Memory Journal exists (Patient "Memories" button is a no-op; no journal view)',
    async () => {}
  );
  test.fixme(
    "Mood check-in is interactive (dashboard shows static mood only)",
    async () => {}
  );
});
