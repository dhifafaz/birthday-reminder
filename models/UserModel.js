import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
	firstName: { type: String, required: true },
	lastName: { type: String, required: true },
	birthday: { type: Date, required: true },
	location: { type: String, required: true },
});

const UserModel = mongoose.model("User", userSchema);

export default UserModel;
