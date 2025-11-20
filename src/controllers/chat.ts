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
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

// ==================== CBT THERAPIST CONFIGURATION ====================

interface CBTAssessment {
  automaticThoughts: string[];
  cognitiveDistortions: string[];
  emotionalState: string;
  intensity: number;
  cbtTechnique: string;
  coreBelief: string;
}

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    name?: string;
  };
}

// CBT Techniques for Real Therapy
class CBTTherapist {
  static getCBTResponse(technique: string, emotion: string): string {
    const techniques: { [key: string]: { empathy: string[]; intervention: string[] } } = {
      thought_records: {
        empathy: [
          "I hear those automatic thoughts coming through strongly.",
          "It sounds like your mind is generating some powerful negative predictions.",
          "I'm noticing how quickly those thoughts are showing up for you."
        ],
        intervention: [
          "Let's examine the evidence for that thought. What facts support it? What facts challenge it?",
          "What would you tell a friend who had this same thought?",
          "Is there a more balanced way to view this situation?"
        ]
      },
      behavioral_activation: {
        empathy: [
          "I sense how hard it is to find motivation right now.",
          "It sounds like everything feels like too much effort.",
          "I hear how your energy has been really low lately."
        ],
        intervention: [
          "What's one tiny step that feels possible, even if you don't feel like doing it?",
          "What activity used to bring you even a small sense of satisfaction?",
          "Could we schedule one small, pleasant activity for today?"
        ]
      },
      cognitive_restructuring: {
        empathy: [
          "I can hear how stuck you feel in that perspective.",
          "It sounds like this view of the situation feels very fixed.",
          "I'm noticing how absolute that thinking feels for you right now."
        ],
        intervention: [
          "What's another way to interpret what happened?",
          "If you looked at this from a different angle, what might you see?",
          "What would a more flexible perspective on this be?"
        ]
      },
      exposure: {
        empathy: [
          "I can feel the anxiety that thought brings up for you.",
          "It sounds like this really triggers your fear response.",
          "I'm hearing how much you want to avoid that uncomfortable feeling."
        ],
        intervention: [
          "What would be the smallest step toward facing this fear?",
          "Could we practice sitting with this discomfort together for a moment?",
          "What would happen if you approached this gradually instead of avoiding?"
        ]
      },
      mindfulness: {
        empathy: [
          "I hear how much those thoughts are pulling you in.",
          "It sounds like your mind is really holding onto those worries.",
          "I'm noticing how entangled you feel with those thoughts."
        ],
        intervention: [
          "Can we practice observing these thoughts without getting caught in them?",
          "What if we just notice these thoughts like clouds passing in the sky?",
          "Can you describe the thoughts without judging them or yourself?"
        ]
      }
    };

    const techniqueData = techniques[technique] || techniques.mindfulness;
    const empathy = techniqueData.empathy[Math.floor(Math.random() * techniqueData.empathy.length)];
    const intervention = techniqueData.intervention[Math.floor(Math.random() * techniqueData.intervention.length)];
    
    return `${empathy} ${intervention}`;
  }

  static identifyDistortions(thoughts: string[]): string {
    const distortions: { [key: string]: string } = {
      all_or_nothing: "black-and-white thinking",
      catastrophizing: "expecting the worst-case scenario",
      overgeneralization: "seeing patterns based on single events",
      mental_filter: "focusing only on the negative",
      disqualifying_positive: "discounting positive experiences",
      jumping_conclusions: "mind reading or fortune telling",
      magnification: "blowing things out of proportion",
      emotional_reasoning: "believing feelings reflect reality",
      should_statements: "rigid rules about how things must be",
      labeling: "global negative judgments about self"
    };

    // Simple distortion identification
    if (thoughts.length === 0) return distortions.mental_filter;
    
    const thoughtText = thoughts.join(' ').toLowerCase();
    
    if (thoughtText.includes('always') || thoughtText.includes('never') || thoughtText.includes('every') || thoughtText.includes('no one')) 
      return distortions.all_or_nothing;
    if (thoughtText.includes('disaster') || thoughtText.includes('worst') || thoughtText.includes('terrible') || thoughtText.includes('awful')) 
      return distortions.catastrophizing;
    if (thoughtText.includes('everyone') || thoughtText.includes('nobody') || thoughtText.includes('always') || thoughtText.includes('never')) 
      return distortions.overgeneralization;
    
    return distortions.mental_filter;
  }

  static getCBTHomework(technique: string): string {
    const homework: { [key: string]: string } = {
      thought_records: "Practice noticing automatic thoughts and writing down evidence for and against them",
      behavioral_activation: "Schedule one small, pleasant activity each day",
      cognitive_restructuring: "Notice rigid thoughts and practice finding alternative perspectives",
      exposure: "Practice approaching feared situations in small, manageable steps",
      mindfulness: "Practice observing thoughts without judgment for 5 minutes daily"
    };

    return homework[technique] || "Practice noticing the connection between thoughts, feelings, and behaviors";
  }

