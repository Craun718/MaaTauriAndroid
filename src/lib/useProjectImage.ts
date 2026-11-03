import { useEffect, useState, useSyncExternalStore } from "react";
import { readProjectImage } from "./api";
import {
  resourceGeneration,
  subscribeResourceGeneration,
} from "./resourceGeneration";

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

/**
 * Loads a Project Interface asset into an object URL. Subscribing to the
 * resource generation is what retries a failed read after resources change;
 * without it a mounted component would remember its first failure until the
 * user happened to navigate away and back.
 */
export function useProjectImage(path?: string): string | undefined {
  const generation = useSyncExternalStore(
    subscribeResourceGeneration,
    resourceGeneration,
    resourceGeneration,
  );
  const [source, setSource] = useState<string>();
  // Encode the generation into the dependency so a failed read retries when the
  // resource tree is adopted again, without suppressing hook dependency rules.
  const assetKey = path === undefined ? undefined : `${generation}:${path}`;

  useEffect(() => {
    if (!assetKey) return;
    const assetPath = assetKey.slice(assetKey.indexOf(":") + 1);
    let active = true;
    let objectUrl: string | undefined;

    void readProjectImage(assetPath)
      .then((bytes) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: imageMimeType(assetPath) }),
        );
        setSource(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetKey]);

  return source;
}
