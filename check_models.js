import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function debugModels() {
    try {
        // We list models and log the entire raw response
        const result = await ai.models.list();
        console.log("--- RAW API RESPONSE ---");
        console.log(JSON.stringify(result, null, 2));
    } catch (e) {
        console.error("API Error:", e.message);
    }
}
debugModels();
