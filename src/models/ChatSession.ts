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
  // Internal flag to track empty sessions
  isEmptySession?: boolean;
}

const chatMessageSchema = new Schema<IChatMessage>({
  role: { type: String, required: true, enum: ["user", "assistant"] },
  content: { 
    type: String, 
    required: true,
    trim: true,
    minlength: 1 // Ensure content is not empty
  },
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
  startTime: { 
    type: Date, 
    required: true,
    default: Date.now 
  },
  status: {
    type: String,
    required: true,
    enum: ["active", "completed", "archived"],
    default: "active"
  },
  messages: [chatMessageSchema],
  isEmptySession: {
    type: Boolean,
    default: false
  }
});

// ============== SMART VALIDATION ==============
chatSessionSchema.pre("save", function(next) {
  const session = this;
  
  // If session is brand new and has no messages yet, allow it
  if (session.isNew && (!session.messages || session.messages.length === 0)) {
    // Mark as empty session that needs to be populated
    session.isEmptySession = true;
    console.log("Creating new empty session - will auto-delete if not populated");
    return next();
  }
  
  // If updating an existing session
  if (session.isModified('messages')) {
    // If messages became empty, mark for deletion
    if (!session.messages || session.messages.length === 0) {
      session.isEmptySession = true;
    } else {
      // Check if all messages have valid content
      const hasValidMessages = session.messages.some(
        msg => msg.content && msg.content.trim().length > 0
      );
      
      if (!hasValidMessages) {
        session.isEmptySession = true;
      } else {
        // Session has valid messages, clear the empty flag
        session.isEmptySession = false;
      }
    }
  }
  
  next();
});

// ============== AUTO-CLEANUP ==============
chatSessionSchema.post("save", async function(doc) {
  // If session is marked as empty, schedule it for deletion
  if (doc.isEmptySession) {
    // Delete after 5 minutes if still empty
    setTimeout(async () => {
      try {
        const freshSession = await ChatSession.findById(doc._id);
        if (freshSession && freshSession.isEmptySession) {
          await freshSession.deleteOne();
          console.log(`Auto-deleted empty session ${doc.sessionId}`);
        }
      } catch (error) {
        console.error("Error auto-deleting empty session:", error);
      }
    }, 5 * 60 * 1000); // 5 minutes
  }
});

// ============== PERIODIC CLEANUP (runs on first find each day) ==============
let lastCleanup = new Date();

chatSessionSchema.pre("find", async function() {
  const now = new Date();
  // Run cleanup once per day
  if (now.getTime() - lastCleanup.getTime() > 24 * 60 * 60 * 1000) {
    try {
      const result = await ChatSession.deleteMany({
        isEmptySession: true,
        startTime: { $lt: new Date(Date.now() - 30 * 60 * 1000) } // Older than 30 minutes
      });
      
      if (result.deletedCount > 0) {
        console.log(`Periodic cleanup deleted ${result.deletedCount} empty sessions`);
      }
      
      lastCleanup = now;
    } catch (error) {
      console.error("Periodic cleanup failed:", error);
    }
  }
});

export const ChatSession = model<IChatSession>(
  "ChatSession",
  chatSessionSchema
);