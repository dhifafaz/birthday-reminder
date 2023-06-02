import express from "express";
import * as dotenv from "dotenv";
import cors from "cors";
dotenv.config();
import Connect from "./config/database.js";

import UserRoute from "./routes/UserRoute.js";

const app = express();
// const PORT = Config.development.PORT;
const PORT = process.env.PORT || 3001;
// const PORT = 3000;
app.use(cors());
app.use(express.json());
app.use(UserRoute);

app.listen(PORT, () => {
	Connect();
	console.log(`Server Started at port ${PORT}`);
});
