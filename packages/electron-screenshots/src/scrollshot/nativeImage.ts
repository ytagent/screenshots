import { nativeImage, type NativeImage } from 'electron';
import type { PixelImage } from 'scrollshot-core';

export function nativeImageToPixelImage(image: NativeImage): PixelImage {
  const size = image.getSize();
  return {
    width: size.width,
    height: size.height,
    data: new Uint8ClampedArray(image.toBitmap()),
  };
}

export function pixelImageToNativeImage(
  image: PixelImage,
  scaleFactor: number,
): NativeImage {
  return nativeImage.createFromBitmap(Buffer.from(image.data), {
    width: image.width,
    height: image.height,
    scaleFactor,
  });
}

export function cropNativeImageByDipBounds(
  image: NativeImage,
  bounds: { x: number; y: number; width: number; height: number },
  display: { width: number; height: number },
): { image: NativeImage; scaleFactor: number } {
  const size = image.getSize();
  const scaleX = size.width / display.width;
  const scaleY = size.height / display.height;
  const scaleFactor = Math.max(scaleX, scaleY);

  return {
    image: image.crop({
      x: Math.max(0, Math.round(bounds.x * scaleX)),
      y: Math.max(0, Math.round(bounds.y * scaleY)),
      width: Math.max(1, Math.round(bounds.width * scaleX)),
      height: Math.max(1, Math.round(bounds.height * scaleY)),
    }),
    scaleFactor,
  };
}
