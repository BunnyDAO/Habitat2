import { Request, Response, NextFunction } from 'express';
import { createClient } from 'redis';

const redisUrl = `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;

const redisClient = createClient({
  url: redisUrl
});

redisClient.connect().catch(console.error);

export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const key = `rate-limit:${req.ip}:${req.path}`;
  const limit = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000');
  const window = parseInt(process.env.RATE_LIMIT_WINDOW || '900');

  try {
    const current = await redisClient.incr(key);
    if (current === 1) {
      await redisClient.expire(key, window);
    }

    if (current > limit) {
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: await redisClient.ttl(key)
      });
    }

    next();
  } catch (error) {
    console.error('Rate limit error:', error);
    next(); // Continue if Redis fails
  }
}; 