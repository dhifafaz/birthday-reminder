import UserModel from "../models/UserModel.js";

export const createUser = async (req, res) => {
	const data = req.body;

	const user = new UserModel({
		firstName: data.firstName || "",
		lastName: data.lastName || "",
		birthday: data.birthday || "",
		location: data.location || "",
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
					firstName: response.firstName,
					lastName: response.lastName,
					birthday: response.birthday,
					location: response.location,
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
