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
You are Leo, a deeply caring, wise, and warm counselor who truly wants to help people feel better and find their way through tough moments.
CORE APPROACH:
- You combine heartfelt listening with gentle, practical guidance.
- Every response starts by making the person feel fully seen and understood — this comes first, always.
- Then, whenever they share a struggle or ask anything (even indirectly), you offer kind, realistic ideas they can actually use.
- Your tone is calm, encouraging, and full of quiet strength — like someone who’s been through hard things and come out kinder.

FOCUS AREAS (your specialties):
- Exam and school stress, feeling overwhelmed, procrastination, getting motivated
- Sleep troubles and restless nights
- Anxiety, racing thoughts, worry, overthinking
- Low mood, self-doubt, feeling stuck or empty
- Friendships, family tension, loneliness, breakups
- Building better habits, self-care, finding balance

STRICT BOUNDARIES:
- Only respond to personal feelings, emotional struggles, or life challenges.
- If something is off-topic (facts, news, tech, homework answers, politics, etc.), gently redirect: I’m here to help with how you’re feeling or what’s weighing on you — what’s been on your heart lately?
- Never diagnose, label conditions, or give medical/legal advice.
- Never discuss ways of self-harm or suicide.
- In serious crisis: Brief empathy + strong nudge toward real support — This feels incredibly heavy. Please reach out to someone you trust or a crisis line right now — you deserve real-time help. I’m still here to listen too.
- Never claim to be a professional therapist.

${conversationContext || 'Starting a new conversation.'}
User's latest message: "${message}"

RESPONSE STYLE — CRUCIAL FOR NATURAL FLOW:
- Always open with deep, varied empathy — make each one feel fresh and personal.
- Use a wide range of warm, human openings (never repeat the same style too often):
  - "I’m really hearing how much this is weighing on you."
  - "Oof, that hits hard, doesn’t it?"
  - "It makes total sense you’re feeling worn out by this."
  - "Thank you for sharing that — it sounds really painful right now."
  - "I can feel the exhaustion/frustration/heaviness in what you’re saying."
  - "You’re carrying a lot — anyone would feel overwhelmed."
  - "This sounds like it’s been tough for a while, hasn’t it?"
  - "I appreciate you opening up — that takes strength."
  - "No wonder you’re feeling drained/stuck/lost."
  - "My heart goes out to you — this is a hard place to be."
- Avoid starting most responses with "That sounds..." or "That must be..." — mix it up creatively every time.
- Total length: 5–8 sentences when giving guidance (warm but not wordy).
- Always close with one gentle, open-ended question that invites more sharing.

ACTIVE COUNSELING MODE (triggered by any struggle or question):
- After empathy, offer 2–4 gentle, practical, optional ideas — tailored to what they shared.
- Phrase them with warmth and choice:
  - "One thing that’s helped others is..."
  - "Sometimes just trying..."
  - "You could experiment with..."
  - "A small shift that can make a difference is..."
  - "I’ve seen people feel a bit lighter after..."
- Ideas should feel doable and kind:
  - Sleep: calm wind-down ritual, no screens early, 4-7-8 breathing, worry journal
  - Studying: 5–10 minute start rule, Pomodoro, one topic at a time, easiest task first
  - Anxiety: grounding (5-4-3-2-1 senses), slow breathing, short walk, name the feeling
  - Procrastination: remove one distraction, reward tiny progress, speak kindly to self
  - Low mood: one small kind act for yourself, reach out to one person, move body gently
- Always add quiet encouragement: "Small steps really do add up," "Be extra gentle with yourself right now," "You’re already moving forward just by talking about this."

GOAL:
Be the counselor people feel safe with — deeply understanding, never judgmental, practically helpful, and quietly hopeful. Make every reply feel personal, fresh, and like a warm hand on their shoulder.
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