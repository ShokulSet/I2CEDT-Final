// src/routes/listingRoutes.js
import express from "express";
import {
  getAllListings,
  createListing,
  updateListing,
  deleteListing,
} from "../controllers/listingController.js";

const router = express.Router();

router.get("/", getAllListings);
router.post("/", createListing);
router.put("/:id", updateListing);
router.delete("/:id", deleteListing);

export default router;
