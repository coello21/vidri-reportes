/* =====================================================================
   Configuración de Supabase
   Supabase > Project Settings > API:
     - Project URL           -> SUPABASE_URL
     - Publishable key (o "anon public" en proyectos viejos) -> SUPABASE_KEY
   La clave pública puede ir aquí: los datos los protege la seguridad (RLS)
   de la base. NUNCA pongas aquí la clave "service_role" o "secret".
   ===================================================================== */
window.VIDRI_CLOUD = {
  SUPABASE_URL: 'https://mtyhrvvclqfhhwipfrli.supabase.co',
  SUPABASE_KEY: 'sb_publishable_yXZaP5J03Y8OJb_QjPyMGQ_u7JEZlyn',

  // Cuántos días del Radar se cargan al abrir la página (el resto queda en la base).
  DIAS_RADAR: 120,
  // Cuántos días de pedidos se cargan (la página usa 60).
  DIAS_PEDIDOS: 62,
};
