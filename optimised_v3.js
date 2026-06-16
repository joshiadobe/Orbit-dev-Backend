import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./db.js";
import crypto from "crypto";
import conversationService from "./services/conversation-service.js";

dotenv.config();

const app = express();

app.use(function addHeaders(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-User-Token"
    );
    res.header("Access-Control-Allow-Private-Network", "true");
    next();
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: "50mb" }));

const BASE_URL = process.env.FJ_BASE_URL || "https://api.fluffyjaws.adobe.com";
const MODEL = process.env.FJ_MODEL || "gpt-5.4";
const PORT = process.env.PORT || 3000;
const OKTA_OIDC_ISSUER =
  process.env.OKTA_OIDC_ISSUER ||
  "https://adobe-stage.okta.com/oauth2";

const OKTA_TOKEN_URL =
    process.env.OKTA_TOKEN_URL ||
    "https://adobe.okta.com/oauth2/aus1gan31wnmCPyB60h8/v1/token";
const OKTA_CLIENT_ID = process.env.OKTA_CLIENT_ID || "";
const OKTA_CLIENT_SECRET = process.env.OKTA_CLIENT_SECRET || "";

let serviceTokenCache = {
    accessToken: null,
    expiresAt: 0
};

let serviceTokenInFlight = null;

app.options("/chat", function optionsChat(req, res) {
    res.sendStatus(200);
});

function parseJwt(token) {
    try {
        return JSON.parse(
            Buffer.from(
                token.split(".")[1],
                "base64"
            ).toString("utf8")
        );
    } catch (err) {
        return null;
    }
}

function parseSSE(chunk, bufferObj) {
    bufferObj.buffer += chunk;
    const events = [];

    while (bufferObj.buffer.includes("\n\n")) {
        const parts = bufferObj.buffer.split("\n\n");
        const block = parts.shift();
        bufferObj.buffer = parts.join("\n\n");

        const dataParts = [];

        block.split("\n").forEach(function parseLine(line) {
            if (line.startsWith("data:")) {
                dataParts.push(line.replace("data:", "").trim());
            }
        });

        if (dataParts.length) {
            events.push(dataParts.join("\n"));
        }
    }

    return events;
}



async function getServiceToken() {
    const now = Date.now();

    if (
        serviceTokenCache.accessToken &&
        now < serviceTokenCache.expiresAt - 60 * 1000
    ) {
        return serviceTokenCache.accessToken;
    }

    if (serviceTokenInFlight) {
        return serviceTokenInFlight;
    }

    serviceTokenInFlight = (async () => {
        if (!OKTA_CLIENT_ID || !OKTA_CLIENT_SECRET) {
            throw new Error("Missing OKTA_CLIENT_ID or OKTA_CLIENT_SECRET");
        }

        const body = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: OKTA_CLIENT_ID,
            client_secret: OKTA_CLIENT_SECRET,
            scope: "fluffyjaws"
        });

        const response = await fetch(OKTA_TOKEN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json"
            },
            body: body.toString()
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                data.error_description ||
                data.error ||
                "Failed to obtain service token"
            );
        }

        if (!data.access_token) {
            throw new Error("Service token response missing access_token");
        }

        const expiresIn = Number(data.expires_in || 3600);

        serviceTokenCache = {
            accessToken: data.access_token,
            expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000
        };

        return serviceTokenCache.accessToken;
    })();

    try {
        return await serviceTokenInFlight;
    } finally {
        serviceTokenInFlight = null;
    }
}

