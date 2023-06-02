import express from "express";
import { createUser } from "../controllers/UserController.js";
import Prefix from "./Prefix.js";

const router = express.Router();

router.post(`${Prefix}/user`, createUser);

export default router;
