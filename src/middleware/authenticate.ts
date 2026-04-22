import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-to-a-real-secret-in-production";

interface JwtPayload {
  userId: string;
  email: string;
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: { message: "Missing or invalid authorization header" } });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;

    req.user = {
      id: payload.userId,
      email: payload.email,
      displayName: "",
    };
    next();
  } catch {
    res.status(401).json({ error: { message: "Invalid token" } });
  }
}
