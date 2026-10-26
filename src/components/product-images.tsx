import { addImagesAction, deleteImageAction, moveImageAction, setPrimaryImageAction, updateImageAltAction } from "@/app/actions/catalog";
import type { ProductImage } from "@/server/modules/catalog/images";
import { ConfirmAction } from "./confirm-action";
import { ActionForm, FieldError, SubmitButton } from "./form";
import { Badge, buttonClass, Hint, inputClass } from "./ui";

// Gestión de fotos del producto: principal, orden, texto alternativo y borrado.
export function ProductImages({ productId, productName, images, canWrite, max }: { productId: string; productName: string; images: ProductImage[]; canWrite: boolean; max: number }) {
  return (
    <div className="space-y-4">
      {images.length === 0 ? (
        <p className="text-sm text-muted">Este producto no tiene fotos.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Fotos del producto">
          {images.map((img, i) => (
            <li key={img.id} className="rounded-lg border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.altText || productName} loading="lazy" className="aspect-square w-full rounded-md object-cover" />
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {img.isPrimary && <Badge tone="primary">Principal</Badge>}
                <span className="text-xs text-muted">{Math.round(img.size / 1024)} KB</span>
              </div>
              {canWrite && (
                <div className="mt-2 space-y-2">
                  <ActionForm action={updateImageAltAction} className="space-y-1">
                    <input type="hidden" name="productId" value={productId} />
                    <input type="hidden" name="imageId" value={img.id} />
                    <label htmlFor={`alt-${img.id}`} className="block text-xs font-medium">
                      Descripción de la foto
                    </label>
                    <input id={`alt-${img.id}`} name="altText" defaultValue={img.altText} maxLength={200} className={inputClass} />
                    <FieldError name="altText" />
                    <SubmitButton variant="secondary" className="h-8 w-full text-xs">
                      Guardar descripción
                    </SubmitButton>
                  </ActionForm>
                  <div className="flex flex-wrap gap-1">
                    {!img.isPrimary && (
                      <ActionForm action={setPrimaryImageAction} className="space-y-0">
                        <input type="hidden" name="productId" value={productId} />
                        <input type="hidden" name="imageId" value={img.id} />
                        <button type="submit" className={buttonClass("secondary", "sm")}>
                          Hacer principal
                        </button>
                      </ActionForm>
                    )}
                    {i > 0 && (
                      <ActionForm action={moveImageAction} className="space-y-0">
                        <input type="hidden" name="productId" value={productId} />
                        <input type="hidden" name="imageId" value={img.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button type="submit" className={buttonClass("ghost", "sm")} aria-label={`Mover la foto ${i + 1} antes`}>
                          ←
                        </button>
                      </ActionForm>
                    )}
                    {i < images.length - 1 && (
                      <ActionForm action={moveImageAction} className="space-y-0">
                        <input type="hidden" name="productId" value={productId} />
                        <input type="hidden" name="imageId" value={img.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button type="submit" className={buttonClass("ghost", "sm")} aria-label={`Mover la foto ${i + 1} después`}>
                          →
                        </button>
                      </ActionForm>
                    )}
                    <ConfirmAction action={deleteImageAction} hidden={{ productId, imageId: img.id }} label="Eliminar" size="sm" title="¿Eliminar esta foto?" confirmLabel="Eliminar" />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && images.length < max && (
        <ActionForm action={addImagesAction} resetOnSuccess>
          <input type="hidden" name="productId" value={productId} />
          <div>
            <label htmlFor="new-images" className="mb-1 block text-sm font-medium">
              Agregar fotos
            </label>
            <input id="new-images" name="images" type="file" multiple accept="image/png,image/jpeg,image/webp" className="block text-sm" />
            <Hint>
              JPG, PNG o WEBP de máximo 2 MB cada una. Puedes tener hasta {max} fotos (quedan {max - images.length}).
            </Hint>
            <FieldError name="images" />
            <FieldError name="image" />
          </div>
          <SubmitButton variant="secondary">Subir fotos</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
