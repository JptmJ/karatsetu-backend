import { Router } from 'express';
import { z } from 'zod';
import { handler, validate } from '../../core/http/middleware.js';
import { login, refreshSession, revokeRefreshToken } from './auth.service.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  validate({
    body: z.object({
      tenantCode: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(1),
    }),
  }),
  handler(async (req, res) => {
    const { tenantCode, email, password } = req.body;
    const result = await login(tenantCode, email, password, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    res.json(result);
  }),
);

authRouter.post(
  '/refresh',
  validate({ body: z.object({ refreshToken: z.string().min(1) }) }),
  handler(async (req, res) => {
    res.json(await refreshSession(req.body.refreshToken));
  }),
);

authRouter.post(
  '/logout',
  validate({ body: z.object({ refreshToken: z.string().min(1) }) }),
  handler(async (req, res) => {
    await revokeRefreshToken(req.body.refreshToken);
    res.status(204).end();
  }),
);
