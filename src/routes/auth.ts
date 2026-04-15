import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../utils/prisma.js";

export const authRouter = Router();

const JWT_SECRET = process.env.JWT_SECRET || "change-me-to-a-real-secret-in-production";

// BUG #9 (PLANTED): No rate limiting on login endpoint — an attacker can
// brute-force passwords with unlimited attempts per second.
// Should use express-rate-limit or similar middleware.

// Register
authRouter.post("/register", async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, passwordHash, displayName },
    });

    const { passwordHash: _, ...userWithoutPassword } = user;
    res.status(201).json({ data: userWithoutPassword });
  } catch (error) {
    next(error);
  }
});

// Login
authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: { message: "Invalid credentials" } });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: { message: "Invalid credentials" } });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: "24h" },
    );

    const { passwordHash: _, ...userWithoutPassword } = user;
    res.json({ data: { token, user: userWithoutPassword } });
  } catch (error) {
    next(error);
  }
});
