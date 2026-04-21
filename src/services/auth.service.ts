import { prisma } from "../utils/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export async function registerUser(
  email: string,
  password: string,
  displayName: string,
): Promise<{ id: string; email: string; displayName: string; createdAt: Date }> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw Object.assign(new Error("Email already in use"), { status: 409 });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.create({
    data: { email, displayName, passwordHash },
    select: { id: true, email: true, displayName: true, createdAt: true },
  });
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string; displayName: string } }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw Object.assign(new Error("Invalid credentials"), { status: 401 });
  }
  const token = jwt.sign(
    { id: user.id, email: user.email, displayName: user.displayName },
    process.env.JWT_SECRET ?? "",
    { expiresIn: "7d" },
  );
  return { token, user: { id: user.id, email: user.email, displayName: user.displayName } };
}