app.post(
    "/auth/exchange",

    async function authExchangeHandler(
        req,
        res
    ) {
        try {
            const code =
                req.body && req.body.code
                    ? req.body.code
                    : null;

            const codeVerifier =
                req.body &&
                    req.body.codeVerifier
                    ? req.body.codeVerifier
                    : null;

            const redirectUri =
                req.body &&
                    req.body.redirectUri
                    ? req.body.redirectUri
                    : null;

            if (
                !code ||
                !codeVerifier ||
                !redirectUri
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Missing PKCE parameters"
                    });
            }

            const body =
                new URLSearchParams({
                    grant_type:
                        "authorization_code",

                    client_id:
                        process.env
                            .OKTA_NATIVE_CLIENT_ID,

                    redirect_uri:
                        redirectUri,

                    code:
                        code,

                    code_verifier:
                        codeVerifier
                });

            const response = await fetch(
                OKTA_OIDC_ISSUER + "/v1/token",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded",

                        Accept:
                            "application/json"
                    },

                    body: body.toString()
                }
            );

            const data =
                await response.json();

            if (!response.ok) {
                return res
                    .status(response.status)
                    .json({
                        error:
                            data.error_description ||
                            data.error ||
                            "Token exchange failed"
                    });
            }

            return res.json(data);

        } catch (err) {
            console.error(
                "PKCE exchange failed:",
                err
            );

            return res
                .status(500)
                .json({
                    error:
                        "PKCE exchange failed"
                });
        }
    }
);

app.post(
    "/auth/refresh",

    async function authRefreshHandler(
        req,
        res
    ) {
        try {
            const refreshToken =
                req.body &&
                    req.body.refreshToken
                    ? req.body.refreshToken
                    : null;

            if (!refreshToken) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Missing refresh token"
                    });
            }

            const body =
                new URLSearchParams({
                    grant_type:
                        "refresh_token",

                    client_id:
                        process.env
                            .OKTA_NATIVE_CLIENT_ID,

                    refresh_token:
                        refreshToken
                });

            const response = await fetch(
                OKTA_OIDC_ISSUER + "/v1/token",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded",

                        Accept:
                            "application/json"
                    },

                    body: body.toString()
                }
            );

            const data =
                await response.json();

            if (!response.ok) {
                return res
                    .status(response.status)
                    .json({
                        error:
                            data.error_description ||
                            data.error ||
                            "Refresh failed"
                    });
            }

            return res.json(data);

        } catch (err) {
            console.error(
                "Refresh flow failed:",
                err
            );

            return res
                .status(500)
                .json({
                    error:
                        "Refresh flow failed"
                });
        }
    }
);

app.post(
  "/conversation/recent",

  async function recentConversationHandler(
    req,
    res
  ) {
    try {

      const caseId =
        req.body &&
        req.body.caseId
          ? String(req.body.caseId).trim()
          : "";

      const userToken =
        req.body &&
        req.body.userToken
          ? req.body.userToken
          : null;

      if (!caseId) {
        return res.status(400).json({
          error: "caseId required"
        });
      }

      const tokenPayload =
        userToken
          ? parseJwt(userToken)
          : null;

      const userSub =
        tokenPayload?.sub ||
        "anonymous";

      const result =
        await conversationService
          .getConversationBundle({
            caseId,
            userSub,
            limit: 50
          });

      return res.json({
        success: true,

        orbitConversationId:
          result.orbitConversationId,

        conversation:
          result.conversation || null,

        messages:
          result.messages || [],

        latestResponseId:
          result.conversation
            ?.latestResponseId || null
      });

    } catch (err) {

      console.error(
        "💥 Failed loading conversation:",
        err
      );

      return res.status(500).json({
        error:
          "Failed loading conversation"
      });
    }
  }
);

