import express from "express";
import cors from "cors";
import qaRoutes from "./routes/qaRoutes.js";

const app = express();

// body-parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// allow request from other origin (Frontend which is at different port)
app.use(cors());

app.use("/qa", qaRoutes);

export default app;