  static getExerciseSuggestion(technique: string, emotion: string): string {
    const exercises: { [key: string]: string } = {
      thought_records: "The thought challenging exercise in the app can help examine those automatic thoughts",
      behavioral_activation: "The activity scheduling meditation can help build momentum",
      cognitive_restructuring: "The perspective shifting exercise might help find alternative views",
      exposure: "The gradual exposure practice can help build confidence facing fears",
      mindfulness: "The mindful observation meditation helps create space from difficult thoughts"
    };

    return exercises[technique] || "The CBT techniques in the app align well with what we're working on";
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

// ✅ CBT THERAPIST sendMessage
export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    
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

    // ✅ CBT Assessment
    const assessmentPrompt = `
    As a CBT therapist, identify the cognitive patterns in this message.

    Client: "${message}"

    Return JSON:
    {
      "automaticThoughts": ["identify 2-3 key automatic thoughts"],
      "cognitiveDistortions": ["all_or_nothing", "catastrophizing", "overgeneralization", "mental_filter", "emotional_reasoning"],
      "emotionalState": "anxious|depressed|angry|overwhelmed",
      "intensity": 1-10,
      "cbtTechnique": "thought_records|behavioral_activation|cognitive_restructuring|exposure|mindfulness",
      "coreBelief": "brief core belief pattern"
    }`;

    const assessmentCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: assessmentPrompt }],
      model: "openai/gpt-oss-20b",
      temperature: 0.2,
      max_tokens: 300,
    });

    const assessmentText = assessmentCompletion.choices?.[0]?.message?.content?.trim() || "{}";
    
    let cbtData: CBTAssessment;
    try {
      const cleanedText = assessmentText.replace(/```json|```/g, "").trim();
      cbtData = JSON.parse(cleanedText);
    } catch (error) {
      // Fallback CBT assessment
      cbtData = {
        automaticThoughts: ["I'm not sure what to think"],
        cognitiveDistortions: ["mental_filter"],
        emotionalState: "neutral",
        intensity: 5,
        cbtTechnique: "mindfulness",
        coreBelief: "Uncertainty about the situation"
      };
    }

    // ✅ Get CBT intervention
    const cbtIntervention = CBTTherapist.getCBTResponse(cbtData.cbtTechnique, cbtData.emotionalState);
    const identifiedDistortion = CBTTherapist.identifyDistortions(cbtData.automaticThoughts);
    const homework = CBTTherapist.getCBTHomework(cbtData.cbtTechnique);
    const exerciseSuggestion = Math.random() > 0.3 ? CBTTherapist.getExerciseSuggestion(cbtData.cbtTechnique, cbtData.emotionalState) : "";

    // ✅ CBT Therapist Context
    const therapistContext = `
    You are a warm, skilled CBT therapist. You use evidence-based techniques while being genuinely human.

    CBT ASSESSMENT:
    - Automatic thoughts: ${cbtData.automaticThoughts.join(', ')}
    - Cognitive distortion: ${identifiedDistortion}
    - Emotional state: ${cbtData.emotionalState} (${cbtData.intensity}/10)
    - Core belief pattern: ${cbtData.coreBelief}
    - CBT technique: ${cbtData.cbtTechnique}

    YOUR THERAPEUTIC APPROACH:
    Use this CBT intervention: "${cbtIntervention}"
    ${exerciseSuggestion ? `App exercise: "${exerciseSuggestion}"` : ''}

    SPEAK LIKE A REAL CBT THERAPIST:
    - Be warm and genuinely empathetic
    - Use the CBT technique naturally in conversation
    - Help identify thinking patterns without judgment
    - Collaborate on finding new perspectives
    - Keep responses conversational but therapeutically focused
    - 3-4 sentences maximum

    CLIENT'S MESSAGE:
    "${message}"

    Respond as a real CBT therapist would - using evidence-based techniques while being fully present and human.`;

    // ✅ Generate CBT therapist response
    const responseCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: therapistContext }],
      model: "openai/gpt-oss-20b",
      temperature: 0.7,
      max_tokens: 150,
    });

    let leoResponse = responseCompletion.choices?.[0]?.message?.content?.trim() || 
      "I hear you. Let's work with these thoughts together using some CBT techniques.";

    // ✅ Save session
    const userMessage = {
      role: "user" as const,
      content: message,
      timestamp: new Date(),
    };

    const assistantMessage = {
      role: "assistant" as const,
      content: leoResponse,
      timestamp: new Date(),
      metadata: {
        // place CBT analysis inside the `analysis` field to match IChatMessage.metadata shape
        analysis: {
          cbt: {
            automaticThoughts: cbtData.automaticThoughts,
            cognitiveDistortion: identifiedDistortion,
            emotion: cbtData.emotionalState,
            intensity: cbtData.intensity,
            cbtTechnique: cbtData.cbtTechnique,
            homework: homework
          }
        }
      },
    };

    session.messages.push(userMessage);
    session.messages.push(assistantMessage);
    await session.save();

    // ✅ Response
    res.json({
      response: leoResponse,
      metadata: {
        cbtAnalysis: {
          automaticThoughts: cbtData.automaticThoughts,
          cognitiveDistortion: identifiedDistortion,
          technique: cbtData.cbtTechnique,
          homework: homework
        },
        emotion: cbtData.emotionalState,
        intensity: cbtData.intensity,
        exercise: exerciseSuggestion || null
      },
    });

  } catch (error) {
    logger.error("Error in CBT session:", error);
    res.status(500).json({
      message: "I'm having some technical difficulties. Let's pause and try again in a moment.",
    });
  }
};

// ✅ Keep other functions
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