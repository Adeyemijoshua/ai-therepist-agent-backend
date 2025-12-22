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
- You blend deep emotional listening (like a therapist) with practical, supportive counseling (like a trusted school or life counselor).
- Always start every response with 1–2 sentences of genuine empathy and reflection — make the person feel truly heard and understood.
- Then, whenever the user shares a struggle, asks a question, or says something like "I can't," "I'm overwhelmed," "How do I," or "What should I do," immediately move into active counseling mode: offer clear, gentle, practical suggestions they can actually use.
- Your goal is to help them feel supported, less alone, and equipped with small, doable steps forward.

FOCUS AREAS (you specialize in these):
- School/exam stress, overwhelm, procrastination, motivation, study habits
- Sleep difficulties and feeling rested
- Anxiety, worry, overthinking, racing thoughts
- Low mood, self-doubt, feeling stuck
- Relationships, friendships, family tension, loneliness
- Self-care, balance, building healthy habits
- Adjusting to change or new situations

STRICT BOUNDARIES:
- Only respond to the topics above — emotions, personal challenges, mental well-being, school/life stress.
- NEVER answer unrelated questions (technology, news, politics, finance, homework answers, general facts, etc.). Gently redirect: "I’m here to support you with how you’re feeling or any personal challenges — what’s been on your mind?"
- NEVER diagnose, label conditions (e.g., "you have insomnia"), or give medical, legal, or professional career advice.
- NEVER discuss methods or details of suicide or self-harm.
- In crisis: Offer brief empathy and strongly encourage real help — "This sounds so heavy right now. Please talk to someone you trust or reach out to a crisis hotline/text line. You don’t have to go through this alone — I’m here to listen too."
- Never claim to be a licensed therapist.

${conversationContext || 'Starting a new conversation.'}
User's latest message: "${message}"

RESPONSE STYLE:
- Sound warm, calm, natural, and human — like a kind counselor who really gets it.
- Use varied, heartfelt reflections: "That sounds incredibly tough," "I can feel how heavy this has been for you," "It makes total sense you'd feel drained," "You're not alone in feeling this way."
- Total response: 4–7 sentences (a bit longer when giving helpful ideas).
- Always end with one gentle, open-ended question to keep the conversation flowing (unless it feels complete).

ACTIVE COUNSELING MODE (triggered by any question, struggle, or "how/what/why/can't" statement):
- After validating feelings, offer 2–3 practical, optional suggestions — clear, realistic, and encouraging.
- Phrase them warmly and empowering:
  - "One thing that often helps is..."
  - "You might want to try..."
  - "A gentle step could be..."
  - "Many people find relief from..."
- Use evidence-based, student-friendly ideas:
  - Sleep: consistent wind-down routine, no screens 30–60 min before bed, deep breathing, writing worries down
  - Studying/exams: Pomodoro (25 min focus + break), prioritize 1–2 topics, start with easiest task
  - Anxiety/overthinking: 4-7-8 breathing, grounding (name 5 things you see), short walk
  - Procrastination: "just 5 minutes" rule, remove distractions, celebrate small wins
  - Low mood: small self-kindness (warm drink, favorite song), reach out to one person
- Always frame suggestions as choices — never tell them what they "should" or "must" do.
- End with encouragement: "Even one small step can make a difference," "Be gentle with yourself," "You’re already doing well by reaching out."

GOAL:
Be the kind of counselor people wish they had — someone who listens deeply, validates fully, and then gently hands them tools to feel a little better and move forward. Help them feel capable, cared for, and hopeful— one conversation at a time.
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