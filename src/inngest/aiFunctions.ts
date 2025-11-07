import { inngest } from "./client";
import Groq from "groq-sdk";
import { logger } from "../utils/logger";
import dotenv from "dotenv";

dotenv.config();

// 🧩 Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// 🧠 Friendly CBT Therapist Personality
const therapistPersona = `
You are a warm, empathetic CBT-based therapist. 
You speak naturally, like a caring human therapist in a private session.
You use compassion, gentle reflection, and open-ended questions.
Avoid sounding robotic or overly formal. 
Be concise, kind, and encouraging.
If you sense emotional distress, acknowledge it gently and offer grounding or reframing.
Never give medical diagnoses or crisis instructions.
`;

// Helper for Groq chat completions
async function generateWithGroq(prompt: string) {
  try {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-20b",
      temperature: 0.8,
      top_p: 0.9,
      messages: [
        { role: "system", content: therapistPersona },
        { role: "user", content: prompt },
      ],
    });

    return completion.choices[0].message.content?.trim() || "";
  } catch (error) {
    logger.error("Groq API error:", error);
    throw new Error("Failed to generate Groq response");
  }
}

// ===========================================================
// 1️⃣ Process Chat Message
// ===========================================================
export const processChatMessage = inngest.createFunction(
  { id: "process-chat-message" },
  { event: "therapy/session.message" },
  async ({ event, step }) => {
    try {
      const {
        message,
        history,
        memory = {
          userProfile: {
            emotionalState: [],
            riskLevel: 0,
            preferences: { tone: "warm", style: "conversational" },
          },
          sessionContext: {
            conversationThemes: [],
            currentTechnique: null,
          },
        },
        goals = [],
      } = event.data;

      logger.info("Processing chat message:", {
        message,
        historyLength: history?.length,
      });

      // 🧩 Step 1 — Analyze Message
      const analysis = await step.run("analyze-message", async () => {
        const prompt = `
Analyze this therapy message using CBT principles and respond with valid JSON only.

Message: ${message}
Context: ${JSON.stringify({ memory, goals })}

Provide:
{
  "emotionalState": "Describe emotional tone briefly (e.g., anxious, hopeful, sad, angry, calm)",
  "themes": ["Key topics or concerns mentioned"],
  "riskLevel": "0-5 where 0 = safe, 5 = crisis",
  "recommendedApproach": "Best CBT method to use (e.g., reframing, grounding, behavioral activation)",
  "progressIndicators": ["Any signs of insight or progress"]
}
Do not include markdown or explanations.
`;

        try {
          const text = await generateWithGroq(prompt);
          const clean = text.replace(/```json\n?|```/g, "").trim();
          return JSON.parse(clean);
        } catch (error) {
          logger.error("Error parsing analysis:", error);
          return {
            emotionalState: "neutral",
            themes: [],
            riskLevel: 0,
            recommendedApproach: "supportive",
            progressIndicators: [],
          };
        }
      });

      // 🧠 Step 2 — Update Memory
      const updatedMemory = await step.run("update-memory", async () => {
        if (analysis.emotionalState)
          memory.userProfile.emotionalState.push(analysis.emotionalState);
        if (analysis.themes)
          memory.sessionContext.conversationThemes.push(...analysis.themes);
        if (analysis.riskLevel)
          memory.userProfile.riskLevel = analysis.riskLevel;
        return memory;
      });

      // 🚨 Step 3 — Risk Alert
      if (analysis.riskLevel > 4) {
        await step.run("trigger-risk-alert", async () => {
          logger.warn("⚠️ High risk level detected in chat message", {
            message,
            riskLevel: analysis.riskLevel,
          });
        });
      }

      // 💬 Step 4 — Generate Therapist Response
      const response = await step.run("generate-response", async () => {
        const prompt = `
You are a compassionate CBT therapist. 
Generate a short, human-like, caring response.

Message: ${message}
Analysis: ${JSON.stringify(analysis)}
Memory: ${JSON.stringify(memory)}
Goals: ${JSON.stringify(goals)}

Your response should:
1. Start with empathy (reflect emotion naturally).
2. Offer gentle validation.
3. Apply a CBT technique where appropriate (e.g., reframing, small actionable step).
4. Ask an open-ended question to continue the session.
5. Sound conversational, warm, and human.
`;

        try {
          const text = await generateWithGroq(prompt);
          return text.trim();
        } catch (error) {
          logger.error("Error generating response:", error);
          return "That sounds really tough. I’m here with you — can you tell me a bit more about what’s been hardest lately?";
        }
      });

      return { response, analysis, updatedMemory };
    } catch (error) {
      logger.error("Error in chat message processing:", error);
      return {
        response:
          "I’m here to listen and help you work through what’s on your mind.",
        analysis: {
          emotionalState: "neutral",
          themes: [],
          riskLevel: 0,
          recommendedApproach: "supportive",
          progressIndicators: [],
        },
        updatedMemory: event.data.memory,
      };
    }
  }
);

