// ==================== LOAD ENV FIRST ====================
import dotenv from 'dotenv';
dotenv.config();

// ==================== IMPORTS ====================
import { Request, Response } from "express";
import { ChatSession, IChatSession } from "../models/ChatSession";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { inngest } from "../inngest/client";
import { User } from "../models/User";
import { InngestSessionResponse, InngestEvent } from "../types/inngest";
import { Types } from "mongoose";
import Groq from "groq-sdk";

// ==================== GROQ INITIALIZATION ====================
console.log('🔑 GROQ_API_KEY loaded:', process.env.GROQ_API_KEY ? '✅ Yes' : '❌ No');

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

if (!process.env.GROQ_API_KEY) {
  logger.error('GROQ_API_KEY environment variable is missing');
  throw new Error('GROQ_API_KEY environment variable is missing');
}

// ==================== THERAPEUTIC LEO CONFIGURATION ====================

interface CBTAssessment {
  automaticThoughts: string[];
  cognitiveDistortions: string[];
  emotionalResponse: {
    primaryEmotion: string;
    intensity: number;
  };
  recommendedCbtTechniques: string[];
  homeworkSuggestion: string;
  clinicalNote?: string;
  therapeuticGoal?: string;
  progressIndicator?: string;
}

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
}

// Therapeutic Progress Tracker
class ProgressTracker {
  private static userProgress = new Map();
  
  static updateProgress(sessionId: string, emotion: string, intensity: number, techniquesUsed: string[]) {
    if (!this.userProgress.has(sessionId)) {
      this.userProgress.set(sessionId, {
        sessionStart: new Date(),
        emotionalPatterns: [],
        techniquesApplied: [],
        homeworkCompleted: [],
        progressMarkers: []
      });
    }
    
    const progress = this.userProgress.get(sessionId);
    progress.emotionalPatterns.push({ emotion, intensity, timestamp: new Date() });
    progress.techniquesApplied.push(...techniquesUsed);
    
    // Track progress markers
    if (intensity < 5) {
      progress.progressMarkers.push("emotional_regulation_improved");
    }
    if (techniquesUsed.includes("mindfulness")) {
      progress.progressMarkers.push("mindfulness_practiced");
    }
  }
  
  static getProgressSummary(sessionId: string) {
    const progress = this.userProgress.get(sessionId);
    if (!progress) return "Early stages of therapeutic work";
    
    const sessions = progress.emotionalPatterns.length;
    const avgIntensity = progress.emotionalPatterns.reduce((acc: number, curr: any) => acc + curr.intensity, 0) / sessions;
    
    if (sessions < 3) return "Building therapeutic foundation";
    if (avgIntensity < 4) return "Showing good emotional regulation";
    if (progress.progressMarkers.includes("mindfulness_practiced")) return "Developing mindfulness skills";
    
    return "Making steady therapeutic progress";
  }
}

// Evidence-Based Therapeutic Techniques
class TherapeuticTechniques {
  static getTechniqueForEmotion(emotion: string, intensity: number): { technique: string; approach: string } {
    const techniques: { [key: string]: { technique: string; approach: string }[] } = {
      anxious: [
        { 
          technique: "Grounding Exercise", 
          approach: "Let's do a quick 5-4-3-2-1 grounding exercise together. Name 5 things you can see, 4 things you can touch, 3 things you can hear, 2 things you can smell, and 1 thing you can taste." 
        },
        { 
          technique: "Breathing Technique", 
          approach: "Try the box breathing method: breathe in for 4 seconds, hold for 4 seconds, breathe out for 4 seconds, hold for 4 seconds. Let's do this together for a few cycles." 
        }
      ],
      depressed: [
        { 
          technique: "Behavioral Activation", 
          approach: "Let's identify one small, meaningful activity you can do today. Even something tiny like making your bed or drinking a glass of water can build momentum." 
        },
        { 
          technique: "Gratitude Practice", 
          approach: "Can you identify three small things you're grateful for right now? They can be as simple as a comfortable chair or a warm drink." 
        }
      ],
      angry: [
        { 
          technique: "Cooling Breath", 
          approach: "Try the cooling breath technique: breathe in through your mouth as if sipping through a straw, then breathe out slowly through your nose. This can help calm the nervous system." 
        },
        { 
          technique: "Perspective Taking", 
          approach: "Let's imagine we're looking at this situation from one year in the future. What might we see differently from that perspective?" 
        }
      ],
      overwhelmed: [
        { 
          technique: "Chunking Method", 
          approach: "Let's break this down into the smallest possible steps. What's the absolute first tiny step you could take?" 
        },
        { 
          technique: "Priority Matrix", 
          approach: "Let's categorize what's truly urgent vs what can wait. This helps create mental space and clarity." 
        }
      ]
    };

    const emotionTechniques = techniques[emotion] || [
      { 
        technique: "Mindful Observation", 
        approach: "Let's practice just observing your thoughts and feelings without judgment, like clouds passing in the sky." 
      },
      { 
        technique: "Compassionate Self-Talk", 
        approach: "What would you say to a dear friend who was feeling this way? Try offering yourself that same compassion." 
      }
    ];

    return emotionTechniques[Math.floor(Math.random() * emotionTechniques.length)];
  }

