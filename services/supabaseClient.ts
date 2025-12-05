import { createClient } from '@supabase/supabase-js';

// --- CONFIGURACIÓN DE SUPABASE ---

// 1. Claves de Respaldo (Funcionan en local/preview)
const FALLBACK_URL = 'https://tdgyqgrzjkafxwfkqtix.supabase.co'; 
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkZ3lxZ3J6amthZnh3ZmtxdGl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MjEyODQsImV4cCI6MjA4MDQ5NzI4NH0.qplUc1Dy1dUdQgijek-J0cA1aMOxwqia_8W7LhmbxiY';

// 2. Intentar leer variables de entorno de Vite (Vercel/Producción)
// @ts-ignore
const envUrl = import.meta.env.VITE_SUPABASE_URL;
// @ts-ignore
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 3. Selección de Credenciales (Prioridad: Entorno > Fallback)
const SUPABASE_URL = (envUrl && envUrl.length > 0) ? envUrl : FALLBACK_URL;
const SUPABASE_ANON_KEY = (envKey && envKey.length > 0) ? envKey : FALLBACK_ANON_KEY;

// ---------------------------------

// Verificamos si las claves parecen válidas
const isConfigured = SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;

// Log para depuración
console.log(`[Supabase] Init: ${isConfigured ? 'OK' : 'MISSING CONFIG'} | URL: ${SUPABASE_URL}`);

// 4. FIX CRÍTICO: Almacenamiento "Fantasma"
// Definimos un storage en memoria que no hace nada.
// Esto evita que Supabase toque 'localStorage' o 'cookies', lo que causa el error 
// "Tracking Prevention blocked access to storage" en Edge y Safari.
const memoryStorage = {
  getItem: (key: string) => null,
  setItem: (key: string, value: string) => {},
  removeItem: (key: string) => {},
};

export const supabase = isConfigured 
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: memoryStorage, // Forzamos usar memoria interna, nunca el navegador
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }) 
  : null;

export const checkSupabaseConfig = () => isConfigured;
