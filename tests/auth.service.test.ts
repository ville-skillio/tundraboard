import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { prisma } from "../src/utils/prisma.js";
import { registerUser, loginUser } from "../src/services/auth.service.js";

vi.mock("../src/utils/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
    compare: vi.fn(),
  },
}));

const MOCK_USER = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  passwordHash: "hashed-password",
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("auth.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "test-secret";
  });

  describe("registerUser", () => {
    it("creates and returns a new user when the email is not taken", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue(MOCK_USER);

      const result = await registerUser("test@example.com", "password123", "Test User");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: "test@example.com" },
      });
      expect(prisma.user.create).toHaveBeenCalled();
      expect(result).toHaveProperty("email", "test@example.com");
    });

    it("throws a 409 error when the email is already in use", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER);

      await expect(
        registerUser("test@example.com", "password123", "Test User"),
      ).rejects.toMatchObject({ message: "Email already in use", status: 409 });

      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe("loginUser", () => {
    it("returns a JWT token and user object on valid credentials", async () => {
      const bcrypt = (await import("bcryptjs")).default;
      vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const result = await loginUser("test@example.com", "password123");

      expect(result).toHaveProperty("token");
      expect(result.user).toMatchObject({
        id: "user-1",
        email: "test@example.com",
        displayName: "Test User",
      });

      const decoded = jwt.decode(result.token) as Record<string, unknown>;
      expect(decoded).toHaveProperty("id", "user-1");
    });

    it("throws a 401 error when the user does not exist", async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      await expect(loginUser("nobody@example.com", "password123")).rejects.toMatchObject({
        status: 401,
      });
    });

    it("throws a 401 error when the password is wrong", async () => {
      const bcrypt = (await import("bcryptjs")).default;
      vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      await expect(loginUser("test@example.com", "wrongpassword")).rejects.toMatchObject({
        status: 401,
      });
    });
  });
});
