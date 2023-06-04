import moment from "moment-timezone";
import axios from "axios";
import redis from "redis";

import {
	updateSendEmailStatus,
	findUsersWithBirthdaysToday,
} from "../controllers/UserController.js";

// make redis connection
const redisClient = redis.createClient();
(async () => {
	await redisClient.connect();
})();

redisClient.on("connect", () => console.log("Redis Client Connected"));
redisClient.on("error", (err) =>
	console.log("Redis Client Connection Error", err)
);

const emailServiceUrl = "https://email-service.digitalenvision.com.au";
const MAX_RETRY_ATTEMPTS = 3;

// Schedule task to send birthday messages at 9 AM on users' local time
// We need to check the user location, and server time is set to UTC 0
const sendBirthdayMessages = async () => {
	try {
		const now = moment().tz("UTC");
		const users = findUsersWithBirthdaysToday();
		console.log("ini data user", users);

		if (users.length > 0) {
			for (const user of users) {
				const { firstName, lastName, location, email } = user;
				const birthdayMessage = `Hey, ${firstName} ${lastName}, it's your birthday!`;

				const payload = {
					email: email,
					message: birthdayMessage,
				};

				// Get the user's timezone based on location
				const timezone = moment.tz.guess(location);

				// Calculate the target time in the user's local timezone
				const targetTime = moment
					.tz(now)
					.tz(timezone)
					.startOf("day")
					.add(595, "minutes");

				// Calculate the delay based on the difference between the current time and target time
				const delay = targetTime.diff(now);

				if (user.sendEmail === false) {
					setTimeout(async () => {
						console.log(
							`Sending Birthday Message To ${firstName} ${lastName} Via Email In ${delay}ms`
						);
						try {
							await axios.post(`${emailServiceUrl}/send-email`, payload);
							await updateSendEmailStatus(user._id);
							console.log(
								`Birthday Message Sent To ${firstName} ${lastName} Via Email`
							);
						} catch (error) {
							console.error(
								`Failed To Send Birthday Message To ${firstName} ${lastName}. System Will Retry Later.`
							);
							// Add the failed message to Redis queue for recovery and push from tail of the queue
							redisClient.rPush(
								"failedMessages",
								JSON.stringify({
									user,
									message: birthdayMessage,
									retryAttempts: 0,
								})
							);
						}
					}, delay);
				}
			}
		}
	} catch (error) {
		console.error("Failed To Fetch Users:", error.message);
		console.error(error);
	}
};

const sendUnsentMessages = async () => {
	const unsentMessages = await new Promise((resolve, reject) => {
		redisClient.lRange("failedMessages", 0, -1, (error, messages) => {
			if (error) {
				reject(error);
			} else {
				resolve(messages);
			}
		});
	});

	if (unsentMessages.length > 0) {
		for (const unsentMessage of unsentMessages) {
			const {
				user,
				message: birthdayMessage,
				retryAttempts = 0,
			} = JSON.parse(unsentMessage);
			const { firstName, lastName, email } = user;

			if (retryAttempts < MAX_RETRY_ATTEMPTS) {
				try {
					await axios.post(`${emailServiceUrl}/send-email`, {
						email: email,
						message: birthdayMessage,
					});
					await updateSendEmailStatus(user._id);
					console.log(
						`Process To Resend The Birthday Message Is Successful, To ${firstName} ${lastName} Via Email`
					);
					
				} catch (error) {
					console.error(
						`Failed To Resend Birthday Message To ${firstName} ${lastName}. System Will Retry Later.`
					);
					// Update the retry attempts and store the message back in Redis
					const updatedMessage = {
						user,
						message: birthdayMessage,
						retryAttempts: retryAttempts + 1,
					};
					redisClient.lSet(
						"failedMessages",
						redisClient.lPos("failedMessages", message),
						JSON.stringify(updatedMessage)
					);
				}
			}
		}
	}
};

// function scheduleJob() {
// 	// const currentTime = moment().tz("UTC");
// 	// const targetTime = currentTime.clone().startOf("day").add(564, "minutes");

// 	// const delay = targetTime.diff(currentTime);
// 	// console.log(`Next Job Will Run In ${delay}ms`);
// 	setInterval(async () => {
// 		sendBirthdayMessages();
// 		sendUnsentMessages();
// 	}, 60000);
// }

export { sendBirthdayMessages, sendUnsentMessages };
