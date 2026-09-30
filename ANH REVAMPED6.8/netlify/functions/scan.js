const HF_MODEL = "nateraw/food";
const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;
const MAX_TRIES = 3;
const RETRY_DELAY_MS = 1500;

async function classify(token, contentType, body) {
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let hfRes;
    try {
      hfRes = await fetch(HF_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": contentType
        },
        body,
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      return { status: 502, error: String((error && error.message) || error) };
    }

    const text = await hfRes.text().catch(() => "");

    if (hfRes.status === 503 && attempt < MAX_TRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }

    return { status: hfRes.status, body: text, error: hfRes.status >= 400 ? text : null };
  }
  return { status: 503, error: JSON.stringify({ error: "Still loading" }) };
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors, body: "" };
  }

  const token = process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN;
  if (!token) {
    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({ error: "SCAN_NOT_CONFIGURED" })
    };
  }

  const contentType = event.headers["content-type"] || "application/octet-stream";
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, "base64")
    : Buffer.from(event.body || "", "utf8");

  if (body.length === 0) {
    return {
      statusCode: 400,
      headers: cors,
      body: JSON.stringify({ error: "Empty request body" })
    };
  }

  let result;
  try {
    result = await classify(token, contentType, body);
  } catch (error) {
    return {
      statusCode: 502,
      headers: cors,
      body: JSON.stringify({ error: String((error && error.message) || error) })
    };
  }

  return {
    statusCode: result.status || 502,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
    body: result.body || JSON.stringify({ error: "Empty response" })
  };
};