/** @type {import('next').NextConfig} */
export default {
  // El SDK de QVAC carga binarios nativos: no se puede empaquetar en el bundle.
  serverExternalPackages: ['@qvac/sdk', 'sharp'],
};
