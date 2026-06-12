import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'temp-fallback-secret-key-change-in-env';
if (JWT_SECRET === 'temp-fallback-secret-key-change-in-env') {
  console.warn("WARNING: JWT_SECRET environment variable is not defined!");
}

export interface JwtPayload {
  userId: string;
  role: string;
}

export const generateToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });
};

export const verifyToken = (token: string): JwtPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch (error) {
    return null;
  }
};
