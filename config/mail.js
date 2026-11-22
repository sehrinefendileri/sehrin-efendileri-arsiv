import nodemailer from 'nodemailer';
import { env } from './env.js';
export const mailTransport = nodemailer.createTransport({
  host: 'smtp.office365.com', port: 587, secure: false,
  auth: { user: env.emailUser, pass: env.emailPass }
});
