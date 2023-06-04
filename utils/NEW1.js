import moment from "moment-timezone";
import axios from "axios";
import Redis from "ioredis";
import { uuid } from "uuidv4";

import {
	updateSendEmailStatus,
	findUsersWithBirthdaysToday,
	// findUsersWithBirthdaysByID,
} from "../controllers/UserController.js";
import mongoose from "mongoose";

import UserModel from "../models/UserModel.js";

// Set up Redis connection
const redisClient = new Redis();
// Check the connection status
redisClient.on("connect", () => console.log("Redis Client Connected"));
redisClient.on("error", (error) =>
	console.log("Redis Client Connection Error", error)
);

// if (redisClient.status === "connect") {
// 	console.log("Connected to Redis");
// } else {
// 	console.log("Not connected to Redis");
// }

const MAX_RETRY_ATTEMPTS = 3;

const sendEmail = async (user, message) => {
	try {
		const response = await axios.post(
			"https://email-service.digitalenvision.com.au/send-email",
			{
				email: user.email,
				message: message,
			}
		);

		if (response.status === 200) {
			console.log(
				`Sent birthday message to ${user.firstName} ${user.lastName}: ${message}`
			);
			await updateSendEmailStatus(user._id);
		} else {
			console.error(
				`Failed to send birthday message to ${user.firstName} ${user.lastName}`
			);
		}
	} catch (error) {
		console.error(
			`Error sending birthday message to ${user.firstName} ${user.lastName}:`
		);
	}
};

// Schedule birthday messages for all users
const scheduleBirthdayMessages = async () => {
	try {
		const users = await findUsersWithBirthdaysToday();
		console.log("ini data users di data schedule", users);

		// users.forEach((user) => {
		for (const user of users) {
			const { location, firstName, lastName, _id: userId, sendEmail } = user;
			const localTime = moment().tz(location);
			const nineAMLocalTime = localTime
				.clone()
				.set({ hour: 8, minute: 35, second: 0, millisecond: 0 });

			if (moment().utc().isSameOrBefore(nineAMLocalTime, "minute")) {
				// if (localTime.hour() === 2 && localTime.minute() === 40) {
				const delay = nineAMLocalTime.diff(moment(), "milliseconds");
				console.log("delay", delay);
				const isScheduled = await redisClient.zrank("birthdayMessages", userId);

				if (isScheduled === null && sendEmail === false) {
					// setTimeout(() => {
					const messageId = uuid();
					const message = `Hey, ${firstName} ${lastName}, it's your birthday!`;

					const birthdayMessage = {
						id: messageId,
						userId,
						message,
						timestamp: nineAMLocalTime.valueOf(),
						retryAttempts: 0,
					};

					// redisClient.zadd(
					// 	"birthdayMessages",
					// 	delay,
					// 	JSON.stringify(birthdayMessage)
					// );
					const payload = JSON.stringify(birthdayMessage);
					// prevent adding duplicate messages to redis queue by checking if message already exists using userId
					// Check if the user ID already exists in the sorted set

					redisClient.zadd("birthdayMessages", delay, payload);
					console.log("Scheduled birthday message:", birthdayMessage);
					// }, delay);
				} else {
					console.log(
						`Birthday Message Already Scheduled For User ${userId}. And Email Send Status Is ${sendEmail}`
					);
				}
			} else {
				console.log("Skipping scheduling for User", userId);
			}
			// });
		}
	} catch (error) {
		console.error("Error Scheduling Birthday Messages:", error);
	}
};

