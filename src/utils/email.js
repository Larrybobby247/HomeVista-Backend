/**
 * HomeVista - Email Service
 * Sends transactional emails using Nodemailer
 */

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT || 587,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

/**
 * Send password reset verification code email
 */
const sendPasswordResetCode = async (email, code, firstName = 'there') => {
  const mailOptions = {
    from: `"HomeVista" <${process.env.EMAIL_FROM || 'noreply@homevista.com'}>`,
    to: email,
    subject: 'Your HomeVista Password Reset Code',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
          .logo { text-align: center; margin-bottom: 32px; }
          .logo h1 { color: #003334; font-size: 28px; margin: 0; }
          .heading { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 12px; text-align: center; }
          .message { color: #6b7280; font-size: 15px; line-height: 1.6; margin-bottom: 28px; text-align: center; }
          .code-box { background: #f0fdf4; border: 2px dashed #22c55e; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 28px; }
          .code { font-size: 36px; font-weight: 800; color: #003334; letter-spacing: 8px; font-family: 'Courier New', monospace; }
          .expiry { color: #ef4444; font-size: 13px; margin-top: 12px; font-weight: 500; }
          .footer { text-align: center; color: #9ca3af; font-size: 13px; margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 20px; }
          .warning { background: #fef3c7; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #92400e; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="logo">
            <h1>HomeVista</h1>
          </div>
          <div class="heading">Reset Your Password</div>
          <div class="message">
            Hi ${firstName},<br><br>
            We received a request to reset your HomeVista password. Use the verification code below to complete the process.
          </div>
          <div class="code-box">
            <div class="code">${code}</div>
            <div class="expiry">⏱️ This code expires in 15 minutes</div>
          </div>
          <div class="warning">
            <strong>Didn't request this?</strong> If you didn't ask for a password reset, you can safely ignore this email. Your account is secure.
          </div>
          <div class="footer">
            HomeVista Real Estate Platform<br>
            This is an automated message. Please do not reply.
          </div>
        </div>
      </body>
      </html>
    `,
    text: `HomeVista Password Reset\n\nHi ${firstName},\n\nYour password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request this, please ignore this email.`,
  };

  await transporter.sendMail(mailOptions);
  console.log(`📧 Password reset code sent to ${email}`);
};

module.exports = {
  sendPasswordResetCode,
  transporter,
};