import { Router } from "express";
import { z } from "zod";
import { registerUser, loginUser } from "../services/auth.service.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/register", async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Validation failed", issues: parsed.error.issues } });
    return;
  }
  try {
    const user = await registerUser(
      parsed.data.email,
      parsed.data.password,
      parsed.data.displayName,
    );
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Validation failed", issues: parsed.error.issues } });
    return;
  }
  try {
    const result = await loginUser(parsed.data.email, parsed.data.password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