app.post(
  "/chat",

  async function chatHandler(
    req,
    res
  ) {

    console.log("🔥 /chat hit");

    // Declared in function scope so the catch block can clear it too.
    let keepAlive = null;

    try {

      const prompt =
        req.body &&
        req.body.prompt
          ? String(req.body.prompt)
          : "";

      const caseId =
        req.body &&
        req.body.caseId
          ? String(req.body.caseId).trim()
          : "UNKNOWN_CASE";

      const fresh =
        Boolean(
          req.body &&
          req.body.fresh
        );

      const userToken =
        req.body &&
        req.body.userToken
          ? req.body.userToken
          : null;

      const attachments =
        req.body &&
        Array.isArray(req.body.attachments)
          ? req.body.attachments
          : [];

      const THIRTY_MB = 30 * 1024 * 1024;

      const totalAttachmentSize =
        attachments.reduce((sum, att) => {
          if (!att.fileData) return sum;
          const base64 = att.fileData.includes(",")
            ? att.fileData.split(",")[1]
            : att.fileData;
          return sum + Math.ceil(base64.length * 0.75);
        }, 0);

      if (totalAttachmentSize > THIRTY_MB) {
        return res.status(400).json({
          error: "Total attachment size exceeds 30MB limit"
        });
      }

      if (!prompt) {
        return res.status(400).json({
          error: "Prompt required"
        });
      }

      /* ---------- USER ---------- */

      const tokenPayload =
        userToken
          ? parseJwt(userToken)
          : null;

      const userSub =
        tokenPayload?.sub ||
        "anonymous";

      const userDisplayName =
        tokenPayload?.name || "";

      const userEmail =
        tokenPayload?.email || "";

      const userEmailHash =
        userEmail
          ? crypto
              .createHash("sha256")
              .update(userEmail)
              .digest("hex")
          : "";

      /* ---------- CONVERSATION ---------- */

      const {
        conversation,
        created
      } =
        await conversationService
          .findOrCreateConversation({
            caseId,
            userSub,
            userDisplayName,
            userEmailHash
          });

      const orbitConversationId =
        conversation
          .orbitConversationId;

      const previousResponseId =
        fresh
          ? null
          : conversation
              ?.latestResponseId || null;

      console.log(
        "🧠 orbitConversationId:",
        orbitConversationId
      );

      console.log(
        "🆕 Conversation created:",
        created
      );

      const useThread =
        Boolean(previousResponseId) &&
        !fresh;

      const contextMode =
        useThread
          ? "mongo-thread"
          : "fresh";

      /* ---------- SERVICE TOKEN ---------- */

      const serviceToken =
        await getServiceToken();

      /* ---------- PAYLOAD ---------- */

      const messageContent =
        attachments.length > 0
          ? [
              { type: "input_text", text: prompt },
              ...attachments.map(att => ({
                type: "input_file",
                filename: att.fileName,
                file_data: att.fileData,
                mime_type: att.mimeType || undefined
              }))
            ]
          : prompt;

      const payload = {
        model: MODEL,

        messages: [
          {
            role: "user",
            content: messageContent
          }
        ],

        canvasMode: false,

        reasoningEffort:
          "medium",

        webSearchEnabled: true
      };

      if (useThread) {
        payload.previousResponseId =
          previousResponseId;
      }

      /* ---------- HEADERS ---------- */

      const upstreamHeaders = {
        Authorization:
          "Bearer " +
          serviceToken,

        Accept:
          "text/event-stream",

        "Content-Type":
          "application/json"
      };

      if (userToken) {
        upstreamHeaders["X-User-Token"] = "Bearer " + userToken;
      }

      console.log(
        "📤 Context mode:",
        contextMode
      );

      console.log(
        "📤 Payload:",
        JSON.stringify(
          payload,
          null,
          2
        )
      );

      /* ---------- STORE USER MESSAGE ---------- */

      await conversationService
        .appendMessage({
          orbitConversationId,
          caseId,
          userSub,
          role: "user",
          content: prompt
        });

      /* ---------- FLUFFYJAWS ---------- */

      const response =
        await fetch(
          BASE_URL +
            "/api/v1/stream",
          {
            method: "POST",

            headers:
              upstreamHeaders,

            body:
              JSON.stringify(
                payload
              )
          }
        );

      if (!response.ok) {

        let upstreamError =
          "Upstream failed";

        try {

          const upstreamBody =
            await response.json();

          if (
            upstreamBody &&
            upstreamBody.error
          ) {
            upstreamError =
              upstreamBody.error;
          }

        } catch (parseError) {

          upstreamError =
            "Upstream failed with HTTP " +
            response.status;
        }

        return res
          .status(response.status)
          .json({
            error:
              upstreamError
          });
      }

      if (!response.body) {
        return res.status(502).json({
          error:
            "Missing upstream response body"
        });
      }

      /* ---------- KEEP-ALIVE ---------- */
      // The upstream AI call can take longer than a fronting proxy's
      // idle timeout (~60s). Until we have the final JSON we periodically
      // write a newline so the proxy sees an active connection and does
      // not return 502. JSON.parse ignores leading whitespace, so the
      // client's response.json() still parses the final body correctly.

      res.setHeader("Content-Type", "application/json");

      keepAlive = setInterval(function sendHeartbeat() {
        try {
          res.write("\n");
        } catch (_) {
          /* connection already closed */
        }
      }, 15000);

      /* ---------- STREAM ---------- */

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      const bufferObj = {
        buffer: ""
      };

      let finalText = "";

      let responseId = null;

      let terminalError = null;

      let streamDone = false;

      while (!streamDone) {

        const chunkResult =
          await reader.read();

        if (chunkResult.done) {
          break;
        }

        const chunk =
          decoder.decode(
            chunkResult.value,
            { stream: true }
          );

        const events =
          parseSSE(
            chunk,
            bufferObj
          );

        for (
          let i = 0;
          i < events.length;
          i += 1
        ) {

          const data =
            events[i];

          if (data === "[DONE]") {
            streamDone = true;
            break;
          }

          try {

            const obj =
              JSON.parse(data);

            console.log(
              "EVENT:",
              obj.type
            );

            if (
              obj.type ===
                "response.created" &&
              obj.response &&
              obj.response.id
            ) {
              responseId =
                obj.response.id;
            }

            if (
              obj.type ===
                "response.completed" &&
              obj.response &&
              obj.response.id
            ) {
              responseId =
                obj.response.id;
            }

            if (
              obj.type ===
                "response.output_text.delta" &&
              obj.delta
            ) {
              finalText +=
                obj.delta;
            }

            if (
              obj.type ===
                "response.output_text.done" &&
              typeof obj.text ===
                "string" &&
              obj.text &&
              !finalText
            ) {
              finalText =
                obj.text;
            }

            if (
              obj.type ===
              "response.failed"
            ) {

              terminalError =
                obj.error &&
                obj.error.message
                  ? obj.error.message
                  : "Response failed";

              streamDone = true;

              break;
            }

            if (
              obj.type === "error"
            ) {

              terminalError =
                obj.message ||
                "Upstream error";

              streamDone = true;

              break;
            }

          } catch (parseError) {

            console.warn(
              "⚠️ Failed to parse SSE event:",
              data
            );
          }
        }
      }

      /* ---------- TERMINAL ERROR ---------- */

      if (terminalError) {

        clearInterval(keepAlive);

        console.error(
          "❌ Stream error:",
          terminalError
        );

        const errorBody = JSON.stringify({
          error: terminalError,
          responseId: responseId || null
        });

        // Once the heartbeat has flushed headers we can no longer set a
        // status code, so finish the already-open response with res.end.
        if (res.headersSent) {
          return res.end(errorBody);
        }

        return res.status(502).json({
          error: terminalError,
          responseId:
            responseId || null
        });
      }

      console.log(
        "📤 Final:",
        finalText
      );

      console.log(
        "🆔 responseId:",
        responseId
      );

      /* ---------- STORE ASSISTANT ---------- */

      await conversationService
        .appendMessage({
          orbitConversationId,
          caseId,
          userSub,
          role: "assistant",
          content: finalText,
          responseId
        });

      /* ---------- UPDATE CONTINUITY ---------- */

      await conversationService
        .updateLatestResponseId({
          orbitConversationId,
          latestResponseId:
            responseId
        });

      /* ---------- RESPONSE ---------- */

      clearInterval(keepAlive);

      const successBody = JSON.stringify({
        text: finalText,
        responseId: responseId || null,
        contextMode,
        orbitConversationId
      });

      if (res.headersSent) {
        return res.end(successBody);
      }

      return res.json({
        text: finalText,

        responseId:
          responseId || null,

        contextMode:
          contextMode,

        orbitConversationId
      });

    } catch (err) {

      clearInterval(keepAlive);

      console.error(
        "💥 Server error:",
        err
      );

      if (res.headersSent) {
        return res.end(
          JSON.stringify({ error: "Server error" })
        );
      }

      return res.status(500).json({
        error: "Server error"
      });
    }
  }
);

app.get("/health", function healthHandler(req, res) {
    return res.status(200).json({
        status: "ok",
        service: "orbit-backend",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development"
    });
});

async function startServer() {

    try {

        await connectDB();

        app.listen(
            PORT,
            function onListen() {

                console.log(
                    "🚀 Server running on http://localhost:" + PORT
                );

            }
        );

    } catch (err) {

        console.error(
            "💥 Failed to start backend:",
            err
        );

        process.exit(1);
    }
}

startServer();