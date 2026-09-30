// Netlify Function mirror of POST /api/gemini-scan in server.js.
// GEMINI only: Flash -> Flash-Lite failover.
const GEMINI_MODELS = (process.env.GEMINI_MODELS ||
  "gemini-3-flash-preview,gemini-flash-latest,gemini-3.5-flash,gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite")
  .split(",").map((s) => s.trim()).filter(Boolean);
const GEMINI_PROMPT =
  "You are an expert food recognition and nutrition estimation AI, similar to Google Lens but specialised for food. " +
  "Carefully analyse the image: look at colours, textures, shapes, plating, ingredients visible, cooking method, portion size, and any text/labels on packaging. " +
  "You MUST identify the SPECIFIC dish — not a generic category. For example say 'nasi goreng ayam' not just 'fried rice', say 'rendang sapi' not just 'meat curry'. " +
  "You know Indonesian, Asian, Middle-Eastern, Western and all world cuisines very well. " +
  "Respond ONLY with valid JSON, no markdown, no extra text. " +
  'If the image clearly shows NO food or drink, respond ONLY with {"not_food": true, "seen": "<very short description of the main subject, e.g. two airplanes>"} ' +
  "Otherwise respond ONLY with this JSON: " +
  '{"food": "<specific food name in the most common language for that dish, e.g. indomie goreng, sate ayam, nasi padang, chicken katsu curry>", ' +
  '"food_en": "<English name if the primary name is not English, otherwise same as food>", ' +
  '"description": "<1-sentence description of what you see: ingredients, cooking method, portion>", ' +
  '"confidence": <0.0-1.0 how confident you are this is the correct food>, ' +
  '"protein_g": number, "carbs_g": number, "fat_g": number, "sugar_g": number, "calories": number} ' +
  "— realistic estimate for one typical serving as shown in the photo. " +
  "If you can see the portion is large or small, adjust the nutrition accordingly.";

async function geminiScanOnce(model, key, mime, b64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 12000);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: GEMINI_PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, topP: 0.9, topK: 32, maxOutputTokens: 350 },
      }),
    });
    const text = await r.text().catch(() => "");
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: r.status, data };
  } finally { clearTimeout(timer); }
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const key = process.env.GEMINI_KEY;
  if (!key) {
    return { statusCode: 501, headers: cors, body: JSON.stringify({ error: "GEMINI_NOT_CONFIGURED" }) };
  }

  const b64 = event.isBase64Encoded ? event.body : Buffer.from(event.body || "", "utf8").toString("base64");
  if (!b64) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Empty request body" }) };
  }
  const mime = event.headers["content-type"] || event.headers["Content-Type"] || "image/jpeg";

  let lastErr = "no models configured";
  for (const model of GEMINI_MODELS) {
    let out;
    try {
      out = await geminiScanOnce(model, key, mime, b64);
    } catch (err) {
      lastErr = `${model}: ${String((err && err.message) || err)}`;
      continue;
    }
    if (out.status === 200 && out.data) {
      let inner = out.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof inner === "string") {
        try { inner = JSON.parse(inner); } catch (e) { inner = null; }
      } else if (typeof inner !== "object" || inner === null) {
        inner = null;
      }
      if (inner && (inner.not_food === true || typeof inner.food === "string")) {
        return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8", ...cors }, body: JSON.stringify({ model, ...inner }) };
      }
      lastErr = `${model}: malformed response`;
      continue;
    }
    if (out.status === 429 || (out.status >= 500 && out.status <= 599)) {
      lastErr = `${model}: HTTP ${out.status}`;
      continue;
    }
    const msg = (out.data && out.data.error && out.data.error.message) || "";
    if (out.status === 404 && /no longer available|not.?found/i.test(msg)) {
      lastErr = `${model}: retired`;
      continue;
    }
    return { statusCode: out.status, headers: cors, body: JSON.stringify({ error: msg || `Gemini HTTP ${out.status}`, model }) };
  }
  return { statusCode: 502, headers: cors, body: JSON.stringify({ error: `All Gemini models exhausted (${lastErr})` }) };
};
