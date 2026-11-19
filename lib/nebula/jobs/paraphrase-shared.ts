import type OpenAI from "openai";

/**
 * Shared paraphrase helper. Used by the metadata handler (inline after a fresh
 * provider fetch) and the paraphrase handler (backfill for books that already
 * have a `description` but no `short_description`).
 *
 * Cost: ~$0.00021 per call at gpt-4o-mini rates.
 *   - ~1,000 input tokens (description + system + title/author prefix)
 *   - ~100 output tokens
 * Input description is capped at 2,000 chars (~500 tokens) to keep cost predictable.
 */

const PARAPHRASE_SYSTEM = `You paraphrase book synopses into plain neutral 2-3 sentence summaries. Rules:
- Use your own words; never quote any phrase longer than 4 words from the input.
- Do not invent plot points that aren't in the input.
- No spoilers beyond what the input already reveals.
- No praise, no star ratings, no marketing language.
- Return only the summary, no preamble.`;

const MAX_INPUT_CHARS = 2000;

export async function paraphraseDescription(
  openai: OpenAI,
  description: string,
  title: string,
  author: string,
): Promise<string | null> {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 160,
      messages: [
        { role: "system", content: PARAPHRASE_SYSTEM },
        {
          role: "user",
          content: `Book: ${title} by ${author}\n\nSynopsis:\n${description.slice(0, MAX_INPUT_CHARS)}`,
        },
      ],
    });
    const text = res.choices[0]?.message?.content?.trim();
    return text && text.length > 20 ? text : null;
  } catch {
    return null;
  }
}
