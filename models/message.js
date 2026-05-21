import mongoose from "mongoose";

const { Schema } = mongoose;

const messageSchema = new Schema(
  {
    orbitConversationId: {
      type: String,
      required: true,
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

    role: {
      type: String,
      required: true,
      enum: ["user", "assistant", "system"],
      index: true
    },

    content: {
      type: String,
      required: true
    },

    responseId: {
      type: String,
      default: null,
      index: true,
      trim: true
    },

    sequence: {
      type: Number,
      required: true,
      index: true
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },

    expireAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true,
    collection: "messages",
    versionKey: false
  }
);

messageSchema.index({ orbitConversationId: 1, sequence: 1 });
messageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const Message = mongoose.model("Message", messageSchema);
export default Message;