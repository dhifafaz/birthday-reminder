import Redis from "ioredis";

// Set up Redis connection
const client = new Redis();
// Check the connection status
client.on("connect", () => console.log("Redis Client Connected"));
client.on("error", (error) =>
	console.log("Redis Client Connection Error", error)
);

export default client;