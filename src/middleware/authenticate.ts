import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: { message: "Authorization header missing or malformed" } });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? "") as {
      id: string;
      email: string;
      displayName: string;
    };
    req.user = { id: payload.id, email: payload.email, displayName: payload.displayName };
    next();
  } catch {
    res.status(401).json({ error: { message: "Invalid or expired token" } });
  }
}
