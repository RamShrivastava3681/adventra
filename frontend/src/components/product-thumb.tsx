import { Package } from "lucide-react";
import { useSignedImageUrl } from "@/lib/s3-image";

/**
 * Product catalogue thumbnail. Shows the product image (resolved to a signed
 * URL because the S3 bucket is private) or a package placeholder when there is
 * no image — or while the signed URL is still loading.
 */
export function ProductThumb({
  imageUrl,
  name,
  size = "md",
  rounded = "lg",
  className,
}: {
  imageUrl: string | null | undefined;
  name?: string;
  size?: "sm" | "md";
  rounded?: "md" | "lg";
  className?: string;
}) {
  const src = useSignedImageUrl(imageUrl);
  const box = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const icon = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  const radius = rounded === "md" ? "rounded-md" : "rounded-lg";
  const extra = className ?? "";

  if (imageUrl && src) {
    return (
      <img
        src={src}
        alt={name ?? "Product"}
        className={`${box} ${radius} shrink-0 border border-border object-cover shadow-sm ${extra}`}
      />
    );
  }
  return (
    <span
      className={`grid ${box} ${radius} shrink-0 place-items-center border border-border/60 bg-muted/60 text-muted-foreground ${extra}`}
    >
      <Package className={icon} />
    </span>
  );
}
