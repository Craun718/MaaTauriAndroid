import type { ReactNode } from "react";
import { useProjectImage } from "../lib/useProjectImage";

export function ProjectImage({
  path,
  alt = "",
  className,
  fallback,
}: {
  path?: string;
  alt?: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const source = useProjectImage(path);

  if (!source) return <>{fallback}</>;
  return <img src={source} alt={alt} className={className} />;
}
