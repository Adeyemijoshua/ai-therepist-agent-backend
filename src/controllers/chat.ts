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

// ==================== ENHANCED THERAPEUTIC LEO ====================

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
  progressIndicators?: string[];
  safetyAssessment?: {
    riskLevel: number;
    needsImmediateAttention: boolean;
  };
}

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
}

// ==================== TEXT CLEANING UTILITY ====================

class TextCleaner {
  static cleanTherapeuticResponse(text: string): string {
    if (!text) return "I'm here to listen. Could you tell me more about what you're experiencing?";

    let cleaned = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\|.*?\||\-+\|/g, '')
      .replace(/Question\s*\|\s*What you might discover/g, '')
      .replace(/[-=]+\s*/g, '')
      .replace(/Validation & Empathy|Thought‑Challenging|Let’s Explore Together/g, '')
      .replace(/---.*?---/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    const sentences = cleaned.split(/(?<=[.!?])\s+/);
    const paragraphs: string[] = [];
    let currentParagraph: string[] = [];

    sentences.forEach((sentence, index) => {
      const trimmed = sentence.trim();
      if (!trimmed || trimmed.length < 10) return;

      currentParagraph.push(trimmed);

      if (currentParagraph.length >= 2 || index === sentences.length - 1) {
        const paragraphText = currentParagraph.join(' ');
        paragraphs.push(this.ensureProperPunctuation(paragraphText));
        currentParagraph = [];
      }
    });

    let result = paragraphs.join('\n\n');

    result = result
      .replace(/\s*[|-]\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/(\n\s*){3,}/g, '\n\n')
      .trim();

    return result;
  }

  private static ensureProperPunctuation(text: string): string {
    if (!text) return text;
    const lastChar = text.charAt(text.length - 1);
    if (!['.', '!', '?', '"', "'"].includes(lastChar)) {
      return text + '.';
    }
    return text;
  }

