import express from "express";
import { auth } from "../middleware/auth";
import { createMood, getTodayMoods } from "../controllers/moodController";

const router = express.Router();

// All routes are protected with authentication
router.use(auth);

// Track a new mood entry
router.post("/", createMood);

// ✅ Get today's mood entries
router.get("/today", getTodayMoods);


export default router;
