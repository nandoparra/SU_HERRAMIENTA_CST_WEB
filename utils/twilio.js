```javascript
const twilio = require('twilio');

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

async function sendWhatsAppMessage(phone, message) {
    try {
        // Normalizar número
        if (!phone.startsWith('+')) {
            phone = '+57' + phone.replace(/[^0-9]/g, '').slice(-10);
        }

        const response = await twilioClient.messages.create({
            from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
            to: `whatsapp:${phone}`,
            body: message
        });

        return {
            success: true,
            messageId: response.sid,
            status: response.status,
            phone: phone
        };
    } catch (error) {
        console.error('Error Twilio:', error);
        return {
            success: false,
            error: error.message,
            phone: phone
        };
    }
}

module.exports = {
    sendWhatsAppMessage
};
```