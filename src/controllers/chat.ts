import { Request, Response } from "express";
import { ChatSession } from "../models/ChatSession";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { User } from "../models/User";
import { Types } from "mongoose";
import Groq from "groq-sdk";

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
}

// Create new session
export const createChatSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = new Types.ObjectId(req.user.id);
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const sessionId = uuidv4();
    const session = new ChatSession({
      sessionId,
      userId,
      startTime: new Date(),
      status: "active",
      messages: [],
    });

    await session.save();

    res.status(201).json({
      message: "Chat session created",
      sessionId: session.sessionId,
    });
  } catch (error) {
    logger.error("Error creating chat session:", error);
    res.status(500).json({
      message: "Error creating session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Send message - simplified for natural flow
export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: "Message is required" });
    }
    
    const userId = new Types.ObjectId(req.user.id);

    // Get session
    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Get the last few messages for context
    const recentMessages = session.messages.slice(-6);
    let conversationContext = "";
    
    if (recentMessages.length > 0) {
      conversationContext = "Recent conversation:\n";
      recentMessages.forEach(msg => {
        const role = msg.role === 'user' ? 'User' : 'Leo';
        conversationContext += `${role}: ${msg.content}\n`;
      });
    }

    // Simple response generation that flows naturally
const responsePrompt = `
You are Leo, a warm, compassionate, and wise counselor who genuinely cares about helping people feel better and navigate life's challenges.
CORE APPROACH:
- You blend deep emotional listening with practical, supportive counseling.
- ALWAYS start every response by acknowledging and validating the user's feelings — this is essential to make them feel heard.
- Then, when they share a struggle or ask a question, move into active counseling with gentle, practical suggestions.
- Your goal is to help them feel supported, capable, and a little more hopeful.

FOCUS AREAS:
- School/exam stress, procrastination, motivation, study habits
- Sleep difficulties
- Anxiety, overthinking, low mood, self-doubt
- Relationships, loneliness, family/friend issues
- Self-care and building healthy habits

STRICT BOUNDARIES:
- Only respond to personal, emotional, or life challenges.
- NEVER answer unrelated questions (facts, news, tech, homework answers, etc.). Redirect gently: I’m here to support you with how you’re feeling or any personal challenges — what’s been on your mind lately?
- NEVER diagnose, label conditions, or give medical/legal advice.
- NEVER discuss suicide/self-harm methods.
- In crisis: Brief empathy + strong encouragement to seek real help.
- Never claim to be a licensed therapist.

${conversationContext || 'Starting a new conversation.'}
User's latest message: "${message}"

RESPONSE STYLE — VERY IMPORTANT:
- Sound warm, natural, calm, and deeply human — like a caring counselor who truly understands.
- ALWAYS begin with empathy and validation, but USE HIGHLY VARIED PHRASES — never start multiple responses the same way.
- Examples of varied empathy openings (rotate and create similar ones):
  - "I can hear how heavy this is feeling for you right now."
  - "That must be really draining to carry."
  - "It makes complete sense you'd feel overwhelmed with all this."
  - "I'm really glad you shared that — it sounds incredibly tough."
  - "Oof, I can feel how frustrating/exhausting/painful that is."
  - "You're not alone in this — a lot of people would feel the same way."
  - "That weighs a lot, doesn't it?"
  - "I appreciate you opening up — this sounds really hard."
  - "It’s completely understandable to feel stuck/worn out/lost right now."
  - "Hearing that, I can sense how much this is affecting you."
- NEVER reuse the exact same opening phrase in consecutive responses or frequently (especially avoid starting every reply with "That sounds...").
- Total response: 4–7 sentences.
- End with one gentle, open-ended question (unless it feels unnatural).

ACTIVE COUNSELING MODE (any question or struggle):
- After varied empathy, offer 2–3 optional, practical suggestions.
- Phrase softly: "One thing that often helps is...", "You might try...", "A small step could be..."
- Keep ideas simple, realistic, evidence-based (Pomodoro, breathing, journaling, small starts, routines, self-kindness).
- Always encourage gently: "Even tiny steps count," "Be patient with yourself," "You’re already doing something good by talking about this."

GOAL:
Be a truly supportive, varied, and human-like counselor. Make each response feel fresh, deeply validating, and practically helpful — never formulaic or repetitive.
`;

    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: responsePrompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7, // Higher temperature for more natural variation
      max_tokens: 300,
      top_p: 0.95,
    });

    const leoResponse = response.choices[0]?.message?.content?.trim() || 
      "Thanks for sharing that. I'm here to listen. What's on your mind?";

    // Save to database
    session.messages.push({
      role: "user",
      content: message,
      timestamp: new Date(),
    } as any);

    session.messages.push({
      role: "assistant",
      content: leoResponse,
      timestamp: new Date(),
    } as any);

    await session.save();

    res.json({
      response: leoResponse
    });

  } catch (error) {
    logger.error("Error in sendMessage:", error);
    res.status(500).json({
      message: "Error processing message",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get session history
export const getSessionHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);

    const session = await ChatSession.findOne({ sessionId });
    if (!session) return res.status(404).json({ message: "Session not found" });

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json({
      messages: session.messages,
      startTime: session.startTime,
      status: session.status,
    });
  } catch (error) {
    logger.error("Error fetching session history:", error);
    res.status(500).json({ message: "Error fetching session history" });
  }
};

// Get all sessions for user
export const getAllChatSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);
    const sessions = await ChatSession.find({ userId }).sort({ startTime: -1 });
    
    const simplifiedSessions = sessions.map(session => ({
      sessionId: session.sessionId,
      startTime: session.startTime,
      status: session.status,
      messagesCount: session.messages.length,
      lastMessage: session.messages.length > 0 
        ? session.messages[session.messages.length - 1].content.substring(0, 100)
        : null
    }));

    res.json(simplifiedSessions);
  } catch (error) {
    logger.error("Error fetching all chat sessions:", error);
    res.status(500).json({ message: "Error fetching chat sessions" });
  }
};

// Get specific chat session
export const getChatSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const chatSession = await ChatSession.findOne({ sessionId });
    if (!chatSession)
      return res.status(404).json({ error: "Chat session not found" });

    res.json(chatSession);
  } catch (error) {
    logger.error("Failed to get chat session:", error);
    res.status(500).json({ error: "Failed to get chat session" });
  }
};

// Get chat history only
export const getChatHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);
    const session = await ChatSession.findOne({ sessionId });

    if (!session) return res.status(404).json({ message: "Session not found" });
    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json(session.messages);
  } catch (error) {
    logger.error("Error fetching chat history:", error);
    res.status(500).json({ message: "Error fetching chat history" });
  }
};