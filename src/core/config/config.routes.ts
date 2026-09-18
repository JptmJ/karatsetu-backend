import { Router } from 'express';
import { z } from 'zod';
import { handler, param, requirePermission, validate } from '../http/middleware.js';
import { transaction } from '../db/client.js';
import { describeConfig, setConfig } from './config-service.js';

export const configRouter = Router();

/** Everything the settings screen needs, grouped and with its source shown. */
configRouter.get(
  '/',
  requirePermission('settings.config.view'),
  handler(async (_req, res) => {
    const rows = await transaction(describeConfig);
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) (grouped[row.group] ??= []).push(row);
    res.json({ groups: grouped });
  }),
);

configRouter.put(
  '/:key',
  requirePermission('settings.config.update'),
  validate({
    params: z.object({ key: z.string().min(1) }),
    body: z.object({
      value: z.unknown(),
      branchId: z.string().uuid().nullish(),
      reason: z.string().max(500).optional(),
    }),
  }),
  handler(async (req, res) => {
    const key = param(req, 'key');
    await transaction((tx) =>
      setConfig(tx, key, req.body.value, {
        branchId: req.body.branchId ?? null,
        reason: req.body.reason,
      }),
    );
    res.json({ ok: true, key });
  }),
);