// ===========================================================
// 2️⃣ Analyze Entire Therapy Session
// ===========================================================
export const analyzeTherapySession = inngest.createFunction(
  { id: "analyze-therapy-session" },
  { event: "therapy/session.created" },
  async ({ event, step }) => {
    try {
      const sessionContent = await step.run("get-session-content", async () => {
        return event.data.notes || event.data.transcript;
      });

      const analysis = await step.run("analyze-with-groq", async () => {
        const prompt = `
You are a CBT therapist reviewing a full session.
Summarize clearly and return valid JSON.

Session: ${sessionContent}

Return:
{
  "themes": ["main issues discussed"],
  "emotionalSummary": "brief overall emotional tone",
  "areasOfConcern": ["potential risk or distress points"],
  "recommendations": ["suggested CBT directions or techniques"],
  "progressIndicators": ["positive developments"]
}
`;

        const text = await generateWithGroq(prompt);
        const clean = text.replace(/```json\n?|```/g, "").trim();
        return JSON.parse(clean);
      });

      await step.run("store-analysis", async () => {
        logger.info("✅ Session analysis stored");
        return analysis;
      });

      if (analysis.areasOfConcern?.length > 0) {
        await step.run("trigger-concern-alert", async () => {
          logger.warn("⚠️ Areas of concern detected", {
            sessionId: event.data.sessionId,
            concerns: analysis.areasOfConcern,
          });
        });
      }

      return { message: "Session analyzed", analysis };
    } catch (error) {
      logger.error("Error analyzing session:", error);
      throw error;
    }
  }
);

// ===========================================================
// 3️⃣ Generate Personalized Activity Recommendations
// ===========================================================
export const generateActivityRecommendations = inngest.createFunction(
  { id: "generate-activity-recommendations" },
  { event: "mood/updated" },
  async ({ event, step }) => {
    try {
      const userContext = await step.run("get-user-context", async () => ({
        recentMoods: event.data.recentMoods,
        completedActivities: event.data.completedActivities,
        preferences: event.data.preferences,
      }));

      const recommendations = await step.run(
        "generate-recommendations",
        async () => {
          const prompt = `
You are a CBT therapist suggesting uplifting activities.

User Context: ${JSON.stringify(userContext)}

Return JSON only:
{
  "recommendations": [
    {
      "activity": "short friendly title",
      "reasoning": "why it helps for this user",
      "expectedBenefits": ["specific benefits"],
      "difficultyLevel": "easy | moderate | challenging",
      "estimatedDuration": "approx time"
    }
  ]
}
Keep tone encouraging and practical.
`;

          const text = await generateWithGroq(prompt);
          const clean = text.replace(/```json\n?|```/g, "").trim();
          return JSON.parse(clean);
        }
      );

      await step.run("store-recommendations", async () => {
        logger.info("✅ Activity recommendations stored");
        return recommendations;
      });

      return { message: "Activity recommendations generated", recommendations };
    } catch (error) {
      logger.error("Error generating recommendations:", error);
      throw error;
    }
  }
);

// ===========================================================
// Export
// ===========================================================
export const functions = [
  processChatMessage,
  analyzeTherapySession,
  generateActivityRecommendations,
];
