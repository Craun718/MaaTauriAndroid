import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { readProjectImage } from "../lib/api";

function imageMimeType(path: string) {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "gif":
      return "image/gif";
    case "ico":
      return "image/x-icon";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

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
  const [source, setSource] = useState<string>();

  useEffect(() => {
    if (!path) return;
    let active = true;
    let objectUrl: string | undefined;

    void readProjectImage(path)
      .then((bytes) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: imageMimeType(path) }),
        );
        setSource(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!source) return <>{fallback}</>;
  return <img src={source} alt={alt} className={className} />;
}
