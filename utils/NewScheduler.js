import moment from "moment-timezone";
import axios from "axios";
import redis from "redis";
import mongoose from "mongoose";

import {
	updateSendEmailStatus,
	findUsersWithBirthdaysToday,
} from "../controllers/UserController.js";
import UserModel from "../models/UserModel.js";

// make redis connection
const redisClient = redis.createClient();
(async () => {
	await redisClient.connect();
})();

redisClient.on("connect", () => console.log("Redis Client Connected"));
redisClient.on("error", (error) =>
	console.log("Redis Client Connection Error", error)
);

const MAX_RETRY_ATTEMPTS = 3;

// Schedule and send birthday messages at 9 AM local time
const scheduleBirthdayMessages = async () => {
	try {
		const users = await findUsersWithBirthdaysToday();
		console.log("ini data users di data schedule", users);

		users.forEach((user) => {
			const message = `Hey, ${user.firstName} ${user.lastName}, it's your birthday!`;

			const scheduleTime = moment
				.tz(user.location)
				.set({ hour: 8, minute: 39, second: 0 });

			// Calculate the delay in milliseconds until the scheduled time
			const delay = scheduleTime.diff(moment().utc());

			// const delay = scheduleTime.diff(moment(), "milliseconds");

			setTimeout(() => {
				redisClient.rPush(
					"birthdayMessages",
					JSON.stringify({
						userId: user._id,
						message,
						timestamp: Date.now(), // Store the timestamp for recovery
					})
				);
				console.log(
					"Scheduled Birthday Message For User:",
					user.firstName,
					user.lastName
				);
			}, delay);
			// if (moment().tz("UTC").isSameOrBefore(scheduleTime, "second")) {

			// }
		});
	} catch (error) {
		console.error("Error Scheduling Birthday Messages:", error);
	}
};

// Send queued birthday messages
const sendBirthdayMessages = async () => {
	try {
		while (await redisClient.lLen("birthdayMessages")) {
			const queuedMessage = await redisClient.lPop("birthdayMessages");
			const {
				userId,
				message: queuedMessageText,
				timestamp,
				retryAttempts = 0,
			} = JSON.parse(queuedMessage);

			// // Check if the message is recoverable (within 24 hours) and has not exceeded retry attempts
			// if (Date.now() - timestamp < 24 * 60 * 60 * 1000 && retryAttempts < 3) {
			// 	// Retrieve user details from MongoDB
			// 	const user = await findUsersWithBirthdaysToday(userId);
			// 	console.log("ini data user di func sendBirthday", user);

			// 	// Send the birthday message via email service API
			// 	try {
			// 		await sendEmail(user, queuedMessageText);
			// 		console.log("Sent Birthday Message:", queuedMessageText);
			// 		continue;
			// 	} catch (error) {
			// 		// Update the retryAttempts for the message in the Redis list
			// 		const updatedUnsentMessage = {
			// 			userId,
			// 			message: queuedMessageText,
			// 			timestamp,
			// 			retryAttempts: retryAttempts + 1,
			// 		};
			// 		const index = await redisClient.lPos(
			// 			"birthdayMessages",
			// 			queuedMessage
			// 		);
			// 		redisClient.lSet(
			// 			"birthdayMessages",
			// 			index,
			// 			JSON.stringify(updatedUnsentMessage)
			// 		);
			// 		console.log("Updated Unsent Birthday Message:", updatedUnsentMessage);
			// 	}
			// } // If the message is not successfully sent or exceeds retry attempts, remove it from the Redis list
			// console.log("Removing Unsent Birthday Message:", queuedMessageText);

			// Check if the message is recoverable (within 24 hours) and has not exceeded retry attempts
			if (Date.now() - timestamp < 24 * 60 * 60 * 1000 && retryAttempts < 3) {
				// Retrieve user details from MongoDB within a transaction
				const session = await mongoose.startSession();
				let user;
				try {
					await session.withTransaction(async () => {
						user = await UserModel.findById(userId).session(session);

						// Send the birthday message via email service API
						try {
							await sendEmail(user, queuedMessageText);
							console.log("Sent birthday message:", queuedMessageText);
						} catch (error) {
							console.error("Error sending birthday message:", error);
							throw error;
						}
					});
				} finally {
					session.endSession();
				}

				// If the transaction is successful, remove the message from the Redis list
				const index = await redisClient.lpos("birthdayMessages", queuedMessage);
				redisClient.lRem("birthdayMessages", index, 1);
				console.log("Removed sent birthday message:", queuedMessageText);
			} else {
				// If the message is not recoverable or exceeds retry attempts, remove it from the Redis list
				const index = await redisClient.lPos("birthdayMessages", queuedMessage);
				redisClient.lRem("birthdayMessages", index, 1);
				console.log("Removed unsent birthday message:", queuedMessageText);
			}
		}
	} catch (error) {
		console.error("Error Sending Birthday Messages:", error);
	}
};

// Simulate sending an email (HTTP request to email service API)
const sendEmail = async (user, message) => {
	try {
		const emailServiceUrl =
			"https://email-service.digitalenvision.com.au/send-email";
		const payload = {
			email: user.email,
			message: message,
		};

		await axios.post(emailServiceUrl, payload);
		if (response.status === 200) {
			// Update the sendEmail status to true
			await updateSendEmailStatus(user._id);
			console.log(
				`Birthday Message Sent To ${firstName} ${lastName} At ${getServerTimeOnUTC0} Server Time And ${getUserTime} User's Time`
			);
		} else {
			console.log(response);
			throw new Error("Failed To Send Birthday Message.");
		}
		// Note: The API might return errors, but we're assuming it's working fine for this example.
	} catch (error) {
		console.error("Error sending email:", error);
		throw error; // Rethrow the error to handle retries or other recovery mechanisms
	}
};

export { scheduleBirthdayMessages, sendBirthdayMessages };
