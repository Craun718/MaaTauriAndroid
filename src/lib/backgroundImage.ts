import { useEffect, useState } from "react";
import { readBackgroundImage } from "./api";
import type { BackgroundImage } from "./types";

export function backgroundImageMimeType(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
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
 * A missing or unreadable local image falls back to the normal surface
 * background instead of making the shell fail; configuration cleanup can
 * repair the pointer on the next remove/import.
 */
export async function loadBackgroundImageObjectUrl(
  image: BackgroundImage,
  read = readBackgroundImage,
): Promise<string | undefined> {
  try {
    const bytes = await read();
    return URL.createObjectURL(
      new Blob([bytes], { type: backgroundImageMimeType(image.fileName) }),
    );
  } catch {
    return undefined;
  }
}

export function useBackgroundImageObjectUrl(
  image?: BackgroundImage,
): string | undefined {
  const fileName = image?.fileName;
  const revision = image?.revision;
  const [source, setSource] = useState<string>();

  useEffect(() => {
    if (!fileName || revision === undefined) {
      setSource(undefined);
      return;
    }

    let active = true;
    let objectUrl: string | undefined;
    void loadBackgroundImageObjectUrl({ fileName, revision }).then((url) => {
      if (!active) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setSource(url);
    });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileName, revision]);

  return source;
}
