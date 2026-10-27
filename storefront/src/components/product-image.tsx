import Image from "next/image";

export function ProductImage({ image, sizes, priority = false }: { image: { id: string; alt: string } | undefined; sizes: string; priority?: boolean }) {
  if (!image) {
    return <div className="flex h-full w-full items-center justify-center bg-primary-soft text-sm text-muted">Sin foto</div>;
  }
  // /img/<id> es el proxy de la tienda: la foto se pide a InventoryOS con la clave en el servidor.
  return <Image src={`/img/${image.id}`} alt={image.alt} fill sizes={sizes} priority={priority} unoptimized className="object-cover" />;
}
