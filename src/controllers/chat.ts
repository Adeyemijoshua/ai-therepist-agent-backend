import dotenv from 'dotenv';
dotenv.config();

import { Request, Response } from "express";
import { ChatSession, IChatSession } from "../models/ChatSession";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { User } from "../models/User";
import { Types } from "mongoose";
import Groq from "groq-sdk";

// Type-safe authenticated request
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
}

// Define types for memory objects
interface MemoryEntry {
  role: string;
  content: string;
}

interface SessionMemory {
  history: MemoryEntry[];
  techniques: string[];
  emotions: string[];
  topics: string[];
  patterns: string[];
}

interface AnalysisData {
  emotion: string;
  intensity: number;
  mainThoughts: string[];
  cognitivePatterns: string[];
  recommendedTechniques: string[];
  therapeuticFocus: string;
}

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

// Simple memory storage with proper typing
const sessionMemories = new Map<string, SessionMemory>();

// Get or create session memory with proper typing - LOADS FROM DATABASE ON RESTART
async function getSessionMemory(sessionId: string): Promise<SessionMemory> {
  // If memory exists in Map, return it
  if (sessionMemories.has(sessionId)) {
    return sessionMemories.get(sessionId)!;
  }
  
  // Otherwise, load from database
  const session = await ChatSession.findOne({ sessionId });
  const memory: SessionMemory = {
    history: [],
    techniques: [],
    emotions: [],
    topics: [],
    patterns: []
  };
  
  if (session && session.messages && session.messages.length > 0) {
    // Convert database messages to memory format
    session.messages.forEach((msg: any) => {
      if (msg.role === 'user') {
        memory.history.push({ role: 'client', content: msg.content });
      } else if (msg.role === 'assistant') {
        memory.history.push({ role: 'leo', content: msg.content });
      }
      
      // Extract metadata if available
      if (msg.metadata?.analysis) {
        const analysis = msg.metadata.analysis;
        if (analysis.emotion) memory.emotions.push(analysis.emotion);
        if (analysis.mainThoughts) memory.topics.push(...analysis.mainThoughts.slice(0, 2));
        if (analysis.cognitivePatterns) memory.patterns.push(...analysis.cognitivePatterns);
        if (analysis.recommendedTechniques && analysis.recommendedTechniques[0]) {
          memory.techniques.push(analysis.recommendedTechniques[0]);
        }
      }
    });
  }
  
  // Store in Map for future use
  sessionMemories.set(sessionId, memory);
  return memory;
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

// Send message with memory and therapy techniques
export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
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

    // Get session memory with proper typing - NOW ASYNC
    const memory = await getSessionMemory(sessionId);
    
    // Build conversation history from memory - ADDED SAFETY CHECK
    const conversationHistory = memory?.history?.slice(-8).map((entry: MemoryEntry) => 
      `${entry.role}: ${entry.content}`
    ).join('\n') || '';

    // Therapeutic Analysis
    const analysisPrompt = `
    As a therapist, analyze this message and suggest therapeutic approaches. Return JSON:

    Message: "${message}"
    ${conversationHistory ? `Recent conversation:\n${conversationHistory}` : ''}

    {
      "emotion": "anxious|sad|angry|stressed|overwhelmed|hopeless|frustrated|lonely",
      "intensity": 1-10,
      "mainThoughts": ["string"],
      "cognitivePatterns": ["all_or_nothing", "catastrophizing", "overgeneralization", "personalization"],
      "recommendedTechniques": ["thought_challenging", "validation", "mindfulness", "reframing", "exposure", "acceptance"],
      "therapeuticFocus": "emotional_support|cognitive_work|behavioral_change|skill_building"
    }`;

    const analysis = await groq.chat.completions.create({
      messages: [{ role: "user", content: analysisPrompt }],
      model: "openai/gpt-oss-20b",
      temperature: 0.2,
      max_tokens: 400,
    });

    const analysisText = analysis.choices?.[0]?.message?.content?.trim() || "{}";
    let analysisData: AnalysisData;
    try {
      analysisData = JSON.parse(analysisText.replace(/```json|```/g, "").trim());
    } catch (e) {
      analysisData = {
        emotion: "processing",
        intensity: 5,
        mainThoughts: ["Exploring thoughts"],
        cognitivePatterns: [],
        recommendedTechniques: ["active_listening"],
        therapeuticFocus: "emotional_support"
      };
    }

    // Update memory - ADDED SAFETY CHECKS
    if (memory) {
      if (analysisData.emotion) memory.emotions.push(analysisData.emotion);
      if (analysisData.mainThoughts && analysisData.mainThoughts.length > 0) {
        memory.topics.push(...analysisData.mainThoughts.slice(0, 2));
      }
      if (analysisData.cognitivePatterns && analysisData.cognitivePatterns.length > 0) {
        memory.patterns.push(...analysisData.cognitivePatterns);
      }
      if (analysisData.recommendedTechniques && analysisData.recommendedTechniques[0]) {
        memory.techniques.push(analysisData.recommendedTechniques[0]);
      }

      // Update memory history
      memory.history.push(
        { role: 'client', content: message },
        { role: 'leo', content: '' } // Will be filled after response
      );
    }

    // Generate Leo's response with memory and therapeutic approach
    const leoPrompt = `
    You are Leo, an AI therapist. Be warm, professional, and therapeutic.

    SESSION MEMORY:
    ${memory?.history && memory.history.length > 0 ? `
    We've discussed: ${[...new Set(memory.topics || [])].slice(-3).join(', ')}
    Emotional patterns: ${[...new Set(memory.emotions || [])].slice(-3).join(', ')}
    Techniques used: ${[...new Set(memory.techniques || [])].slice(-3).join(', ')}` : 
    'First session - building therapeutic relationship'}

    CURRENT ASSESSMENT:
    Emotion: ${analysisData.emotion} (${analysisData.intensity}/10 intensity)
    Therapeutic focus: ${analysisData.therapeuticFocus}
    Recommended techniques: ${analysisData.recommendedTechniques.join(', ')}

    CONVERSATION HISTORY:
    ${conversationHistory || 'Starting our therapeutic work'}

    HOW TO RESPOND AS LEO:
    1. Start with validation and empathy
    2. Apply ${analysisData.recommendedTechniques[0] || 'active listening'} technique naturally
    3. Connect to previous topics if relevant
    4. Keep response therapeutic but conversational
    5. End with one gentle question to continue exploration
    6. Be human, not robotic

    Client says: "${message}"`;

    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: leoPrompt }],
      model: "openai/gpt-oss-20b",
      temperature: 0.7,
      max_tokens: 300,
    });

    let leoResponse = response.choices?.[0]?.message?.content?.trim() || 
      "I hear what you're sharing. Could you tell me more about how that feels?";

    // Update memory with Leo's response
    if (memory && memory.history.length > 0) {
      // Update the last entry (which we added as empty)
      const lastEntry = memory.history[memory.history.length - 1];
      if (lastEntry.role === 'leo') {
        lastEntry.content = leoResponse;
      }
      
      // Keep history manageable
      if (memory.history.length > 20) {
        memory.history = memory.history.slice(-20);
      }
    }

    // Save to database
    session.messages.push({
      role: "user",
      content: message,
      timestamp: new Date(),
      metadata: { analysis: analysisData },
    } as any);

    session.messages.push({
      role: "assistant",
      content: leoResponse,
      timestamp: new Date(),
      metadata: { 
        analysis: analysisData,
        technique: analysisData.recommendedTechniques[0],
        focus: analysisData.therapeuticFocus
      },
    } as any);

    await session.save();

    res.json({
      response: leoResponse,
      analysis: analysisData,
      therapy: {
        technique: analysisData.recommendedTechniques[0],
        focus: analysisData.therapeuticFocus,
        patterns: analysisData.cognitivePatterns
      },
      memory: memory ? {
        sessionDepth: memory.history.length / 2,
        topics: [...new Set(memory.topics || [])].slice(-5),
        techniques: [...new Set(memory.techniques || [])]
      } : {
        sessionDepth: 0,
        topics: [],
        techniques: []
      }
    });

  } catch (error) {
    logger.error("Error in sendMessage:", error);
    res.status(500).json({
      message: "Error processing message",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get session history with memory
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

    // Get memory for this session - NOW ASYNC
    const memory = await getSessionMemory(sessionId);

    res.json({
      messages: session.messages,
      memory: memory ? {
        topics: [...new Set(memory.topics || [])],
        emotions: [...new Set(memory.emotions || [])],
        techniques: [...new Set(memory.techniques || [])],
        patterns: [...new Set(memory.patterns || [])],
        sessionDepth: memory.history ? memory.history.length / 2 : 0
      } : null,
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
    
    const sessionsWithMemory = await Promise.all(sessions.map(async (s) => {
      const memory = await getSessionMemory(s.sessionId);
      return {
        sessionId: s.sessionId,
        startTime: s.startTime,
        status: s.status,
        messagesCount: s.messages.length,
        lastMessage: s.messages[s.messages.length - 1] || null,
        memorySummary: memory ? {
          topics: [...new Set(memory.topics || [])].slice(-3),
          sessionDepth: memory.history ? memory.history.length / 2 : 0
        } : null
      };
    }));

    res.json(sessionsWithMemory);
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

// Get chat history
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