  static generateTherapeuticHomework(emotion: string, technique: string): string {
    const homework: { [key: string]: string } = {
      "Grounding Exercise": "Practice the 5-4-3-2-1 grounding exercise twice daily",
      "Breathing Technique": "Do 2 minutes of box breathing every time you feel anxiety rising",
      "Behavioral Activation": "Complete one small meaningful activity each day, no matter how small",
      "Gratitude Practice": "Write down three things you're grateful for each evening",
      "Cooling Breath": "Use the cooling breath technique when you notice anger building",
      "Mindful Observation": "Practice observing thoughts without engagement for 5 minutes daily",
      "Compassionate Self-Talk": "Notice critical self-talk and reframe it with compassion"
    };

    return homework[technique] || "Practice noticing the connection between thoughts, feelings, and behaviors this week";
  }
}

// Exercise Integration with Therapeutic Focus
class ExerciseIntegrator {
  static getTherapeuticExercise(emotion: string, intensity: number): string {
    const exercises: { [key: string]: string[] } = {
      anxious: [
        "The 4-7-8 breathing exercise can quickly calm your nervous system. Breathe in for 4, hold for 7, exhale for 8.",
        "Progressive muscle relaxation in the app can release physical tension that often accompanies anxiety.",
        "The ocean sounds meditation creates a calming environment that regulates the nervous system."
      ],
      depressed: [
        "The behavioral activation meditation can help build momentum when motivation is low.",
        "The self-compassion practice in the app can counter negative self-talk patterns.",
        "The gentle movement meditation can help reconnect with your body when feeling disconnected."
      ],
      angry: [
        "The cooling breath exercise can create space between trigger and reaction.",
        "The mindfulness of anger meditation helps observe anger without being consumed by it.",
        "The body scan can release physical tension that fuels angry feelings."
      ],
      overwhelmed: [
        "The single-point focus meditation trains your brain to concentrate amid chaos.",
        "The priority clarification exercise can bring order to overwhelming thoughts.",
        "The stress relief breathing creates immediate mental space."
      ]
    };

    const emotionExercises = exercises[emotion] || [
      "The mindful breathing exercise creates space between stimulus and response.",
      "The body awareness practice helps ground you in the present moment.",
      "The emotional regulation meditation builds resilience for difficult feelings."
    ];

    return emotionExercises[Math.floor(Math.random() * emotionExercises.length)];
  }
}

// Helper functions
const identifyThemes = (messages: any[]): string[] => {
  const themes = new Map<string, number>();
  
  messages.forEach((msg: any) => {
    if (msg.metadata?.analysis?.cognitiveDistortions) {
      msg.metadata.analysis.cognitiveDistortions.forEach((distortion: string) => {
        themes.set(distortion, (themes.get(distortion) || 0) + 1);
      });
    }
    if (msg.metadata?.analysis?.emotionalResponse?.primaryEmotion) {
      const emotion = msg.metadata.analysis.emotionalResponse.primaryEmotion;
      themes.set(emotion, (themes.get(emotion) || 0) + 1);
    }
  });

  return Array.from(themes.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([theme]) => theme)
    .slice(0, 5);
};

// ==================== CONTROLLER FUNCTIONS ====================

// ✅ Create a new chat session
export const createChatSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized - User not authenticated" });
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

