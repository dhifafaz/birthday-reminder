import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
	email: {
		type: String,
		required: true,
		match: [
			/^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
			"Please Enter A Valid Email",
		],
	},
	firstName: { type: String, required: true },
	lastName: { type: String, required: true },
	birthday: { type: Date, required: true },
	location: { type: String, required: true },
	created_at: { type: Date, required: true, default: Date.now },
	sendEmail: { type: Boolean, required: true, default: false },
});

const UserModel = mongoose.model("User", userSchema);

export default UserModel;
