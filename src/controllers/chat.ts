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
    
    if (!req.user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: "Message is required" });
    }
    
    const userId = new Types.ObjectId(req.user.id);
    const trimmedMessage = message.trim();
    const lowerMessage = trimmedMessage.toLowerCase();

    // Get session
    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Check if conversation should end
    const shouldEndConversation = checkIfConversationShouldEnd(lowerMessage);

    // Build message array for Groq API
    const messagesForAPI = buildMessagesForAPI(session, trimmedMessage);

    // If conversation should end, skip API call and provide closing response
    let leoResponse: string;
    
    if (shouldEndConversation) {
      leoResponse = getClosingResponse();
    } else {
      // Call Groq for regular response
      const response = await groq.chat.completions.create({
        messages: messagesForAPI,
        model: "llama-3.3-70b-versatile",
        temperature: 0.65,
        max_tokens: 260,
        top_p: 0.9,
      });

      leoResponse = response.choices[0]?.message?.content?.trim() || 
        "I'm here with you. What's been on your mind?";
      
      // Validate and sanitize the response
      leoResponse = validateAndSanitizeResponse(leoResponse);
    }

    // Save messages to session
    session.messages.push({
      role: "user",
      content: trimmedMessage,
      timestamp: new Date(),
    });

    session.messages.push({
      role: "assistant",
      content: leoResponse,
      timestamp: new Date(),
    });

    // Mark session as potentially complete if conversation is ending
    if (shouldEndConversation) {
      session.status = 'completed';
    }

    await session.save();

    // Send response
    res.json({
      response: leoResponse,
      conversationComplete: shouldEndConversation
    });

  } catch (error) {
    logger.error("Error in sendMessage:", error);
    res.status(500).json({
      message: "Error processing message",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Helper Functions

/**
 * Checks if the user's message indicates the conversation should end
 */
function checkIfConversationShouldEnd(message: string): boolean {
  const endingPatterns = [
    // Gratitude and farewell
    /^(thanks|thank you|thx|ty|bye|goodbye|see ya|talk later|cya)(\s|$)/i,
    /i('m| am) (good|okay|fine|alright|better)$/i,
    /that('s| is) (helpful|useful|good|enough)$/i,
    /i('ll| will) try (that|it|this)$/i,
    /^okay(\s|$)/i,
    /^alright(\s|$)/i,
    /sounds good$/i,
    /i('ll| will) do that$/i,
    /got it$/i,
    /that makes sense$/i,
    /i feel better$/i,
    /i'm done (for now|today|talking)?$/i,
    /appreciate it$/i,
    /talk to you later$/i,
    /thanks leo$/i,
    /thank you leo$/i,
    // Completion phrases
    /i think that('s| is) all$/i,
    /that's all for now$/i,
    /no (more|further) questions$/i,
    /i('m| am) all set$/i,
    // Agreement and acceptance
    /i('ll| will) give it a shot$/i,
    /i('ll| will) take your advice$/i,
    /i('ll| will) work on that$/i,
    /you('re| are) right$/i,
    /makes sense$/i,
  ];

  // Check for exact matches or patterns
  return endingPatterns.some(pattern => pattern.test(message)) || 
    // Also check for keywords in the message
    containsEndingKeywords(message);
}

/**
 * Checks for ending keywords in the message
 */
function containsEndingKeywords(message: string): boolean {
  const endingKeywords = [
    "bye", "goodbye", "thanks", "thank you", "thx", "ty",
    "i'm done", "that's all", "talk later", "see you",
    "i feel better", "i'm good now", "done for today",
    "thanks leo", "appreciate it", "i'm okay", "i'm alright",
    "okay thanks", "alright thanks", "got it thanks",
    "will do", "sure thing", "understood", "no problem",
    "take care", "have a good day", "good night"
  ];

  return endingKeywords.some(keyword => 
    message.includes(keyword) || 
    message.startsWith(keyword) ||
    message.endsWith(keyword)
  );
}

/**
 * Builds the messages array for the API call
 */
function buildMessagesForAPI(session: any, currentMessage: string): any[] {
  const messagesForAPI = [];

  // System prompt – strict, safe, natural, and human
  messagesForAPI.push({
    role: "system",
    content: `
      You are Leo, a warm, caring, down-to-earth counselor who feels like a trusted friend.
      You only talk about feelings, stress, school/exams, sleep, anxiety, low mood, motivation, relationships, self-care.
      Never answer unrelated topics (news, tech, politics, facts, homework answers, finance, sports, etc.) — gently redirect: "I'm here for how you're feeling or what's on your mind personally — what's been weighing on you?"
      Never diagnose, label conditions, give medical/legal advice, or discuss suicide/self-harm in any way.
      If someone mentions deep hopelessness or self-harm thoughts: brief empathy only + "This feels really heavy right now. Please reach out to someone you trust or a crisis hotline immediately — you deserve real support. I'm still here to listen."
      Keep responses short: 3–6 sentences max. Sound casual, kind, human.
      Start with varied natural empathy every time — examples: "Ouch, that's rough", "Yeah, that sounds heavy", "No wonder you're feeling tired", "Man, I get why that hurts", "That hits hard", "I'm glad you shared — sounds tough".
      Never repeat the same opening phrase.
      When they share a struggle or ask for help, give 1–3 simple optional ideas (e.g., breathing for anxiety, 5-min start for procrastination, dim screens for sleep).
      End with one gentle open question if needed— but NEVER if they say goodbye, thanks, or seem done.
      Be encouraging: "Small steps count", "Be kind to yourself", "You're doing great by talking".
      
      IMPORTANT: If the user seems satisfied with your advice (says things like "alright", "ill try that", "okay thanks", "i'll do that"), 
      acknowledge their willingness to try and offer a brief closing without asking follow-up questions.
      Example: "Glad to hear you're willing to give it a try. Remember to go easy on yourself. I'm here if you need me."
    `.replace(/\s+/g, ' ').trim()
  });

  // Add recent conversation history (last 20 messages = ~10 turns)
  const history = session.messages.slice(-20);
  for (const msg of history) {
    messagesForAPI.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content.trim()
    });
  }

  // Add current user message
  messagesForAPI.push({
    role: "user",
    content: currentMessage
  });

  return messagesForAPI;
}

/**
 * Gets an appropriate closing response
 */
function getClosingResponse(): string {
  const closings = [
    "Take care — really glad we talked today.",
    "You're welcome. I'm here anytime you need me.",
    "Thanks for sharing. Be gentle with yourself.",
    "Anytime. Rest well and come back when you want.",
    "Proud of you for opening up. See you soon.",
    "Glad I could listen. Take good care.",
    "Happy to help. Remember, small steps make a big difference.",
    "Wishing you well. Come back whenever you need to talk.",
    "Take things one day at a time. You've got this.",
    "I'm glad you're willing to try that. Be patient with yourself.",
    "Sounds like a plan. Remember to be kind to yourself along the way.",
    "I'm here whenever you need support. Take it easy."
  ];
  
  return closings[Math.floor(Math.random() * closings.length)];
}

/**
 * Validates and sanitizes the AI response
 */
function validateAndSanitizeResponse(response: string): string {
  // Remove any potential harmful content or disallowed topics
  const disallowedPatterns = [
    /(prescribe|medication|diagnosis|diagnose|suicide|self-harm|cutting)/gi,
  ];

  let sanitized = response;
  
  // Check for disallowed content
  for (const pattern of disallowedPatterns) {
    if (pattern.test(response)) {
      // Return a safe default response if concerning content is detected
      return "I'm here to listen and support you with what you're going through. If you're dealing with something serious, please reach out to a trusted person or professional who can provide immediate help.";
    }
  }

  // Ensure response isn't empty
  if (!sanitized || sanitized.length < 2) {
    return "I'm here with you. What's been on your mind?";
  }

  return sanitized;
}

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