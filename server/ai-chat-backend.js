const http = require("http");

const PORT = Number(process.env.PORT || 8787);
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-1.5-flash").trim();
const CHAT_BACKEND_TOKEN = String(process.env.CHAT_BACKEND_TOKEN || "").trim();
const ENABLE_LOCAL_FALLBACK = !["0", "false", "no"].includes(
  String(process.env.ENABLE_LOCAL_FALLBACK || "true").trim().toLowerCase(),
);
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes("*")) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (!origin && ALLOWED_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new Error("Request body too large"));
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function normalizeHistory(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((message) => message && message.content)
    .slice(-12)
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: String(message.content).slice(0, 3000) }],
    }));
}

async function askGemini({ userText, systemPrompt, messages }) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const contents = [
    ...normalizeHistory(messages),
    {
      role: "user",
      parts: [{ text: String(userText || "") }],
    },
  ];

  const payload = {
    systemInstruction: {
      parts: [
        {
          text:
            String(systemPrompt || "").slice(0, 3000) ||
            "Tu es un assistant ERP utile et concis.",
        },
      ],
    },
    contents,
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      maxOutputTokens: 700,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 240)}`);
  }

  const data = await response.json();
  const reply = String(
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("\n") || "",
  ).trim();

  if (!reply) {
    throw new Error("Empty Gemini response");
  }

  return reply;
}

function isAuthorized(req) {
  if (!CHAT_BACKEND_TOKEN) return true;
  const authorization = String(req.headers.authorization || "").trim();
  return authorization === `Bearer ${CHAT_BACKEND_TOKEN}`;
}

function buildLocalFallbackReply({ userText, context }) {
  const text = String(userText || "").trim();
  const normalized = text.toLowerCase();
  const role = String(context?.userRole || "inconnu");
  const section = String(context?.section || "cockpit");

  if (!text) {
    return "Je suis en mode local de secours. Posez une question sur le stock, les rôles ou les processus.";
  }

  if (/(bonjour|salut|hello|bonsoir)/.test(normalized)) {
    return "Bonjour. Je suis en mode local de secours. Je peux vous aider sur les procédures principales de l'application.";
  }

  if (/(demande|commander|materiel|matériel)/.test(normalized)) {
    return [
      "Procedure demande materiel:",
      "1. Ouvrez le module de demande selon votre role.",
      "2. Saisissez operateur, designation et quantite.",
      "3. Verifiez puis validez.",
      "4. Suivez le statut dans vos sections de suivi.",
    ].join("\n");
  }

  if (/(retour|reintegrer|réintégrer)/.test(normalized)) {
    return [
      "Procedure retour de stock:",
      "1. Ouvrez la section Retour de Stock.",
      "2. Selectionnez la designation et la quantite retournee.",
      "3. Verifiez l'operateur concerne.",
      "4. Validez et controlez la mise a jour du stock.",
    ].join("\n");
  }

  if (/(role|rôle|profil|fonctionnalit)/.test(normalized)) {
    return `Vous etes connecte en tant que ${role}. Section active: ${section}. Je peux vous guider sur vos actions disponibles.`;
  }

  if (/(rapport|sortie|livraison|scanner)/.test(normalized)) {
    return "Pour les sorties et rapports: validez les mouvements puis controlez la section Rapports Sorties pour audit et suivi.";
  }

  return [
    "Je suis en mode local de secours (Gemini indisponible).",
    "Je peux aider sur: demande materiel, retour stock, rapports sorties, role utilisateur.",
    `Contexte actuel: role=${role}, section=${section}.`,
  ].join("\n");
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "itc-ai-backend",
      geminiConfigured: Boolean(GEMINI_API_KEY),
      localFallbackEnabled: ENABLE_LOCAL_FALLBACK,
      model: GEMINI_MODEL,
    });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/chat") {
    try {
      if (!isAuthorized(req)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }

      const body = await readJsonBody(req);
      const userText = String(body?.userText || "").trim();
      const systemPrompt = String(body?.systemPrompt || "").trim();
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const context = body?.context && typeof body.context === "object" ? body.context : {};

      if (!userText) {
        sendJson(res, 400, { error: "userText is required" });
        return;
      }

      let reply = "";
      let source = "gemini";

      try {
        reply = await askGemini({ userText, systemPrompt, messages });
      } catch (error) {
        if (!ENABLE_LOCAL_FALLBACK) {
          throw error;
        }

        source = "local-fallback";
        reply = buildLocalFallbackReply({ userText, context });
      }

      sendJson(res, 200, { reply, model: GEMINI_MODEL, source });
    } catch (error) {
      sendJson(res, 500, {
        error: "AI backend failure",
        details: String(error?.message || error),
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`ITC AI backend listening on http://localhost:${PORT}`);
});
