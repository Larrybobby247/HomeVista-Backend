/**
 * HomeVista - Email Service
 * Sends transactional emails using Resend
 */

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL =
  process.env.EMAIL_FROM || 'HomeVista <noreply@accurrattehommes.com>';

/**
 * Send signup/email verification code
 */
const sendSignupVerificationCode = async (
  email,
  code,
  firstName = 'there'
) => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Verify Your HomeVista Account',

      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >

          <title>Verify Your HomeVista Account</title>

          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
                Roboto, sans-serif;
              background: #f5f5f5;
              margin: 0;
              padding: 20px;
            }

            .container {
              max-width: 480px;
              margin: 0 auto;
              background: #ffffff;
              border-radius: 16px;
              padding: 40px;
              box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            }

            .logo {
              text-align: center;
              margin-bottom: 32px;
            }

            .logo h1 {
              color: #003334;
              font-size: 28px;
              margin: 0;
            }

            .heading {
              font-size: 22px;
              font-weight: 700;
              color: #111827;
              text-align: center;
              margin-bottom: 12px;
            }

            .message {
              color: #6b7280;
              font-size: 15px;
              line-height: 1.6;
              text-align: center;
              margin-bottom: 28px;
            }

            .code-box {
              background: #f0fdf4;
              border: 2px dashed #22c55e;
              border-radius: 12px;
              padding: 24px;
              text-align: center;
              margin-bottom: 28px;
            }

            .code {
              font-size: 36px;
              font-weight: 800;
              color: #003334;
              letter-spacing: 8px;
              font-family: 'Courier New', monospace;
            }

            .expiry {
              color: #ef4444;
              font-size: 13px;
              margin-top: 12px;
              font-weight: 500;
            }

            .footer {
              text-align: center;
              color: #9ca3af;
              font-size: 13px;
              margin-top: 32px;
              border-top: 1px solid #e5e7eb;
              padding-top: 20px;
            }
          </style>
        </head>

        <body>
          <div class="container">

            <div class="logo">
              <h1>HomeVista</h1>
            </div>

            <div class="heading">
              Verify Your Email
            </div>

            <div class="message">
              Hi ${firstName},<br><br>

              Welcome to HomeVista! Use the verification code below
              to verify your email address and activate your account.
            </div>

            <div class="code-box">
              <div class="code">${code}</div>

              <div class="expiry">
                ⏱️ This code expires in 15 minutes
              </div>
            </div>

            <div class="footer">
              HomeVista Real Estate Platform<br>
              This is an automated message. Please do not reply.
            </div>

          </div>
        </body>
        </html>
      `,

      text: `
HomeVista Email Verification

Hi ${firstName},

Welcome to HomeVista!

Your email verification code is:

${code}

This code expires in 15 minutes.

If you did not create a HomeVista account, please ignore this email.
      `,
    });

    if (error) {
      console.error('Resend signup verification error:', error);
      throw new Error('Failed to send verification email');
    }

    console.log(`📧 Signup verification code sent to ${email}`);

    return {
      success: true,
      id: data?.id,
    };

  } catch (error) {
    console.error('sendSignupVerificationCode error:', error);
    throw error;
  }
};

/**
 * Send password reset verification code email
 */
const sendPasswordResetCode = async (
  email,
  code,
  firstName = 'there'
) => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
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
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
                Roboto, sans-serif;
              background: #f5f5f5;
              margin: 0;
              padding: 20px;
            }

            .container {
              max-width: 480px;
              margin: 0 auto;
              background: #ffffff;
              border-radius: 16px;
              padding: 40px;
              box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            }

            .logo {
              text-align: center;
              margin-bottom: 32px;
            }

            .logo h1 {
              color: #003334;
              font-size: 28px;
              margin: 0;
            }

            .heading {
              font-size: 22px;
              font-weight: 700;
              color: #111827;
              margin-bottom: 12px;
              text-align: center;
            }

            .message {
              color: #6b7280;
              font-size: 15px;
              line-height: 1.6;
              margin-bottom: 28px;
              text-align: center;
            }

            .code-box {
              background: #f0fdf4;
              border: 2px dashed #22c55e;
              border-radius: 12px;
              padding: 24px;
              text-align: center;
              margin-bottom: 28px;
            }

            .code {
              font-size: 36px;
              font-weight: 800;
              color: #003334;
              letter-spacing: 8px;
              font-family: 'Courier New', monospace;
            }

            .expiry {
              color: #ef4444;
              font-size: 13px;
              margin-top: 12px;
              font-weight: 500;
            }

            .footer {
              text-align: center;
              color: #9ca3af;
              font-size: 13px;
              margin-top: 32px;
              border-top: 1px solid #e5e7eb;
              padding-top: 20px;
            }

            .warning {
              background: #fef3c7;
              border-radius: 8px;
              padding: 12px 16px;
              font-size: 13px;
              color: #92400e;
              margin-top: 20px;
            }
          </style>
        </head>

        <body>
          <div class="container">

            <div class="logo">
              <h1>HomeVista</h1>
            </div>

            <div class="heading">
              Reset Your Password
            </div>

            <div class="message">
              Hi ${firstName},<br><br>

              We received a request to reset your HomeVista password.
              Use the verification code below to complete the process.
            </div>

            <div class="code-box">
              <div class="code">${code}</div>

              <div class="expiry">
                ⏱️ This code expires in 15 minutes
              </div>
            </div>

            <div class="warning">
              <strong>Didn't request this?</strong>
              If you didn't ask for a password reset, you can safely
              ignore this email. Your account is secure.
            </div>

            <div class="footer">
              HomeVista Real Estate Platform<br>
              This is an automated message. Please do not reply.
            </div>

          </div>
        </body>
        </html>
      `,

      text: `
HomeVista Password Reset

Hi ${firstName},

Your password reset code is: ${code}

This code expires in 15 minutes.

If you didn't request this, please ignore this email.
      `,
    });

    if (error) {
      console.error('Resend password reset error:', error);
      throw new Error('Failed to send password reset email');
    }

    console.log(`📧 Password reset code sent to ${email}`);

    return {
      success: true,
      id: data?.id,
    };
  } catch (error) {
    console.error('sendPasswordResetCode error:', error);
    throw error;
  }
};


