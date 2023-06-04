import moment from "moment-timezone";
import axios from "axios";
import Redis from "ioredis";
import { uuid } from "uuidv4";

import {
	updateSendEmailStatus,
	findUsersWithBirthdaysToday,
	updateScheduledStatus,
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
			`Error sending birthday message to ${user.firstName} ${user.lastName}:`,
			error
		);
	}
};

// Function to process delayed birthday messages
const processDelayedTasks = async () => {
	try {
		const currentTime = moment().valueOf();
		const [queuedMessage] = await redisClient.zrangebyscore(
			"birthdayMessages",
			0,
			currentTime,
			"LIMIT",
			0,
			1
		);

		if (queuedMessage) {
			// Process the task
			const { userId, message, retryAttempts = 0 } = JSON.parse(queuedMessage);
			const user = await UserModel.findById(userId);

			if (user) {
				const localTime = moment().tz(user.location);
				const nineAMLocalTime = localTime
					.clone()
					.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

				if (moment().isSame(nineAMLocalTime, "minute")) {
					try {
						await sendEmail(user, message);
						console.log("Sent birthday message:", message);
						// Remove the processed task from the sorted set
						redisClient.zrem("birthdayMessages", queuedMessage);
					} catch (error) {
						console.error("Error sending birthday message:", error);
						if (retryAttempts < 3) {
							// Retry the task by updating the retryAttempts count and re-adding it to the sorted set
							const updatedMessage = {
								...JSON.parse(queuedMessage),
								retryAttempts: retryAttempts + 1,
							};
							const updatedMessageJson = JSON.stringify(updatedMessage);

							redisClient.zrem("birthdayMessages", queuedMessage);
							redisClient.zadd(
								"birthdayMessages",
								currentTime,
								updatedMessageJson
							);
							console.log("Retrying failed birthday message:", message);
						} else {
							console.log(
								"Max retry attempts reached. Failed to send birthday message:",
								message
							);
							// Remove the failed task from the sorted set
							redisClient.zrem("birthdayMessages", queuedMessage);
							// Add the failed task to a separate set for logging or further processing
							redisClient.sadd("failedMessages", queuedMessage);
						}
					}
				} else {
					console.log("Skipping sending for user:", user._id);
				}
			} else {
				console.log(`User not found for ID: ${userId}`);
			}
		}
	} catch (error) {
		console.error("Error processing delayed tasks:", error);
        
	}
};

// Function to schedule birthday messages for all users
const scheduleBirthdayMessages = async () => {
	try {
		const users = await findUsersWithBirthdaysToday();
		console.log("Users with birthdays today:", users);

		for (const user of users) {
			const { location, firstName, lastName, _id: userId, sendEmail } = user;
			const localTime = moment().tz(location);
			const nineAMLocalTime = localTime
				.clone()
				.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
			const delay = nineAMLocalTime.diff(localTime);

			if (delay > 0) {
				const isScheduled = await redisClient.zrank("birthdayMessages", userId);

				if (isScheduled === null && !sendEmail) {
					const messageId = uuid();
					const message = `Hey, ${firstName} ${lastName}, it's your birthday!`;

					const birthdayMessage = {
						id: messageId,
						userId,
						message,
						timestamp: nineAMLocalTime.valueOf(),
						retryAttempts: 0,
					};

					const payload = JSON.stringify(birthdayMessage);
					redisClient.zadd(
						"birthdayMessages",
						nineAMLocalTime.valueOf(),
						payload
					);
					console.log("Scheduled birthday message:", birthdayMessage);
					await updateSendEmailStatus(userId);
				} else {
					console.log(
						`Birthday Message Already Scheduled For User ${userId}. And Email Send Status Is ${sendEmail}`
					);
				}
			} else {
				console.log("Skipping scheduling for User", userId);
			}
		}
	} catch (error) {
		console.error("Error Scheduling Birthday Messages:", error);
	}
};

export { processDelayedBirthdayMessages, scheduleBirthdayMessages };
