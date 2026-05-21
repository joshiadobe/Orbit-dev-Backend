import crypto from "crypto";
import Conversation from "../models/conversation.js";
import Message from "../models/message.js";

const DEFAULT_TTL_DAYS =
  Number(process.env.ORBIT_CONVERSATION_TTL_DAYS || 100);

const DEFAULT_MESSAGE_WINDOW =
  Number(process.env.ORBIT_MESSAGE_WINDOW || 50);

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCaseId(caseId) {
  return normalizeText(caseId);
}

function normalizeUserSub(userSub) {
  return normalizeText(userSub);
}

function normalizeEmailHash(userEmailHash) {
  return normalizeText(userEmailHash);
}

function normalizeDisplayName(userDisplayName) {
  return normalizeText(userDisplayName);
}

function sha256Hex(input) {
  return crypto
    .createHash("sha256")
    .update(String(input), "utf8")
    .digest("hex");
}

function computeExpireAt(days = DEFAULT_TTL_DAYS) {
  const ttlDays = Number(days || DEFAULT_TTL_DAYS);
  const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ttlMs);
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

export function generateOrbitConversationId(caseId, userSub) {
  const normalizedCaseId = normalizeCaseId(caseId);
  const normalizedUserSub = normalizeUserSub(userSub);

  if (!normalizedCaseId) {
    throw new Error("caseId is required");
  }

  if (!normalizedUserSub) {
    throw new Error("userSub is required");
  }

  return sha256Hex(`${normalizedCaseId}::${normalizedUserSub}`);
}

export async function findConversation({
  orbitConversationId,
  caseId,
  userSub
} = {}) {
  const query = {};

  if (orbitConversationId) {
    query.orbitConversationId = normalizeText(orbitConversationId);
  } else {
    const normalizedCaseId = normalizeCaseId(caseId);
    const normalizedUserSub = normalizeUserSub(userSub);

    if (!normalizedCaseId || !normalizedUserSub) {
      throw new Error(
        "findConversation requires orbitConversationId or both caseId and userSub"
      );
    }

    query.caseId = normalizedCaseId;
    query.userSub = normalizedUserSub;
  }

  return Conversation.findOne(query).lean();
}

export async function createConversation({
  caseId,
  userSub,
  userDisplayName = "",
  userEmailHash = "",
  orbitConversationId,
  fjConversationUuid = null,
  latestResponseId = null,
  state = "active"
} = {}) {
  const normalizedCaseId = normalizeCaseId(caseId);
  const normalizedUserSub = normalizeUserSub(userSub);
  const normalizedDisplayName = normalizeDisplayName(userDisplayName);
  const normalizedEmailHash = normalizeEmailHash(userEmailHash);

  if (!normalizedCaseId) {
    throw new Error("caseId is required");
  }

  if (!normalizedUserSub) {
    throw new Error("userSub is required");
  }

  const finalOrbitConversationId =
    normalizeText(orbitConversationId) ||
    generateOrbitConversationId(normalizedCaseId, normalizedUserSub);

  const doc = await Conversation.create({
    orbitConversationId: finalOrbitConversationId,
    caseId: normalizedCaseId,
    userSub: normalizedUserSub,
    userDisplayName: normalizedDisplayName,
    userEmailHash: normalizedEmailHash,
    fjConversationUuid: fjConversationUuid || null,
    latestResponseId: latestResponseId || null,
    messageCount: 0,
    state,
    lastAccessedAt: new Date(),
    expireAt: computeExpireAt()
  });

  return doc.toObject();
}

export async function findOrCreateConversation({
  caseId,
  userSub,
  userDisplayName = "",
  userEmailHash = "",
  orbitConversationId,
  fjConversationUuid = null
} = {}) {
  const normalizedCaseId = normalizeCaseId(caseId);
  const normalizedUserSub = normalizeUserSub(userSub);

  if (!normalizedCaseId) {
    throw new Error("caseId is required");
  }

  if (!normalizedUserSub) {
    throw new Error("userSub is required");
  }

  const finalOrbitConversationId =
    normalizeText(orbitConversationId) ||
    generateOrbitConversationId(normalizedCaseId, normalizedUserSub);

  const now = new Date();
  const expireAt = computeExpireAt();

  const existing = await Conversation.findOne({
    orbitConversationId: finalOrbitConversationId
  });

  if (existing) {
    const updates = {
      lastAccessedAt: now,
      expireAt
    };

    if (
      userDisplayName &&
      !normalizeText(existing.userDisplayName)
    ) {
      updates.userDisplayName = normalizeDisplayName(userDisplayName);
    }

    if (
      userEmailHash &&
      !normalizeText(existing.userEmailHash)
    ) {
      updates.userEmailHash = normalizeEmailHash(userEmailHash);
    }

    if (
      fjConversationUuid &&
      !normalizeText(existing.fjConversationUuid)
    ) {
      updates.fjConversationUuid = normalizeText(fjConversationUuid);
    }

    const updated = await Conversation.findOneAndUpdate(
      { orbitConversationId: finalOrbitConversationId },
      { $set: updates },
      { returnDocument: "after" }
    );

    return {
      conversation: updated.toObject(),
      created: false
    };
  }

  const created = await createConversation({
    caseId: normalizedCaseId,
    userSub: normalizedUserSub,
    userDisplayName,
    userEmailHash,
    orbitConversationId: finalOrbitConversationId,
    fjConversationUuid
  });

  return {
    conversation: created,
    created: true
  };
}

