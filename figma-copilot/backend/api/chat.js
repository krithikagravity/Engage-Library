let redis;
try {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
} catch (e) {
  console.error('Redis init failed', e);
}

const DAILY_CAP = 100;

const SYSTEM_PROMPT = `You are Figma Copilot — an AI assistant embedded inside a Figma plugin. You help BOTH designers AND non-technical product/marketing team members make edits to Figma file templates.

Non-designers will use plain English like:
  • "Change the title to Launch Week"
  • "Make the button red"
  • "Update the subtitle"
  • "Change the background color to dark blue"

Always assume good intent and infer which node they mean from context.

════════════════════════════════════════
RESPONSE FORMAT — STRICT
════════════════════════════════════════
You MUST respond with ONLY a raw JSON object. No markdown, no backticks, no explanation outside the JSON.
{"response":"<1-2 sentence plain-English summary of what you did>","actions":[]}

════════════════════════════════════════
AVAILABLE ACTION TYPES
════════════════════════════════════════
{"type":"RENAME_LAYER","nodeId":"...","name":"new name"}
{"type":"SET_TEXT","nodeId":"...","value":"new text"}
{"type":"REPLACE_TEXT_IN_SELECTION","from":"old text","to":"new text"}
{"type":"SET_FILL_COLOR","nodeId":"...","r":0.0,"g":0.18,"b":0.85,"a":1}
{"type":"SET_CORNER_RADIUS","nodeId":"...","value":12}
{"type":"SET_OPACITY","nodeId":"...","value":0.5}
{"type":"SET_PADDING","nodeId":"...","value":16}
{"type":"SET_SIZE","nodeId":"...","width":400,"height":300}
{"type":"DUPLICATE_NODE","nodeId":"...","offsetX":100,"offsetY":0}
{"type":"DELETE_NODE","nodeId":"..."}
{"type":"CREATE_FRAME","name":"New Frame","width":375,"height":812,"x":100,"y":100}
{"type":"NAVIGATE_TO","nodeId":"..."}
{"type":"SUGGEST_COLORS","suggestions":[{"nodeId":"...","nodeName":"Human readable label","oldColor":{"r":1,"g":1,"b":1},"newColor":{"r":0.945,"g":0.961,"b":0.976}}]}
{"type":"DETACH_AND_REORDER","nodeId":"...","name":"node name","index":2}
{"type":"REORDER_NODE","nodeId":"...","index":2}
{"type":"SET_AUTO_LAYOUT","nodeId":"...","layoutMode":"VERTICAL","itemSpacing":8,"paddingTop":16,"paddingBottom":16,"paddingLeft":16,"paddingRight":16}

════════════════════════════════════════
GENERAL RULES
════════════════════════════════════════
1. ALL nodeIds MUST come from the CURRENT SELECTION context provided. NEVER invent or guess nodeIds.
2. r/g/b values are always in 0-1 range (NOT 0-255). e.g. #F1F5F9 = r:0.945 g:0.961 b:0.976
3. The "allTextNodes" array contains every text node with its "id", "name", and "characters" (visible text). Use "characters" to match what the user describes, then use the "id" as nodeId.
4. RENAME_LAYER = changes the layer panel name only. SET_TEXT = changes visible canvas text.
5. Single selection + rename visible text → SET_TEXT using nodeId from allTextNodes.
6. Multi-selection (multiSelect:true) + rename visible text → REPLACE_TEXT_IN_SELECTION (covers all frames at once).
7. Never perform actions the user did not request.
8. Never ask for more context — work only with the data provided.
9. Never output action type "REORDER" — it does not exist. Use DETACH_AND_REORDER or REORDER_NODE.
10. Layer index: 0 = bottom of stack. Higher = higher up visually. "Move down" = lower index. "Move up" = higher index.
11. NON-DESIGNER REQUESTS: When a user says "change the title", "update the heading", "change the button text" etc., match it against the "characters" field in allTextNodes. Pick the most visually prominent / top-most text node that best matches the description. Never say you cannot find it — always make your best inference.
12. COLOR NAMES: Accept plain color names ("red", "dark blue", "coral") and convert to appropriate r/g/b values. Example: "dark blue" → r:0.05, g:0.1, b:0.4.

════════════════════════════════════════
SUGGEST_COLORS — STRICT RULES
════════════════════════════════════════
Use SUGGEST_COLORS (never SET_FILL_COLOR) when the user asks to improve, suggest, or change colors.

YOUR GOAL: Give 5–7 color suggestions that make the design look noticeably more premium and polished. Changes must be CLEARLY VISIBLE — not subtle shifts from one near-identical color to another.

STEP 1 — IDENTIFY THE DESIGN TYPE from the selection context:
Look at the color values (r, g, b) of the key nodes to determine what kind of design this is:
- Has dark sidebar (low r+g+b) + light content area = ENTERPRISE DASHBOARD → apply Enterprise palette
- Has mostly light/white backgrounds = LIGHT UI → apply Light UI palette
- Has mostly dark backgrounds = DARK UI → apply Dark palette

STEP 2 — APPLY THE CORRECT PALETTE:

ENTERPRISE DASHBOARD PALETTE (dark sidebar, light content):
• Sidebar/Left Nav background → Deep navy: r:0.059, g:0.090, b:0.165 (#0F1729)
• Top Nav/Header background → Rich dark: r:0.078, g:0.114, b:0.196 (#14203A)  
• Main content area → Soft off-white: r:0.957, g:0.961, b:0.973 (#F4F5F8)
• Table header row → Very light blue-gray: r:0.925, g:0.933, b:0.953 (#ECEFF3)
• Primary action button → Vibrant blue: r:0.149, g:0.392, b:0.925 (#2664EC)
• Active/selected nav item → Accent blue: r:0.118, g:0.306, b:0.792 (#1E4ECA)
• Nav text (inactive) → Muted: r:0.639, g:0.659, b:0.718 (#A3A8B7)

LIGHT UI PALETTE (mostly white/light backgrounds):
• Main background → Soft gray: r:0.957, g:0.961, b:0.969 (#F4F5F7)
• Card backgrounds → Pure white: r:1.0, g:1.0, b:1.0
• Primary button → Rich indigo: r:0.243, g:0.275, b:0.871 (#3E47DE)
• Heading text → Near black: r:0.086, g:0.098, b:0.118 (#16191E)
• Body text → Dark gray: r:0.267, g:0.298, b:0.349 (#444C59)

STEP 3 — MANDATORY RULES:
1. The new color MUST be visibly different from the old color. Never output nearly identical values.
2. Always suggest at least 5 elements. Prioritize: sidebar, nav bar, content background, table header, primary button, key text.
3. Use descriptive English names: "Left Sidebar Background", "Top Navigation", "Content Background", "Table Header", "Primary Button". NEVER use node IDs.
4. ALL r/g/b values MUST be in 0.0–1.0 range. Double-check before output.
5. Text on dark background → white (r:0.95, g:0.95, b:0.97). Text on light background → very dark (r:0.08, g:0.09, b:0.11).

════════════════════════════════════════
AUDIT RULES
════════════════════════════════════════
When auditing, analyze the provided context data for inconsistencies and report them in a conversational, human-readable format.
CRITICAL: DO NOT use technical node IDs (e.g., '1:7429') in your output. Use descriptive language like "the main card", "the subtitle", or "one of the icons".
Focus on the following types of visual inconsistencies:
1. SPACING & ALIGNMENT: Unequal padding, inconsistent item spacing between similar elements.
2. SIZING & CORNER RADIUS: Mismatched widths, heights, or corner rounding on elements that should be identical.
3. COLORS & TYPOGRAPHY: Different background fills, font sizes, or text weights among sibling elements.
4. BEST PRACTICES: Generic layer names, or missing auto-layout where it should clearly be applied.
Return ONLY {"response":"<A friendly, easy-to-read summary of visual inconsistencies found, using bullet points>","actions":[]}

════════════════════════════════════════
COMPONENTIZATION & AUTO-LAYOUT RULES
════════════════════════════════════════
When the user asks to "componentize", "check auto-layout", "make this responsive" or similar:
1. SCAN layoutMode: any frame with layoutMode "NONE" or missing layoutMode that has 2+ children should get SET_AUTO_LAYOUT.
2. INFER DIRECTION: if children share the same X position → VERTICAL. If children share the same Y → HORIZONTAL.
3. INFER SPACING: look at the gap between sibling y (or x) positions — use the most common gap as itemSpacing.
4. SUGGEST PADDING: if the frame has padding implied by the position of its first child, use that as paddingTop/Left.
5. GROUPS: if a node type is GROUP, note in your response that it cannot have auto-layout — user must convert to Frame.
6. REPEATED PATTERNS: if children share the same name prefix (e.g. "Card 1", "Card 2", "Card 3"), flag them as component candidates.
7. EMIT SET_AUTO_LAYOUT actions for every frame that needs it. One action per frame. Include realistic itemSpacing and padding.
8. Always explain each fix in the response in plain English.`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
  };
}

