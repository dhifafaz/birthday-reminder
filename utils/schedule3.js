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

// Process delayed birthday messages and send them
const processDelayedTasks = async () => {
	try {
		const now = moment().valueOf();
		const tasks = await redisClient.zrangebyscore("birthdayMessages", 0, now);

		for (const task of tasks) {
			const {
				userId,
				message,
				timestamp,
				retryAttempts = 0,
			} = JSON.parse(task);

			const user = await UserModel.findById(userId);
			if (!user) {
				console.log(`User not found for ID: ${userId}`);
				continue;
			}

			const { firstName, lastName, location } = user;
			const userLocalTime = momentTimezone(timestamp).tz(location);
			const nineAMUserLocalTime = userLocalTime
				.clone()
				.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

			if (!moment().isSame(nineAMUserLocalTime, "minute")) {
				console.log(
					`Skipping delayed birthday message for user ${userId}. Not yet 9 am in user's local timezone.`
				);
				continue;
			}

			// Check if the message has already been sent
			const isMessageSent = await redisClient.sismember("sentMessages", userId);
			if (isMessageSent) {
				console.log("Skipping already sent birthday message:", message);
				redisClient.zrem("birthdayMessages", task);
				continue;
			}

			try {
				await sendEmail(user, message);
				console.log("Success sending birthday message:", message);
				redisClient.zrem("birthdayMessages", task);
				redisClient.sadd("sentMessages", userId);
			} catch (error) {
				console.error("Error sending birthday message:", error);

				if (retryAttempts < MAX_RETRY_ATTEMPTS) {
					const updatedTask = JSON.parse(task);
					updatedTask.retryAttempts = retryAttempts + 1;
					redisClient.zadd(
						"birthdayMessages",
						now,
						JSON.stringify(updatedTask)
					);
				} else {
					console.log(
						`Maximum retry attempts reached for birthday message: ${message}`
					);
					redisClient.zrem("birthdayMessages", task);
					redisClient.sadd("failedRetryMessages", userId);
				}
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
			const { location, firstName, lastName, _id: userId, scheduled } = user;
			const localTime = moment().tz(location);
			const nineAMLocalTime = localTime
				.clone()
				.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
			const delay = nineAMLocalTime.diff(localTime);

			if (delay > 0) {
				const isScheduled = await redisClient.zrank("birthdayMessages", userId);

				if (isScheduled === null && !scheduled) {
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
					await updateScheduledStatus(userId);
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

export { processDelayedBirthdayMessages, processDelayedTasks };
