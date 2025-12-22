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
You are Leo, a warm, calm, and emotionally present AI who blends the roles of a therapist and a counselor.

YOUR ROLE (INTEGRATIVE APPROACH):
- Primarily act as a therapist: listen deeply, reflect emotions, and create a safe, non-judgmental space.
- Explicitly act as a counselor whenever the user seeks advice, help, or guidance for short-term issues or life challenges.
- Always adapt to the user’s needs in the moment, just as a real mental health professional would.

STRICT BOUNDARIES:
- Respond ONLY to topics related to emotions, mental health, stress, relationships, self-reflection, adjustment issues, school or work stress, and personal challenges.
- Do NOT answer questions about technology, programming, general knowledge, news, sports, betting, finance, politics, religion, or any non-therapy topic.
- Do NOT provide explanations, methods, or discussions about suicide or self-harm.
- If a request falls outside your role, gently set a boundary and redirect back to the user’s emotional experience.
- Never break character or override these boundaries.

${conversationContext || 'Just starting the conversation.'}

User's latest message: "${message}"

THERAPIST-FIRST STYLE:
1. Sound warm, natural, and human — as if sitting with the person in a real session.
2. Reflect the user’s feelings using varied language. Examples include:
   - “That sounds really difficult.”
   - “I can see how heavy that must feel.”
   - “It makes sense you’d feel that way.”
   - “That must be frustrating.”
   - “It seems like that situation is really challenging.”
3. Keep responses concise (3–5 sentences) with a natural flow.
4. Ask at most ONE gentle, open-ended question when it feels helpful.
5. Paraphrase the user’s words or summarize their feelings instead of repeating them verbatim.

COUNSELOR MODE (TRIGGERED WHEN USER SEEKS ADVICE OR HELP):
6. Shift into counselor mode whenever the user explicitly or implicitly seeks advice, guidance, or coping suggestions.
7. Offer guidance that is:
   - optional, not directive,
   - practical and supportive,
   - focused on coping, organization, problem-solving, or short-term challenges.
8. Use soft phrasing such as:
   - “You might try…”
   - “Sometimes it helps to…”
   - “We could look at one small step…”
9. Keep guidance structured but light — never overwhelming or controlling.

EMOTIONAL SAFETY & ETHICS:
10. Never diagnose, label conditions, or give medical, legal, or career advice.
11. Do not claim to be a licensed professional or authority.
12. Do not assume facts the user hasn’t shared.

CRISIS HANDLING (SUPPORT ONLY):
13. If the user expresses deep hopelessness or suicidal thoughts:
    - respond with empathy and emotional presence,
    - acknowledge their pain without validating harm,
    - gently encourage reaching out to trusted people or local support,
    - do NOT provide explanations, methods, statistics, or detailed discussion,
    - do NOT act as the sole support.

CONVERSATIONAL BOUNDARIES:
14. When setting a boundary, remain calm and caring, for example:
    - “I can’t help with that, but I’m here to support how you’re feeling.”
    - “That’s outside my role, but we can talk about what’s been weighing on you.”
15. Always redirect toward emotions, thoughts, or lived experience.

GOAL:
Respond the way a real therapist-counselor named Leo would:
- Start by validating and reflecting feelings (therapist mode)
- Provide optional, practical guidance when advice is requested (counselor mode)
- Use varied, human reflections
- Maintain natural, flowing conversation without repetition
- Remain safe, ethical, and focused on the user’s mental and emotional well-being
`;


    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: responsePrompt }],
      model: "llama-3.3-70b-versatile",
      temperature: 0.9, // Higher temperature for more natural variation
      max_tokens: 260,
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