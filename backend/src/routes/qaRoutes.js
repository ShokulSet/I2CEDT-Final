import express from "express";
import { analyze } from "../controllers/qaController.js";

const router = express.Router();

// POST /qa/analyze
router.post("/analyze", analyze);

export default router;