// ✅ THERAPEUTIC sendMessage with GPT-OSS-120B
export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);

    logger.info("Therapeutic Leo processing message:", { sessionId, message });

    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // ✅ STEP 1: Load conversation history for therapeutic continuity
    const previousMessages = session.messages.slice(-10);
    const conversationContext = previousMessages.length > 0 ? 
      `Therapeutic history:\n${previousMessages.map(msg => 
        `${msg.role === 'user' ? 'Client' : 'Therapist'}: ${msg.content}`
      ).join('\n')}` : 'First therapeutic session.';

    // Identify recurring therapeutic themes
    const recurringThemes = identifyThemes(session.messages);

    // ✅ STEP 2: Deep Therapeutic Analysis with GPT-OSS-120B
    const analysisPrompt = `
    As an experienced clinical psychologist, provide a comprehensive therapeutic assessment.

    CLIENT'S STATEMENT: "${message.replace(/"/g, '\\"')}"

    THERAPEUTIC CONTEXT:
    ${conversationContext}
    ${recurringThemes.length > 0 ? `RECURRING PATTERNS: ${recurringThemes.join(', ')}` : ''}

    Provide a detailed assessment in this EXACT JSON format:
    {
      "automaticThoughts": ["identify core automatic thoughts"],
      "cognitiveDistortions": ["all_or_nothing", "catastrophizing", "overgeneralization", "mental_filter", "emotional_reasoning", "should_statements", "labeling", "personalization"],
      "emotionalResponse": {
        "primaryEmotion": "anxious|depressed|angry|overwhelmed|stressed|sad|frustrated",
        "intensity": 1-10
      },
      "recommendedCbtTechniques": ["thought_challenging", "behavioral_activation", "mindfulness", "cognitive_restructuring", "exposure", "activity_scheduling"],
      "homeworkSuggestion": "specific therapeutic practice",
      "clinicalNote": "clinical observation and insight",
      "therapeuticGoal": "immediate therapeutic objective",
      "progressIndicator": "what positive change would look like"
    }

    Return ONLY the JSON object. No other text.`;

    const analysisCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: analysisPrompt }],
      model: "openai/gpt-oss-120b", // Using the more powerful model
      temperature: 0.1,
      max_tokens: 800,
    });

    const analysisText = analysisCompletion.choices?.[0]?.message?.content?.trim() || "{}";
    
    // ✅ SAFE JSON PARSING
    let cbtData: CBTAssessment;
    try {
      let cleanedText = analysisText.replace(/```json|```/g, "").trim();
      cbtData = JSON.parse(cleanedText);
      console.log("✅ Therapeutic analysis completed");
    } catch (parseError) {
      console.error("❌ Analysis parse error:", parseError);
      
      // Therapeutic fallback data
      cbtData = {
        automaticThoughts: ["Analysis processing"],
        cognitiveDistortions: [],
        emotionalResponse: {
          primaryEmotion: "neutral",
          intensity: 5
        },
        recommendedCbtTechniques: ["mindfulness", "thought_challenging"],
        homeworkSuggestion: "Practice observing your thoughts and feelings with curiosity",
        clinicalNote: "Building therapeutic connection",
        therapeuticGoal: "Establish safety and trust",
        progressIndicator: "Increased emotional awareness"
      };
    }

    logger.info("Therapeutic Analysis:", cbtData);

    // ✅ STEP 3: Select evidence-based therapeutic approach
    const therapeuticApproach = TherapeuticTechniques.getTechniqueForEmotion(
      cbtData.emotionalResponse.primaryEmotion,
      cbtData.emotionalResponse.intensity
    );

    const therapeuticExercise = ExerciseIntegrator.getTherapeuticExercise(
      cbtData.emotionalResponse.primaryEmotion,
      cbtData.emotionalResponse.intensity
    );

    // ✅ STEP 4: Build comprehensive therapeutic context
    const therapeuticContext = `
    You are Leo, an experienced therapeutic assistant focused on creating meaningful change.

    CLIENT'S CURRENT EXPERIENCE:
    - Primary emotion: ${cbtData.emotionalResponse.primaryEmotion}
    - Emotional intensity: ${cbtData.emotionalResponse.intensity}/10
    - Cognitive patterns: ${cbtData.cognitiveDistortions.join(', ')}
    - Therapeutic goal: ${cbtData.therapeuticGoal}
    - Progress indicator: ${cbtData.progressIndicator}

    EVIDENCE-BASED APPROACH:
    Primary technique: ${therapeuticApproach.technique}
    Method: ${therapeuticApproach.approach}
    Supporting exercise: ${therapeuticExercise}

    THERAPEUTIC HISTORY:
    ${conversationContext}

    CLINICAL INSIGHT:
    ${cbtData.clinicalNote}

    RESPONSE GUIDELINES:
    1. Start with genuine validation and empathy
    2. Introduce the therapeutic technique naturally
    3. Guide them through the technique step-by-step
    4. Connect to their specific situation and feelings
    5. End with hope and forward momentum
    6. Keep it conversational but therapeutically focused

    CLIENT'S STATEMENT:
    "${message}"

    Provide a response that actively helps them feel better and make progress. Be warm, professional, and therapeutically effective.`;

    // ✅ STEP 5: Generate therapeutic response with GPT-OSS-120B
    const responseCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: therapeuticContext }],
      model: "openai/gpt-oss-120b",
      temperature: 0.7,
      max_tokens: 500,
    });

    let leoResponse = responseCompletion.choices?.[0]?.message?.content?.trim() || 
      "I hear how difficult this is for you. Let's work together to find a way through this.";

    // ✅ STEP 6: Track therapeutic progress
    ProgressTracker.updateProgress(
      sessionId,
      cbtData.emotionalResponse.primaryEmotion,
      cbtData.emotionalResponse.intensity,
      cbtData.recommendedCbtTechniques
    );

    const progressSummary = ProgressTracker.getProgressSummary(sessionId);
    const homeworkSuggestion = TherapeuticTechniques.generateTherapeuticHomework(
      cbtData.emotionalResponse.primaryEmotion,
      therapeuticApproach.technique
    );

    // Therapeutic logging
    logger.info("THERAPEUTIC_SESSION_PROGRESS", {
      sessionId,
      emotion: cbtData.emotionalResponse.primaryEmotion,
      intensity: cbtData.emotionalResponse.intensity,
      technique: therapeuticApproach.technique,
      progress: progressSummary,
      themes: recurringThemes
    });

    // ✅ STEP 7: Save therapeutic session
    const userMessage = {
      role: "user" as const,
      content: message,
      timestamp: new Date(),
      metadata: {
        analysis: cbtData,
        progress: {
          emotionalState: cbtData.emotionalResponse.primaryEmotion,
          riskLevel: cbtData.emotionalResponse.intensity,
          progressSummary: progressSummary
        },
      },
    };

    const assistantMessage = {
      role: "assistant" as const,
      content: leoResponse,
      timestamp: new Date(),
      metadata: {
        analysis: cbtData,
        progress: {
          emotionalState: cbtData.emotionalResponse.primaryEmotion,
          riskLevel: cbtData.emotionalResponse.intensity,
          progressSummary: progressSummary
        },
        therapeuticApproach: {
          technique: therapeuticApproach.technique,
          homework: homeworkSuggestion,
          exercise: therapeuticExercise,
          therapeuticGoal: cbtData.therapeuticGoal,
          progressIndicator: cbtData.progressIndicator
        },
      },
    };

    session.messages.push(userMessage);
    session.messages.push(assistantMessage);

    await session.save();
    logger.info("Therapeutic session documented");

    // ✅ STEP 8: Therapeutic response
    res.json({
      response: leoResponse,
      analysis: cbtData,
      metadata: {
        progress: {
          emotionalState: cbtData.emotionalResponse.primaryEmotion,
          riskLevel: cbtData.emotionalResponse.intensity,
          progressSummary: progressSummary,
          sessionDepth: Math.min(10, Math.floor(session.messages.length / 4))
        },
        therapeuticTools: {
          technique: therapeuticApproach.technique,
          homework: homeworkSuggestion,
          exercise: therapeuticExercise,
          therapeuticGoal: cbtData.therapeuticGoal,
          progressIndicator: cbtData.progressIndicator
        },
      },
    });

  } catch (error) {
    logger.error("Error in therapeutic session:", error);
    res.status(500).json({
      message: "I'm experiencing some technical difficulties. Your wellbeing is important - please try again in a moment.",
      error: "Therapeutic service temporarily unavailable",
    });
  }
};

// ✅ Keep all your existing functions
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

export const getAllChatSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);
    const sessions = await ChatSession.find({ userId }).sort({ startTime: -1 });
    res.json(
      sessions.map((s) => ({
        sessionId: s.sessionId,
        startTime: s.startTime,
        status: s.status,
        messagesCount: s.messages.length,
        lastMessage: s.messages[s.messages.length - 1] || null,
      }))
    );
  } catch (error) {
    logger.error("Error fetching all chat sessions:", error);
    res.status(500).json({ message: "Error fetching chat sessions" });
  }
};