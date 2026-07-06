import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { getPublicCard } from '../services/publicService.js';

export const publicRoutes = express.Router();

publicRoutes.get('/cards/:token', validate(z.object({
  params: z.object({ token: z.string().min(10) })
})), asyncHandler(async (req, res) => {
  const card = await getPublicCard(req.params.token);
  res.json(card);
}));
