use crate::atomic_io::write_atomic;
use crate::domain::types::BackgroundImage;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const BACKGROUND_DIRECTORY: &str = "background";

#[derive(Debug, thiserror::Error)]
pub enum BackgroundImageError {
    #[error("the background image exceeds the size limit")]
    TooLarge,
    #[error("the selected file is not a supported background image")]
    UnsupportedImage,
    #[error("the background image reference is invalid")]
    InvalidReference,
    #[error("the background image file is missing")]
    Missing,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl fmt::Display for BackgroundImage {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} (revision {})", self.file_name, self.revision)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Avif,
    Bmp,
    Gif,
    Ico,
    Jpeg,
    Png,
    Webp,
}

impl ImageFormat {
    fn file_name(self) -> &'static str {
        match self {
            Self::Avif => "background.avif",
            Self::Bmp => "background.bmp",
            Self::Gif => "background.gif",
            Self::Ico => "background.ico",
            Self::Jpeg => "background.jpg",
            Self::Png => "background.png",
            Self::Webp => "background.webp",
        }
    }
}

pub fn valid_reference(image: &BackgroundImage) -> bool {
    image.revision > 0
        && Path::new(&image.file_name).file_name().is_some_and(|name| {
            name.to_str() == Some(image.file_name.as_str())
                && image.file_name.starts_with("background.")
                && ImageFormat::from_file_name(&image.file_name).is_some()
        })
}

pub fn normalize_reference(image: Option<BackgroundImage>) -> Option<BackgroundImage> {
    image.filter(valid_reference)
}

pub fn directory(data_root: &Path) -> PathBuf {
    data_root.join(BACKGROUND_DIRECTORY)
}

pub fn read(data_root: &Path, image: &BackgroundImage) -> Result<Vec<u8>, BackgroundImageError> {
    if !valid_reference(image) {
        return Err(BackgroundImageError::InvalidReference);
    }

    let path = image_path(data_root, &image.file_name)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            BackgroundImageError::Missing
        } else {
            BackgroundImageError::Io(error)
        }
    })?;
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err(BackgroundImageError::TooLarge);
    }

    let bytes = fs::read(path)?;
    detect_format(&bytes)?;
    Ok(bytes)
}

pub struct SavedBackgroundImage {
    pub image: BackgroundImage,
    pub format: ImageFormat,
}

pub fn save(
    data_root: &Path,
    previous_revision: u64,
    bytes: &[u8],
) -> Result<SavedBackgroundImage, BackgroundImageError> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(BackgroundImageError::TooLarge);
    }
    let format = detect_format(bytes)?;
    let file_name = format.file_name();
    write_atomic(&image_path(data_root, file_name)?, bytes)?;

    Ok(SavedBackgroundImage {
        image: BackgroundImage {
            file_name: file_name.to_string(),
            revision: previous_revision.saturating_add(1),
        },
        format,
    })
}

/// Removes every generated background file except the current one. Failures
/// are non-fatal: the new image and its configuration reference are already
/// durable by the time cleanup runs.
pub fn remove_stale_files(data_root: &Path, keep: Option<&str>) {
    let Ok(entries) = fs::read_dir(directory(data_root)) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if Some(file_name) == keep || ImageFormat::from_file_name(file_name).is_none() {
            continue;
        }
        let _ = fs::remove_file(entry.path());
    }
}

pub fn remove(data_root: &Path) {
    remove_stale_files(data_root, None);
}

fn image_path(data_root: &Path, file_name: &str) -> Result<PathBuf, BackgroundImageError> {
    let reference = BackgroundImage {
        file_name: file_name.to_string(),
        revision: 1,
    };
    if !valid_reference(&reference) {
        return Err(BackgroundImageError::InvalidReference);
    }
    Ok(directory(data_root).join(file_name))
}

