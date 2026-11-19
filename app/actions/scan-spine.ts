"use server";

import Anthropic from "@anthropic-ai/sdk";

// --- Types ---

export interface SpineResult {
  title: string;
  author: string;
  confidence: "high" | "medium" | "low";
}

// --- Spine reading via Claude Vision ---

const SPINE_PROMPT = `You are analysing images of book spines on a bookshelf. Your task is to read every visible book spine and identify the title and author of each book.

Rules:
- Read every spine visible in the image(s)
- If multiple images are provided, they show different sections of the same shelf — deduplicate any books that appear in more than one image
- For each book, provide: title, author, and your confidence level (high, medium, low)
- "high" = clearly legible title and author
- "medium" = title is clear but author is guessed or partially visible
- "low" = title is partially legible, best guess
- If you can only see a partial title, still include it with "low" confidence
- Return ONLY valid JSON — no markdown, no explanation

Return a JSON array:
[{"title": "Book Title", "author": "Author Name", "confidence": "high"}, ...]`;

export async function scanSpine(formData: FormData): Promise<{
  results: SpineResult[];
  error?: string;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { results: [], error: "ANTHROPIC_API_KEY not configured" };
  }

  // Extract images from FormData
  const images: { base64: string; mediaType: string }[] = [];
  const entries = formData.getAll("images");

  for (const entry of entries) {
    if (typeof entry === "string") continue;
    const file = entry as File;
    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mediaType = file.type || "image/jpeg";
    images.push({ base64, mediaType });
  }

  if (images.length === 0) {
    return { results: [], error: "No images provided" };
  }

  // Build Claude Vision message with all images
  const content: Anthropic.Messages.ContentBlockParam[] = [];

  for (const img of images) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: img.base64,
      },
    });
  }

  content.push({
    type: "text",
    text: images.length > 1
      ? `These ${images.length} images show different sections of the same bookshelf. Read every unique book spine across all images. Deduplicate — each book should appear only once.`
      : "Read every book spine visible in this image.",
  });

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SPINE_PROMPT,
      messages: [{ role: "user", content }],
    });

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { results: [], error: "No text in response" };
    }

    // Parse JSON — handle potential markdown wrapping
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as SpineResult[];

    // Validate structure
    const results = parsed
      .filter((r) => r.title && typeof r.title === "string")
      .map((r) => ({
        title: r.title.trim(),
        author: (r.author ?? "Unknown").trim(),
        confidence: (["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium") as SpineResult["confidence"],
      }));

    return { results };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { results: [], error: `Vision analysis failed: ${message}` };
  }
}
