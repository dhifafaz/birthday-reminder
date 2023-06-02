import UserModel from "../models/UserModel.js";

export const createUser = async (req, res) => {
	const { firstName, lastName, birthday, location } = req.body;
	// const data = req.body;

	const user = new UserModel({
		// firstName: data.firstName || "",
		// lastName: data.lastName || "",
		// birthday: data.birthday || "",
		// location: data.location || "",
		firstName: firstName || "",
		lastName: lastName || "",
		birthday: birthday || "",
		location: location || "",
	});

	try {
		await user.save().then((response) => {
			res.status(201).json({
				message: "User Created",
				id: response.id,
			});
		});
	} catch (error) {
		console.log(error.message);
		res.status(404).json({ message: error.message });
	}
};
