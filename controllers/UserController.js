import UserModel from "../models/UserModel.js";
import moment from "moment";

export const createUser = async (req, res) => {
	const data = req.body;

	const user = new UserModel({
		email: data.email || "",
		firstName: data.firstName || "",
		lastName: data.lastName || "",
		birthday: data.birthday || "",
		location: data.location || "",
		sendEmail: data.sendEmail || false,
	});

	try {
		await user.save().then((response) => {
			res.status(201).json({
				meta: {
					code: 201,
					success: true,
					message: "User Created",
				},
				data: {
					id: response._id,
					email: response.email,
					firstName: response.firstName,
					lastName: response.lastName,
					birthday: response.birthday,
					location: response.location,
					sendEmail: response.sendEmail,
				},
			});
		});
	} catch (error) {
		console.log(error.message);
		res.status(400).json({
			code: 400,
			success: false,
			message: error.message,
		});
	}
};

export const getUsers = async (req, res) => {
	try {
		await UserModel.find().then((response) => {
			res.status(200).json({
				meta: {
					code: 200,
					success: true,
					message: "Users Fetched",
				},
				data: response,
			});
		});
	} catch (error) {
		console.log(error.message);
		res.status(400).json({
			code: 400,
			success: false,
			message: error.message,
		});
	}
};

export const getUserById = async (req, res) => {
	try {
		await UserModel.findById(req.params.id).then((response) => {
			res.status(200).json({
				meta: {
					code: 200,
					success: true,
					message: "User Fetched",
				},
				data: response,
			});
		});
	} catch (error) {
		console.log(error.message);
		res.status(400).json({
			code: 400,
			success: false,
			message: error.message,
		});
	}
};

export const deleteUserById = async (req, res) => {
	try {
		await UserModel.findByIdAndDelete(req.params.id).then((response) => {
			res.status(200).json({
				meta: {
					code: 200,
					success: true,
					message: "User Deleted",
				},
				data: response,
			});
		});
	} catch (error) {
		console.log(error.message);
		res.status(400).json({
			code: 400,
			success: false,
			message: error.message,
		});
	}
};

export const updateSendEmailStatus = async (userId) => {
	try {
		await UserModel.findByIdAndUpdate(userId, {
			sendEmail: true,
		}).then((response) => {
			console.log("User Updated");
		});
	} catch (error) {
		console.log(error.message);
	}
};

export const findUsersWithBirthdaysToday = async () => {
	try {
		const users = await UserModel.find();
		const usersWithBirthdaysToday = users.filter((user) => {
			const birthday = moment(user.birthday).format("MM-DD");
			const today = moment().utc().format("MM-DD");
			if (user.sendEmail === false) {
				return birthday === today;
			}
			return false;
		});
		return usersWithBirthdaysToday;
	} catch (error) {
		console.log(error.message);
	}
};

export const findUsersWithBirthdaysByID = async (userId) => {
	try {
		const user = await UserModel.find(userId);
		return user;
	} catch (error) {
		console.log(error.message);
	}
};
