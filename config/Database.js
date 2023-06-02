import mongoose from "mongoose";
import * as dotenv from "dotenv";
dotenv.config();

const mongoString = process.env.DATABASE_URL;
const database = mongoose.connection;

database.on("error", (error) => {
	console.log("MongoDB Connection Error : " + error.message);
});

database.once("connected", () => {
	console.log("Database Connected");
});

function Connect() {
	mongoose.connect(mongoString, {
		useNewUrlParser: true,
		useUnifiedTopology: true,
	});
	return database;
}

export default Connect;