// Send queued birthday messages
const sendBirthdayMessages = async () => {
	console.log("Sending Birthday Messages......");
	try {
		while (await redisClient.zcard("birthdayMessages")) {
			const [queuedMessage] = await redisClient.zrange(
				"birthdayMessages",
				0,
				0
			);
			const {
				// id,
				userId,
				message,
				timestamp,
				retryAttempts = 0,
			} = JSON.parse(queuedMessage);

			const user = await UserModel.findById(userId);
			if (!user) {
				console.log(`User not found for ID: ${userId}`);
				continue;
			}

			const { location } = user;
			const localTime = moment().tz(location);
			const nineAMLocalTime = localTime
				.clone()
				.set({ hour: 8, minute: 35, second: 0, millisecond: 0 });

			if (
				moment(timestamp).isSame(nineAMLocalTime, "minute") &&
				moment.utc() - timestamp < 24 * 60 * 60 * 1000 &&
				retryAttempts < MAX_RETRY_ATTEMPTS
			) {
				// Check if the message has already been sent
				const isMessageSent = await redisClient.sismember(
					"sentMessages",
					userId
				);
				if (isMessageSent) {
					console.log("Skipping Already Sent Birthday Message:", message);
					redisClient.zrem("birthdayMessages", queuedMessage);
					continue;
				}

				const session = await mongoose.startSession();
				try {
					await session.withTransaction(async () => {
						try {
							await sendEmail(user, message);
							console.log("Success Sending Birthday Message:", message);
						} catch (error) {
							console.error("Error Sending Birthday Message");
							throw error;
						}
					});
				} finally {
					session.endSession();
				}

				const messageId = JSON.parse(queuedMessage).id;
				redisClient.zrem("birthdayMessages", queuedMessage);
				console.log("Removed Sent Birthday Message:", message);
				redisClient.sadd("sentMessages", messageId);
			} else {
				const { id, ...updatedMessage } = JSON.parse(queuedMessage);
				updatedMessage.retryAttempts = retryAttempts + 1;
				const updatedMessageJson = JSON.stringify(updatedMessage);

				redisClient.zrem("birthdayMessages", queuedMessage);
				redisClient.zadd("birthdayMessages", timestamp, updatedMessageJson);
				console.log(
					"Updated Retry Attempts For Unsent Birthday Message:",
					message
				);

				if (updatedMessage.retryAttempts >= MAX_RETRY_ATTEMPTS) {
					const messageId = updatedMessage.id;
					redisClient.zrem("birthdayMessages", updatedMessageJson);
					console.log("Removed Failed Retry Birthday Message:", message);
					redisClient.sadd("failedRetryMessages", messageId);
				}
			}
		}
	} catch (error) {
		console.error("Error Sending Birthday Messages");
	}
};

// // Retry sending unsent birthday messages
// const retryUnsentMessages = async () => {
// 	try {
// 		const unsentMessageIds = await redisClient.smembers("unsentMessages");

// 		for (const messageId of unsentMessageIds) {
// 			const queuedMessage = await redisClient.lindex(
// 				"failedMessages",
// 				messageId
// 			);
// 			if (!queuedMessage) continue;

// 			const { userId, message, timestamp, retryAttempts } =
// 				JSON.parse(queuedMessage);
// 			if (
// 				Date.now() - timestamp < 24 * 60 * 60 * 1000 &&
// 				retryAttempts < MAX_RETRY_ATTEMPTS
// 			) {
// 				const session = await mongoose.startSession();
// 				let user;
// 				try {
// 					await session.withTransaction(async () => {
// 						user = await UserModel.findById(userId).session(session);

// 						try {
// 							await sendEmail(user, message);
// 							console.log("Sent Retry Birthday Message:", message);
// 						} catch (error) {
// 							console.error("Error Sending Retry Birthday Message");
// 							throw error;
// 						}
// 					});
// 				} finally {
// 					session.endSession();
// 				}

// 				redisClient.lrem("failedMessages", 0, queuedMessage);
// 				console.log("Removed Unsent Retry Birthday Message:", message);
// 				redisClient.sadd("sentMessages", messageId);
// 			} else {
// 				redisClient.lrem("failedMessages", 0, queuedMessage);
// 				console.log("Removed Failed Retry Birthday Message:", message);
// 				redisClient.sadd("failedRetryMessages", messageId);
// 			}
// 		}
// 	} catch (error) {
// 		console.error("Error Retrying Unsent Birthday Messages");
// 	}
// };

export { scheduleBirthdayMessages, sendBirthdayMessages };
