import type { Metadata } from 'next';
import Kit from './kit';

export const metadata: Metadata = {
  title: 'Marca · ATLAS NEX',
  description: 'Hoja de marca: nombre, isotipo, lockup, color, tipografía, estado y voz',
};

export default function MarcaPage() {
  return <Kit />;
}
