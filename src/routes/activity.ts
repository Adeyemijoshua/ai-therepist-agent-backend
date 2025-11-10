import express from "express";
import { auth } from "../middleware/auth";
import { logActivity, getTodayActivities } from "../controllers/activityController";

const router = express.Router();

// All routes are protected with authentication
router.use(auth);

// Log a new activity
router.post("/", logActivity);

router.get("/today", getTodayActivities);


export default router;
