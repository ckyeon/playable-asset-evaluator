import { describe, expect, it } from "vitest";
import { GET as getProfileDetail } from "@/app/api/style-profiles/[id]/route";
import { GET as getProfileHistory } from "@/app/api/style-profiles/[id]/history/route";
import { POST as postGenerationContextCandidate } from "@/app/api/generation-contexts/[id]/candidates/route";
import { getDb } from "@/lib/db/client";
import { createImageFile, useTempDataDir } from "../helpers";

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("generation context API routes", () => {
  it("returns profile detail without legacy sessions", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };

    const response = await getProfileDetail(new Request(`http://test.local/api/style-profiles/${profile.id}`), params(profile.id));
    const data = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(data.generationContexts).toEqual(expect.arrayContaining([expect.objectContaining({ style_profile_id: profile.id })]));
    expect(data).not.toHaveProperty("sessions");
  });

  it("uploads candidates through generation context routes and returns history without legacy session objects", async () => {
    useTempDataDir();
    const db = getDb();
    const profile = db.prepare("SELECT id FROM style_profiles LIMIT 1").get() as { id: string };
    const generationContext = db.prepare("SELECT id FROM generation_contexts LIMIT 1").get() as { id: string };
    const formData = new FormData();
    formData.set("file", await createImageFile("candidate.png"));
    formData.set("promptText", "Generate a polished character reaction pose.");

    const uploadResponse = await postGenerationContextCandidate(
      new Request(`http://test.local/api/generation-contexts/${generationContext.id}/candidates`, {
        method: "POST",
        body: formData
      }),
      params(generationContext.id)
    );
    const uploadData = (await uploadResponse.json()) as {
      candidate: { generation_context_id: string; imageUrl: string | null; originalUrl: string | null };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadData.candidate.generation_context_id).toBe(generationContext.id);
    expect(uploadData.candidate.imageUrl).toMatch(/^\/api\/assets\//);
    expect(uploadData.candidate.originalUrl).toMatch(/^\/api\/assets\//);

    const historyResponse = await getProfileHistory(
      new Request(`http://test.local/api/style-profiles/${profile.id}/history`),
      params(profile.id)
    );
    const historyData = (await historyResponse.json()) as {
      history: Array<Record<string, unknown> & { generationContext: { id: string } }>;
    };

    expect(historyResponse.status).toBe(200);
    expect(historyData.history).toHaveLength(1);
    expect(historyData.history[0].generationContext.id).toBe(generationContext.id);
    expect(historyData.history[0]).not.toHaveProperty("session");
  });
});