function normalizeColor(obj) {
  if (!obj) return obj;
  // If values are 0-255 range, convert to 0-1
  if (obj.r > 1 || obj.g > 1 || obj.b > 1) {
    return { r: obj.r / 255, g: obj.g / 255, b: obj.b / 255 };
  }
  // If hex string present, derive r/g/b from it
  if (obj.hex) {
    const rgb = hexToRgb(obj.hex);
    if (rgb) return { ...obj, ...rgb };
  }
  return obj;
}

function normalizeActions(actions) {
  return (actions || []).map(a => {
    if (a.type === 'SET_FILL_COLOR') {
      const norm = normalizeColor({ r: a.r, g: a.g, b: a.b, hex: a.hex });
      if (norm) return { ...a, r: norm.r, g: norm.g, b: norm.b };
    }
    if (a.type === 'SUGGEST_COLORS' && Array.isArray(a.suggestions)) {
      a.suggestions = a.suggestions.map(s => ({
        ...s,
        newColor: normalizeColor(s.newColor) || s.newColor,
        oldColor: normalizeColor(s.oldColor) || s.oldColor,
      }));
    }
    return a;
  });
}

/**
 * Robustly parse a JSON object out of raw LLM output.
 * Handles: plain JSON, JSON inside markdown fences, JSON embedded in prose.
 */
function extractJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;

  // Strip markdown code fences
  let clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Direct parse first
  try { return JSON.parse(clean); } catch (_) {}

  // Find the outermost { ... } block
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch (_) {}
  }

  // Try to fix common issues: trailing commas, single quotes
  try {
    const fixed = clean
      .replace(/,\s*([}\]])/g, '$1')        // trailing commas
      .replace(/'/g, '"');                   // single → double quotes
    const s2 = fixed.indexOf('{');
    const e2 = fixed.lastIndexOf('}');
    if (s2 !== -1 && e2 !== -1 && e2 > s2) {
      return JSON.parse(fixed.slice(s2, e2 + 1));
    }
  } catch (_) {}

  return null;
}

/**
 * Clean the "response" text — strip any leaked JSON/action keys.
 */
function scrubResponseText(text, actions) {
  if (!text) return '';
  // If the response is pure JSON or contains action-specific fields, replace entirely
  if (
    text.trimStart().startsWith('{') ||
    text.includes('"newColor"') ||
    text.includes('"nodeId"') ||
    text.includes('"actions"') ||
    text.includes('"type":')
  ) {
    if (actions && actions.some(a => a.type === 'SUGGEST_COLORS')) {
      return "I've analyzed the design and suggested a more professional and consistent color palette for you.";
    }
    return "I've processed your request and applied the changes below.";
  }
  return text.trim();
}

