import { GoogleGenAI, Type } from "@google/genai";

export const geminiService = {
  suggestInspectionDetails: async (itemName: string): Promise<{ question: string, photoInstruction: string, requiresPhoto: boolean }> => {
    try {
      // Use process.env.API_KEY as per guidelines
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Eres un experto en seguridad industrial. Genera una configuración de inspección para el elemento: "${itemName}".
        
        Devuelve JSON con:
        1. question: Una pregunta técnica de seguridad (Si/No) concisa.
        2. requiresPhoto: booleano (true si el estado visual es crítico).
        3. photoInstruction: instrucción corta para la foto (si requiresPhoto es false, pon string vacio).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              requiresPhoto: { type: Type.BOOLEAN },
              photoInstruction: { type: Type.STRING }
            },
            required: ["question", "requiresPhoto", "photoInstruction"]
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");
      
      return JSON.parse(text);
    } catch (error) {
      console.error("Gemini suggestion failed:", error);
      return {
        question: `¿El elemento ${itemName} está en buenas condiciones?`,
        requiresPhoto: true,
        photoInstruction: `Foto del estado actual de ${itemName}`
      };
    }
  }
};