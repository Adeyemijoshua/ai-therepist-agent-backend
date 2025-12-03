import { Request, Response } from "express";
import { ChatSession, IChatSession } from "../models/ChatSession";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { User } from "../models/User";
import { Types } from "mongoose";
import Groq from "groq-sdk";

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

// Type-safe authenticated request
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
}

// Enhanced Memory Types
interface SessionMemory {
  // Core memory
  emotionalPatterns: string[];
  conversationThemes: string[];
  therapeuticTechniques: string[];
  progressIndicators: {
    emotionalAwareness: number;
    copingSkills: number;
    selfReflection: number;
    resilience: number;
  };
  
  // User preferences
  userPreferences: {
    name?: string;
    communicationStyle?: 'direct' | 'gentle' | 'reflective' | 'balanced';
    preferredTopics?: string[];
    avoidedTopics?: string[];
    therapeuticGoals?: string[];
  };
  
  // Session context
  context: {
    lastEmotionalState: string;
    lastTechniqueUsed: string;
    sessionProgress: number;
    trustLevel: number;
  };
}

// Enhanced Analysis Types
interface MessageAnalysis {
  emotionalState: string;
  intensity: number;
  primaryThemes: string[];
  riskLevel: number;
  recommendedApproach: string;
  specificTechniques: string[];
  cognitivePatterns: string[];
  underlyingNeeds: string[];
  therapeuticFocus: string;
  safetyCheck: boolean;
}

// Memory storage with auto-cleanup
const sessionMemories = new Map<string, SessionMemory>();

