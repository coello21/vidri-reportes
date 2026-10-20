-- Cambia el correo por el tuyo (el mismo con el que vas a entrar) y corre esta consulta.
-- Para dar acceso a otra persona más adelante, agrega otra línea igual con su correo.
insert into public.app_usuarios (email) values ('TU_CORREO@ejemplo.com')
on conflict (email) do nothing;
