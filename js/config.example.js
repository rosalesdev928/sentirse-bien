// Copia este archivo como js/config.js:  cp js/config.example.js js/config.js
//
// Con SUPABASE_URL vacío el sitio funciona en MODO DEMO: los horarios y las citas
// se guardan solo en tu navegador (localStorage) y no se conecta a ninguna base de datos.
// Para usar Supabase, completa la URL del proyecto y la clave anon en js/config.js.
export const CONFIG = {
  SUPABASE_URL: '', // ejemplo: 'https://tu-proyecto.supabase.co'
  SUPABASE_ANON_KEY: '',

  // Valores ficticios: con código de país, sin + ni espacios.
  WHATSAPP: '51000000000',
  EMAIL: 'correo@ejemplo.com',

  TIMEZONE: 'America/Lima',
};
