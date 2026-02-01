const axios = require('axios');

const welcomeemail = async (email, username, tempPassword) => {
    const apiKey = process.env.BREVO_API_KEY;
    const url = 'https://api.brevo.com/v3/smtp/email';

    const emailData = {
        sender: {
            name: 'Vaibhav Jewellers bill tracker',
            email: 'hippocloudtechnologies@gmail.com',
        },
        to: [{ email }],
        subject: 'Login Credentials for Your Account',
        htmlContent:  `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; box-shadow: 0px 4px 8px rgba(0, 0, 0, 0.1);">
    <!-- Logo Section -->
    <div style="text-align: center; margin-bottom: 20px;">
        <h2 style="color: #2c3e50; font-size: 24px; margin: 0;">Welcome to PettyCash</h2>
    </div>

    <!-- Welcome Message -->
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
        Dear <strong>${username}</strong>,
    </p>
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
        Your account has been created successfully. Please use the following credentials to log in:
    </p>

    <!-- Credentials Section -->
    <ul style="list-style-type: none; padding: 0; margin: 20px 0; font-size: 16px; color: #555;">
        <li style="margin-bottom: 10px;"><strong>Email:</strong> ${email}</li>
        <li><strong>Temporary Password:</strong> ${tempPassword}</li>
    </ul>

    <!-- Instructions -->
    <p style="color: #555; font-size: 16px; line-height: 1.6;">
        Please update your password upon first login to ensure your account's security.
    </p>

    <!-- Footer -->
    <div style="margin-top: 20px; text-align: center; border-top: 1px solid #ddd; padding-top: 10px;">
        <p style="font-size: 14px; color: #aaa;">If you have any questions, feel free to contact us at <a href="mailto:sandeep@vaibhavjewellers.com" style="color: #3498db;">sandeep@vaibhavjewellers.com</a>.</p>
        <p style="font-size: 14px; color: #aaa;">Thank you for choosing PettyCash🤝🏻🤝🏻!</p>
    </div>
</div>`,
    };

    try {
        const response = await axios.post(url, emailData, {
            headers: {
                'accept': 'application/json',
                'Content-Type': 'application/json',
                'api-key': apiKey,
            },
        });
        return response.data;
    } catch (error) {
        console.error('Full error object:', error);
        if (error.response) {
            console.error('Error response data:', error.response.data);
        }
        throw new Error(`Failed to send email: ${error.message}`);
    }
};

module.exports = { welcomeemail };