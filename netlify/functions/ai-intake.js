/**
 * AI Intake — POST /api/ai-intake
 * Accepts a plain-English request from a guest and returns:
 *   - parsed fields (venue, date, party_size, notes)
 *   - a personalized confirmation message to show the user
 *   - the detected intent (booking / inquiry / membership)
 *
 * Requires ANTHROPIC_API_KEY in Netlify env.
 */

const SYSTEM = `You are the AI concierge for Dream Hospitality Group, New York City's premier hospitality group.

Venues:
  Nightlife: Harbor NYC, Nebula, PHD Rooftop, Petite (invite-only)
  Dining: Sei Less, Pappas NY, Tucci New York, Gyro City (Greenwich Village & Astoria)
  Cannabis brand: Dank by Definition

Your job: read a guest's message and return ONLY valid JSON with this shape:
{
  "intent": "booking" | "inquiry" | "membership" | "other",
  "venue": "<venue name or null>",
  "date": "<ISO date YYYY-MM-DD or null>",
  "party_size": "<number as string or null>",
  "notes": "<cleaned request summary, max 200 chars>",
  "reply": "<warm, concise confirmation to show the guest, 1-2 sentences, no em dashes>"
}

Rules:
- venue must exactly match one of the listed names, or null
- reply should feel premium and personal, not robotic
- Never invent dates; if ambiguous return null
- Output ONLY the JSON object, no markdown fences`;

function json(statusCode, data) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json(503, { error: 'AI service not configured' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const message = (body.message || '').trim().slice(0, 800);
  if (!message) return json(400, { error: 'message is required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[ai-intake] Anthropic error:', errText);
      return json(502, { error: 'AI service error' });
    }

    const data = await response.json();
    const rawText = data?.content?.[0]?.text || '{}';

    let parsed;
    try { parsed = JSON.parse(rawText); }
    catch {
      console.error('[ai-intake] Failed to parse AI response:', rawText);
      return json(500, { error: 'AI returned unexpected format' });
    }

    return json(200, {
      intent:     parsed.intent     || 'inquiry',
      venue:      parsed.venue      || null,
      date:       parsed.date       || null,
      party_size: parsed.party_size || null,
      notes:      parsed.notes      || null,
      reply:      parsed.reply      || 'Thanks for reaching out. Our team will be in touch shortly.',
    });

  } catch (e) {
    console.error('[ai-intake] Error:', e);
    return json(500, { error: 'Internal error' });
  }
};
