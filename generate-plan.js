// api/generate-plan.js
// Server-side proxy — API key never exposed to the browser.
// Vercel runs this as a serverless function.

const RATE_LIMIT_MAP = new Map();
const RATE_WINDOW_MS = 60 * 1000;  // 1 minute window
const MAX_REQUESTS   = 3;           // max 3 submissions per IP per minute

function getRateLimitKey(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim()
      || req.socket?.remoteAddress
      || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = RATE_LIMIT_MAP.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW_MS) {
    RATE_LIMIT_MAP.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= MAX_REQUESTS) return true;
  entry.count++;
  RATE_LIMIT_MAP.set(ip, entry);
  return false;
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // CORS — only allow requests from your own domain
  const origin = req.headers.origin || '';
  if (origin && !origin.includes('habthera.com')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Rate limiting
  const ip = getRateLimitKey(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
  }

  // Validate request body
  const { userName, answers } = req.body || {};
  if (!userName || !answers) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Build the user message from quiz answers
  const userMessage = buildUserMessage(userName, answers);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',   // Haiku: fast + cheapest (~$0.001/quiz)
        max_tokens: 1200,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic error:', response.status, err);
      return res.status(502).json({
        error: err?.error?.message || 'AI service error. Please try again.'
      });
    }

    const data = await response.json();
    const planText = data.content?.[0]?.text || '';
    return res.status(200).json({ plan: planText });

  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Dr. Mark Nessim's AI nutrition assistant for Habthera Nutrition. You create personalized GLP-1 nutrition plans based on patient quiz responses.

Habthera's product is ASP-1 Adaptive Support Powder — a clinician-formulated supplement for GLP-1 medication users containing: whey isolate protein (20g), creatine monohydrate, Magtein® magnesium L-threonate, collagen peptides (5g), pre/probiotics, and allulose as the primary sweetener.

ASP-1 is built around four pillars:
• MUSCLE — preserves lean mass during GLP-1-induced weight loss
• BRAIN — Magtein® supports cognitive clarity and energy
• GUT — pre/probiotics ease GLP-1 digestive side effects
• SKIN — collagen peptides support skin elasticity during rapid weight loss

Your response must be formatted in clean HTML using only these tags: <h3>, <p>, <ul>, <li>, <strong>, <em>. Do not use markdown.

Structure your plan as:
1. A brief personalized opening (2 sentences, address the user by first name)
2. Their top priority pillar and why (based on their answers)
3. 3–4 specific, actionable daily recommendations
4. How ASP-1 addresses their specific needs
5. A warm closing encouragement

Keep the total response under 350 words. Be warm, clinical, and specific — not generic.`;

// ─── Build user message from answers ─────────────────────────────────────────
function buildUserMessage(userName, answers) {
  return `Patient first name: ${userName}

Quiz responses:
Journey duration: ${answers.journeyDuration || 'Not specified'}
Weight lost: ${answers.weightLost || 'Not specified'}
Primary goal: ${answers.primaryGoal || 'Not specified'}
Muscle symptoms: ${answers.muscleSymptoms || 'Not specified'}
Daily protein intake: ${answers.proteinIntake || 'Not specified'}
Brain fog frequency: ${answers.brainFog || 'Not specified'}
Sleep quality: ${answers.sleepQuality || 'Not specified'}
Digestive symptoms: ${Array.isArray(answers.digestiveSymptoms) ? answers.digestiveSymptoms.join(', ') : answers.digestiveSymptoms || 'None'}
Gut comfort rating: ${answers.gutComfort || 'Not specified'}
Skin changes: ${answers.skinChanges || 'Not specified'}
Taking collagen supplement: ${answers.takingCollagen || 'Not specified'}

Please generate a personalized GLP-1 nutrition plan for this patient.`;
}
