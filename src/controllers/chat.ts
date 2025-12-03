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
  timestamp?: Date;
}

interface SessionMemory {
  history: MemoryEntry[];
  techniques: string[];
  emotions: string[];
  topics: string[];
  patterns: string[];
  userPreferences: {
    name?: string;
    therapeuticStyle?: 'warm' | 'directive' | 'reflective' | 'supportive';
  };
}

interface AnalysisData {
  emotion: string;
  intensity: number;
  mainThoughts: string[];
  cognitivePatterns: string[];
  recommendedTechniques: string[];
  therapeuticFocus: string;
  underlyingNeeds: string[];
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
    patterns: [],
    userPreferences: {}
  };
  
  if (session && session.messages && session.messages.length > 0) {
    // Convert database messages to memory format
    session.messages.forEach((msg: any) => {
      if (msg.role === 'user') {
        memory.history.push({ 
          role: 'client', 
          content: msg.content,
          timestamp: msg.timestamp 
        });
      } else if (msg.role === 'assistant') {
        memory.history.push({ 
          role: 'therapist', 
          content: msg.content,
          timestamp: msg.timestamp 
        });
      }
      
      // Extract metadata if available
      if (msg.metadata?.analysis) {
        const analysis = msg.metadata.analysis;
        if (analysis.emotion && typeof analysis.emotion === 'string') {
          memory.emotions.push(analysis.emotion);
        }
        if (Array.isArray(analysis.mainThoughts) && analysis.mainThoughts.length > 0) {
          memory.topics.push(...analysis.mainThoughts.slice(0, 2));
        }
        if (Array.isArray(analysis.cognitivePatterns) && analysis.cognitivePatterns.length > 0) {
          memory.patterns.push(...analysis.cognitivePatterns);
        }
        if (Array.isArray(analysis.recommendedTechniques) && analysis.recommendedTechniques[0]) {
          memory.techniques.push(analysis.recommendedTechniques[0]);
        }
      }
    });
    
    // Extract user name if mentioned
    const userNameRegex = /(?:my name is|call me|I'm|I am) ([A-Za-z]+)/i;
    const allMessages = session.messages.map((m: any) => m.content).join(' ');
    const nameMatch = allMessages.match(userNameRegex);
    if (nameMatch && !memory.userPreferences.name) {
      memory.userPreferences.name = nameMatch[1];
    }
  }
  
  // Store in Map for future use
  sessionMemories.set(sessionId, memory);
  return memory;
}

