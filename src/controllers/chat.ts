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

// Enhanced CBT Techniques with Therapeutic Depth
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
      anxious: `Let's gently examine that anxious thought. What's the actual evidence for it? What's the evidence against it? What would you tell a friend who had this thought?`,
      depressed: `That thought seems really heavy. Let's look at it from different angles. Is there any evidence that contradicts this perspective?`,
      angry: `That thought seems to carry a lot of energy. Let's explore what values or boundaries might be underneath it.`
    };
    return approaches[emotion as keyof typeof approaches] || `Let's examine that thought together. What makes it feel true? What might challenge it?`;
  }

  private static getBehavioralActivationPlan(intensity: number): string {
    if (intensity >= 8) return `Even a tiny step can help. What's one small thing you could do in the next hour that might bring a moment of relief?`;
    if (intensity >= 5) return `Sometimes action creates motivation. What's one meaningful activity you could try today, even if you don't feel like it?`;
    return `What activities usually bring you satisfaction? How could we build more of those into your days?`;
  }

  private static getCognitiveRestructuringMethod(emotion: string): string {
    return `I wonder if there might be alternative ways to view this situation. What would a compassionate observer notice?`;
  }

  private static getMindfulnessPractice(emotion: string, intensity: number): string {
    return `Let's practice just noticing these ${emotion} feelings without fighting them. They're visitors, not permanent residents.`;
  }

  private static getExposureGuidance(intensity: number): string {
    return `What's one small step you could take toward facing this? We can start with whatever feels barely manageable.`;
  }

  private static getProblemSolvingFramework(): string {
    return `Let's break this down together. What parts feel most overwhelming? What's one piece we could address right now?`;
  }

  private static getEmotionalRegulationSkills(emotion: string): string {
    return `When ${emotion} feelings get intense, sometimes naming them and breathing through them can create space.`;
  }

  private static getDefaultTherapeuticApproach(): string {
    return `Let's work with this together in a way that feels helpful right now.`;
  }

  static generateTherapeuticHomework(technique: string, emotion: string): string {
    const homeworkPlans: { [key: string]: string } = {
      thought_challenging: `Practice noticing automatic thoughts and gently questioning them. Write down one thought and look for evidence for and against it.`,
      behavioral_activation: `Schedule one small, meaningful activity each day. Notice how your mood shifts, even slightly, after doing it.`,
      cognitive_restructuring: `Keep a thought record - when negative thoughts come up, practice generating alternative perspectives.`,
      mindfulness: `Practice 5-10 minutes of mindful awareness daily. Just notice thoughts and feelings without judgment.`,
      exposure: `Create a fear hierarchy and practice the easiest item this week.`,
      emotional_regulation: `Practice naming emotions as they arise and using breathing to create space.`
    };
    return homeworkPlans[technique] || `Practice noticing the connection between thoughts, feelings, and behaviors this week.`;
  }

  static getProgressTrackingQuestion(sessionNumber: number): string {
    const questions = [
      "What's one small change you've noticed since we started working together?",
      "How has your understanding of these patterns shifted?",
      "What tools have been most helpful so far?",
      "Where are you noticing even small moments of progress?",
      "What would you like to focus on building in our work together?"
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

    // Track if this seems like an insight moment
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

// ✅ THERAPEUTICALLY EFFECTIVE sendMessage
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

    // ✅ STEP 1: Load therapeutic history
    const previousMessages = session.messages.slice(-10);
    const conversationContext = previousMessages.length > 0 ? 
      `Therapeutic history:\n${previousMessages.map(msg => 
        `${msg.role === 'user' ? 'Client' : 'Therapist'}: ${msg.content}`
      ).join('\n')}` : 'First therapeutic session.';

    const recurringThemes = identifyThemes(session.messages);
    const progressSummary = ProgressTracker.getProgressSummary(sessionId);

    // ✅ STEP 2: Comprehensive Therapeutic Assessment
    const assessmentPrompt = `
    As an experienced CBT therapist, provide a comprehensive assessment. Return ONLY valid JSON:

    CLIENT STATEMENT: "${message.replace(/"/g, '\\"')}"

    THERAPEUTIC CONTEXT:
    ${conversationContext}
    ${recurringThemes.length > 0 ? `RECURRING PATTERNS: ${recurringThemes.join(', ')}` : ''}
    ${progressSummary ? `PROGRESS CONTEXT: ${JSON.stringify(progressSummary)}` : ''}

    COMPREHENSIVE ASSESSMENT REQUESTED:
    {
      "automaticThoughts": ["specific automatic thoughts expressed"],
      "cognitiveDistortions": ["all_or_nothing", "catastrophizing", "overgeneralization", "mental_filter", "disqualifying_positive", "jumping_conclusions", "magnification", "emotional_reasoning", "should_statements", "labeling", "personalization"],
      "emotionalResponse": {
        "primaryEmotion": "anxious|depressed|angry|overwhelmed|stressed|hopeless|frustrated|lonely",
        "intensity": 1-10
      },
      "recommendedCbtTechniques": ["thought_challenging", "behavioral_activation", "cognitive_restructuring", "mindfulness", "exposure", "problem_solving", "emotional_regulation"],
      "homeworkSuggestion": "specific between-session practice",
      "clinicalNote": "therapeutic observation and direction",
      "progressIndicators": ["signs of insight", "emotional awareness", "behavioral change", "cognitive shift"],
      "safetyAssessment": {
        "riskLevel": 1-10,
        "needsImmediateAttention": false
      }
    }

    Return ONLY the JSON object. No other text.`;

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
    
    // ✅ SAFE JSON PARSING
    let therapeuticAssessment: CBTAssessment;
    try {
      let cleanedText = TextCleaner.cleanJSONResponse(assessmentText);
      therapeuticAssessment = JSON.parse(cleanedText);
      console.log("✅ Therapeutic assessment completed");
    } catch (parseError) {
      console.error("❌ Assessment parse error:", parseError);
      
      // Fallback assessment
      therapeuticAssessment = {
        automaticThoughts: ["Assessment processing"],
        cognitiveDistortions: [],
        emotionalResponse: {
          primaryEmotion: "neutral",
          intensity: 5
        },
        recommendedCbtTechniques: ["thought_challenging", "mindfulness"],
        homeworkSuggestion: "Practice observing thoughts and feelings",
        clinicalNote: "Continuing therapeutic support",
        progressIndicators: ["engagement"],
        safetyAssessment: {
          riskLevel: 1,
          needsImmediateAttention: false
        }
      };
    }

    logger.info("Therapeutic Assessment:", therapeuticAssessment);

    // ✅ STEP 3: Generate therapeutic response with GPT-OSS-20B
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
    You are an experienced, compassionate CBT therapist having a therapeutic session.

    CLIENT'S CURRENT EXPERIENCE:
    - Primary emotion: ${therapeuticAssessment.emotionalResponse.primaryEmotion}
    - Emotional intensity: ${therapeuticAssessment.emotionalResponse.intensity}/10
    - Cognitive patterns: ${therapeuticAssessment.cognitiveDistortions.join(', ')}
    - Automatic thoughts: ${therapeuticAssessment.automaticThoughts.join('; ')}
    - Safety concern: ${therapeuticAssessment.safetyAssessment?.needsImmediateAttention ? 'HIGH' : 'LOW'}

    THERAPEUTIC APPROACH:
    - Use evidence-based CBT techniques
    - Provide genuine empathy and validation
    - Apply ${primaryTechnique} intervention: "${therapeuticIntervention}"
    - Focus on creating meaningful change
    - Build coping skills and resilience
    - Track progress and insights
    - Assign relevant between-session work

    THERAPEUTIC HISTORY:
    ${conversationContext}

    ${progressSummary ? `PROGRESS CONTEXT: Client has completed ${progressSummary.sessionsCompleted} sessions with average intensity ${progressSummary.averageEmotionalIntensity}/10` : ''}

    CLIENT'S STATEMENT:
    "${message}"

    Provide a therapeutic response that:
    1. Validates their experience genuinely
    2. Applies the CBT intervention skillfully
    3. Promotes insight and coping skills
    4. Encourages between-session practice
    5. Tracks therapeutic progress

    Respond as an effective therapist focused on real improvement.`;

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
      "I hear what you're sharing. Let's work with this together in a way that feels helpful.";

    // ✅ CLEAN THE RESPONSE
    therapeuticResponse = TextCleaner.cleanTherapeuticContent(therapeuticResponse);

    // ✅ STEP 4: Update progress tracking
    ProgressTracker.updateProgress(sessionId, therapeuticAssessment, therapeuticResponse.length);

    // Log therapeutic progress
    logger.info("THERAPEUTIC_SESSION", {
      sessionId,
      emotion: therapeuticAssessment.emotionalResponse.primaryEmotion,
      intensity: therapeuticAssessment.emotionalResponse.intensity,
      technique: primaryTechnique,
      riskLevel: therapeuticAssessment.safetyAssessment?.riskLevel,
      progressIndicators: therapeuticAssessment.progressIndicators
    });

    // ✅ STEP 5: Save therapeutic session
    const userMessage = {
      role: "user" as const,
      content: message,
      timestamp: new Date(),
      metadata: {
        analysis: therapeuticAssessment,
        progress: {
          emotionalState: therapeuticAssessment.emotionalResponse.primaryEmotion,
          riskLevel: therapeuticAssessment.emotionalResponse.intensity,
        },
      },
    };

    const assistantMessage = {
      role: "assistant" as const,
      content: therapeuticResponse,
      timestamp: new Date(),
      metadata: {
        analysis: therapeuticAssessment,
        progress: {
          emotionalState: therapeuticAssessment.emotionalResponse.primaryEmotion,
          riskLevel: therapeuticAssessment.emotionalResponse.intensity,
        },
        therapeuticApproach: {
          technique: primaryTechnique,
          intervention: therapeuticIntervention,
          homework: homeworkSuggestion,
          distortionsAddressed: therapeuticAssessment.cognitiveDistortions,
          progressIndicators: therapeuticAssessment.progressIndicators
        },
      },
    };

    session.messages.push(userMessage);
    session.messages.push(assistantMessage);

    await session.save();
    logger.info("Therapeutic session documented");

    // ✅ STEP 6: Response with progress tracking
    const currentProgress = ProgressTracker.getProgressSummary(sessionId);

    res.json({
      response: therapeuticResponse,
      analysis: therapeuticAssessment,
      progress: currentProgress,
      metadata: {
        therapeuticTools: {
          technique: primaryTechnique,
          homework: homeworkSuggestion,
          intervention: therapeuticIntervention,
          clinicalFocus: therapeuticAssessment.clinicalNote,
          safetyLevel: therapeuticAssessment.safetyAssessment?.riskLevel
        },
        sessionMetrics: {
          emotionalIntensity: therapeuticAssessment.emotionalResponse.intensity,
          sessionDepth: Math.min(10, Math.floor(session.messages.length / 4)),
          techniquesApplied: therapeuticAssessment.recommendedCbtTechniques.length
        }
      },
    });

  } catch (error) {
    logger.error("Error in therapeutic session:", error);
    res.status(500).json({
      message: "I'm experiencing some technical difficulties. Please try again in a moment.",
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