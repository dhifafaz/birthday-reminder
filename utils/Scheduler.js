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
const smembersAsync = promisify(redisClient.smembers).bind(redisClient);
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
				`Sent Birthday Message To ${user.firstName} ${user.lastName}: ${message}`
			);
			await updateSendEmailStatus(user._id);
		} else {
			console.error(
				`Failed To Send Birthday Message To ${user.firstName} ${user.lastName}`
			);
		}
	} catch (error) {
		console.error(
			`Error Sending Birthday Message To ${user.firstName} ${user.lastName}:`,
			error.response.status
		);
		throw error;
	}
};

const scheduleBirthdayMessages = async () => {
	console.log("Running Scheduler......");
	try {
		const users = await findUsersWithBirthdaysToday();
		if (users.length === 0) {
			console.log("No Users With Birthdays Today.");
			return;
		}

		for (const user of users) {
			const { location, firstName, lastName, _id: userId, scheduled } = user;
			const localTime = moment().tz(location);
			const nineAMLocalTime = localTime
				.clone()
				.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

			if (moment().utc().isSameOrBefore(nineAMLocalTime, "hour")) {
				const delay = nineAMLocalTime.diff(moment().utc(), "milliseconds");
				const isScheduled = await zscoreAsync("birthdayMessages", userId);

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
					} else {
						console.log(`Failed To Update Scheduled Status For User ${userId}`);
					}
				} else {
					console.log(
						`Birthday Message Already Scheduled For ser ${userId}. And Scheduled Status Is ${scheduled}`
					);
				}
			} else {
				console.log(`Skipping Scheduling For User ${userId}.`);
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
		if (tasks.length === 0) {
			console.log("No Delayed Tasks To Process.");
			return;
		}

		for (const task of tasks) {
			const {
				userId,
				message,
				timestamp,
				retryAttempts = 0,
			} = JSON.parse(task);

			const user = await UserModel.findById(userId);
			if (!user) {
				console.log(`User Not Found For ID: ${userId}`);
				continue;
			}

			const { location } = user;
			const userLocalTime = moment(timestamp).tz(location);
			const nineAMUserLocalTime = userLocalTime
				.clone()
				.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

			if (!moment().utc().isSame(nineAMUserLocalTime, "hour")) {
				console.log(
					`Skipping Delayed Birthday Message For User ${userId}. Not Yet 9 AM In User's Local Timezone.`
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
				await sendEmail(user, message);
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
					await zremAsync("birthdayMessages", task);
					await saddAsync("failedRetryMessages", userId);
					await saddAsync(
						"failedMessages",
						JSON.stringify({ userId, message })
					);
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
		const failedRetryMessages = await smembersAsync("failedRetryMessages");
		if (!failedRetryMessages.length) {
			console.log("No Failed Retry Messages Found");
			return;
		}

		for (const userId of failedRetryMessages) {
			const user = await UserModel.findById(userId);
			if (!user) {
				console.log(`User Not Found For ID: ${userId}`);
				continue;
			}

			const failedMessages = await smembersAsync("failedMessages");
			const userFailedMessages = failedMessages.filter((message) => {
				const parsedMessage = JSON.parse(message);
				return parsedMessage.userId === userId;
			});

			for (const failedMessage of userFailedMessages) {
				try {
					await sendEmail(user, failedMessage);
					console.log(
						"Success Recovering And Sending Failed Message:",
						failedMessage
					);
					await zremAsync("failedMessages", failedMessage);
				} catch (error) {
					console.error("Error Recovering And Sending Failed Message:", error);
				}
			}

			await zremAsync("failedRetryMessages", userId);
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

export default runScheduler;