// Initialize or retrieve session memory
async function getSessionMemory(sessionId: string): Promise<SessionMemory> {
  if (sessionMemories.has(sessionId)) {
    return sessionMemories.get(sessionId)!;
  }
  
  const session = await ChatSession.findOne({ sessionId });
  const memory: SessionMemory = {
    emotionalPatterns: [],
    conversationThemes: [],
    therapeuticTechniques: [],
    progressIndicators: {
      emotionalAwareness: 0,
      copingSkills: 0,
      selfReflection: 0,
      resilience: 0
    },
    userPreferences: {},
    context: {
      lastEmotionalState: "neutral",
      lastTechniqueUsed: "validation",
      sessionProgress: 0,
      trustLevel: 50
    }
  };
  
  if (session && session.messages && session.messages.length > 0) {
    // Process historical messages to build memory
    session.messages.forEach((msg: any, index: number) => {
      // Extract analysis data
      if (msg.metadata?.analysis) {
        const analysis = msg.metadata.analysis;
        
        // Emotional patterns
        if (analysis.emotion || analysis.emotionalState) {
          const emotion = analysis.emotion || analysis.emotionalState;
          memory.emotionalPatterns.push(emotion);
          memory.context.lastEmotionalState = emotion;
        }
        
        // Themes
        if (analysis.themes || analysis.mainThoughts) {
          const themes = analysis.themes || analysis.mainThoughts || [];
          memory.conversationThemes.push(...themes.slice(0, 2));
        }
        
        // Techniques
        if (analysis.recommendedTechniques || analysis.technique) {
          const techniques = analysis.recommendedTechniques || [analysis.technique];
          memory.therapeuticTechniques.push(...techniques.slice(0, 2));
          if (analysis.technique) {
            memory.context.lastTechniqueUsed = analysis.technique;
          }
        }
        
        // Update progress
        if (analysis.progressIndicators) {
          analysis.progressIndicators.forEach((indicator: string) => {
            if (indicator.toLowerCase().includes('awareness')) memory.progressIndicators.emotionalAwareness++;
            if (indicator.toLowerCase().includes('coping')) memory.progressIndicators.copingSkills++;
            if (indicator.toLowerCase().includes('reflection')) memory.progressIndicators.selfReflection++;
            if (indicator.toLowerCase().includes('resilience')) memory.progressIndicators.resilience++;
          });
        }
      }
      
      // Extract user preferences from messages
      if (msg.role === 'user') {
        const content = msg.content.toLowerCase();
        
        // Name extraction
        const namePatterns = [
          /my name is (\w+)/i,
          /call me (\w+)/i,
          /i['`]?m (\w+)/i,
          /i am (\w+)/i
        ];
        
        for (const pattern of namePatterns) {
          const match = msg.content.match(pattern);
          if (match && !memory.userPreferences.name) {
            memory.userPreferences.name = match[1];
            break;
          }
        }
        
        // Communication style preferences
        if (content.includes('be direct') || content.includes('straightforward')) {
          memory.userPreferences.communicationStyle = 'direct';
        } else if (content.includes('be gentle') || content.includes('soft')) {
          memory.userPreferences.communicationStyle = 'gentle';
        } else if (content.includes('help me reflect')) {
          memory.userPreferences.communicationStyle = 'reflective';
        }
        
        // Goals extraction
        if (content.includes('want to') || content.includes('goal is')) {
          const goalMatch = msg.content.match(/want to (.*?)(\.|$)/i) || 
                           msg.content.match(/goal is to (.*?)(\.|$)/i);
          if (goalMatch) {
            if (!memory.userPreferences.therapeuticGoals) {
              memory.userPreferences.therapeuticGoals = [];
            }
            memory.userPreferences.therapeuticGoals.push(goalMatch[1]);
          }
        }
      }
      
      // Update trust level based on response patterns
      if (msg.role === 'assistant' && index > 0) {
        const prevMsg = session.messages[index - 1];
        if (prevMsg.role === 'user') {
          // Increase trust if user continues conversation
          memory.context.trustLevel = Math.min(100, memory.context.trustLevel + 2);
        }
      }
    });
    
    // Calculate session progress
    memory.context.sessionProgress = Math.min(100, (session.messages.length / 2) * 5);
  }
  
  sessionMemories.set(sessionId, memory);
  return memory;
}

// Enhanced message analysis with memory context
async function analyzeMessageWithMemory(message: string, memory: SessionMemory): Promise<MessageAnalysis> {
  try {
    // Build recent conversation context
    const recentThemes = [...new Set(memory.conversationThemes.slice(-3))];
    const recentEmotions = [...new Set(memory.emotionalPatterns.slice(-3))];
    const recentTechniques = [...new Set(memory.therapeuticTechniques.slice(-3))];
    
    const analysisPrompt = `
    As a therapeutic AI, analyze this message with full context. Return ONLY a valid JSON object.

    CURRENT MESSAGE: "${message}"

    SESSION CONTEXT:
    - Recent emotional patterns: ${recentEmotions.join(', ') || 'None yet'}
    - Ongoing conversation themes: ${recentThemes.join(', ') || 'Just starting'}
    - Previously used techniques: ${recentTechniques.join(', ') || 'Basic validation'}
    - Session progress: ${memory.context.sessionProgress}%
    - Trust level: ${memory.context.trustLevel}/100
    - User's name: ${memory.userPreferences.name || 'Not known yet'}
    - Communication preference: ${memory.userPreferences.communicationStyle || 'Balanced'}

    REQUIRED ANALYSIS (JSON):
    {
      "emotionalState": "specific emotion (anxious, sad, angry, overwhelmed, hopeful, reflective, confused, etc.)",
      "intensity": 1-10,
      "primaryThemes": ["max 3 key themes from message"],
      "riskLevel": 0-10 (0=no risk, 10=immediate crisis),
      "recommendedApproach": "validation/reframing/mindfulness/exploration/skill-building/problem-solving",
      "specificTechniques": ["active_listening", "cognitive_restructuring", "grounding", "perspective_taking", "self_compassion", "behavioral_activation"],
      "cognitivePatterns": ["all_or_nothing", "catastrophizing", "personalization", "overgeneralization", "emotional_reasoning", "none"],
      "underlyingNeeds": ["safety", "connection", "understanding", "autonomy", "competence", "acceptance"],
      "therapeuticFocus": "emotional_processing/cognitive_work/behavioral_change/relationship_building",
      "safetyCheck": true/false
    }

    Be clinically accurate, nuanced, and human-centered.`;

    const analysis = await groq.chat.completions.create({
      messages: [{ role: "user", content: analysisPrompt }],
      model: "llama-3.3-70b-versatile", // Using Llama 3.3 for better analysis
      temperature: 0.3,
      max_tokens: 500,
    });

    const analysisText = analysis.choices[0]?.message?.content?.trim() || "{}";
    const cleanText = analysisText.replace(/```json|```/g, "").trim();
    
    let parsedAnalysis;
    try {
      parsedAnalysis = JSON.parse(cleanText);
    } catch (e) {
      logger.error("JSON parse error:", e);
      parsedAnalysis = {};
    }

    // Update memory with new analysis
    memory.emotionalPatterns.push(parsedAnalysis.emotionalState || "neutral");
    memory.context.lastEmotionalState = parsedAnalysis.emotionalState || "neutral";
    
    if (parsedAnalysis.primaryThemes) {
      memory.conversationThemes.push(...parsedAnalysis.primaryThemes.slice(0, 2));
    }
    
    if (parsedAnalysis.specificTechniques) {
      memory.therapeuticTechniques.push(...parsedAnalysis.specificTechniques.slice(0, 2));
      memory.context.lastTechniqueUsed = parsedAnalysis.specificTechniques[0] || "validation";
    }
    
    // Update progress based on analysis
    if (parsedAnalysis.intensity && parsedAnalysis.intensity < 5) {
      memory.progressIndicators.resilience++;
    }
    if (parsedAnalysis.cognitivePatterns && parsedAnalysis.cognitivePatterns.length > 0) {
      memory.progressIndicators.selfReflection++;
    }

    // Ensure all required fields
    return {
      emotionalState: parsedAnalysis.emotionalState || "reflective",
      intensity: parsedAnalysis.intensity || 5,
      primaryThemes: parsedAnalysis.primaryThemes || ["exploring thoughts"],
      riskLevel: parsedAnalysis.riskLevel || 0,
      recommendedApproach: parsedAnalysis.recommendedApproach || "validation",
      specificTechniques: parsedAnalysis.specificTechniques || ["active_listening"],
      cognitivePatterns: parsedAnalysis.cognitivePatterns || [],
      underlyingNeeds: parsedAnalysis.underlyingNeeds || ["understanding"],
      therapeuticFocus: parsedAnalysis.therapeuticFocus || "emotional_processing",
      safetyCheck: parsedAnalysis.safetyCheck || false
    };
  } catch (error) {
    logger.error("Analysis error:", error);
    return {
      emotionalState: "neutral",
      intensity: 5,
      primaryThemes: ["exploring thoughts"],
      riskLevel: 0,
      recommendedApproach: "validation",
      specificTechniques: ["active_listening"],
      cognitivePatterns: [],
      underlyingNeeds: ["understanding"],
      therapeuticFocus: "emotional_processing",
      safetyCheck: false
    };
  }
}

// Generate human-like therapeutic response
async function generateTherapeuticResponse(
  message: string,
  analysis: MessageAnalysis,
  memory: SessionMemory
): Promise<string> {
  try {
    const userName = memory.userPreferences.name;
    const communicationStyle = memory.userPreferences.communicationStyle || 'balanced';
    
    // Determine response style based on analysis and preferences
    let responseStyle = "";
    switch (communicationStyle) {
      case 'direct':
        responseStyle = "Be direct and clear while maintaining empathy. Offer concrete observations.";
        break;
      case 'gentle':
        responseStyle = "Be gentle and nurturing. Use softer language and more validation.";
        break;
      case 'reflective':
        responseStyle = "Be thoughtful and reflective. Ask questions that encourage self-discovery.";
        break;
      default:
        responseStyle = "Balance empathy with curiosity. Be warm but professional.";
    }
    
    // Add safety considerations if needed
    if (analysis.riskLevel >= 7 || analysis.safetyCheck) {
      responseStyle += " Prioritize safety and grounding. Offer immediate support and resources if needed.";
    }

    const responsePrompt = `
    You are Leo, a compassionate AI therapist. You're having a therapeutic conversation with ${userName ? userName : 'a client'}.

    CLIENT'S CURRENT STATE:
    - Emotion: ${analysis.emotionalState} (intensity: ${analysis.intensity}/10)
    - Key themes: ${analysis.primaryThemes.join(', ')}
    - Therapeutic focus: ${analysis.therapeuticFocus}
    - Recommended approach: ${analysis.recommendedApproach}
    - Techniques to use: ${analysis.specificTechniques.join(', ')}
    - Underlying needs: ${analysis.underlyingNeeds.join(', ')}

    SESSION CONTEXT:
    - Session progress: ${memory.context.sessionProgress}%
    - Trust level: ${memory.context.trustLevel}/100
    - Last emotional state: ${memory.context.lastEmotionalState}
    - Last technique used: ${memory.context.lastTechniqueUsed}
    - Client's communication preference: ${communicationStyle}

    RECENT CONVERSATION PATTERNS:
    ${memory.conversationThemes.length > 0 ? 
      `We've been discussing: ${[...new Set(memory.conversationThemes.slice(-3))].join(', ')}` : 
      'Building initial rapport'}

    CLIENT'S MESSAGE:
    "${message}"

    HOW TO RESPOND:
    1. First, validate the emotion (${analysis.emotionalState}) authentically
    2. Apply ${analysis.specificTechniques[0]} technique naturally
    3. ${responseStyle}
    4. Connect to previous themes if relevant
    5. Keep it conversational and human - use natural pauses, varied sentence lengths
    6. ${analysis.riskLevel >= 7 ? 'Include safety resources and grounding techniques' : 'End with an open-ended question that encourages exploration'}
    7. Use ${userName ? `their name (${userName}) naturally` : 'a warm tone'}
    8. Avoid clichés and robotic language

    Write your response as if you're thinking in real time.`;

    const response = await groq.chat.completions.create({
      messages: [{ role: "user", content: responsePrompt }],
      model: "llama-3.3-70b-versatile", // Using same model for consistency
      temperature: 0.75, // Higher for more human-like variation
      max_tokens: 400,
      presence_penalty: 0.1,
      frequency_penalty: 0.1,
    });

    let therapistResponse = response.choices[0]?.message?.content?.trim() || 
      "Thank you for sharing that. I'm here with you. What's coming up for you as you reflect on this?";
    
    // Post-process for naturalness
    therapistResponse = therapistResponse
      .replace(/I understand that you are feeling/g, 'That sounds')
      .replace(/It is important to/g, 'It might help to')
      .replace(/You should/g, 'You could consider')
      .replace(/As your therapist, I/g, 'I')
      .replace(/I recommend/g, 'One approach that might be helpful');
    
    return therapistResponse;
  } catch (error) {
    logger.error("Response generation error:", error);
    return "I'm listening carefully. That sounds significant. Could you tell me more about what this experience has been like for you?";
  }
}