export async function touchConversation({
  orbitConversationId
} = {}) {
  const id = normalizeText(orbitConversationId);

  if (!id) {
    throw new Error("orbitConversationId is required");
  }

  const updated = await Conversation.findOneAndUpdate(
    { orbitConversationId: id },
    {
      $set: {
        lastAccessedAt: new Date(),
        expireAt: computeExpireAt()
      }
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    return null;
  }

  return updated.toObject();
}

export async function setFjConversationUuid({
  orbitConversationId,
  fjConversationUuid
} = {}) {
  const id = normalizeText(orbitConversationId);
  const uuid = normalizeText(fjConversationUuid);

  if (!id) {
    throw new Error("orbitConversationId is required");
  }

  if (!uuid) {
    throw new Error("fjConversationUuid is required");
  }

  const updated = await Conversation.findOneAndUpdate(
    { orbitConversationId: id },
    {
      $set: {
        fjConversationUuid: uuid,
        lastAccessedAt: new Date(),
        expireAt: computeExpireAt()
      }
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    return null;
  }

  return updated.toObject();
}

export async function updateLatestResponseId({
  orbitConversationId,
  latestResponseId
} = {}) {
  const id = normalizeText(orbitConversationId);
  const responseId = normalizeText(latestResponseId);

  if (!id) {
    throw new Error("orbitConversationId is required");
  }

  const updated = await Conversation.findOneAndUpdate(
    { orbitConversationId: id },
    {
      $set: {
        latestResponseId: responseId || null,
        lastAccessedAt: new Date(),
        expireAt: computeExpireAt()
      }
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    return null;
  }

  return updated.toObject();
}

export async function setConversationState({
  orbitConversationId,
  state
} = {}) {
  const id = normalizeText(orbitConversationId);
  const nextState = normalizeText(state);

  if (!id) {
    throw new Error("orbitConversationId is required");
  }

  if (!nextState) {
    throw new Error("state is required");
  }

  const updated = await Conversation.findOneAndUpdate(
    { orbitConversationId: id },
    {
      $set: {
        state: nextState,
        lastAccessedAt: new Date(),
        expireAt: computeExpireAt()
      }
    },
    { returnDocument: "after" }
  );

  if (!updated) {
    return null;
  }

  return updated.toObject();
}

export async function appendMessage({
  orbitConversationId,
  caseId,
  userSub,
  role,
  content,
  responseId = null,
  metadata = {}
} = {}) {
  const id = normalizeText(orbitConversationId);
  const normalizedCaseId = normalizeCaseId(caseId);
  const normalizedUserSub = normalizeUserSub(userSub);
  const normalizedRole = normalizeText(role);
  const normalizedContent = normalizeText(content);
  const normalizedResponseId = normalizeText(responseId);

  if (!id) {
    throw new Error("orbitConversationId is required");
  }

  if (!normalizedCaseId) {
    throw new Error("caseId is required");
  }

  if (!normalizedUserSub) {
    throw new Error("userSub is required");
  }

  if (!normalizedRole) {
    throw new Error("role is required");
  }

  if (!normalizedContent) {
    throw new Error("content is required");
  }

  const conversation = await Conversation.findOneAndUpdate(
    { orbitConversationId: id },
    {
      $inc: { messageCount: 1 },
      $set: {
        lastAccessedAt: new Date(),
        expireAt: computeExpireAt()
      }
    },
    { returnDocument: "after" }
  );

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  const sequence = Number(conversation.messageCount || 0);

  const message = await Message.create({
    orbitConversationId: id,
    caseId: normalizedCaseId,
    userSub: normalizedUserSub,
    role: normalizedRole,
    content: normalizedContent,
    responseId: normalizedResponseId || null,
    sequence,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    expireAt: computeExpireAt()
  });

  return {
    conversation: conversation.toObject(),
    message: message.toObject()
  };
}

export async function getRecentMessages({
  orbitConversationId,
  limit = DEFAULT_MESSAGE_WINDOW,
  beforeSequence = null
} = {}) {
  const id = normalizeText(orbitConversationId);

  if (!id) {
    throw new Error("orbitConversationId is required");
  }

  const safeLimit = clampInteger(limit, 1, 100, DEFAULT_MESSAGE_WINDOW);

  const query = {
    orbitConversationId: id
  };

  if (beforeSequence !== null && beforeSequence !== undefined) {
    const parsedBefore = Number.parseInt(beforeSequence, 10);
    if (!Number.isNaN(parsedBefore)) {
      query.sequence = { $lt: parsedBefore };
    }
  }

  const rows = await Message.find(query)
    .sort({ sequence: -1 })
    .limit(safeLimit)
    .lean();

  return rows.reverse();
}

export async function getConversationBundle({
  caseId,
  userSub,
  limit = DEFAULT_MESSAGE_WINDOW
} = {}) {
  const normalizedCaseId = normalizeCaseId(caseId);
  const normalizedUserSub = normalizeUserSub(userSub);

  if (!normalizedCaseId) {
    throw new Error("caseId is required");
  }

  if (!normalizedUserSub) {
    throw new Error("userSub is required");
  }

  const orbitConversationId =
    generateOrbitConversationId(normalizedCaseId, normalizedUserSub);

  const conversation = await findConversation({
    orbitConversationId
  });

  const messages = conversation
    ? await getRecentMessages({
        orbitConversationId,
        limit
      })
    : [];

  return {
    orbitConversationId,
    conversation,
    messages
  };
}

export default {
  generateOrbitConversationId,
  findConversation,
  createConversation,
  findOrCreateConversation,
  touchConversation,
  setFjConversationUuid,
  updateLatestResponseId,
  setConversationState,
  appendMessage,
  getRecentMessages,
  getConversationBundle
};