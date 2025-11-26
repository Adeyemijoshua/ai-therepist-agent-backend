// ==================== LOAD ENV FIRST ====================
import dotenv from 'dotenv';
dotenv.config();

// ==================== IMPORTS ====================
import { Request, Response } from "express";
import { ChatSession } from "../models/ChatSession";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { User } from "../models/User";
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

// ==================== INTERFACES ====================

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
      .replace(/^#+\s+/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim();

    cleaned = cleaned
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/\{.*?\}/g, '')
      .replace(/<.*?>/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\+\+\+.*?\+\+\+/g, '')
      .replace(/~~~.*?~~~/g, '')
      .replace(/["']{2,}/g, '"')
      .trim();

    return this.formatParagraphs(cleaned);
  }

  private static formatParagraphs(text: string): string {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const paragraphs: string[] = [];
    let currentParagraph: string[] = [];

    sentences.forEach((sentence, index) => {
      const trimmedSentence = sentence.trim();
      if (!trimmedSentence) return;

      currentParagraph.push(trimmedSentence);

      const shouldEndParagraph = 
        currentParagraph.length >= 2 || 
        index === sentences.length - 1;

      if (shouldEndParagraph) {
        const paragraphText = currentParagraph.join(' ');
        const finalParagraph = this.ensureProperPunctuation(paragraphText);
        paragraphs.push(finalParagraph);
        currentParagraph = [];
      }
    });

    if (currentParagraph.length > 0) {
      const finalParagraph = this.ensureProperPunctuation(currentParagraph.join(' '));
      paragraphs.push(finalParagraph);
    }

    return paragraphs.join('\n\n');
  }

  private static ensureProperPunctuation(text: string): string {
    if (!text) return text;
    const lastChar = text.charAt(text.length - 1);
    if (!['.', '!', '?'].includes(lastChar)) {
      return text + '.';
    }
    return text;
  }

  static cleanTherapeuticContent(text: string): string {
    let cleaned = this.cleanTherapeuticResponse(text);
    cleaned = cleaned
      .replace(/^(okay|well|so|now|alright),?\s*/gi, '')
      .replace(/as an ai(?: therapist)?/gi, '')
      .replace(/as a therapist/gi, '')
      .replace(/based on.*?(?:model|ai|gpt)/gi, '')
      .trim();

    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned;
  }

  static cleanJSONResponse(text: string): string {
    if (!text) return "{}";
    return text
      .replace(/```json|```/g, "")
      .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
      .trim();
  }
}

// ==================== THERAPEUTIC TECHNIQUES ====================

class TherapeuticTechniques {
  static getCBTIntervention(technique: string, emotion: string, intensity: number): string {
    const interventions: { [key: string]: string } = {
      thought_challenging: `Let's examine that thought. What evidence supports it? What challenges it?`,
      behavioral_activation: intensity >= 7 ? 
        `What's one small step you could take today?` : 
        `What activity usually helps lift your mood?`,
      cognitive_restructuring: `Let's explore alternative perspectives on this.`,
      mindfulness: `Notice these feelings without judgment. They're temporary.`,
      exposure: `What small step feels manageable right now?`,
      problem_solving: `Let's break this down. What part feels most urgent?`,
      emotional_regulation: `Name the feeling and breathe through it.`
    };
    return interventions[technique] || `Let's work with this together.`;
  }

  static generateTherapeuticHomework(technique: string, emotion: string): string {
    const homeworkPlans: { [key: string]: string } = {
      thought_challenging: `Write down one automatic thought and look for evidence.`,
      behavioral_activation: `Schedule one meaningful activity today.`,
      cognitive_restructuring: `Practice finding alternative perspectives.`,
      mindfulness: `Practice 5 minutes of mindful awareness.`,
      exposure: `Try one small step from your fear list.`,
      emotional_regulation: `Notice and name emotions as they arise.`
    };
    return homeworkPlans[technique] || `Notice thought-feeling connections this week.`;
  }
}

// ==================== PROGRESS TRACKER ====================

class ProgressTracker {
  private static userProgress = new Map();

  static updateProgress(sessionId: string, assessment: CBTAssessment) {
    if (!this.userProgress.has(sessionId)) {
      this.userProgress.set(sessionId, {
        sessionCount: 0,
        emotionalIntensityTrend: [],
        techniquesUsed: [],
      });
    }

    const progress = this.userProgress.get(sessionId);
    progress.sessionCount++;
    progress.emotionalIntensityTrend.push(assessment.emotionalResponse.intensity);
    progress.techniquesUsed.push(...assessment.recommendedCbtTechniques);
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
    };
  }
}

// ==================== HELPER FUNCTIONS ====================

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
    .slice(0, 3);
};

// ==================== CONTROLLER FUNCTIONS ====================

export const createChatSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
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
      message: "Error creating chat session",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    
    if (!req.user?.id) {
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

    // Load conversation context
    const previousMessages = session.messages.slice(-8);
    const conversationContext = previousMessages.length > 0 ? 
      `Recent conversation:\n${previousMessages.map(msg => 
        `${msg.role === 'user' ? 'Client' : 'Therapist'}: ${msg.content}`
      ).join('\n')}` : 'First session.';

    const recurringThemes = identifyThemes(session.messages);

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
      reasoning_effort: "medium",
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

    const therapeuticContext = `
    You are a compassionate CBT therapist.

    CLIENT'S CURRENT STATE:
    - Emotion: ${therapeuticAssessment.emotionalResponse.primaryEmotion}
    - Intensity: ${therapeuticAssessment.emotionalResponse.intensity}/10
    - Thoughts: ${therapeuticAssessment.automaticThoughts.join('; ')}
    - Patterns: ${therapeuticAssessment.cognitiveDistortions.join(', ')}

    APPROACH: Use ${primaryTechnique}: "${therapeuticIntervention}"
    Be empathetic, focused, and practical. Keep responses concise but meaningful.

    CLIENT: "${message}"

    Provide a therapeutic response that validates, applies CBT, and suggests practice.`;

    const responseCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: therapeuticContext }],
      model: "openai/gpt-oss-20b",
      temperature: 0.7,
      max_completion_tokens: 512,
      top_p: 1,
      stream: false,
      reasoning_effort: "medium",
      stop: null
    });

    let therapeuticResponse = responseCompletion.choices?.[0]?.message?.content?.trim() || 
      "I hear you. Let's explore this together.";

    // Clean the response
    therapeuticResponse = TextCleaner.cleanTherapeuticContent(therapeuticResponse);

    // Update progress tracking
    ProgressTracker.updateProgress(sessionId, therapeuticAssessment);

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
      message: "Technical difficulties. Please try again.",
      error: "Service temporarily unavailable",
    });
  }
};

export const getSessionHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    
    if (!req.user?.id) {
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

export const getAllChatSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.user?.id) {
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