// Enhanced therapeutic analysis
async function analyzeMessage(message: string, memory: SessionMemory): Promise<AnalysisData> {
  try {
    const recentHistory = memory.history.slice(-4).map(entry => 
      `${entry.role}: ${entry.content}`
    ).join('\n');
    
    const analysisPrompt = `
    As an experienced therapist, analyze this client message considering their emotional state, thought patterns, and therapeutic needs.
    
    CLIENT MESSAGE: "${message}"
    
    ${recentHistory ? `RECENT CONVERSATION:\n${recentHistory}` : 'First interaction with client.'}
    
    Provide a nuanced analysis in JSON format:
    
    {
      "emotion": "Primary emotion (be specific: anxious, sad, angry, stressed, overwhelmed, hopeless, frustrated, lonely, ashamed, guilty, confused, etc.)",
      "intensity": 1-10,
      "mainThoughts": ["Identify 1-3 core thoughts or themes in the message"],
      "cognitivePatterns": ["Identify cognitive distortions if present (catastrophizing, black-and-white thinking, overgeneralization, personalization, mind-reading, emotional reasoning)"],
      "recommendedTechniques": ["Choose 2-3 therapeutic techniques appropriate for this moment (active_listening, validation, gentle_challenge, mindfulness, reframing, perspective_taking, normalization, self-compassion, grounding)"],
      "therapeuticFocus": "Current therapeutic need (emotional_validation, cognitive_restructuring, behavioral_activation, self-compassion, boundary_setting, problem_solving, exploration)",
      "underlyingNeeds": ["What underlying needs might be present? (connection, understanding, safety, control, meaning, acceptance)"]
    }
    
    Be nuanced and human in your analysis. If uncertain, acknowledge complexity.`;
    
    const analysis = await groq.chat.completions.create({
      messages: [{ role: "user", content: analysisPrompt }],
      model: "qwen-2.5-32b", // Using Qwen model as requested
      temperature: 0.3,
      max_tokens: 500,
    });

    const analysisText = analysis.choices?.[0]?.message?.content?.trim() || "{}";
    
    try {
      const parsed = JSON.parse(analysisText.replace(/```json|```/g, "").trim());
      
      // Safely extract all fields with proper type checking and defaults
      return {
        emotion: typeof parsed.emotion === 'string' ? parsed.emotion : "reflective",
        intensity: typeof parsed.intensity === 'number' && parsed.intensity >= 1 && parsed.intensity <= 10 
          ? parsed.intensity 
          : Math.min(5 + Math.floor(Math.random() * 3), 10),
        mainThoughts: Array.isArray(parsed.mainThoughts) && parsed.mainThoughts.length > 0
          ? parsed.mainThoughts 
          : ["Exploring thoughts and feelings"],
        cognitivePatterns: Array.isArray(parsed.cognitivePatterns) ? parsed.cognitivePatterns : [],
        recommendedTechniques: Array.isArray(parsed.recommendedTechniques) && parsed.recommendedTechniques.length > 0
          ? parsed.recommendedTechniques 
          : ["active_listening", "validation"],
        therapeuticFocus: typeof parsed.therapeuticFocus === 'string' ? parsed.therapeuticFocus : "emotional_validation",
        underlyingNeeds: Array.isArray(parsed.underlyingNeeds) && parsed.underlyingNeeds.length > 0
          ? parsed.underlyingNeeds
          : ["understanding", "support"]
      };
    } catch (e) {
      console.error("JSON parsing error in analyzeMessage:", e);
      // Fallback to nuanced defaults
      return {
        emotion: "reflective",
        intensity: 5,
        mainThoughts: ["Exploring thoughts and feelings"],
        cognitivePatterns: [],
        recommendedTechniques: ["active_listening", "validation"],
        therapeuticFocus: "emotional_validation",
        underlyingNeeds: ["understanding", "support"]
      };
    }
  } catch (error) {
    logger.error("Error in analysis:", error);
    return {
      emotion: "reflective",
      intensity: 5,
      mainThoughts: ["Exploring thoughts and feelings"],
      cognitivePatterns: [],
      recommendedTechniques: ["active_listening", "validation"],
      therapeuticFocus: "emotional_validation",
      underlyingNeeds: ["understanding", "support"]
    };
  }
}

// Generate human-like therapist response
async function generateTherapistResponse(
  message: string, 
  memory: SessionMemory, 
  analysis: AnalysisData,
  userName?: string
): Promise<string> {
  try {
    // Prepare conversation context
    const recentHistory = memory.history.slice(-6).map(entry => 
      `${entry.role === 'client' ? 'Client' : 'Therapist'}: ${entry.content}`
    ).join('\n\n');
    
    // Get therapist personality based on interaction history
    const therapistStyle = determineTherapistStyle(memory, analysis);
    
    // Create therapeutic response guidelines
    const guidelines = createTherapeuticGuidelines(analysis, therapistStyle);
    
    const responsePrompt = `
You are Leo, a compassionate and skilled therapist having a therapeutic conversation with ${userName ? userName : 'a client'}.

YOUR THERAPEUTIC APPROACH:
${guidelines.approach}

CLIENT'S CURRENT STATE:
- Primary emotion: ${analysis.emotion} (intensity: ${analysis.intensity}/10)
- Therapeutic focus: ${analysis.therapeuticFocus}
- Key techniques to use: ${analysis.recommendedTechniques.join(', ')}
- Underlying needs: ${analysis.underlyingNeeds.join(', ')}

CONVERSATION HISTORY:
${recentHistory || 'This is the beginning of the session.'}

CLIENT'S LATEST MESSAGE:
"${message}"

HOW TO RESPOND AS LEO:
1. Be genuinely empathetic and human - use natural language, varied sentence lengths
2. ${guidelines.responseStyle}
3. Show you've been listening by referencing previous topics if relevant
4. Use the client's name ${userName ? `(${userName})` : 'if you know it'} naturally
5. Balance validation with gentle curiosity
6. End with an open-ended question that encourages deeper exploration, but only if it flows naturally

Write your response as if you're thinking in real time. Be warm, professional, and avoid clichés.`;

    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: responsePrompt }],
      model: "qwen-2.5-32b", // Using Qwen model as requested
      temperature: 0.75,
      max_tokens: 350,
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
    });

    let therapistResponse = response.choices?.[0]?.message?.content?.trim() || 
      "I'm here with you. Take your time... What's coming up for you as you share this?";
    
    // Post-process for naturalness
    therapistResponse = enhanceNaturalness(therapistResponse, therapistStyle);
    
    return therapistResponse;
  } catch (error) {
    logger.error("Error generating therapist response:", error);
    return "I'm listening carefully. That sounds really significant. Can you tell me more about what this experience has been like for you?";
  }
}

