import express from "express";
import cors from "cors";
import bodyParser from "body-parser";

import listingRoutes from "./routes/listingRoutes.js";
import qaRoutes from "./routes/qaRoutes.js";

const app = express();

app.use(cors());
app.use(bodyParser.json());

app.use("/listings", listingRoutes);
app.use("/qa", qaRoutes);

export default app;
