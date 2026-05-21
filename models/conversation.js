import mongoose from "mongoose";

const { Schema } = mongoose;

const conversationSchema = new Schema(
  {
    orbitConversationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },

    caseId: {
      type: String,
      required: true,
      index: true,
      trim: true
    },

    userSub: {
      type: String,
      required: true,
      index: true,
      trim: true
    },

    userDisplayName: {
      type: String,
      default: "",
      trim: true
    },

    userEmailHash: {
      type: String,
      default: "",
      trim: true
    },

    fjConversationUuid: {
      type: String,
      default: null,
      index: true,
      trim: true
    },

    latestResponseId: {
      type: String,
      default: null,
      index: true,
      trim: true
    },

    messageCount: {
      type: Number,
      default: 0
    },

    state: {
      type: String,
      enum: ["active", "archived", "expired", "deleted"],
      default: "active",
      index: true
    },

    lastAccessedAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    expireAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true,
    collection: "conversations",
    versionKey: false
  }
);

conversationSchema.index({ caseId: 1, userSub: 1 });
conversationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const Conversation = mongoose.model("Conversation", conversationSchema);
export default Conversation;