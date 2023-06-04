import express from "express";
import {
	createUser,
	getUsers,
	getUserById,
	deleteUserById,
} from "../controllers/UserController.js";
import Prefix from "./Prefix.js";

const router = express.Router();

router.post(`${Prefix}/user`, createUser);
router.get(`${Prefix}/users`, getUsers);
router.get(`${Prefix}/user/:id`, getUserById);
router.delete(`${Prefix}/user/:id`, deleteUserById);


export default router;