/**
 * Send payment request email
 *
 * @param {Object} paymentData
 * @param {string} paymentData.email - User's email
 * @param {string} paymentData.firstName - User's first name
 * @param {number|string} paymentData.amount - Payment amount
 * @param {string} paymentData.description - What the payment is for
 * @param {string} paymentData.reference - Payment reference
 * @param {string} paymentData.paymentLink - Optional payment URL
 */
const sendPaymentRequest = async ({
  email,
  firstName = 'there',
  amount,
  description,
  reference,
  paymentLink,
}) => {
  try {
    const formattedAmount = new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      maximumFractionDigits: 0,
    }).format(Number(amount));

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Payment Request - ${formattedAmount} | HomeVista`,

      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >

          <title>Payment Request</title>

          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
                Roboto, sans-serif;
              background: #f5f5f5;
              margin: 0;
              padding: 20px;
            }

            .container {
              max-width: 520px;
              margin: 0 auto;
              background: #ffffff;
              border-radius: 16px;
              padding: 40px;
              box-shadow: 0 4px 24px rgba(0,0,0,0.08);
            }

            .logo {
              text-align: center;
              margin-bottom: 30px;
            }

            .logo h1 {
              color: #003334;
              font-size: 28px;
              margin: 0;
            }

            .heading {
              color: #111827;
              font-size: 22px;
              font-weight: 700;
              text-align: center;
              margin-bottom: 12px;
            }

            .message {
              color: #6b7280;
              font-size: 15px;
              line-height: 1.6;
              text-align: center;
              margin-bottom: 28px;
            }

            .amount-box {
              background: #f0fdf4;
              border-radius: 12px;
              padding: 24px;
              text-align: center;
              margin-bottom: 24px;
            }

            .amount-label {
              color: #6b7280;
              font-size: 13px;
              margin-bottom: 8px;
            }

            .amount {
              color: #003334;
              font-size: 32px;
              font-weight: 800;
            }

            .details {
              background: #f9fafb;
              border-radius: 10px;
              padding: 18px;
              margin-bottom: 24px;
            }

            .detail {
              display: block;
              padding: 8px 0;
              border-bottom: 1px solid #e5e7eb;
              color: #374151;
              font-size: 14px;
            }

            .detail:last-child {
              border-bottom: none;
            }

            .label {
              color: #6b7280;
            }

            .button-wrapper {
              text-align: center;
              margin: 28px 0;
            }

            .button {
              display: inline-block;
              background: #003334;
              color: #ffffff !important;
              text-decoration: none;
              padding: 14px 28px;
              border-radius: 10px;
              font-weight: 700;
              font-size: 15px;
            }

            .reference {
              color: #9ca3af;
              font-size: 12px;
              text-align: center;
              word-break: break-all;
            }

            .footer {
              text-align: center;
              color: #9ca3af;
              font-size: 13px;
              margin-top: 32px;
              border-top: 1px solid #e5e7eb;
              padding-top: 20px;
            }
          </style>
        </head>

        <body>
          <div class="container">

            <div class="logo">
              <h1>HomeVista</h1>
            </div>

            <div class="heading">
              Payment Request
            </div>

            <div class="message">
              Hi ${firstName},<br><br>

              You have received a payment request through
              HomeVista. Please review the details below.
            </div>

            <div class="amount-box">
              <div class="amount-label">
                Amount Requested
              </div>

              <div class="amount">
                ${formattedAmount}
              </div>
            </div>

            <div class="details">

              <div class="detail">
                <span class="label">Description:</span><br>
                <strong>${description}</strong>
              </div>

              <div class="detail">
                <span class="label">Reference:</span><br>
                <strong>${reference}</strong>
              </div>

            </div>

            ${
              paymentLink
                ? `
                  <div class="button-wrapper">
                    <a
                      href="${paymentLink}"
                      class="button"
                    >
                      Proceed to Payment
                    </a>
                  </div>
                `
                : ''
            }

            <div class="reference">
              Payment reference: ${reference}
            </div>

            <div class="footer">
              HomeVista Real Estate Platform<br>
              This is an automated message. Please do not reply.
            </div>

          </div>
        </body>
        </html>
      `,

      text: `
HomeVista Payment Request

Hi ${firstName},

You have received a payment request through HomeVista.

Amount: ${formattedAmount}
Description: ${description}
Reference: ${reference}

${paymentLink ? `Proceed to payment: ${paymentLink}` : ''}

HomeVista Real Estate Platform
      `,
    });

    if (error) {
      console.error('Resend payment request error:', error);
      throw new Error('Failed to send payment request email');
    }

    console.log(`📧 Payment request sent to ${email}`);

    return {
      success: true,
      id: data?.id,
    };
  } catch (error) {
    console.error('sendPaymentRequest error:', error);
    throw error;
  }
};


module.exports = {
  sendSignupVerificationCode, 
  sendPasswordResetCode,
  sendPaymentRequest,
};
