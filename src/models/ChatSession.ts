import { Document, Schema, model, Types } from "mongoose";

export interface IChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  metadata?: {
    analysis?: any;
    currentGoal?: string | null;
    progress?: {
      emotionalState?: string;
      riskLevel?: number;
    };
  };
}

export interface IChatSession extends Document {
  _id: Types.ObjectId;
  sessionId: string;
  userId: Types.ObjectId;
  startTime: Date;
  status: "active" | "completed" | "archived";
  messages: IChatMessage[];
}

const chatMessageSchema = new Schema<IChatMessage>({
  role: { type: String, required: true, enum: ["user", "assistant"] },
  content: { type: String, required: true },
  timestamp: { type: Date, required: true },
  metadata: {
    analysis: Schema.Types.Mixed,
    currentGoal: String,
    progress: {
      emotionalState: String,
      riskLevel: Number,
    },
  },
});

const chatSessionSchema = new Schema<IChatSession>({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  startTime: { type: Date, required: true },
  status: {
    type: String,
    required: true,
    enum: ["active", "completed", "archived"],
  },
  messages: [chatMessageSchema],
});

//
chatSessionSchema.pre("save", function(next) {
  // Check if messages array is empty or undefined
  if (!this.messages || this.messages.length === 0) {
    // Prevent saving by passing an error
    return next(new Error("Cannot save chat session with empty messages"));
  }
  
  // Optional: Also check if all messages have content
  const hasValidMessages = this.messages.some(
    msg => msg.content && msg.content.trim().length > 0
  );
  
  if (!hasValidMessages) {
    return next(new Error("Cannot save chat session without valid message content"));
  }
  
  next(); // Allow save to proceed
});

export const ChatSession = model<IChatSession>(
  "ChatSession",
  chatSessionSchema
);