fn detect_format(bytes: &[u8]) -> Result<ImageFormat, BackgroundImageError> {
    [
        (b"\x89PNG\r\n\x1a\n".as_slice(), ImageFormat::Png),
        (b"GIF87a", ImageFormat::Gif),
        (b"GIF89a", ImageFormat::Gif),
        (b"BM", ImageFormat::Bmp),
    ]
    .into_iter()
    .find(|(signature, _)| bytes.starts_with(signature))
    .map(|(_, format)| format)
    .or_else(|| {
        if bytes.starts_with(b"\xff\xd8\xff") {
            Some(ImageFormat::Jpeg)
        } else if bytes.starts_with(&[0, 0, 1, 0]) {
            Some(ImageFormat::Ico)
        } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
            Some(ImageFormat::Webp)
        } else if is_avif(bytes) {
            Some(ImageFormat::Avif)
        } else {
            None
        }
    })
    .ok_or(BackgroundImageError::UnsupportedImage)
}

fn is_avif(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    let end = bytes.len().min(8 + 32);
    bytes[8..end]
        .chunks_exact(4)
        .any(|brand| brand == b"avif" || brand == b"avis" || brand == b"av01")
}

impl ImageFormat {
    fn from_file_name(file_name: &str) -> Option<Self> {
        match file_name {
            "background.avif" => Some(Self::Avif),
            "background.bmp" => Some(Self::Bmp),
            "background.gif" => Some(Self::Gif),
            "background.ico" => Some(Self::Ico),
            "background.jpg" => Some(Self::Jpeg),
            "background.png" => Some(Self::Png),
            "background.webp" => Some(Self::Webp),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference(file_name: &str) -> BackgroundImage {
        BackgroundImage {
            file_name: file_name.to_string(),
            revision: 1,
        }
    }

    #[test]
    fn detects_supported_image_headers() {
        let cases = [
            (&b"\x89PNG\r\n\x1a\nimage"[..], ImageFormat::Png),
            (b"\xff\xd8\xffimage", ImageFormat::Jpeg),
            (b"GIF89aimage", ImageFormat::Gif),
            (b"BMimage", ImageFormat::Bmp),
            (b"\0\0\x01\0image", ImageFormat::Ico),
            (b"RIFF\x0c\0\0\0WEBPdata", ImageFormat::Webp),
            (b"\0\0\0\x18ftypavifavifmif1", ImageFormat::Avif),
        ];

        for (bytes, expected) in cases {
            assert_eq!(detect_format(bytes).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_non_images_and_oversized_data() {
        assert!(matches!(
            detect_format(b"<svg xmlns=\"example\"></svg>"),
            Err(BackgroundImageError::UnsupportedImage)
        ));
        let bytes = vec![0x89; MAX_IMAGE_BYTES + 1];
        assert!(matches!(
            save(Path::new("/unused"), 0, &bytes),
            Err(BackgroundImageError::TooLarge)
        ));
    }

    #[test]
    fn validates_generated_references_only() {
        assert!(valid_reference(&reference("background.png")));
        for file_name in [
            "../background.png",
            "/background.png",
            "interface/background.png",
            "background.svg",
            "background.png.bak",
        ] {
            assert!(!valid_reference(&reference(file_name)));
        }
    }

    #[test]
    fn save_replace_read_and_cleanup_files() {
        let root = tempfile::tempdir().unwrap();
        let png = b"\x89PNG\r\n\x1a\nfirst";
        let saved = save(root.path(), 3, png).unwrap();
        assert_eq!(saved.image.file_name, "background.png");
        assert_eq!(saved.image.revision, 4);

        let webp = b"RIFF\x0c\0\0\0WEBPdata";
        let replacement = save(root.path(), 4, webp).unwrap();
        assert_eq!(replacement.image.file_name, "background.webp");
        assert_eq!(replacement.image.revision, 5);
        remove_stale_files(root.path(), Some("background.webp"));

        assert_eq!(
            read(root.path(), &replacement.image).unwrap(),
            webp.to_vec()
        );
        assert!(matches!(
            read(root.path(), &saved.image),
            Err(BackgroundImageError::Missing)
        ));
    }

    #[test]
    fn read_rejects_an_oversized_file_before_reading_it() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("background.png");
        fs::write(&path, vec![0x89; MAX_IMAGE_BYTES + 1]).unwrap();

        assert!(matches!(
            read(root.path(), &reference("background.png")),
            Err(BackgroundImageError::TooLarge)
        ));
    }
}
