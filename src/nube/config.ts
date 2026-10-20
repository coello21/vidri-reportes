/**
 * Configuración de Supabase para la versión nueva.
 * Son los mismos valores de public/config.js (el Radar actual).
 * La clave pública puede ir aquí: los datos los protege la seguridad (RLS)
 * de la base. NUNCA pongas aquí la clave "service_role" o "secret".
 */
export const CONFIG = {
  SUPABASE_URL: 'https://mtyhrvvclqfhhwipfrli.supabase.co',
  SUPABASE_KEY: 'sb_publishable_yXZaP5J03Y8OJb_QjPyMGQ_u7JEZlyn',
  /** Días del Radar que se cargan al abrir (el resto queda en la base). */
  DIAS_RADAR: 120,
  /** Días de pedidos que se cargan (la pantalla usa 60). */
  DIAS_PEDIDOS: 62,
} as const;