// Determine therapist style based on client interaction
function determineTherapistStyle(memory: SessionMemory, analysis: AnalysisData): 'warm' | 'reflective' | 'directive' | 'supportive' {
  if (memory.history.length < 3) return 'warm'; // Start warm
  
  // Analyze client patterns to adjust style
  const highIntensity = analysis.intensity >= 7;
  const hasPatterns = analysis.cognitivePatterns.length > 0;
  const isDistressed = ['anxious', 'overwhelmed', 'hopeless'].includes(analysis.emotion);
  
  if (highIntensity && isDistressed) return 'supportive';
  if (hasPatterns && memory.history.length > 5) return 'reflective';
  if (memory.userPreferences.therapeuticStyle) {
    return memory.userPreferences.therapeuticStyle;
  }
  
  return 'warm';
}

// Create therapeutic guidelines based on style and analysis
function createTherapeuticGuidelines(analysis: AnalysisData, style: string): { approach: string; responseStyle: string } {
  const guidelines: Record<string, { approach: string; responseStyle: string }> = {
    warm: {
      approach: "Warm, nurturing, and gentle. Focus on building safety and trust. Use affirming language and validate emotions deeply.",
      responseStyle: "Use warm validation first, then gentle curiosity. Be particularly gentle with difficult emotions."
    },
    reflective: {
      approach: "Thoughtful, curious, and insightful. Help the client notice patterns and gain self-awareness. Use reflective questions.",
      responseStyle: "Reflect back what you're hearing, then offer a gentle observation or question for exploration."
    },
    directive: {
      approach: "Structured, focused, and goal-oriented. Help develop practical strategies while maintaining empathy.",
      responseStyle: "Be clear and direct while maintaining empathy. Offer specific suggestions or perspectives."
    },
    supportive: {
      approach: "Calm, steady, and containing. Focus on emotional regulation and safety first.",
      responseStyle: "Use calming language. Acknowledge difficulty while offering hope. Focus on present safety."
    }
  };
  
  return guidelines[style] || guidelines.warm;
}

