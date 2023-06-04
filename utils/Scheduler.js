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

const MAX_RETRY_ATTEMPTS = 3;

// Schedule task to send birthday messages at 9 AM on users' local time
// We need to check the user location, and server time is set to UTC 0
function scheduleBirthdayMessages() {
	setInterval(async () => {
		try {
			// const today = moment().tz("UTC").format("MM-DD");
			const users = await findUsersWithBirthdaysToday();
			console.log("ini data user", users);

			if (users.length > 0) {
				for (const user of users) {
					const { firstName, lastName, location } = user;
					const now = moment();
					// const userLocalTime = now.tz(location).startOf("day").add(9, "hours");
					const currentUserLocalTime = now.tz(location);
					// console.log("ini userLocalTime", userLocalTime);
					console.log("ini currentUserLocalTime", currentUserLocalTime);

					if (
						currentUserLocalTime.hour() === 1 &&
						currentUserLocalTime.minute() === 0
					) {
						const birthdayMessage = `Hey, ${firstName} ${lastName}, it's your birthday!`;
						try {
							await sendBirthdayMessage(user, birthdayMessage);
						} catch (error) {
							console.error(
								`Failed To Send Birthday Message To ${firstName} ${lastName}. System Will Retry Sending The Message Up To ${MAX_RETRY_ATTEMPTS} Times.`
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
					} 
					else {
						console.log(
							`It's Not The Time To Send This Birthday Message. It Will Be Sended On 9 AM User's Timezone`
						);
					}
				}
			}
		} catch (error) {
			console.error("Error occurred during birthday message sending:", error);
		}
	}, 1000 * 60 * 1);
}

// Function to send the birthday message
async function sendBirthdayMessage(user, birthdayMessage) {
	const getServerTimeOnUTC0 = moment().tz("UTC");
	const getUserTime = moment().tz(user.location);

	const { firstName, lastName, email, _id: userId } = user;
	const emailServiceUrl = "https://email-service.digitalenvision.com.au";
	// const emailServiceUrl = "http://localhost:3000";
	const payload = {
		email: email,
		message: birthdayMessage,
	};

	// Making the request
	const response = await axios.post(`${emailServiceUrl}/send-email`, payload);
	if (response.status === 200) {
		// Update the sendEmail status to true
		await updateSendEmailStatus(userId);
		console.log(
			`Birthday Message Sent To ${firstName} ${lastName} At ${getServerTimeOnUTC0} Server Time And ${getUserTime} User's Time`
		);
	} else {
		console.log(response);
		throw new Error("Failed To Send Birthday Message.");
	}
}

// Recover and resend unsent messages from Redis queue
async function recoverUnsentMessages() {
	const queueLength = await redisClient.lLen("failedMessages");

	if (queueLength > 0) {
		console.log(`Recovering ${queueLength} Unsent Birthday Messages...`);
		const unsentMessages = await redisClient.lRange(
			"failedMessages",
			0,
			queueLength - 1
		);
		for (const unsentMessage of unsentMessages) {
			const {
				user,
				message: birthdayMessage,
				retryAttempts = 0,
			} = JSON.parse(unsentMessage);

			const { firstName, lastName } = user;

			if (retryAttempts < MAX_RETRY_ATTEMPTS) {
				try {
					await sendBirthdayMessage(user, birthdayMessage);
					console.log(
						`Process To Resend The Birthday Message Is Successful, To ${firstName} ${lastName} Via Email`
					);
					// Remove the message from Redis queue
					redisClient.lRem("failedMessages", 0, unsentMessage);
				} catch (error) {
					console.error(
						`Failed To Resend Birthday Message To ${firstName} ${lastName}. System Will Retry To Send It Again.`
					);
					// Add the failed message to Redis queue for recovery from tail of the queue
					const updatedUnsentMessage = {
						user,
						message: birthdayMessage,
						retryAttempts: retryAttempts + 1,
					};
					redisClient.lSet(
						"failedMessages",
						redisClient.lPos("failedMessages", unsentMessage),
						JSON.stringify(updatedUnsentMessage)
					);
				}
			} else {
				console.error(
					`Really Failed To Send Birthday Message To ${firstName} ${lastName}, System Cannot Reach Out The Email`
				);
			}
		}
	}
}

export { scheduleBirthdayMessages, recoverUnsentMessages };