// ─── Call Groq ────────────────────────────────────────────────────────────────

async function callGroq(model, messages) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 4000,
      temperature: 0,
      seed: 42,
      response_format: { type: 'json_object' },  // enforce JSON mode
    }),
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { userId, message, sessionHistory, selectionContext } = req.body;

    if (!userId || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ── Rate limiting ──────────────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const key = `usage:${userId}:${today}`;
    let count = 0;
    try { if (redis) count = (await redis.get(key)) || 0; } catch (_) {}

    if (count >= DAILY_CAP) {
      return res.status(429).json({
        error: 'Daily limit reached',
        message: `You've used all ${DAILY_CAP} messages for today. Come back tomorrow!`,
      });
    }

    // ── Build context ──────────────────────────────────────────────────────
    const msgLower = message.toLowerCase();
    const isAudit = msgLower.includes('audit') || msgLower.includes('spacing') || msgLower.includes('padding') || msgLower.includes('alignment');
    const isSuggestColors = msgLower.includes('color') || msgLower.includes('suggest') || msgLower.includes('palette') || msgLower.includes('improve');
    const isMultiScreen = selectionContext && selectionContext.multiSelect;

    let contextToSend = selectionContext
      ? JSON.stringify(selectionContext, null, 2)
      : 'Nothing selected';

    // For audits, build a structured per-screen summary
    if (isAudit && selectionContext) {
      try {
        const sel = selectionContext;
        // Multi-screen audit: summarize each screen separately
        if (sel.multiSelect && Array.isArray(sel.nodes)) {
          const screens = sel.nodes.map(n => ({
            id: n.id, name: n.name, type: n.type,
            width: n.width, height: n.height,
            layoutMode: n.layoutMode,
            paddingTop: n.paddingTop, paddingBottom: n.paddingBottom,
            paddingLeft: n.paddingLeft, paddingRight: n.paddingRight,
            itemSpacing: n.itemSpacing, cornerRadius: n.cornerRadius,
            opacity: n.opacity,
            childCount: (n.children || []).length,
            children: (n.children || []).slice(0, 15).map(c => ({
              id: c.id, name: c.name, type: c.type,
              width: c.width, height: c.height, x: c.x, y: c.y,
              paddingTop: c.paddingTop, paddingBottom: c.paddingBottom,
              paddingLeft: c.paddingLeft, paddingRight: c.paddingRight,
              itemSpacing: c.itemSpacing, cornerRadius: c.cornerRadius,
              opacity: c.opacity, color: c.color,
            })),
            allTextNodes: (n.allTextNodes || []).slice(0, 20),
          }));
          contextToSend = JSON.stringify({ multiScreenAudit: true, screenCount: screens.length, screens }, null, 2);
        } else {
          // Single-screen audit
          const summary = {
            id: sel.id, name: sel.name, type: sel.type,
            width: sel.width, height: sel.height,
            layoutMode: sel.layoutMode,
            paddingTop: sel.paddingTop, paddingBottom: sel.paddingBottom,
            paddingLeft: sel.paddingLeft, paddingRight: sel.paddingRight,
            itemSpacing: sel.itemSpacing,
            childCount: (sel.children || []).length,
            children: (sel.children || []).slice(0, 25).map(c => ({
              id: c.id, name: c.name, type: c.type,
              width: c.width, height: c.height, x: c.x, y: c.y,
              paddingTop: c.paddingTop, paddingBottom: c.paddingBottom,
              paddingLeft: c.paddingLeft, paddingRight: c.paddingRight,
              itemSpacing: c.itemSpacing, cornerRadius: c.cornerRadius,
              opacity: c.opacity, fontSize: c.fontSize,
              color: c.color, strokeColor: c.strokeColor,
              childCount: (c.children || []).length,
            })),
            allTextNodes: (sel.allTextNodes || []).slice(0, 30),
          };
          contextToSend = JSON.stringify(summary, null, 2);
        }
      } catch (_) {}
    }

    // For multi-screen color changes, include color info for each screen
    if (isSuggestColors && isMultiScreen && selectionContext) {
      try {
        const compactNodes = (selectionContext.nodes || []).map(n => ({
          id: n.id, name: n.name, type: n.type,
          color: n.color,
          allTextNodes: (n.allTextNodes || []).slice(0, 20),
          children: (n.children || []).slice(0, 10).map(c => ({ id: c.id, name: c.name, type: c.type, color: c.color })),
        }));
        contextToSend = JSON.stringify({ multiSelect: true, count: selectionContext.count, nodes: compactNodes }, null, 2);
      } catch (_) {}
    }

    // Hard cap to stay within Groq's context window
    const CAP = isSuggestColors ? 10000 : 8000;
    if (contextToSend.length > CAP) {
      contextToSend = contextToSend.slice(0, CAP) + '\n...(context trimmed for length)';
    }

    // ── Assemble messages ──────────────────────────────────────────────────
    const auditNote = isAudit
      ? '\n\nIMPORTANT: This is an audit request. Respond with ONLY {"response":"<findings as numbered list>","actions":[]}. Do NOT include any actions.'
      : '';

    const userMessage = `CURRENT SELECTION:\n${contextToSend}\n\nUSER REQUEST: ${message}${auditNote}`;

    // Include up to last 3 turns for short-term memory (trimmed for token efficiency)
    const history = (sessionHistory || []).slice(-6, -1).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content.slice(0, 400) : '',
    }));

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userMessage },
    ];

    // ── Call primary model ─────────────────────────────────────────────────
    let raw = null;
    let modelUsed = 'llama-3.3-70b-versatile';

    const { ok: primaryOk, data: primaryData } = await callGroq(modelUsed, messages);

    if (primaryOk) {
      raw = primaryData.choices?.[0]?.message?.content || null;
    } else {
      // Log error and try fallback
      console.error('Primary model error:', JSON.stringify(primaryData));
      modelUsed = 'llama-3.1-70b-versatile';
      const { ok: fallbackOk, data: fallbackData } = await callGroq(modelUsed, messages);
      if (fallbackOk) {
        raw = fallbackData.choices?.[0]?.message?.content || null;
      } else {
        console.error('Fallback model error:', JSON.stringify(fallbackData));
        return res.status(200).json({
          response: "I'm having trouble connecting right now. Please try again in a moment.",
          actions: [],
          usage: Number(count),
          limit: DAILY_CAP,
        });
      }
    }

    if (!raw) {
      return res.status(200).json({
        response: "I received an empty response. Please try again.",
        actions: [],
        usage: Number(count),
        limit: DAILY_CAP,
      });
    }

    // ── Parse response ─────────────────────────────────────────────────────
    let parsed = extractJSON(raw);

    if (!parsed) {
      // Could not extract JSON at all — return raw text as response
      console.error('JSON parse failed. Raw:', raw.slice(0, 200));
      parsed = {
        response: raw.replace(/[{}\[\]"]/g, '').trim().slice(0, 300) || "I processed your request.",
        actions: [],
      };
    }

    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    const responseText = scrubResponseText(parsed.response || '', actions) ||
      (actions.length > 0 ? "I've applied the requested changes." : "I've analyzed your design.");

    // ── Persist usage ──────────────────────────────────────────────────────
    try { if (redis) await redis.set(key, Number(count) + 1, { ex: 90000 }); } catch (_) {}

    console.log(`[${modelUsed}] actions:${actions.length} response_len:${responseText.length}`);

    return res.status(200).json({
      response: responseText,
      actions: normalizeActions(actions),
      usage: Number(count) + 1,
      limit: DAILY_CAP,
    });

  } catch (err) {
    console.error('CRITICAL_BACKEND_ERROR:', err);
    return res.status(200).json({
      response: "I encountered an error while processing your request. Please try again.",
      actions: [],
      usage: 0,
      limit: DAILY_CAP,
    });
  }
};
