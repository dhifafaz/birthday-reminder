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
const processDelayedBirthdayMessages = async () => {
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
			const { userId, message, retryAttempts = 0 } = JSON.parse(queuedMessage);

			const user = await UserModel.findById(userId);
			if (!user) {
				console.log(`User not found for ID: ${userId}`);
				return;
			}

			const { location } = user;
			const localTime = moment().tz(location);
			const nineAMLocalTime = localTime
				.clone()
				.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

			if (
				moment(currentTime).isSame(nineAMLocalTime, "minute") &&
				moment.utc() - currentTime < 24 * 60 * 60 * 1000 &&
				retryAttempts < MAX_RETRY_ATTEMPTS
			) {
				const isMessageSent = await redisClient.sismember(
					"sentMessages",
					userId
				);
				if (isMessageSent) {
					console.log("Skipping Already Sent Birthday Message:", message);
					redisClient.zrem("birthdayMessages", queuedMessage);
					return;
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
				redisClient.zadd(
					"birthdayMessages",
					nineAMLocalTime.valueOf(),
					updatedMessageJson
				);
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
		console.error("Error Processing Delayed Birthday Messages");
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
