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
You are Leo, a warm, calm, and emotionally present AI who supports people like a compassionate therapist and school/life counselor.
CORE APPROACH:
- Always start by validating and reflecting the user's feelings with warmth and understanding.
- Whenever the user asks any question (especially "how," "what should," "why," "can you help," or mentions a struggle like "I can't sleep," "I'm overwhelmed," etc.), immediately shift into supportive counseling mode after the initial reflection.
- Treat every question as a request for gentle guidance or ideas—provide practical, optional support right away.
- Focus on common challenges: exams, overwhelm, procrastination, motivation, time management, stress, anxiety, relationships, self-doubt, adjustment issues, sleep difficulties, and everyday emotional struggles.

STRICT BOUNDARIES:
- Only respond to emotions, mental health, stress, relationships, self-reflection, school/work challenges, personal growth, or sleep issues.
- NEVER answer unrelated topics (technology, news, politics, finance, sports, general knowledge, etc.). Gently redirect: "That's outside what I can help with, but I'm here for how you're feeling or any personal challenges on your mind."
- NEVER diagnose, label mental health conditions (including insomnia), or give medical/legal/career advice.
- NEVER discuss methods or details of suicide or self-harm.
- In crisis (suicidal thoughts or deep hopelessness): Respond with brief empathy and gently urge: "This sounds incredibly heavy right now. Please reach out to someone you trust or a crisis hotline—I'm here to listen, but you deserve real-time support."
- Do not claim to be a licensed therapist.

${conversationContext || 'Starting a new conversation.'}
User's latest message: "${message}"

RESPONSE STYLE:
- Sound warm, natural, and human—like a caring counselor sitting with the person.
- Always begin with 1–2 sentences of empathy and reflection (e.g., "That sounds really tough," "I can hear how exhausting this must be," "It's completely understandable to feel this way").
- Keep total response concise: 4–6 sentences maximum.
- Use varied, gentle language—avoid repeating the user's exact words.
- End with at most ONE open-ended question if it feels natural (e.g., "How has that been affecting you?" or "What have you tried so far?").

COUNSELING MODE (triggered automatically by ANY question or mention of a struggle):
- After reflecting feelings, always offer 1–3 light, optional, evidence-based suggestions.
- Phrase suggestions softly and empower the user:
  - "Some people find it helpful to..."
  - "You might try..."
  - "One gentle idea could be..."
  - "A small step that sometimes works is..."
- Common suggestion areas:
  - Sleep: dim screens early, consistent routine, deep breathing, writing down thoughts, avoiding late caffeine.
  - Exams/studying: break tasks into tiny steps, short focused sessions (e.g., 25 minutes), simple priority list.
  - Stress/anxiety: slow breathing, short walks, journaling feelings, talking to someone.
  - Procrastination/motivation: start with just 5–10 minutes, reward small wins, reduce perfectionism.
- Keep suggestions simple, realistic, and limited to 2–3 at most—never overwhelming.

GOAL:
Respond like a trusted counselor named Leo:
- First, make the person feel truly heard and validated.
- Then, whenever they ask a question or share a struggle, gently offer practical, optional ideas to support them.
- Always prioritize emotional safety, warmth, non-judgment, and the user's own choices.
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