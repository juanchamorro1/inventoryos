-- Lista de TODAS las empresas para administradores de plataforma (solo lectura de la fila de la empresa).
-- Usa una variable propia, app.platform_user_id, y no app.user_id: varias consultas leen `organizations` sin filtro
-- confiando en que RLS deja solo la empresa activa, y un administrador también puede ser miembro de una empresa.
-- La variable solo la fija listAllCompanies dentro de su transacción, y la política revalida contra platform_admins.
CREATE POLICY org_platform_admin_read ON organizations FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM platform_admins pa
    JOIN users u ON u.id = pa.user_id
    WHERE pa.user_id = NULLIF(current_setting('app.platform_user_id', true), '')::uuid AND u.is_active
  )
);
