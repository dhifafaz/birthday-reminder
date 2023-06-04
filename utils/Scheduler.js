import moment from "moment-timezone";
import axios from "axios";
import { uuid } from "uuidv4";
import { promisify } from "util";

import client from "../config/Redis.js";
import {
	updateSendEmailStatus,
	findUsersWithBirthdaysToday,
	updateScheduledStatus,
} from "../controllers/UserController.js";
import UserModel from "../models/UserModel.js";

const redisClient = client;
// Promisify Redis commands
const zrangebyscoreAsync = promisify(redisClient.zrangebyscore).bind(
	redisClient
);
const zremAsync = promisify(redisClient.zrem).bind(redisClient);
const zaddAsync = promisify(redisClient.zadd).bind(redisClient);
const saddAsync = promisify(redisClient.sadd).bind(redisClient);
const sismemberAsync = promisify(redisClient.sismember).bind(redisClient);
const zscoreAsync = promisify(redisClient.zscore).bind(redisClient);

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
			error.response.status
		);
		throw error;
	}
};

const scheduleBirthdayMessages = async () => {
	console.log("Running Scheduler......");
	try {
		const users = await findUsersWithBirthdaysToday();
		console.log("Users with birthdays today:", users);

		for (const user of users) {
			const { location, firstName, lastName, _id: userId, scheduled } = user;
			const localTime = moment().tz(location);
			const nineAMLocalTime = localTime
				.clone()
				.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

			if (moment().utc().isSameOrBefore(nineAMLocalTime, "hour")) {
				const delay = nineAMLocalTime.diff(moment().utc(), "milliseconds");
				console.log("Delay:", delay);
				const isScheduled = await zscoreAsync("birthdayMessages", userId);
				console.log("isi schedule", isScheduled);

				if (isScheduled === null && !scheduled) {
					const updateStatusResult = await updateScheduledStatus(userId);
					console.log(updateStatusResult);
					if (updateStatusResult) {
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
						await zaddAsync("birthdayMessages", delay, payload);
						console.log("Scheduled birthday message:", birthdayMessage);
					} else {
						console.log(`Failed to update scheduled status for User ${userId}`);
					}
				} else {
					console.log(
						`Birthday message already scheduled for User ${userId}. And scheduled status is ${scheduled}`
					);
				}
			} else {
				console.log(`Skipping scheduling for User ${userId}.`);
			}
		}
	} catch (error) {
		console.error("Error scheduling birthday messages:", error);
	}
};

const processDelayedTasks = async () => {
	console.log("Running The Schedule And Sending Birthday Messages......");
	try {
		const now = moment().utc().valueOf();
		const tasks = await zrangebyscoreAsync("birthdayMessages", 0, now);
		console.log("Tasks:", tasks);

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

			const { location } = user;
			const userLocalTime = moment(timestamp).tz(location);
			const nineAMUserLocalTime = userLocalTime
				.clone()
				.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
			console.log("nineAMUserLocalTime", nineAMUserLocalTime);

			if (!moment().utc().isSame(nineAMUserLocalTime, "hour")) {
				console.log(
					`Skipping delayed birthday message for user ${userId}. Not yet 9 am in user's local timezone.`
				);
				continue;
			}

			// Check if the message has already been sent
			const isMessageSent = await sismemberAsync("sentMessages", userId);
			if (isMessageSent) {
				console.log("Skipping already sent birthday message:", message);
				await zremAsync("birthdayMessages", task);
				continue;
			}

			try {
				await sendEmail(user, message);
				console.log("Success sending birthday message:", message);
				await zremAsync("birthdayMessages", task);
				await saddAsync("sentMessages", userId);
			} catch (error) {
				console.error("Error sending birthday message");

				if (retryAttempts < MAX_RETRY_ATTEMPTS) {
					const updatedTask = JSON.parse(task);
					updatedTask.retryAttempts = retryAttempts + 1;
					await redisClient
						.multi()
						.zrem("birthdayMessages", task)
						.zadd("birthdayMessages", now, JSON.stringify(updatedTask))
						.exec();
				} else {
					console.log(
						`Maximum retry attempts reached for birthday message: ${message}`
					);
					await zremAsync("birthdayMessages", task);
					await saddAsync("failedRetryMessages", userId);
				}
			}
		}
	} catch (error) {
		console.error("Error processing delayed tasks");
	}
};

const runScheduler = async () => {
	while (true) {
		await scheduleBirthdayMessages();
		await processDelayedTasks();
		await new Promise((resolve) => setTimeout(resolve, 60000));
	}
};

export default runScheduler;