// Create new chat session
export const createChatSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized - User not authenticated" });
    }

    const userId = new Types.ObjectId(req.user.id);
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const sessionId = uuidv4();
    const session = new ChatSession({
      sessionId,
      userId,
      startTime: new Date(),
      status: "active",
      messages: [],
    });

    await session.save();

    // Initialize memory for this session
    await getSessionMemory(sessionId);

    res.status(201).json({
      message: "Chat session created successfully",
      sessionId: session.sessionId,
    });
  } catch (error) {
    logger.error("Error creating chat session:", error);
    res.status(500).json({
      message: "Error creating chat session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Send message with enhanced memory and therapy
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

    // Find session
    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Get or create session memory
    const memory = await getSessionMemory(sessionId);
    
    // Analyze message with memory context
    const analysis = await analyzeMessageWithMemory(message, memory);
    
    // Generate therapeutic response
    const therapistResponse = await generateTherapeuticResponse(message, analysis, memory);
    
    // Update session with new messages
    const userMessage = {
      role: "user",
      content: message,
      timestamp: new Date(),
      metadata: { analysis }
    };

    const assistantMessage = {
      role: "assistant",
      content: therapistResponse,
      timestamp: new Date(),
      metadata: {
        analysis,
        technique: analysis.specificTechniques[0],
        focus: analysis.therapeuticFocus,
        riskLevel: analysis.riskLevel
      }
    };

    session.messages.push(userMessage as any);
    session.messages.push(assistantMessage as any);
    
    // Update session progress
    (session as any).lastActivity = new Date();
    await session.save();
    
    // Update memory trust level (user continued conversation)
    memory.context.trustLevel = Math.min(100, memory.context.trustLevel + 3);
    memory.context.sessionProgress = Math.min(100, memory.context.sessionProgress + 2);

    // Prepare response with memory insights
    const recentThemes = [...new Set(memory.conversationThemes.slice(-5))];
    const emotionalTrend = [...new Set(memory.emotionalPatterns.slice(-3))];
    
    res.json({
      response: therapistResponse,
      analysis: {
        emotion: analysis.emotionalState,
        intensity: analysis.intensity,
        focus: analysis.therapeuticFocus,
        techniques: analysis.specificTechniques.slice(0, 2),
        riskLevel: analysis.riskLevel,
        safetyCheck: analysis.safetyCheck
      },
      memory: {
        sessionProgress: memory.context.sessionProgress,
        trustLevel: memory.context.trustLevel,
        recentThemes: recentThemes,
        emotionalTrend: emotionalTrend,
        progress: memory.progressIndicators
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

// Get session history with enhanced memory context
export const getSessionHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);

    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Get memory for this session
    const memory = await getSessionMemory(sessionId);

    res.json({
      messages: session.messages,
      startTime: session.startTime,
      status: session.status,
      lastActivity: (session as any).lastActivity || session.startTime,
      memory: {
        themes: [...new Set(memory.conversationThemes)],
        emotionalPatterns: [...new Set(memory.emotionalPatterns)],
        techniquesUsed: [...new Set(memory.therapeuticTechniques)],
        userPreferences: memory.userPreferences,
        progress: memory.progressIndicators,
        context: memory.context
      }
    });
  } catch (error) {
    logger.error("Error fetching session history:", error);
    res.status(500).json({ message: "Error fetching session history" });
  }
};

// Get all sessions for user with memory summaries
export const getAllChatSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);
    const sessions = await ChatSession.find({ userId }).sort({ startTime: -1 }).limit(20);
    
    const sessionsWithMemory = await Promise.all(sessions.map(async (session) => {
      const memory = await getSessionMemory(session.sessionId);
      const lastMessage = session.messages[session.messages.length - 1];
      const lastAnalysis = lastMessage?.metadata?.analysis || {};
      
      return {
        sessionId: session.sessionId,
        startTime: session.startTime,
        lastActivity: (session as any).lastActivity || session.startTime,
        status: session.status,
        messageCount: session.messages.length,
        lastMessage: lastMessage?.content?.substring(0, 150) + (lastMessage?.content?.length > 150 ? '...' : ''),
        summary: {
          currentEmotion: lastAnalysis.emotionalState || 'neutral',
          primaryTheme: lastAnalysis.primaryThemes?.[0] || 'exploration',
          progress: memory.context.sessionProgress,
          trustLevel: memory.context.trustLevel
        }
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
    if (!chatSession) {
      return res.status(404).json({ error: "Chat session not found" });
    }
    
    // Include memory in response
    const memory = await getSessionMemory(sessionId);
    
    res.json({
      ...chatSession.toObject(),
      memory: {
        summary: {
          themes: [...new Set(memory.conversationThemes.slice(-5))],
          emotionalPatterns: [...new Set(memory.emotionalPatterns.slice(-5))],
          progress: memory.context.sessionProgress
        }
      }
    });
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

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    res.json(session.messages);
  } catch (error) {
    logger.error("Error fetching chat history:", error);
    res.status(500).json({ message: "Error fetching chat history" });
  }
};

// Update user preferences
export const updateUserPreferences = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { preferences } = req.body;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const memory = await getSessionMemory(sessionId);
    
    if (preferences.name) memory.userPreferences.name = preferences.name;
    if (preferences.communicationStyle) memory.userPreferences.communicationStyle = preferences.communicationStyle;
    if (preferences.preferredTopics) memory.userPreferences.preferredTopics = preferences.preferredTopics;
    if (preferences.avoidedTopics) memory.userPreferences.avoidedTopics = preferences.avoidedTopics;
    if (preferences.therapeuticGoals) memory.userPreferences.therapeuticGoals = preferences.therapeuticGoals;
    
    // Increase trust when user shares preferences
    memory.context.trustLevel = Math.min(100, memory.context.trustLevel + 10);
    
    res.json({
      message: "Preferences updated",
      preferences: memory.userPreferences,
      trustLevel: memory.context.trustLevel
    });
  } catch (error) {
    logger.error("Error updating preferences:", error);
    res.status(500).json({ message: "Error updating preferences" });
  }
};