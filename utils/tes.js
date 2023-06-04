// Import necessary dependencies
const express = require("express");
const mongoose = require("mongoose");
const moment = require("moment");
const momentTimezone = require("moment-timezone");
const redis = require("redis");
const axios = require("axios");

// Set up Express.js
const app = express();
app.use(express.json());

// Set up MongoDB connection
mongoose.connect("mongodb://localhost/birthday_app", {
	useNewUrlParser: true,
	useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => {
	console.log("Connected to MongoDB");
});

// Set up Redis connection
const redisClient = redis.createClient();
redisClient.on("connect", () => {
	console.log("Connected to Redis");
});
redisClient.on("error", console.error.bind(console, "Redis connection error:"));

// Define User model
const userSchema = new mongoose.Schema({
	firstName: String,
	lastName: String,
	birthday: Date,
	location: String,
});

const User = mongoose.model("User", userSchema);

// Schedule the birthday message sending task
const scheduleBirthdayMessages = async () => {
	const currentDateTime = moment();

	// Lock the task to prevent race conditions
	const lockKey = "lock:birthday-messages";
	const acquiredLock = await acquireLock(lockKey);
	if (!acquiredLock) {
		console.log(
			"Another instance is already running the birthday message task."
		);
		return;
	}

	try {
		// Query for users with birthdays today
		const today = currentDateTime.format("MM-DD");
		const users = await User.find({
			birthday: {
				$gte: new Date(`${today}T00:00:00Z`),
				$lt: new Date(`${today}T23:59:59Z`),
			},
		});

		for (const user of users) {
			// Calculate user's local 9 am time
			const userTimezone = momentTimezone.tz(user.location);
			const userLocalTime = moment.tz(
				currentDateTime.format("YYYY-MM-DD") + "T09:00:00",
				userTimezone
			);

			// Check if it's time to send the message
			if (currentDateTime.isSame(userLocalTime)) {
				// Send the birthday message
				const message = `Hey, ${user.firstName} ${user.lastName}, it's your birthday`;
				try {
					// Simulate sending the email by making a request to the API
					await axios.post(
						"https://email-service.digitalenvision.com.au/api/messages",
						{ message }
					);
					console.log(
						`Sent birthday message to ${user.firstName} ${user.lastName}`
					);
				} catch (error) {
					console.error(
						`Failed to send birthday message to ${user.firstName} ${user.lastName}`
					);
					// Add the message to the Redis queue with retry attempts
					await redisClient.rpush(
						"birthday-message-queue",
						JSON.stringify({ userId: user._id, message, retries: 0 })
					);
				}
			}
		}
	} catch (error) {
		console.error("An error occurred while sending birthday messages:", error);
	} finally {
		// Release the lock
		await releaseLock(lockKey);
	}
};

// Send unsent messages during system recovery and handle retry attempts
const sendUnsentMessages = async () => {
	const queueLength = await redisClient.llen("birthday-message-queue");

	for (let i = 0; i < queueLength; i++) {
		const message = await redisClient.lpop("birthday-message-queue");
		if (message) {
			try {
				const {
					userId,
					message: birthdayMessage,
					retries,
				} = JSON.parse(message);
				const user = await User.findById(userId);
				if (user) {
					// Calculate user's local 9 am time
					const userTimezone = momentTimezone.tz(user.location);
					const userLocalTime = moment
						.tz()
						.tz(userTimezone)
						.startOf("day")
						.add(9, "hours");

					// Check if it's time to send the message
					if (moment().isSame(userLocalTime)) {
						// Send the birthday message
						try {
							// Simulate sending the email by making a request to the API
							await axios.post(
								"https://email-service.digitalenvision.com.au/api/messages",
								{ message: birthdayMessage }
							);
							console.log(
								`Resent birthday message to ${user.firstName} ${user.lastName}`
							);
						} catch (error) {
							console.error(
								`Failed to resend birthday message to ${user.firstName} ${user.lastName}`
							);
							// Check retry attempts and add the message back to the Redis queue with incremented retries
							if (retries < 3) {
								await redisClient.rpush(
									"birthday-message-queue",
									JSON.stringify({
										userId,
										message: birthdayMessage,
										retries: retries + 1,
									})
								);
							} else {
								console.error(
									`Exceeded maximum retry attempts for birthday message to ${user.firstName} ${user.lastName}`
								);
							}
						}
					}
				}
			} catch (error) {
				console.error(
					"An error occurred while resending birthday messages:",
					error
				);
			}
		}
	}
};

// Helper functions for acquiring and releasing locks
const acquireLock = (lockKey) => {
	return new Promise((resolve, reject) => {
		redisClient.set(lockKey, "locked", "EX", 60, "NX", (error, result) => {
			if (error) {
				reject(error);
			} else {
				resolve(result === "OK");
			}
		});
	});
};

const releaseLock = (lockKey) => {
	return new Promise((resolve, reject) => {
		redisClient.del(lockKey, (error, result) => {
			if (error) {
				reject(error);
			} else {
				resolve(result);
			}
		});
	});
};

// API routes
app.post("/user", async (req, res) => {
	try {
		const { firstName, lastName, birthday, location } = req.body;
		const user = new User({ firstName, lastName, birthday, location });
		await user.save();
		res.status(201).json(user);
	} catch (error) {
		console.error("An error occurred while creating a user:", error);
		res.status(500).json({ error: "Failed to create user" });
	}
});

app.delete("/user/:id", async (req, res) => {
	try {
		const { id } = req.params;
		await User.findByIdAndDelete(id);
		res.status(204).end();
	} catch (error) {
		console.error("An error occurred while deleting a user:", error);
		res.status(500).json({ error: "Failed to delete user" });
	}
});

// Start the Express server
app.listen(3000, () => {
	console.log("Server listening on port 3000");
});

// Schedule the birthday message task to run at 9 am every day
setInterval(scheduleBirthdayMessages, 1000 * 60); // Check every minute for simplicity (adjust as needed)

// Send unsent messages during system recovery and handle retry attempts
sendUnsentMessages();
