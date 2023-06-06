import moment from "moment-timezone";
import axios from "axios";
import { promisify } from "util";

import client from "../config/Redis.js";
import {
	updateSendEmailStatus,
	findUsersWithBirthdaysToday,
	updateScheduledStatus,
} from "../controllers/UserController.js";

const redisClient = client;
// Promisify Redis commands
const zrangebyscoreAsync = promisify(redisClient.zrangebyscore).bind(
	redisClient
);
const zremAsync = promisify(redisClient.zrem).bind(redisClient);
const zaddAsync = promisify(redisClient.zadd).bind(redisClient);
const saddAsync = promisify(redisClient.sadd).bind(redisClient);
const sismemberAsync = promisify(redisClient.sismember).bind(redisClient);
const smembersAsync = promisify(redisClient.smembers).bind(redisClient);
const zscoreAsync = promisify(redisClient.zscore).bind(redisClient);

const MAX_RETRY_ATTEMPTS = 3;

const sendEmail = async (email, message, userId) => {
	try {
		const response = await axios.post(
			"https://email-service.digitalenvision.com.au/send-email",
			{
				email: email,
				message: message,
			}
		);

		if (response.status === 200) {
			console.log(`Sent Birthday Message`);
			await updateSendEmailStatus(userId);
		} else {
			console.error(`Failed To Send Birthday Message`);
		}
	} catch (error) {
		console.error(`Error Sending Birthday Message`, error.response.status);
		throw error;
	}
};

const scheduleBirthdayMessages = async () => {
	console.log("Running Scheduler......");
	try {
		const users = await findUsersWithBirthdaysToday();
		console.log("Users With Birthdays Today:", users);
		if (users.length === 0) {
			console.log("No Users With Birthdays Today.");
			return;
		}

		for (const user of users) {
			const {
				location,
				firstName,
				lastName,
				_id: userId,
				scheduled,
				email,
			} = user;
			const userLocalTime = moment().tz(location);

			if (userLocalTime.hour() >= 9) {
				console.log(
					`Skipping scheduling for user ${userId}. It is already 9 AM or later in user's local timezone.`
				);
				continue;
			}

			const isScheduled = await zscoreAsync("birthdayMessages", userId);

			if (isScheduled === null && !scheduled) {
				const delay = moment
					.duration({ hours: 9 - userLocalTime.hour() })
					.asMilliseconds();
				console.log("Delay:", delay);
				const updateStatusResult = await updateScheduledStatus(userId);
				console.log(updateStatusResult);
				if (updateStatusResult) {
					const message = `Hey, ${firstName} ${lastName}, it's your birthday!`;

					const birthdayMessage = {
						userId,
						message,
						location,
						email,
						retryAttempts: 0,
					};

					const payload = JSON.stringify(birthdayMessage);
					await zaddAsync("birthdayMessages", delay, payload);
				} else {
					console.log(`Failed To Update Scheduled Status For User ${userId}`);
				}
			} else {
				console.log(
					`Birthday Message Already Scheduled For ser ${userId}. And Scheduled Status Is ${scheduled}`
				);
			}
		}
	} catch (error) {
		console.error("Error Scheduling Birthday Messages:", error);
	}
};

const processDelayedTasks = async () => {
	console.log("Running The Schedule And Sending Birthday Messages......");
	try {
		const now = moment().utc().valueOf();
		const tasks = await zrangebyscoreAsync("birthdayMessages", 0, now);
		console.log("Delayed Tasks:", tasks);
		if (tasks.length === 0) {
			console.log("No Delayed Tasks To Process.");
			return;
		}

		for (const task of tasks) {
			const {
				userId,
				message,
				location,
				email,
				retryAttempts = 0,
			} = JSON.parse(task);

			const userLocalTime = moment().tz(location);

			if (
				userLocalTime.hour() !== 9 ||
				userLocalTime.minute() !== 0 ||
				userLocalTime.second() !== 0
			) {
				console.log(
					`Skipping delayed birthday message for user ${userId}. Not yet 9 AM in user's local timezone.`
				);
				continue;
			}

			// Check if the message has already been sent
			const isMessageSent = await sismemberAsync("sentMessages", userId);
			if (isMessageSent) {
				console.log("Skipping Already Sent Birthday Message:", message);
				await zremAsync("birthdayMessages", task);
				continue;
			}

			try {
				await sendEmail(email, message, userId);
				console.log("Success Sending Birthday Message:", message);
				await zremAsync("birthdayMessages", task);
				await saddAsync("sentMessages", userId);
			} catch (error) {
				console.error("Error Sending Birthday Message, System Will Retry.");

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
						`Maximum Retry Attempts Reached For Birthday Message: ${message}`
					);
					const failedMessage = {
						userId,
						message,
						email,
					};
					await zremAsync("birthdayMessages", task);
					await saddAsync("failedMessages", JSON.stringify(failedMessage));
				}
			}
		}
	} catch (error) {
		console.error("Error Processing Delayed Tasks");
	}
};

const recoverFailedMessages = async () => {
	console.log("Recovering Failed Messages...");
	try {
		const userFailedMessages = await smembersAsync("failedMessages");
		console.log("Failed Messages:", userFailedMessages);
		if (!userFailedMessages.length) {
			console.log("No Failed Retry Messages Found");
			return;
		}

		for (const failedMessage of userFailedMessages) {
			const { userId, message, email } = JSON.parse(failedMessage);
			try {
				await sendEmail(email, message, userId);
				console.log("Success Recovering And Sending Failed Message:", message);
				await zremAsync("failedMessages", failedMessage);
				await saddAsync("sentMessages", userId);
			} catch (error) {
				console.error("Error Recovering And Sending Failed Message:", error);
			}
		}
	} catch (error) {
		console.error("Error Recovering Failed Messages:", error);
	}
};

const runScheduler = async () => {
	let lastExecutedDay = null;

	while (true) {
		const currentDay = moment().utc().format("YYYY-MM-DD");

		if (currentDay !== lastExecutedDay) {
			await recoverFailedMessages();
			lastExecutedDay = currentDay;
		}
		await scheduleBirthdayMessages();
		await processDelayedTasks();
		await new Promise((resolve) => setTimeout(resolve, 60000));
	}
};

export {
	sendEmail,
	scheduleBirthdayMessages,
	processDelayedTasks,
	recoverFailedMessages,
	runScheduler,
};
