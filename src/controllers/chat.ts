import { Request, Response } from "express";
import { ChatSession, IChatSession } from "../models/ChatSession";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger";
import { inngest } from "../inngest/client";
import { User } from "../models/User";
import { InngestSessionResponse, InngestEvent } from "../types/inngest";
import { Types } from "mongoose";
import Groq from "groq-sdk";

// Initialize Groq API client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

// ✅ Create a new chat session
export const createChatSession = async (req: Request, res: Response) => {
  try {
    // Ensure user is authenticated
    if (!req.user || !req.user.id) {
      return res
        .status(401)
        .json({ message: "Unauthorized - User not authenticated" });
    }

    const userId = new Types.ObjectId(req.user.id);
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Generate session ID
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

// ✅ Send a message using Groq model
export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;
    const userId = new Types.ObjectId(req.user.id);

    logger.info("Processing message:", { sessionId, message });

    // Find the chat session
    const session = await ChatSession.findOne({ sessionId });
    if (!session)
      return res.status(404).json({ message: "Session not found" });

    if (session.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Log event for tracking in Inngest
    const event: InngestEvent = {
      name: "therapy/session.message",
      data: {
        message,
        history: session.messages,
        memory: {
          userProfile: {
            emotionalState: [],
            riskLevel: 0,
            preferences: {},
          },
          sessionContext: {
            conversationThemes: [],
            currentTechnique: null,
          },
        },
        goals: [],
        systemPrompt: `You are an empathetic AI therapist assistant.
          - Offer emotional support
          - Use CBT-style reflection
          - Ask gentle follow-up questions
          - Keep responses short but warm
          - Monitor user emotions and potential risk`,
      },
    };

    await inngest.send(event);

    // ✅ Step 1: Analyze message (Groq JSON response)
    const analysisPrompt = `
    Analyze this user message for therapy context. Return valid JSON only.

    Message: "${message}"

    Required JSON:
    {
      "emotionalState": "string",
      "themes": ["string"],
      "riskLevel": number,
      "recommendedApproach": "string",
      "progressIndicators": ["string"]
    }`;

    const analysisCompletion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: analysisPrompt }],
      temperature: 0.4,
    });

    const analysisText =
      analysisCompletion.choices?.[0]?.message?.content?.trim() || "{}";
    const analysis = JSON.parse(
      analysisText.replace(/```json|```/g, "").trim()
    );

    logger.info("Message analysis:", analysis);

    // ✅ Step 2: Generate friendly therapist-style response
    const responsePrompt = `
    ${event.data.systemPrompt}

    User message: "${message}"
    Emotional analysis: ${JSON.stringify(analysis)}

    Write a warm, empathetic, and conversational response (2–3 sentences max). 
    End with an open-ended question to keep the conversation going.
    Example tone:
    - “That sounds really difficult, I can understand how you feel.”
    - “It’s okay to feel this way sometimes. What do you think might help you relax right now?”`;

    const responseCompletion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: responsePrompt }],
      temperature: 0.7,
    });

    const response =
      responseCompletion.choices?.[0]?.message?.content?.trim() ||
      "I'm here to listen. Could you share a bit more about that?";

    logger.info("Generated response:", response);

    // ✅ Save messages to session
    session.messages.push({
      role: "user",
      content: message,
      timestamp: new Date(),
    });
    session.messages.push({
      role: "assistant",
      content: response,
      timestamp: new Date(),
      metadata: {
        analysis,
        progress: {
          emotionalState: analysis.emotionalState,
          riskLevel: analysis.riskLevel,
        },
      },
    });

    await session.save();
    logger.info("Session updated successfully:", { sessionId });

    res.json({
      response,
      analysis,
      metadata: {
        progress: {
          emotionalState: analysis.emotionalState,
          riskLevel: analysis.riskLevel,
        },
      },
    });
  } catch (error) {
    logger.error("Error in sendMessage:", error);
    res.status(500).json({
      message: "Error processing message",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// ✅ Fetch chat session history
export const getSessionHistory = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = new Types.ObjectId(req.user.id);

    const session = (await ChatSession.findById(
      sessionId
    ).exec()) as IChatSession;
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

// ✅ Fetch specific chat session
export const getChatSession = async (req: Request, res: Response) => {
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

// ✅ Get all chat history
export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
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
