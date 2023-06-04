import express from "express";
import * as dotenv from "dotenv";
import moment from "moment-timezone";
import cors from "cors";
dotenv.config();
import Connect from "./config/Database.js";

import UserRoute from "./routes/UserRoute.js";

// import {
// 	sendBirthdayMessages,
// 	sendUnsentMessages,
// } from "./utils/SchedulerBirthday.js";

// import {
// 	scheduleBirthdayMessages,
// 	recoverUnsentMessages,
// } from "./utils/Scheduler.js";

// import {
// 	scheduleBirthdayMessages,
// 	sendBirthdayMessages,
// } from "./utils/NewScheduler.js";

import {
	scheduleBirthdayMessages,
	sendBirthdayMessages,
	retryUnsentMessages,
} from "./utils/NEW1.js";

const app = express();
// const PORT = Config.development.PORT;
const PORT = process.env.PORT || 3001;
// const PORT = 3000;
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

// const scheduleJob = async () => {
// 	console.log("Scheduling Job...");
// 	const currentTime = moment().tz("UTC");
// 	const targetTime = currentTime.clone().startOf("day").add(595, "minutes");

// 	const delay = targetTime.diff(currentTime);
// 	console.log(`Next Job Will Run In ${delay}ms`);
// 	setTimeout(async () => {
// 		scheduleBirthdayMessages();
// 		await recoverUnsentMessages();
// 		scheduleJob();
// 	}, delay);
// };

// // Start the job scheduler
// scheduleJob();

// Start scheduling birthday messages
// scheduleBirthdayMessages();

// // Start sending queued birthday messages every minute
// const startSender = () => {
// 	setInterval(sendBirthdayMessages, 60 * 1000); // Repeat every 1 minute
// };

// // Start the sender
// startSender();

// Start the birthday message scheduling process
setInterval(scheduleBirthdayMessages, 1000 * 60 * 1);
// scheduleBirthdayMessages();
// Start the sender to send queued birthday messages every minute
const startSender = () => {
	setInterval(sendBirthdayMessages, 60 * 1000); // Repeat every 1 minute
};

// Start the sender
startSender();

// Retry unsent messages every hour
setInterval(retryUnsentMessages, 60 * 60 * 1000); // Repeat every 1 hour

app.listen(PORT, () => {
	Connect();
	// (async () => {
	// 	await recoverUnsentMessages();
	// })();
	console.log(`Server Started At Port ${PORT}`);
	// scheduleJob();
	// scheduleBirthdayMessages();
});

// setInterval(scheduleBirthdayMessages, 1000 * 60); // Check every minute for simplicity (adjust as needed)

// // Send unsent messages during system recovery and handle retry attempts
// recoverUnsentMessages();