// Enhance response naturalness
function enhanceNaturalness(response: string, style: string): string {
  // Remove overly formal or robotic phrasing
  let naturalResponse = response
    .replace(/I understand that you are feeling/g, 'That sounds')
    .replace(/It is important to/g, 'It might help to')
    .replace(/You should/g, 'You might consider')
    .replace(/I recommend/g, 'One thing that could be helpful')
    .replace(/As your therapist, I/g, 'I');

  return naturalResponse;
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

// Send message with enhanced therapeutic conversation
export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ message: "Message is required and must be a string" });
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

    // Get session memory
    const memory = await getSessionMemory(sessionId);
    
    // Perform therapeutic analysis
    const analysis = await analyzeMessage(message, memory);
    
    // Update memory with analysis
    if (memory) {
      if (analysis.emotion && typeof analysis.emotion === 'string') {
        memory.emotions.push(analysis.emotion);
      }
      
      if (Array.isArray(analysis.mainThoughts) && analysis.mainThoughts.length > 0) {
        memory.topics.push(...analysis.mainThoughts.slice(0, 2));
      }
      
      if (Array.isArray(analysis.cognitivePatterns) && analysis.cognitivePatterns.length > 0) {
        memory.patterns.push(...analysis.cognitivePatterns);
      }
      
      if (Array.isArray(analysis.recommendedTechniques) && analysis.recommendedTechniques.length > 0) {
        memory.techniques.push(...analysis.recommendedTechniques.slice(0, 2));
      }

      // Update memory history
      memory.history.push({
        role: 'client',
        content: message,
        timestamp: new Date()
      });
    }

    // Generate therapist response
    const therapistResponse = await generateTherapistResponse(
      message, 
      memory, 
      analysis,
      memory.userPreferences.name
    );
    
    // Update memory with therapist response
    if (memory) {
      memory.history.push({
        role: 'therapist',
        content: therapistResponse,
        timestamp: new Date()
      });
      
      // Keep memory manageable but preserve important context
      if (memory.history.length > 25) {
        memory.history = memory.history.slice(-25);
      }
    }

    // Save to database
    const userMessage = {
      role: "user",
      content: message,
      timestamp: new Date(),
      metadata: { 
        analysis: analysis,
        sentiment: analysis.emotion,
        intensity: analysis.intensity
      },
    };

    const therapistMessage = {
      role: "assistant",
      content: therapistResponse,
      timestamp: new Date(),
      metadata: { 
        analysis: analysis,
        technique: analysis.recommendedTechniques[0],
        focus: analysis.therapeuticFocus,
        style: determineTherapistStyle(memory, analysis)
      },
    };

    session.messages.push(userMessage as any);
    session.messages.push(therapistMessage as any);
    
    // Update session last activity
    (session as any).lastActivity = new Date();
    await session.save();

    // Prepare memory summary for response
    const uniqueTopics = [...new Set(memory.topics || [])].slice(-5);
    const recentEmotions = [...new Set(memory.emotions.slice(-5) || [])];
    const techniquesUsed = [...new Set(memory.techniques.slice(-5) || [])];

    res.json({
      response: therapistResponse,
      analysis: {
        emotion: analysis.emotion,
        intensity: analysis.intensity,
        therapeuticFocus: analysis.therapeuticFocus,
        techniques: analysis.recommendedTechniques.slice(0, 2)
      },
      conversation: {
        depth: Math.min(Math.floor(memory.history.length / 2), 10),
        continuity: uniqueTopics.length > 0 ? "high" : "developing"
      },
      memory: {
        topics: uniqueTopics,
        recentEmotions: recentEmotions,
        techniques: techniquesUsed,
        sessionProgress: `${memory.history.length} exchanges`
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

    // Get memory for this session
    const memory = await getSessionMemory(sessionId);

    res.json({
      messages: session.messages,
      memory: memory ? {
        topics: [...new Set(memory.topics || [])],
        emotions: [...new Set(memory.emotions || [])],
        techniques: [...new Set(memory.techniques || [])],
        patterns: [...new Set(memory.patterns || [])],
        userPreferences: memory.userPreferences,
        sessionDepth: memory.history ? memory.history.length / 2 : 0
      } : null,
      startTime: session.startTime,
      lastActivity: (session as any).lastActivity || session.startTime,
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
      const lastMessage = s.messages[s.messages.length - 1];
      const sentiment = (lastMessage as any)?.metadata?.sentiment || 'neutral';
      
      return {
        sessionId: s.sessionId,
        startTime: s.startTime,
        lastActivity: (s as any).lastActivity || s.startTime,
        status: s.status,
        messagesCount: s.messages.length,
        lastMessage: lastMessage?.content?.substring(0, 100) + (lastMessage?.content?.length > 100 ? '...' : ''),
        sentiment: sentiment,
        memorySummary: memory ? {
          topics: [...new Set(memory.topics || [])].slice(-3),
          sessionDepth: memory.history ? memory.history.length / 2 : 0,
          therapeuticFocus: (lastMessage as any)?.metadata?.focus || 'exploration'
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

// Update therapeutic style preference
export const updateTherapeuticStyle = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { style } = req.body;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const validStyles = ['warm', 'reflective', 'directive', 'supportive'];
    if (!validStyles.includes(style)) {
      return res.status(400).json({ message: "Invalid therapeutic style" });
    }
    
    const memory = await getSessionMemory(sessionId);
    if (memory) {
      memory.userPreferences.therapeuticStyle = style as any;
    }
    
    res.json({ 
      message: "Therapeutic style updated",
      style: style 
    });
  } catch (error) {
    logger.error("Error updating therapeutic style:", error);
    res.status(500).json({ message: "Error updating style" });
  }
};

// Delete session and clean up memory
export const deleteChatSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);
    const session = await ChatSession.findOne({ sessionId, userId });
    
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    
    // Remove from memory map
    sessionMemories.delete(sessionId);
    
    // Delete from database
    await ChatSession.deleteOne({ _id: session._id });
    
    res.json({ message: "Session deleted successfully" });
  } catch (error) {
    logger.error("Error deleting chat session:", error);
    res.status(500).json({ message: "Error deleting session" });
  }
};