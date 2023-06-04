import express from "express";
import * as dotenv from "dotenv";
import moment from "moment-timezone";
import cors from "cors";
dotenv.config();
import Connect from "./config/Database.js";

import UserRoute from "./routes/UserRoute.js";

import {
	scheduleBirthdayMessages,
	sendBirthdayMessages,
} from "./utils/SchedulerAndSender.js";

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json());
app.use(UserRoute);

app.get("/", (req, res) => {
	res.send("Server Is Running....");
});

const getServerTimeOnUTC0 = () => {
	return moment().tz("UTC").format("YYYY-MM-DD HH:mm:ss");
};

console.log("Server Time On UTC 0: ", getServerTimeOnUTC0());

// Start the birthday message scheduling process
setInterval(scheduleBirthdayMessages, 1000 * 60 * 1);
// Start the sender to send queued birthday messages every minute
const startSender = () => {
	setInterval(sendBirthdayMessages, 60 * 1000); // Repeat every 1 minute
};
// Start the sender
startSender();

app.listen(PORT, () => {
	Connect();
	console.log(`Server Started At Port ${PORT}`);
});
