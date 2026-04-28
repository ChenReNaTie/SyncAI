import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type TokenKind = "access" | "refresh";

interface TokenPayload {
  sub: string;
  kind: TokenKind;
  iat: number;
  exp: number;
}

function encodeTokenSegment(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeTokenSegment(segment: string) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

function signTokenSegments(
  headerSegment: string,
  payloadSegment: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");
}

function isValidUuid(value: string) {
  return uuidPattern.test(value);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const parts = passwordHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = parts[1];
  const encodedHash = parts[2];
  if (!salt || !encodedHash) {
    return false;
  }
  const storedHash = Buffer.from(encodedHash, "base64url");
  const derivedKey = (await scryptAsync(password, salt, storedHash.length)) as Buffer;

  if (derivedKey.length !== storedHash.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, storedHash);
}

export function issueToken(input: {
  userId: string;
  kind: TokenKind;
  secret: string;
  ttlSeconds: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const payload: TokenPayload = {
    sub: input.userId,
    kind: input.kind,
    iat: issuedAt,
    exp: issuedAt + input.ttlSeconds,
  };
  const headerSegment = encodeTokenSegment({
    alg: "HS256",
    typ: "JWT",
  });
  const payloadSegment = encodeTokenSegment(payload);
  const signature = signTokenSegments(
    headerSegment,
    payloadSegment,
    input.secret,
  );

  return `${headerSegment}.${payloadSegment}.${signature}`;
}

export function issueTokenPair(input: {
  userId: string;
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  now?: Date;
}) {
  return {
    accessToken: issueToken({
      userId: input.userId,
      kind: "access",
      secret: input.accessSecret,
      ttlSeconds: input.accessTtlSeconds,
      ...(input.now ? { now: input.now } : {}),
    }),
    refreshToken: issueToken({
      userId: input.userId,
      kind: "refresh",
      secret: input.refreshSecret,
      ttlSeconds: input.refreshTtlSeconds,
      ...(input.now ? { now: input.now } : {}),
    }),
  };
}

export function verifyToken(input: {
  token: string;
  secret: string;
  expectedKind: TokenKind;
  now?: Date;
}) {
  const segments = input.token.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const headerSegment = segments[0];
  const payloadSegment = segments[1];
  const signatureSegment = segments[2];
  if (!headerSegment || !payloadSegment || !signatureSegment) {
    return null;
  }
  const expectedSignature = signTokenSegments(
    headerSegment,
    payloadSegment,
    input.secret,
  );
  const actualSignature = Buffer.from(signatureSegment);
  const signatureBuffer = Buffer.from(expectedSignature);

  if (
    actualSignature.length !== signatureBuffer.length ||
    !timingSafeEqual(actualSignature, signatureBuffer)
  ) {
    return null;
  }

  try {
    const header = decodeTokenSegment(headerSegment);
    const payload = decodeTokenSegment(payloadSegment) as Partial<TokenPayload>;
    const now = Math.floor((input.now ?? new Date()).getTime() / 1000);

    if (header.alg !== "HS256" || header.typ !== "JWT") {
      return null;
    }

    if (
      typeof payload.sub !== "string" ||
      !isValidUuid(payload.sub) ||
      payload.kind !== input.expectedKind ||
      typeof payload.exp !== "number" ||
      payload.exp <= now
    ) {
      return null;
    }

    return {
      userId: payload.sub,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string, secret: string) {
  return verifyToken({
    token,
    secret,
    expectedKind: "access",
  });
}

export function verifyRefreshToken(token: string, secret: string) {
  return verifyToken({
    token,
    secret,
    expectedKind: "refresh",
  });
}