  static cleanTherapeuticContent(text: string): string {
    let cleaned = this.cleanTherapeuticResponse(text);
    
    cleaned = cleaned
      .replace(/^(hi there|hello|thanks for reaching out|welcome).*?\./gi, '')
      .replace(/as an ai therapist|as a therapist|as your therapist/gi, '')
      .replace(/based on.*?model|according to.*?therapy/gi, '')
      .replace(/\b(let me|i'll|i will|we can|we will)\s+(start by|begin by|try to|attempt to)/gi, '')
      .replace(/\b(now|so|well|alright),?\s*/gi, '')
      .trim();

    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned || "I appreciate you sharing that with me. How does that feel to talk about?";
  }

  static cleanJSONResponse(text: string): string {
    if (!text) return "{}";
    return text
      .replace(/```json|```/g, "")
      .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
      .trim();
  }
}

// ==================== ENHANCED THERAPEUTIC TECHNIQUES ====================

class TherapeuticTechniques {
  static getCBTIntervention(technique: string, emotion: string, intensity: number): string {
    const interventions: { [key: string]: string } = {
      thought_challenging: this.getThoughtChallengingApproach(emotion, intensity),
      behavioral_activation: this.getBehavioralActivationPlan(intensity),
      cognitive_restructuring: this.getCognitiveRestructuringMethod(emotion),
      mindfulness: this.getMindfulnessPractice(emotion, intensity),
      exposure: this.getExposureGuidance(intensity),
      problem_solving: this.getProblemSolvingFramework(),
      emotional_regulation: this.getEmotionalRegulationSkills(emotion)
    };
    return interventions[technique] || this.getDefaultTherapeuticApproach();
  }

  private static getThoughtChallengingApproach(emotion: string, intensity: number): string {
    const approaches = {
      anxious: "What makes that anxious thought feel so true right now?",
      depressed: "That thought seems really heavy. What might be another way to look at this?",
      angry: "That thought carries a lot of energy. What values might be underneath it?"
    };
    return approaches[emotion as keyof typeof approaches] || "Let's examine that thought together.";
  }

  private static getBehavioralActivationPlan(intensity: number): string {
    if (intensity >= 8) return "What's one small thing you could do in the next hour that might help?";
    if (intensity >= 5) return "What meaningful activity could you try today, even if you don't feel like it?";
    return "What activities usually bring you satisfaction?";
  }

  private static getCognitiveRestructuringMethod(emotion: string): string {
    return "I wonder if there might be another perspective here.";
  }

  private static getMindfulnessPractice(emotion: string, intensity: number): string {
    return "Just notice these feelings without fighting them.";
  }

  private static getExposureGuidance(intensity: number): string {
    return "What small step feels manageable right now?";
  }

  private static getProblemSolvingFramework(): string {
    return "What part of this feels most overwhelming?";
  }

  private static getEmotionalRegulationSkills(emotion: string): string {
    return "Take a moment to breathe with those feelings.";
  }

  private static getDefaultTherapeuticApproach(): string {
    return "Let's work with this together.";
  }

  static generateTherapeuticHomework(technique: string, emotion: string): string {
    const homeworkPlans: { [key: string]: string } = {
      thought_challenging: "Notice one automatic thought and question it gently.",
      behavioral_activation: "Try one small meaningful activity.",
      cognitive_restructuring: "Practice seeing situations differently.",
      mindfulness: "Take 5 minutes to notice thoughts without judgment.",
      exposure: "Take one small step toward something you've been avoiding.",
      emotional_regulation: "Practice naming feelings as they come up."
    };
    return homeworkPlans[technique] || "Notice how thoughts affect your mood.";
  }

  static getProgressTrackingQuestion(sessionNumber: number): string {
    const questions = [
      "What's one small change you've noticed?",
      "How has your understanding shifted?",
      "What's been most helpful so far?",
      "Where are you noticing progress?",
      "What would you like to focus on?"
    ];
    return questions[Math.min(sessionNumber - 1, questions.length - 1)];
  }
}

// Progress Tracking System
class ProgressTracker {
  private static userProgress = new Map();

  static updateProgress(sessionId: string, assessment: CBTAssessment, responseLength: number) {
    if (!this.userProgress.has(sessionId)) {
      this.userProgress.set(sessionId, {
        sessionCount: 0,
        emotionalIntensityTrend: [],
        techniquesUsed: [],
        homeworkCompletion: [],
        insightMoments: 0,
        lastAssessment: null
      });
    }

    const progress = this.userProgress.get(sessionId);
    progress.sessionCount++;
    progress.emotionalIntensityTrend.push(assessment.emotionalResponse.intensity);
    progress.techniquesUsed.push(...assessment.recommendedCbtTechniques);
    progress.lastAssessment = assessment;

    if (responseLength > 150 && assessment.emotionalResponse.intensity < 7) {
      progress.insightMoments++;
    }
  }

  static getProgressSummary(sessionId: string) {
    const progress = this.userProgress.get(sessionId);
    if (!progress) return null;

    const avgIntensity = progress.emotionalIntensityTrend.reduce((a: number, b: number) => a + b, 0) / progress.emotionalIntensityTrend.length;
    const techniqueVariety = new Set(progress.techniquesUsed).size;

    return {
      sessionsCompleted: progress.sessionCount,
      averageEmotionalIntensity: Math.round(avgIntensity * 10) / 10,
      techniquesExperienced: techniqueVariety,
      insightMoments: progress.insightMoments,
      trend: progress.emotionalIntensityTrend[progress.emotionalIntensityTrend.length - 1] < progress.emotionalIntensityTrend[0] ? 'improving' : 'stable'
    };
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

export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    
    const userId = new Types.ObjectId(req.user.id);

    logger.info("Therapeutic processing:", { sessionId, message });

    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Load therapeutic history
    const previousMessages = session.messages.slice(-10);
    const conversationContext = previousMessages.length > 0 ? 
      `Recent conversation:\n${previousMessages.map(msg => 
        `${msg.role === 'user' ? 'Client' : 'Therapist'}: ${msg.content}`
      ).join('\n')}` : 'First session.';

    const recurringThemes = identifyThemes(session.messages);
    const progressSummary = ProgressTracker.getProgressSummary(sessionId);

    // Therapeutic Assessment
    const assessmentPrompt = `
    As a CBT therapist, provide assessment. Return ONLY valid JSON:

    CLIENT: "${message.replace(/"/g, '\\"')}"

    CONTEXT: ${conversationContext}
    ${recurringThemes.length > 0 ? `THEMES: ${recurringThemes.join(', ')}` : ''}

    ASSESSMENT:
    {
      "automaticThoughts": ["specific thoughts"],
      "cognitiveDistortions": ["all_or_nothing", "catastrophizing", "overgeneralization", "mental_filter", "emotional_reasoning"],
      "emotionalResponse": {
        "primaryEmotion": "anxious|depressed|angry|overwhelmed|stressed",
        "intensity": 1-10
      },
      "recommendedCbtTechniques": ["thought_challenging", "behavioral_activation", "cognitive_restructuring", "mindfulness"],
      "homeworkSuggestion": "brief practice suggestion",
      "clinicalNote": "therapeutic direction"
    }

    Return ONLY JSON.`;

    const assessmentCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: assessmentPrompt }],
      model: "openai/gpt-oss-20b",
      temperature: 0.1,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: false,
      stop: null
    });

    const assessmentText = assessmentCompletion.choices?.[0]?.message?.content?.trim() || "{}";
    
    let therapeuticAssessment: CBTAssessment;
    try {
      let cleanedText = TextCleaner.cleanJSONResponse(assessmentText);
      therapeuticAssessment = JSON.parse(cleanedText);
    } catch (parseError) {
      therapeuticAssessment = {
        automaticThoughts: ["Processing thoughts"],
        cognitiveDistortions: [],
        emotionalResponse: {
          primaryEmotion: "neutral",
          intensity: 5
        },
        recommendedCbtTechniques: ["thought_challenging", "mindfulness"],
        homeworkSuggestion: "Notice thoughts and feelings",
        clinicalNote: "Continuing support"
      };
    }

    // Generate therapeutic response
    const primaryTechnique = therapeuticAssessment.recommendedCbtTechniques[0] || "thought_challenging";
    const therapeuticIntervention = TherapeuticTechniques.getCBTIntervention(
      primaryTechnique,
      therapeuticAssessment.emotionalResponse.primaryEmotion,
      therapeuticAssessment.emotionalResponse.intensity
    );

    const homeworkSuggestion = TherapeuticTechniques.generateTherapeuticHomework(
      primaryTechnique,
      therapeuticAssessment.emotionalResponse.primaryEmotion
    );

    // FIXED: Properly reference variables in the template string
    const therapeuticContext = `
You are a compassionate, authentic therapist. Speak naturally and conversationally.

Client is feeling ${therapeuticAssessment.emotionalResponse.primaryEmotion} at level ${therapeuticAssessment.emotionalResponse.intensity}/10.
They mentioned: "${message}"

Key thoughts: ${therapeuticAssessment.automaticThoughts.slice(0, 2).join('; ')}
Patterns: ${therapeuticAssessment.cognitiveDistortions.slice(0, 3).join(', ')}

Focus on: ${therapeuticIntervention}

Respond naturally:
- Be warm and genuine
- Keep it conversational
- Focus on one main point
- Use simple, clear language
- Show empathy without over-explaining
- 2-3 paragraphs maximum

Avoid:
- Long explanations
- Technical terms
- Multiple techniques at once
- Structured formats like tables
- Markdown formatting
- "As a therapist" introductions
`;

    const responseCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: therapeuticContext }],
      model: "openai/gpt-oss-20b",
      temperature: 0.8,
      max_completion_tokens: 300,
      top_p: 1,
      stream: false,
      stop: null
    });

    let therapeuticResponse = responseCompletion.choices?.[0]?.message?.content?.trim() || 
      "I hear you. Let's explore this together.";

    // Clean the response
    therapeuticResponse = TextCleaner.cleanTherapeuticContent(therapeuticResponse);

    // Update progress tracking
    ProgressTracker.updateProgress(sessionId, therapeuticAssessment, therapeuticResponse.length);

    // Save messages
    const userMessage = {
      role: "user" as const,
      content: message,
      timestamp: new Date(),
      metadata: {
        analysis: therapeuticAssessment,
      },
    };

    const assistantMessage = {
      role: "assistant" as const,
      content: therapeuticResponse,
      timestamp: new Date(),
      metadata: {
        analysis: therapeuticAssessment,
        therapeuticApproach: {
          technique: primaryTechnique,
          homework: homeworkSuggestion,
        },
      },
    };

    session.messages.push(userMessage);
    session.messages.push(assistantMessage);
    await session.save();

    const currentProgress = ProgressTracker.getProgressSummary(sessionId);

    res.json({
      response: therapeuticResponse,
      analysis: therapeuticAssessment,
      progress: currentProgress,
      metadata: {
        technique: primaryTechnique,
        homework: homeworkSuggestion,
        emotionalIntensity: therapeuticAssessment.emotionalResponse.intensity,
      },
    });

  } catch (error) {
    logger.error("Error in therapeutic session:", error);
    res.status(500).json({
      message: "I'm experiencing some technical difficulties. Please try again.",
      error: "Service temporarily unavailable",
    });
  }
};

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

    const progress = ProgressTracker.getProgressSummary(sessionId);

    res.json({
      messages: session.messages,
      startTime: session.startTime,
      status: session.status,
      progressSummary: progress
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
    
    const sessionsWithProgress = sessions.map((s) => ({
      sessionId: s.sessionId,
      startTime: s.startTime,
      status: s.status,
      messagesCount: s.messages.length,
      lastMessage: s.messages[s.messages.length - 1] || null,
      progress: ProgressTracker.getProgressSummary(s.sessionId)
    }));

    res.json(sessionsWithProgress);
  } catch (error) {
    logger.error("Error fetching all chat sessions:", error);
    res.status(500).json({ message: "Error fetching chat sessions" });
  }
};